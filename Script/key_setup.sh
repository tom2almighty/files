#!/bin/bash

# SSH密钥配置脚本
# 用于配置VPS使用密钥登录并禁用密码认证

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' BLUE='\033[0;34m' NC='\033[0m'

# 通用输入函数
safe_read() {
    local prompt="$1"
    local var_name="$2"
    local default="$3"
    
    if [[ -n "$prompt" ]]; then
        echo -e "$prompt"
    fi
    
    if [ ! -t 0 ]; then
        read -r "$var_name" < /dev/tty
    else
        read -r "$var_name"
    fi
    
    # 设置默认值
    if [[ -z "${!var_name}" && -n "$default" ]]; then
        eval "$var_name=\"$default\""
    fi
}

# 日志函数
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查是否为root用户
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "此脚本必须以root权限运行"
        log_info "请使用: sudo $0"
        exit 1
    fi
}

# 安全检查函数
security_checks() {
    log_info "执行安全检查..."
    
    # 检查SSH服务状态
    if ! systemctl is-active --quiet sshd; then
        log_warning "SSH服务未运行"
        return 0
    fi
    
    # 检查当前SSH配置
    local config_file="/etc/ssh/sshd_config"
    if [[ -f "$config_file" ]]; then
        # 检查是否已启用密钥认证
        if grep -q "^PubkeyAuthentication yes" "$config_file"; then
            log_info "密钥认证已启用"
        fi
        
        # 检查密码认证状态
        if grep -q "^PasswordAuthentication no" "$config_file"; then
            log_warning "密码认证已禁用"
        fi
    fi
    
    # 检查.ssh目录权限
    if [[ -d "$HOME/.ssh" ]]; then
        local ssh_perms=$(stat -c "%a" "$HOME/.ssh" 2>/dev/null)
        if [[ "$ssh_perms" != "700" ]]; then
            log_warning ".ssh目录权限不安全 (当前: $ssh_perms，应为: 700)"
        fi
    fi
    
    # 检查authorized_keys权限
    if [[ -f "$HOME/.ssh/authorized_keys" ]]; then
        local auth_keys_perms=$(stat -c "%a" "$HOME/.ssh/authorized_keys" 2>/dev/null)
        if [[ "$auth_keys_perms" != "600" ]]; then
            log_warning "authorized_keys文件权限不安全 (当前: $auth_keys_perms，应为: 600)"
        fi
    fi
    
    log_success "安全检查完成"
}

# 验证公钥格式
validate_public_key() {
    local key="$1"
    
    # 基本格式检查
    if [[ -z "$key" ]]; then
        log_error "公钥不能为空"
        return 1
    fi
    
    # 检查是否以有效的SSH密钥类型开头
    if [[ ! "$key" =~ ^(ssh-rsa|ssh-ed25519|ssh-dss|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) ]]; then
        log_error "无效的SSH公钥格式"
        return 1
    fi
    
    # 检查是否包含必要的空格分隔部分
    local key_parts=($key)
    if [[ ${#key_parts[@]} -lt 2 ]]; then
        log_error "公钥格式不完整"
        return 1
    fi
    
    # 检查base64部分（简单的长度检查）
    local base64_part="${key_parts[1]}"
    if [[ ${#base64_part} -lt 50 ]]; then
        log_error "公钥数据部分过短"
        return 1
    fi
    
    return 0
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
    
    # 使用通用输入函数
    if [ ! -t 0 ]; then
        log_info "检测到管道执行模式，使用专用输入通道..."
    fi
    safe_read "" "public_key"
    
    # 验证公钥格式
    if ! validate_public_key "$public_key"; then
        safe_read "${YELLOW}公钥格式验证失败，是否重新输入? (Y/n): ${NC}" "retry" "Y"
        if [[ ! "$retry" =~ ^[Nn]$ ]]; then
            log_info "请重新输入公钥..."
            return get_public_key
        else
            log_info "操作已取消"
            return 1
        fi
    fi
    
    PUBLIC_KEY="$public_key"
    return 0
}

# 生成SSH密钥对
generate_ssh_keypair() {
    echo
    log_info "SSH密钥对生成功能"
    echo "================================"
    echo
    
    # 询问密钥类型
    echo "请选择密钥类型:"
    echo "1) RSA (4096位) - 兼容性最好"
    echo "2) ED25519 - 现代算法，性能更好"
    echo "3) ECDSA (256位) - 较新的算法"
    echo
    
    safe_read "" "key_choice" "1"
    case $key_choice in
        1) key_type="rsa" key_bits="4096" ;;
        2) key_type="ed25519" key_bits="" ;;
        3) key_type="ecdsa" key_bits="256" ;;
        *) log_warning "默认选择RSA 4096位"; key_type="rsa" key_bits="4096" ;;
    esac
    
    # 询问密钥文件名
    echo
    safe_read "${YELLOW}请输入密钥文件名 (默认: id_${key_type}): ${NC}" "key_filename" "id_${key_type}"
    
    # 询问密钥密码
    echo
    safe_read "${YELLOW}是否为私钥设置密码保护? (y/N): ${NC}" "use_passphrase" "N"
    
    passphrase_args=""
    if [[ "$use_passphrase" =~ ^[Yy]$ ]]; then
        passphrase_args="-N"
        log_info "将在生成过程中提示输入密码"
    else
        passphrase_args="-N \"\""
        log_info "不设置密码保护"
    fi
    
    # 生成密钥对
    echo
    log_info "正在生成密钥对..."
    
    local temp_dir="/tmp/ssh_keygen_$$"
    mkdir -p "$temp_dir"
    
    if [[ -n "$key_bits" ]]; then
        if [[ "$use_passphrase" =~ ^[Yy]$ ]]; then
            ssh-keygen -t "$key_type" -b "$key_bits" -f "$temp_dir/$key_filename"
        else
            ssh-keygen -t "$key_type" -b "$key_bits" -f "$temp_dir/$key_filename" -N ""
        fi
    else
        if [[ "$use_passphrase" =~ ^[Yy]$ ]]; then
            ssh-keygen -t "$key_type" -f "$temp_dir/$key_filename"
        else
            ssh-keygen -t "$key_type" -f "$temp_dir/$key_filename" -N ""
        fi
    fi
    
    if [[ $? -eq 0 ]]; then
        log_success "密钥对生成成功!"
        
        # 读取公钥
        PUBLIC_KEY=$(cat "$temp_dir/${key_filename}.pub")
        
        echo
        echo -e "${GREEN}=== 公钥 ===${NC}"
        echo "$PUBLIC_KEY"
        echo
        
        echo -e "${RED}=== 私钥 (请妥善保存) ===${NC}"
        cat "$temp_dir/$key_filename"
        echo
        
        echo -e "${YELLOW}=== 重要提醒 ===${NC}"
        echo "1. 请立即复制保存私钥，此窗口关闭后将无法恢复"
        echo "2. 私钥文件权限应设置为 600"
        echo "3. 建议将私钥保存到 ~/.ssh/ 目录"
        echo "4. 使用命令: chmod 600 ~/.ssh/${key_filename}"
        echo
        
        # 询问是否继续配置
        safe_read "${YELLOW}是否继续使用此密钥配置SSH? (Y/n): ${NC}" "continue_setup" "Y"
        if [[ ! "$continue_setup" =~ ^[Nn]$ ]]; then
            log_info "将使用生成的密钥继续配置"
            # 清理临时文件
            rm -rf "$temp_dir"
            return 0
        else
            log_info "已保存密钥文件到: $temp_dir/"
            echo "请手动复制文件后删除临时目录"
            return 1
        fi
    else
        log_error "密钥对生成失败"
        rm -rf "$temp_dir"
        return 1
    fi
}

# 恢复备份文件
restore_backup() {
    echo
    log_info "SSH配置恢复功能"
    echo "================================"
    
    # 检查是否有备份文件
    if [[ ! -f /tmp/ssh_backup_path ]]; then
        log_error "未找到备份路径记录"
        safe_read "${YELLOW}请手动指定备份目录路径: ${NC}" "backup_dir"
    else
        backup_dir=$(cat /tmp/ssh_backup_path)
    fi
    
    if [[ -z "$backup_dir" || ! -d "$backup_dir" ]]; then
        log_error "备份目录不存在: $backup_dir"
        return 1
    fi
    
    echo -e "${YELLOW}找到备份目录: $backup_dir${NC}"
    echo "备份内容:"
    ls -la "$backup_dir" 2>/dev/null || echo "  备份目录为空"
    echo
    
    echo -e "${RED}警告: 恢复操作将覆盖当前配置！${NC}"
    safe_read "${YELLOW}确认恢复备份? (y/N): ${NC}" "confirm_restore" "N"
    
    if [[ ! "$confirm_restore" =~ ^[Yy]$ ]]; then
        log_info "恢复操作已取消"
        return 0
    fi
    
    # 恢复sshd_config
    if [[ -f "$backup_dir/sshd_config.bak" ]]; then
        cp "$backup_dir/sshd_config.bak" /etc/ssh/sshd_config
        log_success "已恢复SSH配置文件"
    fi
    
    # 恢复authorized_keys
    if [[ -f "$backup_dir/authorized_keys.bak" ]]; then
        cp "$backup_dir/authorized_keys.bak" ~/.ssh/authorized_keys
        chmod 600 ~/.ssh/authorized_keys
        chown root:root ~/.ssh/authorized_keys
        log_success "已恢复authorized_keys文件"
    fi
    
    # 重启SSH服务
    if systemctl restart sshd; then
        log_success "SSH服务重启成功"
    else
        log_error "SSH服务重启失败"
        return 1
    fi
    
    log_success "备份恢复完成！"
    return 0
}

# 显示主菜单
show_main_menu() {
    clear
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}      SSH密钥配置管理工具${NC}"
    echo -e "${BLUE}================================${NC}"
    echo
    echo "1. 快速配置 (自动备份 + 设置密钥登录)"
    echo "2. 仅粘贴公钥配置"
    echo "3. 生成新密钥对并配置"
    echo "4. 仅备份SSH配置"
    echo "5. 恢复SSH配置备份"
    echo "6. 安全检查和状态"
    echo "7. 检查配置冲突"
    echo "8. 测试SSH配置"
    echo "9. 重启SSH服务"
    echo "10. 显示连接信息"
    echo "0. 退出"
    echo
    echo -e "${YELLOW}请选择操作 (0-10): ${NC}"
}

# 处理菜单选择
handle_menu_choice() {
    local choice="$1"
    
    case $choice in
        1)
            log_info "开始快速配置..."
            check_root
            backup_files
            
            echo -e "${YELLOW}选择获取公钥方式:${NC}"
            echo "1) 粘贴现有公钥"
            echo "2) 生成新密钥对"
            echo
            
            safe_read "" "key_method" "1"
            
            if [[ "$key_method" == "2" ]]; then
                if ! generate_ssh_keypair; then
                    log_error "密钥生成失败"
                    return 1
                fi
            else
                if ! get_public_key; then
                    log_error "获取公钥失败"
                    return 1
                fi
            fi
            
            setup_authorized_keys "$PUBLIC_KEY"
            configure_ssh
            check_include_configs
            
            if ! test_ssh_config; then
                log_error "配置测试失败"
                return 1
            fi
            
            if ! restart_ssh; then
                log_error "SSH服务重启失败"
                return 1
            fi
            
            show_warnings
            show_test_command
            log_success "快速配置完成！"
            ;;
            
        2)
            log_info "开始公钥配置..."
            check_root
            
            if ! get_public_key; then
                log_error "获取公钥失败"
                return 1
            fi
            
            setup_authorized_keys "$PUBLIC_KEY"
            log_success "公钥配置完成！"
            ;;
            
        3)
            log_info "开始生成密钥对并配置..."
            check_root
            
            if ! generate_ssh_keypair; then
                log_error "密钥生成失败"
                return 1
            fi
            
            setup_authorized_keys "$PUBLIC_KEY"
            configure_ssh
            
            if ! test_ssh_config; then
                log_error "配置测试失败"
                return 1
            fi
            
            if ! restart_ssh; then
                log_error "SSH服务重启失败"
                return 1
            fi
            
            show_warnings
            show_test_command
            log_success "密钥对生成和配置完成！"
            ;;
            
        4)
            log_info "开始备份SSH配置..."
            check_root
            backup_files
            ;;
            
        5)
            log_info "开始恢复SSH配置..."
            check_root
            restore_backup
            ;;
            
        6)
            log_info "执行安全检查..."
            check_root
            security_checks
            ;;
            
        7)
            log_info "检查配置冲突..."
            check_root
            check_include_configs
            ;;
            
        8)
            log_info "测试SSH配置..."
            check_root
            if test_ssh_config; then
                log_success "SSH配置测试通过"
            else
                log_error "SSH配置测试失败"
            fi
            ;;
            
        9)
            log_info "重启SSH服务..."
            check_root
            if restart_ssh; then
                log_success "SSH服务重启成功"
            else
                log_error "SSH服务重启失败"
            fi
            ;;
            
        10)
            show_test_command
            ;;
            
        0)
            log_info "感谢使用SSH密钥配置管理工具！"
            exit 0
            ;;
            
        *)
            log_error "无效选择，请重新输入"
            ;;
    esac
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
    
    # 配置项数组：模式 -> 替换内容
    local configs=(
        "PermitRootLogin.*|PermitRootLogin yes"
        "PubkeyAuthentication.*|PubkeyAuthentication yes"
        "AuthorizedKeysFile.*|AuthorizedKeysFile      .ssh/authorized_keys"
        "PasswordAuthentication.*|PasswordAuthentication no"
    )
    
    # 批量修改配置
    for config in "${configs[@]}"; do
        local pattern="${config%%|*}"
        local replacement="${config#*|}"
        
        if grep -q "^#*${pattern%.*}" "$config_file"; then
            # 使用|作为sed分隔符，避免路径中的/冲突
            sed -i "s|^#*${pattern}|${replacement}|" "$config_file"
        else
            echo "${replacement#* }" >> "$config_file"
        fi
    done
    
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
        safe_read "" "continue_choice" "N"
        
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

# 主函数 - 支持命令行参数和菜单模式
main() {
    case ${1:-} in
        --help|-h)
            cat << EOF
SSH密钥配置管理工具

用法: $0 [选项]

选项:
  --help, -h     显示此帮助信息
  --quick        快速配置模式（兼容原版本）
  --menu         菜单模式（默认）

快速配置模式将自动执行完整的SSH密钥配置流程
菜单模式提供交互式操作界面
EOF
            exit 0
            ;;
        --quick)
            log_info "使用快速配置模式..."
            execute_quick_setup
            ;;
        "")
            execute_menu_mode
            ;;
        *)
            log_error "未知选项: $1"
            echo "使用 --help 查看帮助信息"
            exit 1
            ;;
    esac
}

# 快速配置模式（兼容原版本）
execute_quick_setup() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE} SSH密钥配置脚本 - 快速模式${NC}"
    echo -e "${BLUE}================================${NC}"
    echo
    
    check_root || exit 1
    backup_files
    
    get_public_key || { log_error "获取公钥失败，脚本退出"; exit 1; }
    setup_authorized_keys "$PUBLIC_KEY"
    configure_ssh
    check_include_configs
    
    if ! test_ssh_config; then
        log_error "配置测试失败，正在恢复备份..."
        local backup_dir=$(cat /tmp/ssh_backup_path 2>/dev/null)
        [[ -f "$backup_dir/sshd_config.bak" ]] && cp "$backup_dir/sshd_config.bak" /etc/ssh/sshd_config && log_info "已恢复SSH配置文件"
        exit 1
    fi
    
    restart_ssh || { log_error "SSH服务重启失败，请检查配置"; exit 1; }
    show_warnings
    show_test_command
    log_success "SSH密钥配置完成！"
}

# 菜单模式
execute_menu_mode() {
    while true; do
        show_main_menu
        safe_read "" "choice"
        handle_menu_choice "$choice"
        echo
        safe_read "${YELLOW}按回车键继续...${NC}" "dummy"
    done
}

# 执行主函数
main "$@"
