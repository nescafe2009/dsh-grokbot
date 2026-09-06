# 云端部署（#3 A3：harness → 共享电脑 VM）

## VM 侧（ubuntu-bot）
- `start-dsh.sh`：启动脚本（NODE_PATH 指向 dsh-runtime，--expose-internals，固定 8800）
- `dsh-harness.service`：systemd 常驻（开机自启/崩溃重启）
- `migrate_sessions.mjs`：会话头路径迁移（Mac→VM cwd 重写，zstd 逐帧）
- 运行时：`/home/bot/dsh-runtime`（Mac 桌面版 node_modules 整体拷贝 + linux 原生包
  `@img/sharp-{linux-x64,libvips-linux-x64}`、`@koromix/koffi-linux-x64` 链接自 `/home/bot/.native-cache`）
- 状态：`/home/bot/dsh-home`（crew/memory/inbox/rooms/sessions 已迁移；grokbot/workspace 软链到 /home/bot/workspace）
- `computer.json` 增加 `"local": true`：computer_* 工具本地直执（免 SSH）

## Mac 侧
- `com.grokbot.tunnels.plist`：launchd 持久隧道 6080(noVNC)/8000(预览)/18800(harness)
- Mac 本地 grokbot 状态已归档（grokbot.migrated-to-VM-*），防止双跑
- 日常入口：浏览器 http://127.0.0.1:18800/?token=…（token 见 VM `journalctl -u dsh-harness`）

## 坑位记录
- pkill -f 的模式不能出现在执行者自身命令行（自杀）；用脚本文件隔离
- npm install 在无 package.json 目录会 prune 全部"多余"包——绝不在 runtime 目录跑
- 会话目录名与 zstd 首帧 header 都嵌 cwd，迁移需两者同步重写
- `--expose-internals` 不能走 NODE_OPTIONS（黑名单），必须 CLI 参数
