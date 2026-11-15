#!/usr/bin/env bash
#
# Mihomo Docker Compose 一键部署与入站管理脚本
# 支持协议: AnyTLS (自签证书) / VLESS + Reality / 空协议(仅生成基础容器与配置文件)
#
# 目录结构:
#   /opt/mihomo/compose.yaml              docker compose 编排文件(含 Watchtower labels)
#   /opt/mihomo/mihomo_data/config.yaml   mihomo 配置(挂载到容器 /root/.config/mihomo/)
#   /opt/mihomo/mihomo_data/server*.crt   自签名证书(AnyTLS 模式生成, ECDSA prime256v1)
#   /opt/mihomo/mihomo_data/server*.key   证书私钥(AnyTLS 模式生成)
#   /opt/mihomo/node-info.txt             生成的节点信息
#   /opt/mihomo/.deploy.env               最近一次部署参数

set -euo pipefail

INSTALL_DIR="/opt/mihomo"
DATA_DIR="${INSTALL_DIR}/mihomo_data"
COMPOSE_FILE="${INSTALL_DIR}/compose.yaml"
CONFIG_FILE="${DATA_DIR}/config.yaml"
CRT_FILE="${DATA_DIR}/server.crt"
KEY_FILE="${DATA_DIR}/server.key"
NODE_FILE="${INSTALL_DIR}/node-info.txt"
STATE_FILE="${INSTALL_DIR}/.deploy.env"

MIHOMO_IMAGE="metacubex/mihomo:latest"

DEF_PROTO="anytls"
DEF_PORT="8443"
DEF_USER="alice"
DEF_CERT_CN="www.bing.com"

PROTOCOL=""
PORT=""
IPV6_ONLY=0
PUBLISH_SPEC=""
SERVER_ADDR=""
NODE_NAME=""

ANYTLS_USER=""
PASSWORD=""
SNI=""
CERT_REL="./server.crt"
KEY_REL="./server.key"

VLESS_USER=""
UUID=""
REALITY_SNI=""
REALITY_DEST=""
REALITY_PRIVATE_KEY=""
REALITY_PUBLIC_KEY=""
REALITY_SHORT_ID=""

CLI_PROTO=""
CLI_SNI=""
CLI_DEST=""
ACTION=""
COMPOSE_CHANGED=0
ADD_MODE=0

# 优先绑定终端输入，同时支持 curl ... | bash 与纯无终端自动化环境
INPUT_FD=0
if [ -t 0 ]; then
  INTERACTIVE=1
elif { exec 3</dev/tty; } 2>/dev/null; then
  INTERACTIVE=1
  INPUT_FD=3
else
  INTERACTIVE=0
fi

# ------------------------------------------------------------------ 展示工具

styled_text() {
  if [ -t 1 ] && [ "${TERM:-dumb}" != "dumb" ] && [ -z "${NO_COLOR:-}" ]; then
    printf '\033[%sm%s\033[0m' "$1" "$2"
  else
    printf '%s' "$2"
  fi
}

info()  { styled_text '36' "[提示] $*"; printf '\n'; }
ok()    { styled_text '32' "[成功] $*"; printf '\n'; }
warn()  { { styled_text '33' "[注意] $*"; printf '\n'; } >&2; }
error() { { styled_text '1;31' "[错误] $*"; printf '\n'; } >&2; }
die()   { error "$*"; exit 1; }

banner() {
  printf '\n'
  styled_text '1;36' '=================================================='
  printf '\n'
  styled_text '1;32' "  $*"
  printf '\n'
  styled_text '1;36' '=================================================='
  printf '\n'
}

rule() {
  styled_text '2' '--------------------------------------------------'
  printf '\n'
}

section() {
  printf '\n'
  styled_text '1;36' "  ── $* ──"
  printf '\n'
}

# 按 UTF-8 字节估算显示宽度，用于对齐详情标签
display_width() {
  local LC_ALL=C s=$1 i=0 len w=0 b
  len=${#s}
  while (( i < len )); do
    printf -v b '%d' "'${s:i:1}"
    if (( b < 128 )); then (( w += 1, i += 1 ))
    elif (( b < 224 )); then (( w += 1, i += 2 ))
    elif (( b < 240 )); then (( w += 2, i += 3 ))
    else (( w += 2, i += 4 ))
    fi
  done
  REPLY=$w
}

detail() {
  local label="$1" value="$2" pad=0 width=18
  display_width "$label"
  if [ "$REPLY" -lt "$width" ]; then pad=$((width - REPLY)); fi
  printf '  %s%*s' "$label" "$pad" ''
  styled_text '1;32' "$value"
  printf '\n'
}

menu_item() {
  local tag="$1)"
  printf '  '
  styled_text '1;32' "$(printf '%-4s' "$tag")"
  printf '%s\n' "$2"
}

menu_hint() {
  styled_text '2' "  $*"
  printf '\n'
}

dc() { docker compose --project-directory "$INSTALL_DIR" -f "$COMPOSE_FILE" "$@"; }

usage() {
  banner 'Mihomo 部署与入站管理工具'
  printf '\n'
  info '用法: sudo bash mihomo.sh [选项]'
  section '运行选项'
  printf '  %-30s %s\n' '--proto <anytls|vless|empty>' '指定部署协议(跳过交互选择)'
  printf '  %-30s %s\n' '--sni <domain>' '指定 SNI (AnyTLS 可选, VLESS 必填)'
  printf '  %-30s %s\n' '--dest <host:port>' '指定 VLESS Reality 回落目标 (VLESS 必填)'
  printf '  %-30s %s\n' '--add' '向现有实例添加新入站并重载/重建'
  printf '  %-30s %s\n' '--reprint' '查看当前节点信息'
  printf '  %-30s %s\n' '-y, --non-interactive' '非交互模式(使用默认值)'
  printf '  %-30s %s\n' '-h, --help' '显示帮助信息'
  printf '\n'
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --proto)
        [ "$#" -ge 2 ] || die "--proto 需要参数: anytls | vless | empty"
        case "$2" in
          anytls|vless|empty) CLI_PROTO="$2" ;;
          *) die "不支持的协议 '$2'，可选: anytls / vless / empty" ;;
        esac
        shift 2
        ;;
      --sni)
        [ "$#" -ge 2 ] || die "--sni 需要域名参数"
        CLI_SNI="$2"
        shift 2
        ;;
      --dest)
        [ "$#" -ge 2 ] || die "--dest 需要 host:port 参数"
        CLI_DEST="$2"
        shift 2
        ;;
      --add)
        ACTION="add"
        shift
        ;;
      --reprint)
        ACTION="reprint"
        shift
        ;;
      -y|--non-interactive)
        INTERACTIVE=0
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "未知选项: $1 (使用 --help 查看帮助)"
        ;;
    esac
  done
}

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
    || die "未检测到 docker compose v2 插件(compose.yaml 语法依赖它)。"
  command -v openssl >/dev/null 2>&1 \
    || die "未检测到 openssl，无法生成随机密钥或自签名证书。"
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

mihomo_running() {
  [ "$(docker inspect -f '{{.State.Running}}' mihomo 2>/dev/null || true)" = "true" ]
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

# ------------------------------------------------------------------ 输入与校验

# ask <提示> <默认值>；结果写入 REPLY_VAL
ask() {
  local prompt="$1" default="$2" input=""
  if [ "$INTERACTIVE" -eq 0 ]; then
    REPLY_VAL="$default"
    return 0
  fi
  if [ -n "$default" ]; then
    styled_text '1;32' "  ${prompt}" >&2
    printf ' [%s]: ' "$default" >&2
  else
    styled_text '1;32' "  ${prompt}" >&2
    printf ': ' >&2
  fi
  read -r -u "$INPUT_FD" input || input=""
  REPLY_VAL="${input:-$default}"
}

# 交互模式下校验失败可重填，非交互模式直接中止
reject() {
  warn "$1"
  if [ "$INTERACTIVE" -eq 1 ]; then return 0; fi
  die "参数无效，非交互模式已中止。"
}

# config.yaml 里的无引号标量不能被 YAML 解析成数字或布尔值:
# 要求含至少一个字母，且不以 0x 开头
yaml_safe_scalar() {
  case "$1" in
    0x*|0X*) return 1 ;;
  esac
  printf '%s' "$1" | grep -qE '[A-Za-z]'
}

valid_port() {
  printf '%s' "$1" | grep -qE '^[1-9][0-9]{0,4}$' && [ "$1" -le 65535 ]
}

valid_domain() {
  printf '%s' "$1" | grep -qE '^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$'
}

# ------------------------------------------------------------------ 参数收集

select_protocol() {
  local allow_empty="${1:-1}"
  if [ -n "$CLI_PROTO" ]; then
    if [ "$allow_empty" -eq 0 ] && [ "$CLI_PROTO" = "empty" ]; then
      die "添加新入站时不支持空协议，请指定 anytls 或 vless。"
    fi
    PROTOCOL="$CLI_PROTO"
    ok "部署协议: ${PROTOCOL}"
    return 0
  fi
  if [ "$INTERACTIVE" -eq 0 ]; then
    PROTOCOL="$DEF_PROTO"
    ok "部署协议(默认): ${PROTOCOL}"
    return 0
  fi

  section '选择入站协议'
  menu_item 1 'AnyTLS（自签证书，SNI 可选）'
  menu_item 2 'VLESS + Reality（XTLS Vision）'
  if [ "$allow_empty" -eq 1 ]; then
    menu_item 3 '空协议（仅生成容器与基础配置，后续手动编辑）'
  fi

  local c="" range="1-3"
  [ "$allow_empty" -eq 1 ] || range="1-2"
  while :; do
    ask "请选择协议 [${range}]" "1"; c="$REPLY_VAL"
    case "$c" in
      1|anytls) PROTOCOL="anytls"; break ;;
      2|vless)  PROTOCOL="vless"; break ;;
      3|empty)
        if [ "$allow_empty" -eq 1 ]; then PROTOCOL="empty"; break; fi
        warn "添加入站仅支持 1 或 2。"
        ;;
      *) warn "无效选项，请输入 ${range}。" ;;
    esac
  done
  ok "已选择协议: ${PROTOCOL}"
}

collect_port() {
  local label="$1"
  while :; do
    ask "$label" "$DEF_PORT"; PORT="$REPLY_VAL"
    if ! valid_port "$PORT"; then
      reject "端口需为 1-65535 的整数。"
      continue
    fi
    if port_in_use "$PORT"; then
      reject "端口 ${PORT} 已被占用，请换一个。"
      continue
    fi
    if [ "$ADD_MODE" -eq 1 ] && [ -f "$CONFIG_FILE" ] \
       && grep -qE "^[[:space:]]*port:[[:space:]]*${PORT}([[:space:]]*(#.*)?)?$" "$CONFIG_FILE"; then
      reject "端口 ${PORT} 已在 ${CONFIG_FILE} 中配置，请换一个。"
      continue
    fi
    break
  done
}

collect_node_name() {
  local default_name="$1"
  while :; do
    ask "节点名称" "$default_name"; NODE_NAME="$REPLY_VAL"
    case "$NODE_NAME" in
      ""|*,*|*=*|*\'*|*\"*)
        reject "节点名称不能为空，且不能包含逗号、等号或引号。"
        continue
        ;;
    esac
    break
  done
}

detect_server_addr() {
  local prev_addr=""
  if [ "$ADD_MODE" -eq 1 ] && [ -f "$STATE_FILE" ]; then
    prev_addr="$(awk -F"'" '/^SERVER_ADDR=/ {print $2; exit}' "$STATE_FILE" 2>/dev/null || true)"
  fi

  while :; do
    if [ -n "$prev_addr" ]; then
      ask "服务器地址（回车沿用 ${prev_addr}）" "$prev_addr"
    else
      ask "服务器地址（留空自动探测公网 IP）" ""
    fi
    SERVER_ADDR="$(printf '%s' "$REPLY_VAL" | tr -d '[:space:]')"

    if [ -z "$SERVER_ADDR" ]; then
      info "正在探测公网 IP..."
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

  case "$SERVER_ADDR" in
    *:*) IPV6_ONLY=1 ;;
    *)   IPV6_ONLY=0 ;;
  esac

  if [ "$IPV6_ONLY" -eq 1 ]; then
    PUBLISH_SPEC="[::]:${PORT}:${PORT}"
    warn "识别为 IPv6 地址，端口映射写作 [::]:${PORT}:${PORT}（需 Docker 启用 ip6tables）。"
  else
    PUBLISH_SPEC="${PORT}:${PORT}"
  fi
  ok "服务器地址: ${SERVER_ADDR}"
}

collect_anytls_params() {
  local host="$1"
  collect_port "监听端口"

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
    ask "AnyTLS 密码（回车使用随机生成）" "$gen_pass"; PASSWORD="$REPLY_VAL"
    if printf '%s' "$PASSWORD" | grep -qE '^[A-Za-z0-9._~-]{8,64}$' \
       && yaml_safe_scalar "$PASSWORD"; then
      break
    fi
    reject "密码只能包含字母数字与 . _ ~ - ，长度 8-64，且需含至少一个字母。"
  done

  if [ -n "$CLI_SNI" ]; then
    valid_domain "$CLI_SNI" || die "SNI 格式无效: $CLI_SNI"
    SNI="$CLI_SNI"
  else
    while :; do
      ask "伪装 SNI（可选，留空不写入节点信息；证书 CN 默认 ${DEF_CERT_CN}）" ""
      SNI="$(printf '%s' "$REPLY_VAL" | tr -d '[:space:]')"
      if [ -z "$SNI" ] || valid_domain "$SNI"; then break; fi
      reject "SNI 需为合法域名，或留空。"
    done
  fi

  if [ "$ADD_MODE" -eq 1 ]; then
    CERT_REL="./server-${PORT}.crt"
    KEY_REL="./server-${PORT}.key"
    CRT_FILE="${DATA_DIR}/server-${PORT}.crt"
    KEY_FILE="${DATA_DIR}/server-${PORT}.key"
  else
    CERT_REL="./server.crt"
    KEY_REL="./server.key"
    CRT_FILE="${DATA_DIR}/server.crt"
    KEY_FILE="${DATA_DIR}/server.key"
  fi

  collect_node_name "${host}-anytls-${PORT}"
  detect_server_addr
}

collect_vless_params() {
  local host="$1"
  collect_port "监听端口"

  while :; do
    ask "VLESS 用户名（服务端标识）" "$DEF_USER"; VLESS_USER="$REPLY_VAL"
    if printf '%s' "$VLESS_USER" | grep -qE '^[A-Za-z0-9_.-]{1,32}$' \
       && yaml_safe_scalar "$VLESS_USER"; then
      break
    fi
    reject "用户名只能包含字母/数字/下划线/点/连字符，长度 1-32，且需含至少一个字母。"
  done

  while :; do
    ask "UUID（留空将使用 mihomo 自动生成）" ""
    UUID="$(printf '%s' "$REPLY_VAL" | tr -d '[:space:]')"
    if [ -z "$UUID" ]; then
      break
    fi
    if printf '%s' "$UUID" | grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
      UUID="$(printf '%s' "$UUID" | tr 'A-Z' 'a-z')"
      break
    fi
    reject "UUID 格式无效（标准格式如 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）。"
  done

  if [ -n "$CLI_SNI" ]; then
    valid_domain "$CLI_SNI" || die "Reality SNI 格式无效: $CLI_SNI"
    REALITY_SNI="$CLI_SNI"
  else
    while :; do
      ask "Reality 伪装域名 server-names（必填，例如 www.example.com）" ""
      REALITY_SNI="$(printf '%s' "$REPLY_VAL" | tr -d '[:space:]')"
      if [ -n "$REALITY_SNI" ] && valid_domain "$REALITY_SNI"; then break; fi
      reject "Reality 伪装域名为必填项，请输入合法域名。"
    done
  fi

  if [ -n "$CLI_DEST" ]; then
    local d_host="${CLI_DEST%:*}" d_port="${CLI_DEST##*:}"
    [ "$CLI_DEST" != "$d_host" ] && valid_domain "$d_host" && valid_port "$d_port" \
      || die "Reality dest 格式无效: $CLI_DEST (需为 host:port)"
    REALITY_DEST="$CLI_DEST"
  else
    while :; do
      ask "Reality 回落目标 dest（必填，例如 ${REALITY_SNI}:443）" ""
      REALITY_DEST="$(printf '%s' "$REPLY_VAL" | tr -d '[:space:]')"
      local d_host="${REALITY_DEST%:*}" d_port="${REALITY_DEST##*:}"
      if [ -n "$REALITY_DEST" ] && [ "$REALITY_DEST" != "$d_host" ] \
         && valid_domain "$d_host" && valid_port "$d_port"; then
        break
      fi
      reject "Reality 回落目标为必填项，需为 域名:端口 格式（例如 ${REALITY_SNI}:443）。"
    done
  fi

  while :; do
    ask "Reality 私钥 PrivateKey（留空将使用 mihomo 自动生成）" ""
    REALITY_PRIVATE_KEY="$(printf '%s' "$REPLY_VAL" | tr -d '[:space:]')"
    if [ -z "$REALITY_PRIVATE_KEY" ]; then
      REALITY_PUBLIC_KEY=""
      break
    fi
    if printf '%s' "$REALITY_PRIVATE_KEY" | grep -qE '^[A-Za-z0-9_+/=-]{20,128}$'; then
      while :; do
        ask "Reality 公钥 PublicKey（用于生成客户端节点，可留空）" ""
        REALITY_PUBLIC_KEY="$(printf '%s' "$REPLY_VAL" | tr -d '[:space:]')"
        if [ -z "$REALITY_PUBLIC_KEY" ] || printf '%s' "$REALITY_PUBLIC_KEY" | grep -qE '^[A-Za-z0-9_+/=-]{20,128}$'; then
          break
        fi
        reject "PublicKey 格式无效。"
      done
      break
    fi
    reject "PrivateKey 格式无效（应为 Base64 字符串）。"
  done

  while :; do
    ask "Reality Short ID（2-16 位偶数十六进制，留空将使用 openssl 自动生成）" ""
    REALITY_SHORT_ID="$(printf '%s' "$REPLY_VAL" | tr -d '[:space:]')"
    if [ -z "$REALITY_SHORT_ID" ]; then
      REALITY_SHORT_ID="$(openssl rand -hex 8)"
      break
    fi
    if printf '%s' "$REALITY_SHORT_ID" | grep -qiE '^[0-9a-f]{2,16}$' \
       && [ $(( ${#REALITY_SHORT_ID} % 2 )) -eq 0 ]; then
      REALITY_SHORT_ID="$(printf '%s' "$REALITY_SHORT_ID" | tr 'A-Z' 'a-z')"
      break
    fi
    reject "Short ID 需为 2-16 位偶数长度的十六进制字符。"
  done

  collect_node_name "${host}-vless-${PORT}"
  detect_server_addr
}

collect_empty_params() {
  collect_port "容器映射端口（后续可在 compose.yaml 自行增减）"

  local v6=""
  ask "是否同时映射 IPv6 端口 ([::]:${PORT}:${PORT})? [y/N]" "N"; v6="$REPLY_VAL"
  case "$v6" in
    y|Y|yes|YES)
      IPV6_ONLY=1
      PUBLISH_SPEC="[::]:${PORT}:${PORT}"
      ;;
    *)
      IPV6_ONLY=0
      PUBLISH_SPEC="${PORT}:${PORT}"
      ;;
  esac
}

collect_params() {
  local allow_empty="${1:-1}" host
  host="$(hostname -s 2>/dev/null || echo mihomo)"
  [ -n "$host" ] || host="mihomo"

  select_protocol "$allow_empty"

  if [ "$INTERACTIVE" -eq 1 ]; then
    section '配置部署参数'
    menu_hint '方括号内为默认值，直接按 Enter 可快速采用。'
  fi

  case "$PROTOCOL" in
    anytls) collect_anytls_params "$host" ;;
    vless)  collect_vless_params "$host" ;;
    empty)  collect_empty_params ;;
  esac
}

# ------------------------------------------------------------------ 部署与编辑

prepare_dirs() {
  mkdir -p "$DATA_DIR"
  chmod 700 "$INSTALL_DIR"
  ok "目录就绪: ${INSTALL_DIR}"
}

pull_image() {
  if [ "$ADD_MODE" -eq 1 ] && docker image inspect "$MIHOMO_IMAGE" >/dev/null 2>&1; then
    return 0
  fi
  info "拉取镜像 ${MIHOMO_IMAGE}..."
  docker pull -q "$MIHOMO_IMAGE" >/dev/null || die "拉取 ${MIHOMO_IMAGE} 失败，请检查网络。"
  ok "镜像就绪: ${MIHOMO_IMAGE}"
}

generate_vless_secrets() {
  [ "$PROTOCOL" = "vless" ] || return 0

  if [ -z "$UUID" ]; then
    info "使用 mihomo 生成 UUID..."
    UUID="$(docker run --rm "$MIHOMO_IMAGE" generate uuid 2>/dev/null | tr -d '[:space:]' || true)"
    if [ -z "$UUID" ] && [ -r /proc/sys/kernel/random/uuid ]; then
      UUID="$(tr -d '[:space:]' < /proc/sys/kernel/random/uuid)"
    fi
    if ! printf '%s' "$UUID" | grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
      die "生成 UUID 失败。"
    fi
    UUID="$(printf '%s' "$UUID" | tr 'A-Z' 'a-z')"
    ok "已生成 UUID: ${UUID}"
  fi

  if [ -z "$REALITY_PRIVATE_KEY" ]; then
    info "使用 mihomo 生成 Reality 密钥对..."
    local kp=""
    kp="$(docker run --rm "$MIHOMO_IMAGE" generate reality-keypair 2>/dev/null || true)"
    REALITY_PRIVATE_KEY="$(printf '%s\n' "$kp" | awk -F': *' '/^PrivateKey:/ {print $2; exit}' | tr -d '[:space:]')"
    REALITY_PUBLIC_KEY="$(printf '%s\n' "$kp" | awk -F': *' '/^PublicKey:/ {print $2; exit}' | tr -d '[:space:]')"
    if [ -z "$REALITY_PRIVATE_KEY" ] || [ -z "$REALITY_PUBLIC_KEY" ]; then
      die "mihomo generate reality-keypair 执行失败。"
    fi
    ok "已生成 Reality 密钥对。"
  fi
}

unique_listener_name() {
  local base="$1" candidate="$1" idx=2
  if [ -f "$CONFIG_FILE" ]; then
    while grep -qE "^[[:space:]]*-[[:space:]]*name:[[:space:]]*[\"']?${candidate}[\"']?([[:space:]]|$)" "$CONFIG_FILE"; do
      candidate="${base}-${idx}"
      idx=$((idx + 1))
    done
  fi
  printf '%s' "$candidate"
}

listener_yaml_block() {
  local lname
  case "$PROTOCOL" in
    anytls)
      lname="$(unique_listener_name "anytls-${PORT}")"
      cat <<EOF
  - name: ${lname}
    type: anytls
    port: ${PORT}
    listen: "::"
    users:
      ${ANYTLS_USER}: ${PASSWORD}
    certificate: ${CERT_REL}
    private-key: ${KEY_REL}
EOF
      ;;
    vless)
      lname="$(unique_listener_name "vless-reality-${PORT}")"
      cat <<EOF
  - name: ${lname}
    type: vless
    port: ${PORT}
    listen: "::"
    users:
      - username: "${VLESS_USER}"
        uuid: "${UUID}"
        flow: xtls-rprx-vision
    reality-config:
      dest: "${REALITY_DEST}"
      private-key: "${REALITY_PRIVATE_KEY}"
      short-id:
        - "${REALITY_SHORT_ID}"
      server-names:
        - "${REALITY_SNI}"
EOF
      ;;
  esac
}

write_compose() {
  local port_comment=""
  if [ "$PROTOCOL" = "empty" ]; then
    port_comment=$'    # 如需开放更多端口或改用 host 网络，可修改下方 ports 或改为 network_mode: host\n'
  fi

  cat > "$COMPOSE_FILE" <<EOF
# ${COMPOSE_FILE} —— 由一键脚本生成
services:
  mihomo:
    image: ${MIHOMO_IMAGE}
    container_name: mihomo
    restart: unless-stopped
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
    volumes:
      - ./mihomo_data/:/root/.config/mihomo/
${port_comment}    ports:
      - "${PUBLISH_SPEC}"
EOF
  ok "已写入 ${COMPOSE_FILE}"
}

write_config() {
  case "$PROTOCOL" in
    anytls|vless)
      local block
      block="$(listener_yaml_block)"
      cat > "$CONFIG_FILE" <<EOF
# ${CONFIG_FILE}
log-level: warning
ipv6: true

listeners:
${block}

rules:
  - MATCH,DIRECT
EOF
      ;;
    empty)
      cat > "$CONFIG_FILE" <<EOF
# ${CONFIG_FILE}
log-level: warning
ipv6: true

# 空协议模板：可在下方 listeners 中手动添加入站，或再次运行本脚本选择“添加新入站”
# 参考文档: https://wiki.metacubex.one/config/inbound/listeners/
listeners: []

rules:
  - MATCH,DIRECT
EOF
      ;;
  esac
  chmod 600 "$CONFIG_FILE"
  ok "已写入 ${CONFIG_FILE}"
}

# 向现有 config.yaml 安全追加新 listener（保留原有内容与其它配置项）
append_listener_to_config() {
  local block tmp
  block="$(listener_yaml_block)"
  tmp="$(mktemp "${CONFIG_FILE}.tmp.XXXXXX")"

  if grep -qE '^listeners:[[:space:]]*\[\][[:space:]]*(#.*)?$' "$CONFIG_FILE"; then
    awk -v block="$block" '
      !done && /^listeners:[[:space:]]*\[\][[:space:]]*(#.*)?$/ {
        print "listeners:"
        print block
        done=1
        next
      }
      { print }
    ' "$CONFIG_FILE" > "$tmp"
  elif grep -qE '^listeners:[[:space:]]*(#.*)?$' "$CONFIG_FILE"; then
    awk -v block="$block" '
      BEGIN { in_listeners=0; inserted=0 }
      {
        if (!inserted && in_listeners && $0 ~ /^[A-Za-z_][A-Za-z0-9_-]*:/) {
          print block
          print ""
          inserted=1
          in_listeners=0
        }
        if ($0 ~ /^listeners:[[:space:]]*(#.*)?$/) {
          in_listeners=1
        }
        print
      }
      END {
        if (!inserted) {
          print block
        }
      }
    ' "$CONFIG_FILE" > "$tmp"
  elif grep -qE '^rules:[[:space:]]*(#.*)?$' "$CONFIG_FILE"; then
    awk -v block="$block" '
      !inserted && /^rules:[[:space:]]*(#.*)?$/ {
        print "listeners:"
        print block
        print ""
        inserted=1
      }
      { print }
    ' "$CONFIG_FILE" > "$tmp"
  else
    cat "$CONFIG_FILE" > "$tmp"
    printf '\nlisteners:\n%s\n' "$block" >> "$tmp"
  fi

  chmod 600 "$tmp"
  mv -f "$tmp" "$CONFIG_FILE"
  ok "已追加新入站到 ${CONFIG_FILE}"
}

# 向现有 compose.yaml 的 ports 列表追加新映射端口（不重复添加；host 网络模式下跳过）
add_port_to_compose() {
  COMPOSE_CHANGED=0
  if grep -qE '^[[:space:]]*network_mode:[[:space:]]*["'\'']?host["'\'']?' "$COMPOSE_FILE"; then
    info "检测到 compose.yaml 使用 host 网络模式，无需修改端口映射。"
    return 0
  fi
  if grep -qE "^[[:space:]]*-[[:space:]]*[\"']?(\[::\]:)?${PORT}:${PORT}(\/[a-z]+)?[\"']?[[:space:]]*(#.*)?$" "$COMPOSE_FILE"; then
    info "compose.yaml 已包含 ${PORT} 端口映射，跳过修改。"
    return 0
  fi

  local tmp
  tmp="$(mktemp "${COMPOSE_FILE}.tmp.XXXXXX")"
  if grep -qE '^[[:space:]]*ports:[[:space:]]*(#.*)?$' "$COMPOSE_FILE"; then
    awk -v spec="$PUBLISH_SPEC" '
      BEGIN { in_ports=0; inserted=0; indent="    " }
      {
        if (!inserted && in_ports) {
          if ($0 ~ /^[[:space:]]*-[[:space:]]*/ || $0 ~ /^[[:space:]]*#/ || $0 ~ /^[[:space:]]*$/) {
            print
            next
          }
          print indent "  - \"" spec "\""
          inserted=1
          in_ports=0
        }
        if (!inserted && $0 ~ /^[[:space:]]*ports:[[:space:]]*(#.*)?$/) {
          in_ports=1
          match($0, /^[[:space:]]*/)
          indent=substr($0, RSTART, RLENGTH)
        }
        print
      }
      END {
        if (!inserted && in_ports) {
          print indent "  - \"" spec "\""
        }
      }
    ' "$COMPOSE_FILE" > "$tmp"
  else
    awk -v spec="$PUBLISH_SPEC" '
      BEGIN { in_mihomo=0; inserted=0 }
      {
        if (!inserted && in_mihomo && $0 ~ /^[A-Za-z0-9_-]+:/) {
          print "    ports:"
          print "      - \"" spec "\""
          inserted=1
          in_mihomo=0
        }
        if ($0 ~ /^  mihomo:[[:space:]]*$/) {
          in_mihomo=1
        }
        print
      }
      END {
        if (!inserted) {
          print "    ports:"
          print "      - \"" spec "\""
        }
      }
    ' "$COMPOSE_FILE" > "$tmp"
  fi

  mv -f "$tmp" "$COMPOSE_FILE"
  COMPOSE_CHANGED=1
  ok "已向 ${COMPOSE_FILE} 添加端口映射: ${PUBLISH_SPEC}"
}

validate_mihomo_config() {
  info "校验 mihomo 配置..."
  local out
  if ! out="$(docker run --rm -v "${DATA_DIR}:/root/.config/mihomo:ro" "$MIHOMO_IMAGE" -t -d /root/.config/mihomo 2>&1)"; then
    error "配置校验未通过:"
    printf '%s\n' "$out" | sed 's/^/    /' >&2
    return 1
  fi
  ok "mihomo 配置校验通过。"
}

generate_cert() {
  [ "$PROTOCOL" = "anytls" ] || return 0
  local cert_cn="${SNI:-$DEF_CERT_CN}"

  if [ -f "$CRT_FILE" ] && [ -f "$KEY_FILE" ]; then
    local cn c=""
    cn="$(openssl x509 -noout -subject -in "$CRT_FILE" 2>/dev/null \
          | sed 's/^.*CN *= *//; s/,.*$//' || true)"
    warn "已存在自签名证书(CN=${cn:-未知})。重新生成会改变证书指纹，已导入的客户端需要更新节点。"
    if [ "$INTERACTIVE" -eq 1 ]; then
      ask "是否重新生成证书? [y/N]" "N"; c="$REPLY_VAL"
    fi
    case "$c" in
      y|Y|yes|YES) ;;
      *) ok "沿用现有证书。"; return 0 ;;
    esac
  fi

  info "生成自签名证书(ECDSA prime256v1, CN=${cert_cn}, 有效期 36500 天)..."
  if ! openssl req -x509 -nodes \
        -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
        -keyout "$KEY_FILE" -out "$CRT_FILE" \
        -subj "/CN=${cert_cn}" -days 36500 >/dev/null 2>&1; then
    local param
    param="$(mktemp)"
    if ! openssl ecparam -name prime256v1 -out "$param" >/dev/null 2>&1; then
      rm -f "$param"; die "openssl 生成 EC 参数失败。"
    fi
    if ! openssl req -x509 -nodes -newkey "ec:${param}" \
          -keyout "$KEY_FILE" -out "$CRT_FILE" \
          -subj "/CN=${cert_cn}" -days 36500 >/dev/null 2>&1; then
      rm -f "$param"; die "openssl 生成自签名证书失败。"
    fi
    rm -f "$param"
  fi
  chmod 600 "$KEY_FILE"
  chmod 644 "$CRT_FILE"
  ok "证书已生成: ${CRT_FILE}"
}

start_stack() {
  info "启动 / 更新 mihomo 容器..."
  dc up -d || die "docker compose up -d 失败。"
}

reload_or_restart_container() {
  local mode="${1:-ask}"
  if ! mihomo_running; then
    info "mihomo 容器当前未运行，直接启动容器..."
    start_stack
    return 0
  fi

  if [ "$COMPOSE_CHANGED" -eq 1 ]; then
    info "端口映射已变更，重建容器以开放新端口..."
    start_stack
    return 0
  fi

  local choice="1"
  if [ "$mode" = "ask" ] && [ "$INTERACTIVE" -eq 1 ]; then
    section '应用配置变更'
    menu_item 1 '热重载配置（向容器发送 SIGHUP，不重启）'
    menu_item 2 '重启 mihomo 容器（docker compose restart）'
    ask "请选择生效方式 [1-2]" "1"; choice="$REPLY_VAL"
  elif [ "$mode" != "ask" ]; then
    choice="$mode"
  fi

  case "$choice" in
    2|restart)
      info "重启 mihomo 容器..."
      dc restart mihomo || die "重启 mihomo 失败。"
      ok "容器已重启。"
      ;;
    3|recreate)
      start_stack
      ;;
    *)
      info "向 mihomo 容器发送 SIGHUP 热重载配置..."
      if docker kill -s HUP mihomo >/dev/null 2>&1; then
        sleep 1
        ok "已发送热重载信号。"
      else
        warn "热重载失败，回退为重启容器..."
        dc restart mihomo || die "重启 mihomo 失败。"
      fi
      ;;
  esac
}

wait_ready() {
  local i state=""
  for i in $(seq 1 30); do
    state="$(docker inspect -f '{{.State.Status}}' mihomo 2>/dev/null || true)"
    if [ "$state" = "running" ]; then break; fi
    sleep 2
  done
  if [ "$state" != "running" ]; then
    warn "容器 mihomo 未正常运行(状态: ${state:-不存在})，最后 20 行日志:"
    dc logs --no-color --tail 20 mihomo 2>&1 | sed 's/^/    /' || true
    die "部署未完成。完整日志: docker compose -f ${COMPOSE_FILE} logs mihomo"
  fi

  local logs
  logs="$(dc logs --no-color --tail 80 2>/dev/null || true)"
  if printf '%s\n' "$logs" | grep -qiE 'level=(error|fatal)|parse config error'; then
    warn "容器最近日志中有错误，请确认:"
    printf '%s\n' "$logs" | grep -iE 'level=(error|fatal)|parse config error' | tail -n 10
  fi

  if [ "$PROTOCOL" = "empty" ]; then
    ok "mihomo 容器运行中（空协议模板）。"
  elif [ -n "$PORT" ]; then
    if port_in_use "$PORT"; then
      ok "容器运行正常，宿主机 ${PORT} 端口已监听。"
    else
      warn "容器运行中，但未探测到宿主机 ${PORT} 端口监听，请检查端口映射或日志。"
    fi
  else
    ok "mihomo 容器运行正常。"
  fi
}

# ------------------------------------------------------------------ 节点信息输出

cert_fingerprint() {
  openssl x509 -noout -fingerprint -sha256 -in "$CRT_FILE" \
    | sed 's/^.*=//; s/://g' | tr 'A-Z' 'a-z' | tr -d '[:space:]'
}

save_state() {
  cat > "$STATE_FILE" <<EOF
PROTOCOL='${PROTOCOL}'
NODE_NAME='${NODE_NAME}'
SERVER_ADDR='${SERVER_ADDR}'
PORT='${PORT}'
ANYTLS_USER='${ANYTLS_USER}'
PASSWORD='${PASSWORD}'
SNI='${SNI}'
CERT_REL='${CERT_REL}'
KEY_REL='${KEY_REL}'
VLESS_USER='${VLESS_USER}'
UUID='${UUID}'
REALITY_SNI='${REALITY_SNI}'
REALITY_DEST='${REALITY_DEST}'
REALITY_SHORT_ID='${REALITY_SHORT_ID}'
REALITY_PUBLIC_KEY='${REALITY_PUBLIC_KEY}'
EOF
  chmod 600 "$STATE_FILE"
}

print_node() {
  local mode="${1:-overwrite}"
  case "$PROTOCOL" in
    anytls)
      [ -f "$CRT_FILE" ] || die "未找到证书 ${CRT_FILE}。"
      local fp sni_part="" line
      fp="$(cert_fingerprint)"
      if [ -n "$SNI" ]; then sni_part=",sni=${SNI}"; fi
      line="${NODE_NAME} = anytls,${SERVER_ADDR},${PORT},password=\"${PASSWORD}\",skip-cert-verify=true${sni_part},server-cert-fingerprint-sha256=${fp}"

      if [ "$mode" = "append" ] && [ -s "$NODE_FILE" ]; then
        printf '\n# --- %s (AnyTLS : %s) ---\n%s\n' "$NODE_NAME" "$PORT" "$line" >> "$NODE_FILE"
      else
        printf '# --- %s (AnyTLS : %s) ---\n%s\n' "$NODE_NAME" "$PORT" "$line" > "$NODE_FILE"
      fi
      chmod 600 "$NODE_FILE"

      banner '节点信息 · AnyTLS'
      detail '节点名称' "$NODE_NAME"
      detail '监听端口' "$PORT"
      detail '证书 CN' "${SNI:-$DEF_CERT_CN}"
      detail '客户端 SNI' "${SNI:-未指定（已省略）}"
      detail '保存路径' "$NODE_FILE"
      rule
      printf '  %s\n' "$line"
      rule
      menu_hint "AnyTLS 认证仅用密码，用户名 ${ANYTLS_USER} 仅作服务端标签；已固定证书指纹。"
      ;;
    vless)
      local pbk="${REALITY_PUBLIC_KEY:-<请替换为对应的PublicKey>}"
      local uri_host="$SERVER_ADDR" uri_name="${NODE_NAME// /%20}"
      case "$SERVER_ADDR" in
        *:*) uri_host="[${SERVER_ADDR}]" ;;
      esac
      local surge_line uri_line
      surge_line="${NODE_NAME} = vless,${SERVER_ADDR},${PORT},username=${UUID},flow=xtls-rprx-vision,sni=${REALITY_SNI},reality-public-key=${pbk},reality-short-id=${REALITY_SHORT_ID}"
      uri_line="vless://${UUID}@${uri_host}:${PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SNI}&fp=chrome&pbk=${pbk}&sid=${REALITY_SHORT_ID}&type=tcp#${uri_name}"

      if [ "$mode" = "append" ] && [ -s "$NODE_FILE" ]; then
        {
          printf '\n# --- %s (VLESS + Reality : %s) ---\n' "$NODE_NAME" "$PORT"
          printf '# Surge (iOS 6.0+ / Mac 6.12+)\n%s\n' "$surge_line"
          printf '# VLESS URI\n%s\n' "$uri_line"
        } >> "$NODE_FILE"
      else
        {
          printf '# --- %s (VLESS + Reality : %s) ---\n' "$NODE_NAME" "$PORT"
          printf '# Surge (iOS 6.0+ / Mac 6.12+)\n%s\n' "$surge_line"
          printf '# VLESS URI\n%s\n' "$uri_line"
        } > "$NODE_FILE"
      fi
      chmod 600 "$NODE_FILE"

      banner '节点信息 · VLESS + Reality'
      detail '节点名称' "$NODE_NAME"
      detail '监听端口' "$PORT"
      detail '伪装域名' "$REALITY_SNI"
      detail '回落目标' "$REALITY_DEST"
      detail '保存路径' "$NODE_FILE"
      rule
      styled_text '1;36' '  Surge:'; printf '\n'
      printf '  %s\n' "$surge_line"
      styled_text '1;36' '  URI:'; printf '\n'
      printf '  %s\n' "$uri_line"
      rule
      if [ -z "$REALITY_PUBLIC_KEY" ]; then
        warn "未提供 Reality PublicKey，请手动将占位符替换为对应的 PublicKey。"
      fi
      ;;
    empty)
      rm -f "$NODE_FILE"
      banner '基础配置已生成（空协议模板）'
      detail 'Compose 文件' "$COMPOSE_FILE"
      detail 'Mihomo 配置' "$CONFIG_FILE"
      detail '映射端口' "$PUBLISH_SPEC"
      rule
      menu_hint "请编辑 ${CONFIG_FILE} 添加入站，或再次运行本脚本选择“添加新入站”。"
      ;;
  esac
}

show_saved_nodes() {
  if [ -s "$NODE_FILE" ]; then
    banner '已保存节点信息'
    detail '文件路径' "$NODE_FILE"
    rule
    sed 's/^/  /' "$NODE_FILE"
    rule
    return 0
  fi
  [ -f "$STATE_FILE" ] || die "未找到 ${NODE_FILE} 或 ${STATE_FILE}，暂无可输出的节点信息。"
  # shellcheck disable=SC1090
  . "$STATE_FILE"
  if [ "${PROTOCOL:-}" = "empty" ]; then
    warn "当前部署为空协议模板，尚未添加入站。配置文件: ${CONFIG_FILE}"
    return 0
  fi
  CRT_FILE="${DATA_DIR}/${CERT_REL#./}"
  KEY_FILE="${DATA_DIR}/${KEY_REL#./}"
  print_node overwrite
}

print_hints() {
  section '常用管理命令'
  menu_hint "在 ${INSTALL_DIR} 目录下执行："
  printf '  %-38s %s\n' 'docker compose ps' '查看容器状态'
  printf '  %-38s %s\n' 'docker compose logs -f mihomo' '查看实时日志'
  printf '  %-38s %s\n' 'docker kill -s HUP mihomo' '热重载 config.yaml'
  printf '  %-38s %s\n' 'docker compose restart mihomo' '重启容器'
  printf '  %-38s %s\n' 'docker compose down' '停止并移除容器（保留配置）'
  printf '\n'
  detail 'Watchtower 标签' 'com.centurylinklabs.watchtower.enable=true'
  if [ "$PROTOCOL" != "empty" ] && [ -n "$PORT" ]; then
    warn "本脚本不修改防火墙；如有 ufw / firewalld / 安全组，请自行放行 TCP ${PORT}。"
  fi
}

# ------------------------------------------------------------------ 流程编排

deploy_fresh() {
  collect_params 1
  prepare_dirs
  pull_image
  generate_vless_secrets
  write_compose
  write_config
  generate_cert
  validate_mihomo_config
  start_stack
  wait_ready
  save_state
  print_node overwrite
  print_hints
}

add_inbound_flow() {
  [ -f "$COMPOSE_FILE" ] && [ -f "$CONFIG_FILE" ] \
    || die "未检测到已有部署（缺少 ${COMPOSE_FILE} 或 ${CONFIG_FILE}），请先执行初始部署。"

  ADD_MODE=1
  collect_params 0
  prepare_dirs
  pull_image
  generate_vless_secrets
  generate_cert

  local cfg_bak cmp_bak
  cfg_bak="$(mktemp "${CONFIG_FILE}.bak.XXXXXX")"
  cmp_bak="$(mktemp "${COMPOSE_FILE}.bak.XXXXXX")"
  cp -p "$CONFIG_FILE" "$cfg_bak"
  cp -p "$COMPOSE_FILE" "$cmp_bak"

  append_listener_to_config
  add_port_to_compose

  if ! validate_mihomo_config; then
    mv -f "$cfg_bak" "$CONFIG_FILE"
    mv -f "$cmp_bak" "$COMPOSE_FILE"
    die "已回滚 ${CONFIG_FILE} 与 ${COMPOSE_FILE}。"
  fi
  rm -f "$cfg_bak" "$cmp_bak"

  reload_or_restart_container ask
  wait_ready
  save_state
  print_node append
  print_hints
}

manage_container_flow() {
  [ -f "$COMPOSE_FILE" ] && [ -f "$CONFIG_FILE" ] \
    || die "未检测到已有部署。"

  section '重载配置 / 重启容器'
  menu_item 1 '校验配置并热重载（发送 SIGHUP，不断开容器）'
  menu_item 2 '校验配置并重启容器（docker compose restart mihomo）'
  menu_item 3 '校验配置并重建容器（应用 compose.yaml 修改）'
  menu_item 0 '返回'

  local c=""
  ask "请选择 [0-3]" "1"; c="$REPLY_VAL"
  case "$c" in
    0) info "已取消。"; return 0 ;;
    1) validate_mihomo_config && reload_or_restart_container 1 ;;
    2) validate_mihomo_config && reload_or_restart_container restart ;;
    3) validate_mihomo_config && reload_or_restart_container recreate ;;
    *) warn "无效选项。"; return 1 ;;
  esac
  wait_ready
}

handle_existing() {
  [ -f "$COMPOSE_FILE" ] || return 1

  banner "Mihomo 容器管理 · ${INSTALL_DIR}"
  if mihomo_running; then
    detail '容器状态' '运行中 (mihomo)'
  else
    detail '容器状态' '未运行'
  fi

  if [ "$INTERACTIVE" -eq 0 ]; then
    die "非交互模式下不覆盖已有部署；如需添加入站请传 --add，查看节点请传 --reprint。"
  fi

  section '操作菜单'
  menu_item 1 '添加新入站协议（保留现有配置并生效）'
  menu_item 2 '重新部署（覆盖 compose.yaml 与 config.yaml）'
  menu_item 3 '查看当前节点信息'
  menu_item 4 '重载配置 / 重启 mihomo 容器'
  printf '\n'
  menu_item 0 '退出'
  printf '\n'

  local c=""
  ask "请选择 [0-4]" "1"; c="$REPLY_VAL"
  case "$c" in
    1) add_inbound_flow ;;
    2)
      info "停止现有容器..."
      dc down --remove-orphans || true
      deploy_fresh
      ;;
    3) show_saved_nodes ;;
    4) manage_container_flow ;;
    0|q|Q) info "已退出。" ;;
    *) warn "无效选项。"; exit 1 ;;
  esac
  return 0
}

main() {
  parse_args "$@"
  require_root

  case "$ACTION" in
    reprint)
      show_saved_nodes
      exit 0
      ;;
    add)
      check_deps
      add_inbound_flow
      exit 0
      ;;
  esac

  check_deps
  if ! handle_existing; then
    banner 'Mihomo 一键部署'
    deploy_fresh
  fi
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
