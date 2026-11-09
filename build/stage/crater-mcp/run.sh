#!/bin/sh
# Crater MCP 启动脚本（只需 Node 20+）
DIR=$(cd "$(dirname "$0")" && pwd)
exec node "$DIR/dist/index.js" "$@"
