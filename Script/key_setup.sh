#!/bin/bash

# SSH密钥配置脚本
# 用于配置VPS使用密钥登录并禁用密码认证

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否为root用户
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "此脚本必须以root权限运行"
        log_info "请使用: sudo $0"
        exit 1
    fi
}

# 备份重要文件
backup_files() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_dir="/root/ssh_backup_${timestamp}"
    
    log_info "创建备份目录: $backup_dir"
    mkdir -p "$backup_dir"
    
    # 备份sshd_config
    if [[ -f /etc/ssh/sshd_config ]]; then
        cp /etc/ssh/sshd_config "$backup_dir/sshd_config.bak"
        log_success "已备份 /etc/ssh/sshd_config"
    fi
    
    # 备份authorized_keys
    if [[ -f ~/.ssh/authorized_keys ]]; then
        cp ~/.ssh/authorized_keys "$backup_dir/authorized_keys.bak"
        log_success "已备份 ~/.ssh/authorized_keys"
    fi
    
    echo "$backup_dir" > /tmp/ssh_backup_path
    log_success "备份完成，备份路径: $backup_dir"
}

# 获取用户输入的公钥
get_public_key() {
    echo
    log_info "请输入您的SSH公钥 (通常以 ssh-rsa, ssh-ed25519 等开头):"
    echo -e "${YELLOW}提示: 您可以通过 'ssh-keygen -t rsa -b 4096' 生成新的密钥对${NC}"
    echo -e "${YELLOW}然后使用 'cat ~/.ssh/id_rsa.pub' 查看公钥内容${NC}"
    echo
    
    read -r public_key
    
    # 验证公钥格式
    if [[ -z "$public_key" ]]; then
        log_error "公钥不能为空"
        return 1
    fi
    
    # 简单的公钥格式验证
    if [[ ! "$public_key" =~ ^(ssh-rsa|ssh-ed25519|ssh-dss|ecdsa-sha2-) ]]; then
        log_warning "公钥格式可能不正确，但仍将继续..."
        echo -e "${YELLOW}确认继续吗? (y/N): ${NC}"
        read -r confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            log_info "操作已取消"
            return 1
        fi
    fi
    
    # 将公钥保存到全局变量
    PUBLIC_KEY="$public_key"
    return 0
}

# 配置authorized_keys文件
setup_authorized_keys() {
    local public_key="$1"
    local ssh_dir="$HOME/.ssh"
    local auth_keys="$ssh_dir/authorized_keys"
    
    log_info "配置SSH密钥..."
    
    # 创建.ssh目录
    if [[ ! -d "$ssh_dir" ]]; then
        mkdir -p "$ssh_dir"
        chmod 700 "$ssh_dir"
        log_success "创建 .ssh 目录"
    fi
    
    # 处理authorized_keys文件
    if [[ -f "$auth_keys" ]]; then
        log_info "检查公钥是否已存在..."
        # 检查是否已经存在相同的公钥
        if grep -Fxq "$public_key" "$auth_keys"; then
            log_warning "公钥已存在，跳过添加"
        else
            echo "$public_key" >> "$auth_keys"
            log_success "公钥已添加到现有文件"
        fi
    else
        echo "$public_key" > "$auth_keys"
        log_success "创建新的 authorized_keys 文件"
    fi
    
    # 设置正确的权限
    chmod 600 "$auth_keys"
    chown root:root "$auth_keys"
    log_success "设置文件权限完成"
}

# 配置SSH服务
configure_ssh() {
    local config_file="/etc/ssh/sshd_config"
    
    log_info "配置SSH服务..."
    
    if [[ ! -f "$config_file" ]]; then
        log_error "SSH配置文件不存在: $config_file"
        return 1
    fi
    
    # 使用sed命令修改配置
    # PermitRootLogin
    if grep -q "^#*PermitRootLogin" "$config_file"; then
        sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' "$config_file"
    else
        echo "PermitRootLogin yes" >> "$config_file"
    fi
    
    # PubkeyAuthentication
    if grep -q "^#*PubkeyAuthentication" "$config_file"; then
        sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' "$config_file"
    else
        echo "PubkeyAuthentication yes" >> "$config_file"
    fi
    
    # AuthorizedKeysFile
    if grep -q "^#*AuthorizedKeysFile" "$config_file"; then
        sed -i 's|^#*AuthorizedKeysFile.*|AuthorizedKeysFile      .ssh/authorized_keys|' "$config_file"
    else
        echo "AuthorizedKeysFile      .ssh/authorized_keys" >> "$config_file"
    fi
    
    # PasswordAuthentication
    if grep -q "^#*PasswordAuthentication" "$config_file"; then
        sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$config_file"
    else
        echo "PasswordAuthentication no" >> "$config_file"
    fi
    
    log_success "SSH配置文件修改完成"
}

# 检查Include配置文件冲突
check_include_configs() {
    local config_file="/etc/ssh/sshd_config"
    local has_conflicts=false
    local conflict_files=()
    
    log_info "检查SSH Include配置文件..."
    
    # 检查主配置文件是否有Include指令
    if ! grep -q "^Include\|^#Include" "$config_file"; then
        log_info "未发现Include配置，跳过检查"
        return 0
    fi
    
    # 获取所有Include目录/文件模式
    local include_patterns=($(grep "^Include" "$config_file" | awk '{print $2}'))
    
    if [[ ${#include_patterns[@]} -eq 0 ]]; then
        log_info "Include指令被注释，跳过检查"
        return 0
    fi
    
    log_info "发现Include配置: ${include_patterns[*]}"
    
    # 检查每个include模式
    for pattern in "${include_patterns[@]}"; do
        # 如果是目录模式（如 /etc/ssh/sshd_config.d/*.conf）
        if [[ "$pattern" == *"*"* ]]; then
            local dir_path=$(dirname "$pattern")
            local file_pattern=$(basename "$pattern")
            
            if [[ -d "$dir_path" ]]; then
                # 查找匹配的文件
                local files=($(find "$dir_path" -name "$file_pattern" 2>/dev/null))
                
                for file in "${files[@]}"; do
                    if [[ -f "$file" ]]; then
                        # 检查冲突的配置项
                        local conflicts=$(check_config_conflicts "$file")
                        if [[ -n "$conflicts" ]]; then
                            has_conflicts=true
                            conflict_files+=("$file")
                            log_warning "发现配置冲突文件: $file"
                            echo -e "${YELLOW}  冲突项: $conflicts${NC}"
                        fi
                    fi
                done
            fi
        else
            # 直接指定的文件
            if [[ -f "$pattern" ]]; then
                local conflicts=$(check_config_conflicts "$pattern")
                if [[ -n "$conflicts" ]]; then
                    has_conflicts=true
                    conflict_files+=("$pattern")
                    log_warning "发现配置冲突文件: $pattern"
                    echo -e "${YELLOW}  冲突项: $conflicts${NC}"
                fi
            fi
        fi
    done
    
    # 如果有冲突，显示处理建议
    if [[ "$has_conflicts" == true ]]; then
        echo
        log_error "检测到Include配置文件中存在可能覆盖主配置的设置！"
        echo -e "${RED}这些设置可能会覆盖脚本的安全配置，导致密码登录仍然有效。${NC}"
        echo
        echo -e "${YELLOW}建议处理方法：${NC}"
        echo "1. 检查冲突文件内容:"
        for file in "${conflict_files[@]}"; do
            echo "   cat $file"
        done
        echo
        echo "2. 处理冲突（选择其一）:"
        echo "   a) 注释冲突行: 在冲突行前添加 # 号"
        echo "   b) 删除冲突文件: rm filename (请确保不包含其他重要配置)"
        echo "   c) 修改冲突值为安全设置"
        echo
        echo "3. 处理完成后重新运行此脚本或手动重启SSH服务"
        echo
        echo -e "${RED}是否继续执行脚本？继续执行可能导致安全配置被覆盖！${NC}"
        echo -e "${YELLOW}继续执行 (y) / 退出处理冲突 (N): ${NC}"
        read -r continue_choice
        
        if [[ ! "$continue_choice" =~ ^[Yy]$ ]]; then
            log_info "脚本已退出，请处理配置冲突后重新运行"
            exit 1
        else
            log_warning "用户选择继续执行，请注意安全风险"
        fi
        
        return 1
    else
        log_success "Include配置检查通过，无冲突"
        return 0
    fi
}

# 检查单个文件的配置冲突
check_config_conflicts() {
    local file="$1"
    local conflicts=()
    
    # 检查各个可能冲突的配置项
    if grep -q "^[[:space:]]*PermitRootLogin[[:space:]]\+no" "$file"; then
        conflicts+=("PermitRootLogin no")
    fi
    
    if grep -q "^[[:space:]]*PubkeyAuthentication[[:space:]]\+no" "$file"; then
        conflicts+=("PubkeyAuthentication no")
    fi
    
    if grep -q "^[[:space:]]*PasswordAuthentication[[:space:]]\+yes" "$file"; then
        conflicts+=("PasswordAuthentication yes")
    fi
    
    if grep -q "^[[:space:]]*AuthorizedKeysFile[[:space:]]\+" "$file"; then
        local auth_keys_value=$(grep "^[[:space:]]*AuthorizedKeysFile" "$file" | head -1 | awk '{print $2}')
        if [[ "$auth_keys_value" != ".ssh/authorized_keys" ]]; then
            conflicts+=("AuthorizedKeysFile $auth_keys_value")
        fi
    fi
    
    # 返回冲突项列表
    IFS=',' eval 'echo "${conflicts[*]}"'
}

# 测试SSH配置
test_ssh_config() {
    log_info "测试SSH配置..."
    
    if sshd -t; then
        log_success "SSH配置文件语法检查通过"
        return 0
    else
        log_error "SSH配置文件语法错误"
        return 1
    fi
}

# 重启SSH服务
restart_ssh() {
    log_info "重启SSH服务..."
    
    if systemctl restart sshd; then
        log_success "SSH服务重启成功"
    else
        log_error "SSH服务重启失败"
        return 1
    fi
    
    # 检查服务状态
    if systemctl is-active --quiet sshd; then
        log_success "SSH服务运行正常"
    else
        log_error "SSH服务运行异常"
        return 1
    fi
}

# 显示重要提醒
show_warnings() {
    echo
    log_warning "重要提醒："
    echo -e "${RED}1. 密码登录已被禁用，请确保您的私钥可以正常使用${NC}"
    echo -e "${RED}2. 请在断开连接前，先用新窗口测试SSH密钥登录${NC}"
    echo -e "${RED}3. 如果无法登录，可以通过VPS控制面板的VNC/Console访问${NC}"
    echo -e "${RED}4. 如需恢复，备份文件位于: $(cat /tmp/ssh_backup_path 2>/dev/null || echo '未找到备份路径')${NC}"
    echo
}

# 显示连接测试命令
show_test_command() {
    local ip=$(hostname -I | awk '{print $1}')
    echo
    log_info "请使用以下命令测试SSH连接:"
    echo -e "${GREEN}ssh -i /path/to/your/private_key root@${ip}${NC}"
    echo
}

# 主函数
main() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE} SSH密钥配置脚本${NC}"
    echo -e "${BLUE}================================${NC}"
    echo
    
    # 检查权限
    check_root
    
    # 备份文件
    backup_files
    
    # 获取公钥
    if ! get_public_key; then
        log_error "获取公钥失败，脚本退出"
        exit 1
    fi
    
    # 配置authorized_keys
    setup_authorized_keys "$PUBLIC_KEY"
    
    # 配置SSH
    configure_ssh
    
    # 检查Include配置冲突
    check_include_configs
    
    # 测试配置
    if ! test_ssh_config; then
        log_error "配置测试失败，正在恢复备份..."
        backup_dir=$(cat /tmp/ssh_backup_path)
        if [[ -f "$backup_dir/sshd_config.bak" ]]; then
            cp "$backup_dir/sshd_config.bak" /etc/ssh/sshd_config
            log_info "已恢复SSH配置文件"
        fi
        exit 1
    fi
    
    # 重启SSH服务
    if ! restart_ssh; then
        log_error "SSH服务重启失败，请检查配置"
        exit 1
    fi
    
    # 显示提醒和测试命令
    show_warnings
    show_test_command
    
    log_success "SSH密钥配置完成！"
}

# 执行主函数
main "$@"
