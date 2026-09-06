# 能力映射（R0 · v3 契约）

宿主实测版本：DSH Desktop 内置 `@deepseek-ai/* = 0.1.2-alpha.1`（本机验证基线）。
插件 peer 声明 `^0.1.0-rc.6`（R3 需收敛为实测版本矩阵）。以下每项：接口 → 验证方式 → 分享风险。

| # | 能力 | 使用的真实接口 | 已验证方式（本机 0.1.2-alpha.1） | 分享风险与对策 |
|---|------|---------------|--------------------------------|---------------|
| 1 | 会话创建/恢复 | `ctx.agents.create({ sessionId, meta.cwd, agentOptions, setup })`；`ctx.agents.resume({ sessionId })`（失败回落 create） | chatTurn 首建+重启后 resume 全链（迁移往返后 153 会话仍可续） | rc.6↔alpha.1 API 面差异未证；R3 干净 profile 实测后锁 peer 区间 |
| 2 | 事件/回合读取 | `handle.agent.session.events / .seq`；`whenIdle()`；`followup(userMessage(...))` | summarizeTurn/activityOf 生产使用；工具轨迹徽章数据源 | 同上，属同一 dsh-agent 面 |
| 3 | 原生 shell/文件 | 宿主 `@deepseek-ai/dsh-tool-bash` / `dsh-tool-fs`（web profile 默认禁用）——插件 `cordis.patch.yml`（bundle patch 层）启用 | chief 实测本地 `hostname`→MacBook-Pro.local；沙箱 workspace-write + 审批沿用宿主 | patch 依赖 profile 含这两个 entry id；R3 在干净 profile 验证 patch 生效，失败则文档声明仅支持含此二 entry 的宿主 |
| 4 | 工具/回合取消 | `handle.agent.cancel({kind:'user'}, {keepInbox})` + `AbortController.abort()` | stop 路由实测：1 运行中止 + 2 排队取消（cancelledRunning/Queued 计数） | 取消≠OS 进程终止证明；按 v3 以「停止待确认」如实展示，不宣称独占 |
| 5 | 后台任务队列 | 插件自管（inbox enqueueJob/claim/pump + 每 bot 互斥），不复用宿主 jobs | 坦克大战/交错 E2E；僵尸饿死已修（目录归一化+24h 过期）并有验收集回归项 | 无宿主依赖；崩溃恢复靠 queue.jsonl+status 对账（R2 验收） |
| 6 | 附件/文件交付 | 插件 HTTP 路由（`/api/plugins/grokbot/...`，宿主 token 鉴权）读取 stateDir 下产物快照 | **未验证**（曾以 VM 时期 computer_screenshot 的 PNG URL 冒作本项证据，Codex 已指出不成立：那是配件工具产物，不是宿主鉴权快照路由）。本机验证项（R1 收尾）：本机任务产文件 → 卡片展示 → 经插件路由下载，size/SHA 与源一致 | 路径校验防越界/symlink（R2 文件验收项）；不部署独立文件服务 |
| 7 | UI 主区挂载 | 宿主 slots：`sidebar.workspaces` / `shell.overlay`（注册式，实测存在）；**CSS 接管依赖 `centerCol` 类名匹配**（风险项） | 侧栏+未知之境修复实测；六状态待 R1 冻结 | 类名匹配为升级脆弱点；R1 对策：收敛为单一兼容适配层（按宿主版本探测，停用完整清理，无挂载点回退宿主界面并提示） |
| 8 | 会话归属映射 | 插件自管 `chatSessionIds`（`convId:botId` 复合键 → DSH sessionId，持久化） | A1 交错测试：三路并发回流精确归属 | 无宿主依赖 |

**结论**：核心执行面（1-5, 8）落在已实测的宿主接口或插件自管；#6（文件交付路由）尚未本机验证（见行内更正）；#7 的 CSS 接管与 #1/#3 的版本矩阵是结构性风险——分别由 R1 适配层与 R3 干净 profile 验收覆盖。无「另建 agent 引擎/文件服务器」项。
另：#3 中「web profile 禁用执行工具」是本次发现的**重要配置原因**（解释了历史绕道 SSH 的主要路径），但不是唯一根因——历史上另存在工具指向错误目录的问题，两者并存。
