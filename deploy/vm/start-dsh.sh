#!/bin/bash
# DSH harness 启动脚本（VM 云端常驻，#3 A3）
export DSH_HOME=/home/bot/dsh-home
export NODE_PATH=/home/bot/dsh-runtime/node_modules
exec node --expose-internals /home/bot/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --port 8800
