#!/usr/bin/env bash
# VPS SSH / BBR / TCP 管理。需要 Bash 4+；SSH 服务管理使用 systemd。
# 用法：sudo bash vps_setup.sh [--menu|--quick|--bbr|--tcp-defaults|--help]
# TCP 推荐值 = ceil(带宽 Mbps × RTT ms × 125 / 1048576) MiB；实际上限由用户输入。

set -uo pipefail
export LC_ALL=C
export PATH="/usr/sbin:/sbin:$PATH"
umask 077

SSH_CONFIG=/etc/ssh/sshd_config
SYSTEMD_CONFIG_DIR=/etc/systemd/system
SYSCTL_CONFIG=/etc/sysctl.d/99-vps-setup.conf
BACKUP_ROOT=/var/backups/vps-setup
ROOT_HOME=/root
BLOCK_START='# BEGIN vps-setup'
BLOCK_END='# END vps-setup'
BACKUP_DIR=''
TRANSACTION=''
SSH_SERVICE=''
SSH_SOCKET=''
SOCKET_CONFIG=''
SERVICE_TOUCHED=0
SSH_TARGET=''
PUBLIC_KEY=''
declare -a SSH_FILES=()
declare -A SEEN_FILES=()

# 按实际输出通道判断颜色，重定向、命令替换和 NO_COLOR 模式保留纯文本。
styled_text() {
    if [[ -t 1 && ${TERM:-dumb} != dumb && -z ${NO_COLOR:-} ]]; then
        printf '\033[%sm%s\033[0m' "$1" "$2"
    else
        printf '%s' "$2"
    fi
}

info() { styled_text '32' "[提示] $*"; printf '\n'; }
warn() { { styled_text '33' "[注意] $*"; printf '\n'; } >&2; }
error() { { styled_text '1;31' "[错误] $*"; printf '\n'; } >&2; }

section() {
    printf '\n'
    styled_text '1;36' "  ── $* ──"
    printf '\n'
}

detail() {
    printf '  %s：' "$1"
    styled_text '1;32' "$2"
    printf '\n'
}

menu_item() {
    printf '  '
    styled_text '1;32' "$1)"
    printf ' %s\n' "$2"
}

menu_hint() {
    styled_text '2' "  $*"
    printf '\n'
}

# 独立输入通道支持 curl ... | bash；EOF 会返回失败，不在菜单中无限循环。
ask() {
    local name=$1 prompt=$2 default=${3-} reply
    styled_text '1;32' "$prompt" >&2
    IFS= read -r -u 3 reply || { printf '\n' >&2; return 1; }
    printf -v "$name" '%s' "${reply:-$default}"
}

confirm() {
    local answer
    ask answer "$1 [y/N，回车取消]：" N || return 1
    [[ $answer == [yY] || $answer == [yY][eE][sS] ]]
}

require() {
    local command
    for command in "$@"; do
        command -v "$command" >/dev/null || { error "缺少命令：$command"; return 1; }
    done
}

# 每次操作独立备份；清单同时记录原本不存在的文件，回滚时可以删除新增配置。
begin_transaction() {
    mkdir -p "$BACKUP_ROOT" || return 1
    chmod 700 "$BACKUP_ROOT" || return 1
    BACKUP_DIR=$(mktemp -d "$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)-$1.XXXXXX") || return 1
    : > "$BACKUP_DIR/manifest" || return 1
    printf '%s\n' "$1" > "$BACKUP_DIR/kind" || return 1
    TRANSACTION=$1
    SERVICE_TOUCHED=0
    info "备份目录：$BACKUP_DIR"
}

save_file() {
    local file=$1
    [[ $file == /* && $file != *$'\n'* && $file != *$'\t'* ]] || return 1
    if awk -F '\t' -v p="$file" '$2 == p { found=1 } END { exit !found }' "$BACKUP_DIR/manifest"; then
        return 0
    fi
    # 不替换管理员维护的符号链接，避免改错实际目标。
    [[ ! -L $file ]] || { error "配置是符号链接，请先处理实际文件：$file"; return 1; }
    if [[ -e $file ]]; then
        [[ -f $file ]] || return 1
        mkdir -p "$BACKUP_DIR/files$(dirname "$file")" || return 1
        cp -a -- "$file" "$BACKUP_DIR/files$file" || return 1
        printf 'exists\t%s\n' "$file" >> "$BACKUP_DIR/manifest"
    else
        printf 'absent\t%s\n' "$file" >> "$BACKUP_DIR/manifest"
    fi
}

# 写入同目录临时文件后原子替换，保留原文件权限、属主及 SELinux 标签。
write_file() {
    local file=$1 content=$2 temp
    save_file "$file" || return 1
    mkdir -p "$(dirname "$file")" || return 1
    temp=$(mktemp "$(dirname "$file")/.vps-setup.XXXXXX") || return 1
    if ! printf '%s\n' "$content" > "$temp"; then rm -f -- "$temp"; return 1; fi
    if [[ -f $file ]]; then
        if ! chmod --reference="$file" "$temp" || ! chown --reference="$file" "$temp"; then
            rm -f -- "$temp"; return 1
        fi
        if command -v selinuxenabled >/dev/null && selinuxenabled; then
            chcon --reference="$file" "$temp" || { rm -f -- "$temp"; return 1; }
        fi
    fi
    mv -f -- "$temp" "$file" || return 1
    if command -v selinuxenabled >/dev/null && selinuxenabled; then
        restorecon "$file" || return 1
    fi
}

restore_files() {
    local directory=$1 state file failed=0
    while IFS=$'\t' read -r state file; do
        case $state in
            exists)
                mkdir -p "$(dirname "$file")" &&
                    cp -a --remove-destination -- "$directory/files$file" "$file" || failed=1 ;;
            absent) rm -f -- "$file" || failed=1 ;;
            *) failed=1 ;;
        esac
    done < "$directory/manifest"
    return "$failed"
}

finish_transaction() {
    printf '%s\n' "$BACKUP_DIR" > "$BACKUP_ROOT/latest-$TRANSACTION" || return 1
    TRANSACTION=''
    info '配置已保存并生效。'
}

rollback() {
    [[ -n $TRANSACTION ]] || return 0
    local kind=$TRANSACTION failed=0
    TRANSACTION=''
    restore_files "$BACKUP_DIR" || failed=1
    if [[ $kind == sysctl && -f $BACKUP_DIR/runtime.conf ]]; then
        sysctl -p "$BACKUP_DIR/runtime.conf" || failed=1
    elif [[ $kind == ssh && $SERVICE_TOUCHED == 1 ]]; then
        sshd -t -f "$SSH_CONFIG" && apply_ssh_service || failed=1
    fi
    if (( failed )); then
        error "自动回滚未完全成功，请从控制台检查；备份：$BACKUP_DIR"
    else
        warn "操作失败，已回滚本工具修改的文件和参数；备份：$BACKUP_DIR"
    fi
    return "$failed"
}

on_exit() {
    local status=$?
    if [[ -n $TRANSACTION ]]; then rollback || true; status=1; fi
    return "$status"
}

# 输出 Include 的每个路径；支持大小写、缩进、引号、多路径和 keyword=value。
# 含空格的路径保留为一个 token；相对路径按 sshd 的 /etc/ssh 规则解析。
include_patterns() {
    awk -v global_only="${2:-0}" '
        {
            line=$0; sub(/^[ \t]+/, "", line)
            if (line ~ /^#/) next
            sub(/^[^ \t=]+[ \t]*=/, substr(line,1,match(line,/[ \t=]/)-1) " ", line)
            key=line; sub(/[ \t].*$/, "", key); key=tolower(key)
            if (global_only && key == "match") exit
            if (key != "include") next
            sub(/^[^ \t]+[ \t]+/, "", line)
            token=""; quote=""
            for (i=1; i<=length(line); i++) {
                c=substr(line,i,1)
                if (quote != "") { if(c==quote) quote=""; else token=token c }
                else if (c == "\"" || c == "\047") quote=c
                else if (c == "#") break
                else if (c ~ /[ \t]/) { if(token!="") print token; token="" }
                else token=token c
            }
            if(token!="") print token
        }
    ' "$1"
}

discover_ssh_files() {
    local file=$1 depth=${2:-0} pattern child
    (( depth <= 16 )) || { error 'SSH Include 嵌套过深。'; return 1; }
    [[ -z ${SEEN_FILES[$file]+seen} ]] || return 0
    SEEN_FILES[$file]=1
    SSH_FILES+=("$file")
    while IFS= read -r pattern; do
        [[ $pattern == /* ]] || pattern="$(dirname "$SSH_CONFIG")/$pattern"
        while IFS= read -r child; do
            [[ -f $child ]] || continue
            discover_ssh_files "$child" "$((depth + 1))" || return 1
        done < <(compgen -G "$pattern" | sort)
    done < <(include_patterns "$file")
}

prepare_ssh() {
    require sshd ssh-keygen systemctl || return 1
    [[ -f $SSH_CONFIG ]] || { error "未找到 $SSH_CONFIG"; return 1; }
    if [[ ${1:-} != restore ]]; then sshd -t -f "$SSH_CONFIG" || return 1; fi
    SSH_SERVICE=''; SSH_SOCKET=''; SOCKET_CONFIG=''
    local name pattern directory
    for name in ssh sshd; do
        if systemctl is-active --quiet "$name.service"; then SSH_SERVICE="$name.service"; break; fi
    done
    if [[ -z $SSH_SERVICE && ${1:-} == restore ]]; then
        for name in ssh sshd; do
            if systemctl cat "$name.service" >/dev/null 2>&1; then SSH_SERVICE="$name.service"; break; fi
        done
    fi
    [[ -n $SSH_SERVICE ]] || { error '未找到可用的 ssh/sshd systemd 服务。'; return 1; }
    for name in ssh sshd; do
        if systemctl is-active --quiet "$name.socket"; then
            SSH_SOCKET="$name.socket"
            SOCKET_CONFIG="$SYSTEMD_CONFIG_DIR/$SSH_SOCKET.d/99-vps-setup.conf"
            break
        fi
    done
    SSH_FILES=(); SEEN_FILES=()
    discover_ssh_files "$SSH_CONFIG" || return 1
    SSH_TARGET=$SSH_CONFIG
    while IFS= read -r pattern; do
        [[ $pattern == /* ]] || pattern="$(dirname "$SSH_CONFIG")/$pattern"
        directory=${pattern%/*}
        # 此处有意让右侧作为 glob，以确认 Include 会读取我们的文件名。
        # shellcheck disable=SC2053
        if [[ $directory == */sshd_config.d && '00-vps-setup.conf' == ${pattern##*/} ]]; then
            SSH_TARGET="$directory/00-vps-setup.conf"
            break
        fi
    done < <(include_patterns "$SSH_CONFIG" 1)
    info "SSH 配置写入：$SSH_TARGET"
}

# 保留上次管理的其它项；没有有效的全局 Include 时，将块放到主配置开头。
update_ssh_settings() {
    local old='' rest='' settings key line content
    if [[ -f $SSH_TARGET ]]; then
        old=$(awk -v start="$BLOCK_START" -v end="$BLOCK_END" '
            $0==start { inside=1; next } $0==end { inside=0; next } inside { print }
        ' "$SSH_TARGET") || return 1
        rest=$(awk -v start="$BLOCK_START" -v end="$BLOCK_END" '
            $0==start { inside=1; next } $0==end { inside=0; next } !inside { print }
        ' "$SSH_TARGET") || return 1
        if [[ $SSH_TARGET != "$SSH_CONFIG" && -n $rest ]]; then
            error "目标文件含非本工具管理的内容，保留原文件：$SSH_TARGET"; return 1
        fi
    fi
    settings=$old
    for line in "$@"; do
        key=${line%% *}
        settings=$(awk -v key="$key" 'tolower($1)!=tolower(key)' <<< "$settings") || return 1
        settings="${settings:+$settings$'\n'}$line"
    done
    content="$BLOCK_START"$'\n'"$settings"$'\n'"$BLOCK_END"
    [[ -z $rest ]] || content+=$'\n'"$rest"
    write_file "$SSH_TARGET" "$content"
}

# 校验全局配置以及当前连接的 root Match 上下文；优先级冲突时不会继续应用。
validate_ssh_settings() {
    local expected effective item key value actual context
    local client_ip server_ip server_port
    sshd -t -f "$SSH_CONFIG" || return 1
    read -r client_ip _ server_ip server_port <<< "${SSH_CONNECTION:-127.0.0.1 1 127.0.0.1 22}"
    context="user=root,host=$client_ip,addr=$client_ip,laddr=$server_ip,lport=$server_port"
    for expected in global connection; do
        if [[ $expected == global ]]; then
            effective=$(sshd -T -f "$SSH_CONFIG") || return 1
        else
            effective=$(sshd -T -f "$SSH_CONFIG" -C "$context") || return 1
        fi
        for item in "$@"; do
            key=${item%% *}; value=${item#* }
            actual=$(awk -v key="$key" 'tolower($1)==tolower(key) {$1=""; sub(/^ /, ""); print}' <<< "$effective")
            # OpenSSH 将 prohibit-password 标准化为 without-password。
            [[ $key != PermitRootLogin || $actual != without-password ]] || actual=prohibit-password
            if [[ $actual != "$value" ]]; then
                error "$expected 配置未生效：$key 期望 [$value]，实际 [$actual]。请检查更早的 Include、主配置或 Match。"
                return 1
            fi
            if [[ $key == Port ]] && ! awk -v port="$value" '
                $1=="listenaddress" { address=$2; sub(/^.*:/,"",address); if(address!=port) exit 1 }
            ' <<< "$effective"; then
                error 'ListenAddress 中固定了其它端口，请先调整该监听地址。'; return 1
            fi
        done
    done
}

apply_ssh_service() {
    SERVICE_TOUCHED=1
    if [[ -n $SSH_SOCKET ]]; then
        # Ubuntu 的 socket 激活模式需要同步监听套接字；同时重启两个单元。
        systemctl daemon-reload && systemctl restart "$SSH_SOCKET" "$SSH_SERVICE" || return 1
        systemctl is-active --quiet "$SSH_SOCKET" || return 1
    else
        systemctl reload-or-restart "$SSH_SERVICE" || return 1
    fi
    systemctl is-active --quiet "$SSH_SERVICE"
}

read_public_key() {
    local temp
    ask PUBLIC_KEY '粘贴完整 SSH 公钥（单行）：' || return 1
    [[ -n $PUBLIC_KEY && $PUBLIC_KEY != *$'\n'* ]] || return 1
    temp=$(mktemp) || return 1
    printf '%s\n' "$PUBLIC_KEY" > "$temp" || { rm -f -- "$temp"; return 1; }
    if ! ssh-keygen -l -f "$temp"; then
        rm -f -- "$temp"; error '公钥无效。'; return 1
    fi
    rm -f -- "$temp"
}

generate_keypair() {
    local type directory protection
    section '选择密钥类型'
    menu_item 1 'ED25519（推荐）'
    menu_item 2 'RSA 4096'
    ask type '请选择密钥类型 [1，回车使用默认值]：' 1 || return 1
    [[ $type == 1 || $type == 2 ]] || { error '无效的密钥类型。'; return 1; }
    mkdir -p "$ROOT_HOME/.ssh" && chmod 700 "$ROOT_HOME/.ssh" || return 1
    directory=$(mktemp -d "$ROOT_HOME/.ssh/vps-key.XXXXXX") || return 1
    local -a args=(-t ed25519 -f "$directory/id_key" -C "root@$(hostname)")
    [[ $type != 2 ]] || args=(-t rsa -b 4096 -f "$directory/id_key" -C "root@$(hostname)")
    ask protection '为私钥设置密码？[Y/n]：' Y || return 1
    [[ $protection != [nN] ]] || args+=(-N '')
    ssh-keygen "${args[@]}" <&3 || return 1
    PUBLIC_KEY=$(cat "$directory/id_key.pub") || return 1
    info "密钥已保存到 $directory；私钥权限为 600。"
    detail '公钥' "$PUBLIC_KEY"
    if confirm '显示私钥，以便复制并保存到本地'; then cat "$directory/id_key" || return 1; fi
    confirm '确认已将私钥保存到本地，继续配置并禁用密码登录' || return 1
}

install_public_key() {
    local file="$ROOT_HOME/.ssh/authorized_keys" content=''
    mkdir -p "$ROOT_HOME/.ssh" && chmod 700 "$ROOT_HOME/.ssh" || return 1
    [[ ! -f $file ]] || content=$(cat "$file") || return 1
    if ! grep -Fqx -- "$PUBLIC_KEY" <<< "$content"; then
        content="${content:+$content$'\n'}$PUBLIC_KEY"
    fi
    write_file "$file" "$content" && chmod 600 "$file" && chown root:root "$file"
}

configure_keys() {
    prepare_ssh || return 1
    if [[ ${1:-paste} == generate ]]; then generate_keypair || return 1; else read_public_key || return 1; fi
    local -a settings=(
        'PermitRootLogin prohibit-password'
        'PubkeyAuthentication yes'
        'AuthorizedKeysFile .ssh/authorized_keys'
        'PasswordAuthentication no'
        'KbdInteractiveAuthentication no'
        'AuthenticationMethods publickey'
    )
    begin_transaction ssh || return 1
    install_public_key && update_ssh_settings "${settings[@]}" &&
        validate_ssh_settings "${settings[@]}" && apply_ssh_service && finish_transaction || return 1
    warn '密码登录已禁用。请保留当前会话，并在新窗口测试 root 密钥登录。'
    show_connection
}

change_ssh_port() {
    prepare_ssh || return 1
    local port file content
    ask port '新 SSH 端口（1-65535）：' || return 1
    [[ $port =~ ^[0-9]{1,5}$ ]] || { error '端口必须是 1-65535 的整数。'; return 1; }
    port=$((10#$port))
    (( port >= 1 && port <= 65535 )) || { error '端口必须是 1-65535 的整数。'; return 1; }
    warn "请先在防火墙及云安全组放行 TCP $port，并保留当前连接。"
    if command -v selinuxenabled >/dev/null && selinuxenabled; then
        warn "SELinux 已启用，请确保 TCP $port 的端口类型为 ssh_port_t。"
    fi
    confirm "确认将 SSH 监听端口改为 $port" || { info '已取消修改 SSH 端口。'; return 0; }
    # 预先拒绝已被其它程序占用的端口，避免服务重载后才发现无法监听。
    require ss || return 1
    if [[ -n $(ss -H -ltn "sport = :$port") ]] &&
        ! sshd -T -f "$SSH_CONFIG" | grep -Fqx "port $port"; then
        error "端口 $port 已被占用。"; return 1
    fi
    begin_transaction ssh || return 1
    # Port 可以累加，必须处理实际 Include 链中的旧声明。
    for file in "${SSH_FILES[@]}"; do
        if grep -Eiq '^[[:space:]]*Port([[:space:]]|=)' "$file"; then
            content=$(sed -E '/^[[:space:]]*[Pp][Oo][Rr][Tt]([[:space:]]|=)/s/^/# vps-setup old port: /' "$file") || return 1
            write_file "$file" "$content" || return 1
        fi
    done
    update_ssh_settings "Port $port" || return 1
    if [[ -n $SSH_SOCKET ]]; then
        write_file "$SOCKET_CONFIG" "[Socket]
ListenStream=
ListenStream=$port" || return 1
    fi
    validate_ssh_settings "Port $port" && apply_ssh_service && verify_ssh_listener "$port" && finish_transaction || return 1
    warn '端口已更新，请用新窗口验证连接后再关闭当前会话。'
    show_connection
}

verify_ssh_listener() {
    local attempt listeners
    for ((attempt=0; attempt<5; attempt++)); do
        listeners=$(ss -H -ltn "sport = :$1") || return 1
        [[ -z $listeners ]] || return 0
        sleep 1
    done
    error "SSH 未在端口 $1 上监听。"
    return 1
}

show_connection() {
    local port address
    address=${SSH_CONNECTION:-}
    if [[ -n $address ]]; then
        read -r _ _ address _ <<< "$address"
    else
        address=$(hostname -I | awk '{print $1}')
    fi
    port=$(sshd -T -f "$SSH_CONFIG" | awk '$1=="port" {print $2; exit}') || return 1
    section '连接信息'
    detail 'SSH 端口' "$port"
    detail '连接示例' "ssh -p $port -i /path/to/private_key root@${address:-服务器IP}"
    menu_hint '请将 /path/to/private_key 替换为本地私钥路径。'
}

backup_ssh() {
    prepare_ssh && begin_transaction ssh || return 1
    local file
    for file in "${SSH_FILES[@]}" "$SSH_TARGET" "$ROOT_HOME/.ssh/authorized_keys"; do
        save_file "$file" || return 1
    done
    [[ -z $SOCKET_CONFIG ]] || save_file "$SOCKET_CONFIG" || return 1
    printf '%s\n' "$BACKUP_DIR" > "$BACKUP_ROOT/latest-ssh" || return 1
    TRANSACTION=''
    info 'SSH 配置及 authorized_keys 备份完成。'
}

restore_ssh() {
    prepare_ssh restore || return 1
    local source='' state file
    [[ ! -f $BACKUP_ROOT/latest-ssh ]] || source=$(cat "$BACKUP_ROOT/latest-ssh")
    ask source "SSH 备份目录 [$source]：" "$source" || return 1
    [[ -f $source/manifest && -f $source/kind && $source == "$BACKUP_ROOT/"* ]] || {
        error '无有效的 SSH 备份。'; return 1;
    }
    [[ $(cat "$source/kind") == ssh ]] || { error '请选择 SSH 备份目录。'; return 1; }
    confirm "恢复 $source" || { info '已取消恢复 SSH 备份。'; return 0; }
    begin_transaction ssh || return 1
    while IFS=$'\t' read -r state file; do save_file "$file" || return 1; done < "$source/manifest"
    restore_files "$source" && sshd -t -f "$SSH_CONFIG" && apply_ssh_service && finish_transaction
}

# 仅更新本工具管理的键，BBR 与缓冲区选项不会互相抹掉。
update_sysctl_file() {
    local content='' setting key
    [[ ! -f $SYSCTL_CONFIG ]] || content=$(cat "$SYSCTL_CONFIG") || return 1
    for setting in "$@"; do
        key=${setting%%=*}
        content=$(awk -v key="$key" '
            { left=$0; sub(/=.*/,"",left); gsub(/[ \t]/,"",left); if(left!=key) print }
        ' <<< "$content") || return 1
        content="${content:+$content$'\n'}$setting"
    done
    write_file "$SYSCTL_CONFIG" "$content"
}

apply_sysctl() {
    require sysctl || return 1
    local key value setting actual
    begin_transaction sysctl || return 1
    for key in net.core.default_qdisc net.ipv4.tcp_congestion_control net.ipv4.tcp_rmem net.ipv4.tcp_wmem; do
        value=$(sysctl -n "$key") || return 1
        printf '%s=%s\n' "$key" "$value" >> "$BACKUP_DIR/runtime.conf" || return 1
    done
    update_sysctl_file "$@" || return 1
    # 先持久化再加载，避免 sysctl --system 将刚刚设置的运行时值覆盖回去。
    sysctl --system || { error 'sysctl --system 失败；请检查上方错误。'; return 1; }
    for setting in "$@"; do
        key=${setting%%=*}; value=${setting#*=}
        actual=$(sysctl -n "$key" | xargs) || return 1
        if [[ $actual != "$value" ]]; then
            error "$key 被其它 sysctl 配置覆盖：期望 [$value]，实际 [$actual]。请检查 /etc/sysctl.conf 等较晚加载的文件。"
            return 1
        fi
    done
    finish_transaction
}

enable_bbr() {
    require sysctl || return 1
    local available
    available=$(sysctl -n net.ipv4.tcp_available_congestion_control) || return 1
    if [[ " $available " != *' bbr '* ]]; then
        if ! require modprobe || ! modprobe tcp_bbr; then error '当前内核无法加载 BBR。'; return 1; fi
        available=$(sysctl -n net.ipv4.tcp_available_congestion_control) || return 1
    fi
    [[ " $available " == *' bbr '* ]] || { error '当前内核不支持 BBR。'; return 1; }
    apply_sysctl 'net.core.default_qdisc=fq' 'net.ipv4.tcp_congestion_control=bbr'
}

restore_tcp_defaults() {
    info '恢复指定基准：rmem="4096 131072 6291456"，wmem="4096 16384 4194304"。'
    apply_sysctl 'net.ipv4.tcp_rmem=4096 131072 6291456' 'net.ipv4.tcp_wmem=4096 16384 4194304'
}

calculate_tcp_buffer() {
    local rtt=$1 bandwidth=$2
    [[ $rtt =~ ^[0-9]+([.][0-9]+)?$ && $bandwidth =~ ^[0-9]+([.][0-9]+)?$ ]] || return 1
    [[ ${#rtt} -le 15 && ${#bandwidth} -le 15 ]] || return 1
    awk -v rtt="$rtt" -v bandwidth="$bandwidth" 'BEGIN {
        if(rtt<=0 || bandwidth<=0) exit 1
        bytes=rtt*bandwidth*125
        if(bytes>2147483647) exit 1
        rounded=int(bytes); if(bytes>rounded) rounded++
        printf "%.0f\n", rounded
    }'
}

mib_to_bytes() {
    local mib=$1
    [[ $mib =~ ^[0-9]+([.][0-9]+)?$ && ${#mib} -le 15 ]] || return 1
    awk -v mib="$mib" 'BEGIN {
        bytes=mib*1048576
        # 上限不能小于 tcp_rmem/tcp_wmem 的初始值，也不能超出内核整数范围。
        if(bytes<131072 || bytes>2147483647) exit 1
        rounded=int(bytes); if(bytes>rounded) rounded++
        printf "%.0f\n", rounded
    }'
}

configure_tcp_buffer() {
    local rtt bandwidth required recommended mib maximum
    ask rtt '往返延迟 RTT（ping 延迟，单位 ms）：' || return 1
    ask bandwidth '目标带宽（单位 Mbps，1 Gbps = 1000 Mbps）：' || return 1
    required=$(calculate_tcp_buffer "$rtt" "$bandwidth") || {
        error '请输入正数；计算结果不得超过 2147483647 字节。'; return 1;
    }
    recommended=$(((required + 1048575) / 1048576))
    info "带宽时延积：$bandwidth × $rtt × 125 = $required 字节（不足 1 字节向上取整）。"
    if (( recommended * 1048576 <= 2147483647 )); then
        info "推荐上限：$recommended MiB（向上取整到刚好覆盖计算值的整数 MiB）。"
    else
        warn '计算值接近内核上限，向上取整到整数 MiB 后会超限，请手动选择较小值。'
    fi
    info '1 MiB = 1048576 字节；可按需要手动输入整数或小数 MiB。'
    while true; do
        ask mib '请输入要设置的缓冲区上限（MiB，至少 0.125）：' || return 1
        if maximum=$(mib_to_bytes "$mib"); then break; fi
        error '请输入有效的 MiB 数值；换算结果须为 131072–2147483647 字节。'
    done
    info "所选上限：$mib MiB = $maximum 字节（不足 1 字节向上取整）。"
    info "tcp_rmem / tcp_wmem 均设为：4096 131072 $maximum（最小值、初始值、上限）。"
    confirm '保存并立即应用' || { info '已取消设置 TCP 缓冲区。'; return 0; }
    apply_sysctl "net.ipv4.tcp_rmem=4096 131072 $maximum" "net.ipv4.tcp_wmem=4096 131072 $maximum"
}

show_status() {
    local settings key value status=0
    section 'SSH 登录配置'
    if command -v sshd >/dev/null && [[ -f $SSH_CONFIG ]]; then
        menu_hint '以下为全局生效配置，具体用户还可能受 Match 影响。'
        if sshd -t -f "$SSH_CONFIG" && settings=$(sshd -T -f "$SSH_CONFIG"); then
            while read -r key value; do
                case $key in
                    port) detail 'SSH 端口' "$value" ;;
                    permitrootlogin) detail 'root 登录策略' "$value" ;;
                    pubkeyauthentication) detail '公钥认证' "$value" ;;
                    passwordauthentication) detail '密码认证' "$value" ;;
                    kbdinteractiveauthentication) detail '交互式认证' "$value" ;;
                    authorizedkeysfile) detail '公钥文件' "$value" ;;
                    authenticationmethods) detail '认证方式' "$value" ;;
                esac
            done <<< "$settings"
        else
            error '无法读取 SSH 生效配置，请检查上方错误。'
            status=1
        fi
    else
        warn '未找到 sshd 或 SSH 配置文件，跳过 SSH 状态。'
    fi
    section '内核与网络参数'
    detail '内核版本' "$(uname -r)"
    require sysctl || return 1
    for key in net.core.default_qdisc net.ipv4.tcp_available_congestion_control \
        net.ipv4.tcp_congestion_control net.ipv4.tcp_rmem net.ipv4.tcp_wmem; do
        if value=$(sysctl -n "$key"); then
            case $key in
                net.core.default_qdisc) detail '队列调度算法' "$value" ;;
                net.ipv4.tcp_available_congestion_control) detail '可用拥塞控制算法' "$value" ;;
                net.ipv4.tcp_congestion_control) detail '当前拥塞控制算法' "$value" ;;
                net.ipv4.tcp_rmem) detail 'TCP 接收缓冲区（字节）' "$value" ;;
                net.ipv4.tcp_wmem) detail 'TCP 发送缓冲区（字节）' "$value" ;;
            esac
        else
            warn "无法读取 $key，当前内核可能不支持此参数。"
            status=1
        fi
    done
    menu_hint '缓冲区三个值依次为：最小值、初始值、上限。'
    return "$status"
}

run_action() {
    local status=0
    "$@" || status=$?
    if [[ -n $TRANSACTION ]]; then rollback || true; fi
    if (( status != 0 )); then error '操作未完成。'; fi
    return "$status"
}

show_menu() {
    printf '\n'
    styled_text '1;32' '  VPS 管理 · SSH / BBR / TCP'
    printf '\n'
    menu_hint '输入选项编号后按 Enter；0 或 q 退出。'

    section 'SSH 登录与端口'
    menu_item 1 '粘贴公钥并配置 root 密钥登录'
    menu_item 2 '生成密钥对并配置 root 密钥登录'
    menu_item 3 '修改 SSH 端口'
    menu_hint '选项 1 / 2 会禁用密码登录。'

    section '网络优化'
    menu_item 4 '开启 BBR + fq'
    menu_item 5 '恢复 TCP 缓冲区基准值'
    menu_item 6 '按延迟和带宽计算 TCP 缓冲区'

    section '状态查看'
    menu_item 7 '查看 SSH / 内核 / 网络状态'

    section 'SSH 备份与恢复'
    menu_item 8 '备份 SSH 配置和公钥'
    menu_item 9 '恢复 SSH 备份'

    printf '\n'
    menu_item 0 '退出'
    menu_hint '绿色：提示与关键值  黄色：注意事项  红色：错误'
    printf '\n'
}

main_menu() {
    local choice
    while true; do
        show_menu
        ask choice '请选择 [0-9 / q]：' || return 0
        # 允许粘贴编号时带有首尾空格，不影响公钥、路径等其它输入。
        choice=${choice#"${choice%%[![:space:]]*}"}
        choice=${choice%"${choice##*[![:space:]]}"}
        [[ -n $choice ]] || continue
        printf '\n'
        case $choice in
            1) run_action configure_keys paste || true ;;
            2) run_action configure_keys generate || true ;;
            3) run_action change_ssh_port || true ;;
            4) run_action enable_bbr || true ;;
            5) run_action restore_tcp_defaults || true ;;
            6) run_action configure_tcp_buffer || true ;;
            7) run_action show_status || true ;;
            8) run_action backup_ssh || true ;;
            9) run_action restore_ssh || true ;;
            0|q|Q) info '已退出 VPS 管理。'; return 0 ;;
            *) warn '无效选项，请输入 0-9，或输入 q 退出。'; continue ;;
        esac
        printf '\n'
        ask choice '按 Enter 返回主菜单，或输入 q 退出：' || return 0
        if [[ $choice == [qQ] || $choice == 0 ]]; then
            info '已退出 VPS 管理。'
            return 0
        fi
    done
}

main() {
    case ${1:---menu} in
        -h|--help)
            section 'VPS SSH / BBR / TCP 管理工具'
            info '用法：sudo bash vps_setup.sh [选项]'
            section '运行选项'
            cat <<'HELP'
  --menu          交互式菜单（默认）
  --quick         粘贴公钥，配置 root 密钥登录并禁用密码登录
  --bbr           启用并持久化 BBR + fq（不安装或更换内核）
  --tcp-defaults  恢复指定的 TCP 缓冲区基准并持久化
  --help, -h      显示帮助
HELP
            section '配置与备份'
            detail 'SSH 配置' '优先使用 sshd_config.d/00-vps-setup.conf'
            detail '网络参数' "$SYSCTL_CONFIG"
            detail '备份位置' "$BACKUP_ROOT/"
            info 'SSH 配置修改失败自动回滚。'
            section '交互说明'
            menu_hint '输入编号选择功能；0 或 q 退出；操作后按 Enter 返回菜单。'
            menu_hint '确认操作默认选 N（取消），输入 y / yes 确认。'
            menu_hint '颜色：绿色提示与关键值，黄色注意事项，红色错误。'
            menu_hint '设置 NO_COLOR=1 可关闭颜色；重定向输出时自动使用纯文本。'
            return 0 ;;
        --menu|--quick|--bbr|--tcp-defaults) ;;
        *) error "未知选项：$1"; return 1 ;;
    esac
    (( EUID == 0 )) || { error '请使用 root 或 sudo 运行。'; return 1; }
    require awk sed grep sort mktemp flock || return 1
    ROOT_HOME=$(getent passwd root | cut -d: -f6) || return 1
    [[ -n $ROOT_HOME && $ROOT_HOME == /* ]] || { error '无法确定 root 家目录。'; return 1; }
    # 防止两个实例同时更新配置、备份索引。
    exec 9>/run/lock/vps-setup.lock || return 1
    flock -n 9 || { error '已有另一个实例正在运行。'; return 1; }
    trap on_exit EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    case ${1:---menu} in
        --bbr) run_action enable_bbr ;;
        --tcp-defaults) run_action restore_tcp_defaults ;;
        *)
            if [[ -t 0 ]]; then exec 3<&0
            elif ! { exec 3</dev/tty; } 2>/dev/null; then
                error '交互模式需要终端；请下载脚本后使用 sudo bash vps_setup.sh 运行。'; return 1
            fi
            if [[ ${1:---menu} == --quick ]]; then run_action configure_keys paste; else main_menu; fi ;;
    esac
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
