#!/usr/bin/env bash
set -e

ARCH=$(
case "$(uname -m)" in
    x86_64) echo amd64-v3 ;;
    aarch64|arm64) echo arm64 ;;
    armv7l) echo armv7 ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
)

# 获取当前已安装版本(取不到就当作没安装)
CURRENT_VERSION=$(/usr/local/bin/mihomo -v 2>/dev/null | grep -oP 'v\d+\.\d+\.\d+' | head -1 || echo "none")

# 获取 GitHub 最新 release 的 tag_name(比从文件名里解析更可靠)
LATEST_VERSION=$(curl -fsSL https://api.github.com/repos/MetaCubeX/mihomo/releases/latest \
| grep '"tag_name"' \
| head -1 \
| cut -d '"' -f4)

echo "当前版本: ${CURRENT_VERSION}"
echo "最新版本: ${LATEST_VERSION}"

if [ "$CURRENT_VERSION" == "$LATEST_VERSION" ]; then
    echo "已经是最新版本,无需更新。"
    exit 0
fi

echo "发现新版本,开始更新..."

URL=$(curl -fsSL https://api.github.com/repos/MetaCubeX/mihomo/releases/latest \
| grep browser_download_url \
| grep "mihomo-linux-${ARCH}-v[0-9]" \
| grep -v "go1" \
| grep "\.gz\"" \
| cut -d '"' -f4)

if [ -z "$URL" ]; then
    echo "未找到匹配的下载链接,请检查过滤条件。" >&2
    exit 1
fi

cd /tmp
wget -O mihomo.gz "$URL"
gzip -df mihomo.gz

# 备份旧版本
if [ -f /usr/local/bin/mihomo ]; then
    sudo cp /usr/local/bin/mihomo /usr/local/bin/mihomo.bak
fi

sudo systemctl stop mihomo
sudo mv -f mihomo /usr/local/bin/mihomo
sudo chmod +x /usr/local/bin/mihomo
sudo systemctl restart mihomo

echo "更新完成:"
/usr/local/bin/mihomo -v
