#!/usr/bin/env bash
#
# mihomo(AnyTLS 入站) + usque(Cloudflare WARP MASQUE) 一键部署脚本
#
# 目录结构:
#   /opt/mihomo/compose.yaml              docker compose 编排文件
#   /opt/mihomo/mihomo_data/config.yaml   mihomo 配置(挂载到容器 /root/.config/mihomo/)
#   /opt/mihomo/mihomo_data/server.crt    自签名证书(ECDSA prime256v1)
#   /opt/mihomo/mihomo_data/server.key    证书私钥
#   /opt/mihomo/usque_data/config.json    usque 的 WARP 注册信息(删除后需重新注册)
#   /opt/mihomo/node-info.txt             生成的节点信息
#   /opt/mihomo/.deploy.env               部署参数(用于重新输出节点信息)

set -euo pipefail

INSTALL_DIR="/opt/mihomo"
DATA_DIR="${INSTALL_DIR}/mihomo_data"
USQUE_DIR="${INSTALL_DIR}/usque_data"
COMPOSE_FILE="${INSTALL_DIR}/compose.yaml"
CONFIG_FILE="${DATA_DIR}/config.yaml"
CRT_FILE="${DATA_DIR}/server.crt"
KEY_FILE="${DATA_DIR}/server.key"
NODE_FILE="${INSTALL_DIR}/node-info.txt"
STATE_FILE="${INSTALL_DIR}/.deploy.env"

MIHOMO_IMAGE="metacubex/mihomo:latest"
USQUE_IMAGE="superng6/usque:latest"

DEF_PORT="8443"
DEF_USER="alice"
DEF_SNI="www.iqiyi.com"

# usque 镜像内是否自带 nc(拉取镜像后探测，决定是否给 usque 配 healthcheck)
HAS_NC=0
IPV6_ONLY=0

# 无 tty 时(例如 curl | bash)不提问，全部使用默认值
INTERACTIVE=1
[ -t 0 ] || INTERACTIVE=0

if [ -t 1 ]; then
  C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_B=$'\033[36m'; C_0=$'\033[0m'
else
  C_R=''; C_G=''; C_Y=''; C_B=''; C_0=''
fi

info() { printf '%s\n' "${C_B}[*]${C_0} $*"; }
ok()   { printf '%s\n' "${C_G}[+]${C_0} $*"; }
warn() { printf '%s\n' "${C_Y}[!]${C_0} $*"; }
die()  { printf '%s\n' "${C_R}[x]${C_0} $*" >&2; exit 1; }

dc() { docker compose --project-directory "$INSTALL_DIR" -f "$COMPOSE_FILE" "$@"; }

# ------------------------------------------------------------------ 环境检查

require_root() {
  [ "$(id -u)" -eq 0 ] || die "需要 root 权限: sudo bash $0"
}

check_deps() {
  command -v docker >/dev/null 2>&1 \
    || die "未检测到 docker。本脚本不负责安装 Docker，请先安装后重试。"
  docker info >/dev/null 2>&1 \
    || die "docker 已安装但守护进程不可用，请检查: systemctl status docker"
  docker compose version >/dev/null 2>&1 \
    || die "未检测到 docker compose v2 插件(compose.yaml 与 depends_on 语法依赖它)。"
  command -v openssl >/dev/null 2>&1 \
    || die "未检测到 openssl，无法生成自签名证书。"
  ok "依赖检查通过: docker / docker compose v2 / openssl"
}

port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}\$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}\$"
  else
    return 1
  fi
}

# http_get <url> <-4|-6>
http_get() {
  local url="$1" fam="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$fam" --max-time 6 "$url" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$fam" --timeout=6 "$url" 2>/dev/null
  else
    return 1
  fi
}

# http_download <url> <dest>
http_download() {
  local url="$1" dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --max-time 180 -o "$dest" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=180 -O "$dest" "$url"
  else
    return 1
  fi
}

# ------------------------------------------------------------------ 参数收集

# ask <提示> <默认值>；结果写入 REPLY_VAL
ask() {
  local prompt="$1" default="$2" input=""
  if [ "$INTERACTIVE" -eq 0 ]; then
    REPLY_VAL="$default"
    return 0
  fi
  read -r -p "    ${prompt} [${default}]: " input || input=""
  REPLY_VAL="${input:-$default}"
}

# 交互模式下校验失败可重填，非交互模式直接中止
reject() {
  warn "$1"
  if [ "$INTERACTIVE" -eq 1 ]; then return 0; fi
  die "参数无效，非交互模式已中止。"
}

# config.yaml 里的用户名与密码不加引号，所以值本身不能被 YAML 当成数字或布尔值:
# 要求含至少一个字母，且不以 0x 开头(0x… 会被解析成十六进制整数)
yaml_safe_scalar() {
  case "$1" in
    0x*|0X*) return 1 ;;
  esac
  printf '%s' "$1" | grep -qE '[A-Za-z]'
}

collect_params() {
  local host
  host="$(hostname -s 2>/dev/null || echo mihomo)"
  [ -n "$host" ] || host="mihomo"

  info "填写部署参数(直接回车使用默认值):"

  while :; do
    ask "监听端口" "$DEF_PORT"; PORT="$REPLY_VAL"
    if ! printf '%s' "$PORT" | grep -qE '^[1-9][0-9]{0,4}$' || [ "$PORT" -gt 65535 ]; then
      reject "端口需为 1-65535 的整数。"
      continue
    fi
    if port_in_use "$PORT"; then
      reject "端口 ${PORT} 已被占用，请换一个。"
      continue
    fi
    break
  done

  while :; do
    ask "AnyTLS 用户名" "$DEF_USER"; ANYTLS_USER="$REPLY_VAL"
    if printf '%s' "$ANYTLS_USER" | grep -qE '^[A-Za-z0-9_.-]{1,32}$' \
       && yaml_safe_scalar "$ANYTLS_USER"; then
      break
    fi
    reject "用户名只能包含字母/数字/下划线/点/连字符，长度 1-32，且需含至少一个字母。"
  done

  # 密码要同时满足 YAML 与 Surge 单行格式的解析要求: 不含逗号、等号、引号、空格。
  local gen_pass
  gen_pass="$(openssl rand -hex 16)"
  while ! yaml_safe_scalar "$gen_pass"; do
    gen_pass="$(openssl rand -hex 16)"
  done
  while :; do
    ask "AnyTLS 密码" "$gen_pass"; PASSWORD="$REPLY_VAL"
    if printf '%s' "$PASSWORD" | grep -qE '^[A-Za-z0-9._~-]{8,64}$' \
       && yaml_safe_scalar "$PASSWORD"; then
      break
    fi
    reject "密码只能包含字母数字与 . _ ~ - ，长度 8-64，且需含至少一个字母。"
  done

  while :; do
    ask "伪装 SNI(同时用作自签证书 CN)" "$DEF_SNI"; SNI="$REPLY_VAL"
    if printf '%s' "$SNI" | grep -qE '^[A-Za-z0-9][A-Za-z0-9.-]{1,251}[A-Za-z0-9]$'; then break; fi
    reject "SNI 需为合法域名。"
  done

  while :; do
    ask "节点名称" "${host}-anytls"; NODE_NAME="$REPLY_VAL"
    case "$NODE_NAME" in
      ""|*,*|*=*|*\'*) reject "节点名称不能为空，且不能包含逗号、等号或单引号。"; continue ;;
    esac
    break
  done

  DEVICE_NAME="$host"
  detect_server_addr
}

detect_server_addr() {
  while :; do
    ask "服务器地址(留空自动探测公网 IP)" ""
    SERVER_ADDR="$(printf '%s' "$REPLY_VAL" | tr -d '[:space:]')"

    if [ -z "$SERVER_ADDR" ]; then
      info "探测公网 IP..."
      SERVER_ADDR="$(http_get https://api.ipify.org -4 || true)"
      if [ -z "$SERVER_ADDR" ]; then
        SERVER_ADDR="$(http_get https://ifconfig.me/ip -4 || true)"
      fi
      if [ -z "$SERVER_ADDR" ]; then
        SERVER_ADDR="$(http_get https://api6.ipify.org -6 || true)"
      fi
      SERVER_ADDR="$(printf '%s' "$SERVER_ADDR" | tr -d '[:space:]')"
      if [ -z "$SERVER_ADDR" ]; then
        reject "公网 IP 自动探测失败，请手动填写服务器地址。"
        continue
      fi
    fi

    # 地址会拼进 Surge 单行格式，逗号/等号/引号等字符必须挡掉
    if printf '%s' "$SERVER_ADDR" | grep -qE '^[A-Za-z0-9]([A-Za-z0-9._:-]*[A-Za-z0-9])?$'; then
      break
    fi
    reject "服务器地址只能是 IP 或域名(字母数字与 . : _ - )。"
  done

  # 含冒号即视为 IPv6，Docker 默认只在 IPv4 上发布端口，需显式指定 [::]
  case "$SERVER_ADDR" in
    *:*) IPV6_ONLY=1 ;;
  esac

  if [ "$IPV6_ONLY" -eq 1 ]; then
    PUBLISH_SPEC="[::]:${PORT}:${PORT}"
    warn "识别为 IPv6 地址，端口映射写作 [::]:${PORT}:${PORT}，这要求 Docker 已启用 ip6tables。"
  else
    PUBLISH_SPEC="${PORT}:${PORT}"
  fi
  ok "服务器地址: ${SERVER_ADDR}"
}

# ------------------------------------------------------------------ 部署

prepare_dirs() {
  mkdir -p "$DATA_DIR" "$USQUE_DIR"
  chmod 700 "$INSTALL_DIR"
  ok "目录就绪: ${INSTALL_DIR}"
}

pull_images() {
  info "拉取镜像..."
  docker pull -q "$USQUE_IMAGE" >/dev/null || die "拉取 ${USQUE_IMAGE} 失败，请检查网络。"
  docker pull -q "$MIHOMO_IMAGE" >/dev/null || die "拉取 ${MIHOMO_IMAGE} 失败，请检查网络。"
  ok "镜像就绪: ${MIHOMO_IMAGE} / ${USQUE_IMAGE}"
}

# usque 镜像内有 nc 才给它配 healthcheck，否则 healthcheck 会永远失败挡住 mihomo
probe_image_tools() {
  if docker run --rm --entrypoint sh "$USQUE_IMAGE" -c 'command -v nc' >/dev/null 2>&1; then
    HAS_NC=1
  fi
}

write_compose() {
  local depends_block
  if [ "$HAS_NC" -eq 1 ]; then
    depends_block='    depends_on:
      usque:
        condition: service_healthy'
  else
    depends_block='    depends_on:
      - usque'
  fi

  cat > "$COMPOSE_FILE" <<EOF
# ${COMPOSE_FILE} —— 由一键脚本生成
services:
  mihomo:
    image: ${MIHOMO_IMAGE}
    container_name: mihomo
    restart: unless-stopped
    volumes:
      - ./mihomo_data/:/root/.config/mihomo/
    networks:
      - proxy-net
    ports:
      - "${PUBLISH_SPEC}"
${depends_block}

  usque:
    image: ${USQUE_IMAGE}
    container_name: usque
    restart: unless-stopped
    environment:
      - USQUE_MODE=socks
      - USQUE_CONFIG=/app/config.json
      - USQUE_BIND=0.0.0.0
      - USQUE_PORT=1080
      - USQUE_MTU=1280
      - USQUE_DNS=1.1.1.1 8.8.8.8
      - USQUE_DEVICE_NAME=${DEVICE_NAME}
    volumes:
      - ./usque_data:/app
    networks:
      - proxy-net
    # 1080 故意不发布到宿主: 本地 SOCKS5 链路是明文的，只在 proxy-net 内部可达
EOF

  if [ "$HAS_NC" -eq 1 ]; then
    cat >> "$COMPOSE_FILE" <<'EOF'
    healthcheck:
      test: ["CMD-SHELL", "nc -z 127.0.0.1 1080 || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 15s
EOF
  fi

  cat >> "$COMPOSE_FILE" <<'EOF'

networks:
  proxy-net:
    driver: bridge
    name: proxy-net
EOF
  ok "已写入 ${COMPOSE_FILE}"
}

write_config() {
  cat > "$CONFIG_FILE" <<EOF
# ${CONFIG_FILE}
log-level: warning

geodata-mode: true
geo-auto-update: true
geo-update-interval: 24

listeners:
  - name: anytls-in
    type: anytls
    port: ${PORT}
    listen: "::"
    users:
      ${ANYTLS_USER}: ${PASSWORD}
    certificate: ./server.crt
    private-key: ./server.key

proxies:
  - name: WARP
    type: socks5
    server: usque
    port: 1080
    udp: true

rules:
  - GEOSITE,telegram,WARP
  - GEOIP,telegram,WARP
  - MATCH,DIRECT
EOF
  chmod 600 "$CONFIG_FILE"
  ok "已写入 ${CONFIG_FILE}"
}

register_usque() {
  if [ -s "${USQUE_DIR}/config.json" ]; then
    ok "已存在 usque 注册信息，跳过注册。"
    return 0
  fi
  info "注册 usque(Cloudflare WARP)..."
  if ! dc run --rm usque register -a; then
    warn "显式 register 失败，改用容器首次启动时的自动注册流程。"
    dc up -d usque || die "usque 启动失败。"
  fi

  local i
  for i in $(seq 1 30); do
    if [ -s "${USQUE_DIR}/config.json" ]; then break; fi
    sleep 2
  done
  if [ ! -s "${USQUE_DIR}/config.json" ]; then
    die "usque 注册失败(未生成 config.json)。Cloudflare 可能限流，请稍后重试；日志: docker compose -f ${COMPOSE_FILE} logs usque"
  fi
  ok "usque 注册完成。"
}

generate_cert() {
  if [ -f "$CRT_FILE" ] && [ -f "$KEY_FILE" ]; then
    local cn c=""
    cn="$(openssl x509 -noout -subject -in "$CRT_FILE" 2>/dev/null \
          | sed 's/^.*CN *= *//; s/,.*$//' || true)"
    warn "已存在自签名证书(CN=${cn:-未知})。重新生成会改变证书指纹，已导入的客户端需要更新节点。"
    if [ "$INTERACTIVE" -eq 1 ]; then
      read -r -p "    是否重新生成证书? [y/N]: " c || c=""
    fi
    case "$c" in
      y|Y|yes|YES) ;;
      *) ok "沿用现有证书。"; return 0 ;;
    esac
  fi

  info "生成自签名证书(ECDSA prime256v1, CN=${SNI}, 有效期 36500 天)..."
  # 不用 -newkey ec:<(openssl ecparam ...)，进程替换是 bash 专属语法；
  # 这里优先用 -pkeyopt，失败再回退到临时参数文件，两种写法都不依赖 shell 特性。
  if ! openssl req -x509 -nodes \
        -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
        -keyout "$KEY_FILE" -out "$CRT_FILE" \
        -subj "/CN=${SNI}" -days 36500 >/dev/null 2>&1; then
    local param
    param="$(mktemp)"
    if ! openssl ecparam -name prime256v1 -out "$param" >/dev/null 2>&1; then
      rm -f "$param"; die "openssl 生成 EC 参数失败。"
    fi
    if ! openssl req -x509 -nodes -newkey "ec:${param}" \
          -keyout "$KEY_FILE" -out "$CRT_FILE" \
          -subj "/CN=${SNI}" -days 36500 >/dev/null 2>&1; then
      rm -f "$param"; die "openssl 生成自签名证书失败。"
    fi
    rm -f "$param"
  fi
  chmod 600 "$KEY_FILE"
  chmod 644 "$CRT_FILE"
  ok "证书已生成: ${CRT_FILE}"
}

# mihomo 在 dat 模式下启动时若本地没有 GeoSite.dat / GeoIP.dat 会自行下载，
# 下载失败会让配置初始化直接失败、容器起不来。这里先用宿主机的 curl/wget 尽力预置
# (宿主机通常比容器内更容易连通)，失败也不阻断部署，只是给出提示。
seed_geodata() {
  local base="https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest"
  local missing=0 name remote
  for name in GeoSite.dat GeoIP.dat; do
    if [ -s "${DATA_DIR}/${name}" ]; then
      continue
    fi
    case "$name" in
      GeoSite.dat) remote="geosite.dat" ;;
      *)           remote="geoip.dat" ;;
    esac
    info "预置 ${name}(GEOSITE/GEOIP 规则需要，约 4MB / 17MB)..."
    if http_download "${base}/${remote}" "${DATA_DIR}/${name}"; then
      ok "${name} 就绪。"
    else
      rm -f "${DATA_DIR}/${name}"
      missing=1
      warn "${name} 下载失败，将由 mihomo 自行下载。"
    fi
  done
  if [ "$missing" -eq 1 ]; then
    warn "若容器内也下不到 geo 数据，mihomo 会因规则初始化失败而无法启动。"
    warn "届时可手动放置到 ${DATA_DIR}/，或在 config.yaml 里配置 geox-url 换成可用镜像。"
  fi
}

start_stack() {
  info "启动容器(有 healthcheck 时会等待 usque 就绪，可能需要十几秒)..."
  dc up -d || die "docker compose up -d 失败。"
}

wait_ready() {
  local name i state
  for name in usque mihomo; do
    state=""
    for i in $(seq 1 30); do
      state="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || true)"
      if [ "$state" = "running" ]; then break; fi
      sleep 2
    done
    if [ "$state" != "running" ]; then
      warn "容器 ${name} 未正常运行(状态: ${state:-不存在})，最后 20 行日志:"
      dc logs --no-color --tail 20 "$name" 2>&1 | sed 's/^/    /' || true
      die "部署未完成。完整日志: docker compose -f ${COMPOSE_FILE} logs ${name}"
    fi
  done

  local logs
  logs="$(dc logs --no-color --tail 200 2>/dev/null || true)"
  if printf '%s\n' "$logs" | grep -qiE 'level=(error|fatal)|parse config error'; then
    warn "启动日志中有错误，请人工确认:"
    printf '%s\n' "$logs" | grep -iE 'level=(error|fatal)|parse config error' | tail -n 10
  fi

  if port_in_use "$PORT"; then
    ok "容器已启动，宿主机 ${PORT} 端口在监听。"
  else
    warn "容器已启动，但未在宿主机上探测到 ${PORT} 端口监听，请检查端口映射。"
  fi
}

# ------------------------------------------------------------------ 输出

cert_fingerprint() {
  # Surge 的 server-cert-fingerprint-sha256 要求 64 位纯 hex，
  # 需去掉 openssl 输出的 "sha256 Fingerprint=" 前缀和冒号分隔符。
  openssl x509 -noout -fingerprint -sha256 -in "$CRT_FILE" \
    | sed 's/^.*=//; s/://g' | tr 'A-Z' 'a-z' | tr -d '[:space:]'
}

save_state() {
  cat > "$STATE_FILE" <<EOF
NODE_NAME='${NODE_NAME}'
SERVER_ADDR='${SERVER_ADDR}'
PORT='${PORT}'
ANYTLS_USER='${ANYTLS_USER}'
PASSWORD='${PASSWORD}'
SNI='${SNI}'
EOF
  chmod 600 "$STATE_FILE"
}

print_node() {
  local fp line
  fp="$(cert_fingerprint)"
  line="${NODE_NAME} = anytls,${SERVER_ADDR},${PORT},password=\"${PASSWORD}\",skip-cert-verify=true,sni=${SNI},server-cert-fingerprint-sha256=${fp}"

  printf '%s\n' "$line" > "$NODE_FILE"
  chmod 600 "$NODE_FILE"

  echo
  echo "=============================== 节点信息 ==============================="
  printf '%s\n' "$line"
  echo "======================================================================="
  echo
  echo "已保存到 ${NODE_FILE}(权限 600)。"
  echo "AnyTLS 认证只用密码，用户名 ${ANYTLS_USER} 仅是服务端的标签，客户端不需要填。"
  echo "指纹固定已替代证书链校验，skip-cert-verify=true 只是兜底。"
}

reprint_node() {
  [ -f "$STATE_FILE" ] || die "未找到 ${STATE_FILE}，无法重新输出节点信息。"
  [ -f "$CRT_FILE" ] || die "未找到证书 ${CRT_FILE}。"
  # shellcheck disable=SC1090
  . "$STATE_FILE"
  print_node
}

print_hints() {
  echo
  echo "常用管理命令(在 ${INSTALL_DIR} 下执行):"
  echo "    docker compose ps                  查看状态"
  echo "    docker compose logs -f mihomo      查看 mihomo 日志"
  echo "    docker compose restart mihomo      重启 mihomo"
  echo "    docker compose down                停止并移除容器(保留配置与 WARP 注册)"
  echo
  warn "本脚本不改动防火墙。若有安全组 / ufw / firewalld，请自行放行 TCP ${PORT}。"
  warn "删除 ${USQUE_DIR} 会丢失 WARP 注册信息，需重新注册。"
}

handle_existing() {
  [ -f "$COMPOSE_FILE" ] || return 0
  warn "检测到 ${INSTALL_DIR} 下已有部署。"
  if [ "$INTERACTIVE" -eq 0 ]; then
    die "非交互模式下不覆盖已有部署，已中止。"
  fi
  echo "    1) 重新部署(覆盖 compose.yaml 与 config.yaml，保留 WARP 注册信息)"
  echo "    2) 仅重新输出节点信息"
  echo "    3) 退出"
  local c=""
  read -r -p "    请选择 [3]: " c || c=""
  case "${c:-3}" in
    1)
      info "先停止现有容器..."
      dc down --remove-orphans || true
      ;;
    2) reprint_node; exit 0 ;;
    *) info "已退出。"; exit 0 ;;
  esac
}

main() {
  require_root
  check_deps
  handle_existing
  collect_params
  prepare_dirs
  pull_images
  probe_image_tools
  write_compose
  write_config
  register_usque
  generate_cert
  seed_geodata
  start_stack
  wait_ready
  save_state
  print_node
  print_hints
}

main "$@"
