# GOALS — dsh-grokbot：在 DSH 上复刻 Grok Bot

北极星目标：让 DSH 长出一支**常驻、可远程驱动、有自己工作区的命名 agent 团队**——
像 Grok Bot 一样自然活在首页里（不新开窗口），7×24 接受任务，并复用现有 todi-hub 通路从手机可达。

理念：DSH 的一切都是插件，本项目是一个纯树外插件（`dsh plugin --profile web add`），零侵入 DSH 本体。

## 目标与验证指标

### G1 插件骨架（P0）
交付：cordis 插件可被 DSH web profile 加载，随 DSH 启动常驻。
指标：
- `dsh --profile web --dump-config` 组合树中出现 `grokbot` 节点
- 使用隔离 `DSH_HOME` 冒烟启动，无 error 级日志

### G2 常驻 agent 团队（P0）
交付：`crew.json` 定义 bots（id/名称/头像/人格/专属工作区），首页聊天会话按 bot 长期存活；任务队列并发受控。
指标：
- bot 状态机 idle/working 正确流转，状态查询延迟 ≤2s
- 连续投递 20 个任务的 soak 测试无崩溃、无任务丢失（queue.jsonl 全部落到 reply.md 或 failed 状态）

### G3 todi-hub 兼容 inbox 协议（P0）
交付：`queue.jsonl` + `<jobId>/job.json` + `reply.md` 文件协议，与 handoffGrok 完全同构。
指标：
- 冷启动 job→reply ≤60s，热路径 ≤15s
- todi-hub 侧新增 `handoffDsh` 适配 ≤60 行（不含脚本文件）

### G4 首页原生 UI（P0，硬性要求）
交付：首页出现「Agent 团队」区块——bot 卡片（头像/名称/状态/当前任务），点击进入会话视图；全程不新开窗口。
指标：
- 单窗口完成 浏览→点开 bot→发送→收到回复 全流程
- bot 工作状态在首页实时可见（≤2s）

### G5 触发器（P1）
交付：cron routine、webhook HTTP、文件 watcher 三种触发入口，统一走 inbox 协议。
指标：
- cron 触发误差 ±5s；webhook→入队 ≤5s；三种入口各有自动化测试

### G6 端到端复刻验收（P0）
交付：手机 → todi-hub → dsh-grokbot → reply.md → 手机的完整链路。
指标：
- 复现 2026-09-02 grok 通路验收：手机收到 bot 的实质回复（对齐“通路通了”标准）

### G7 开源项目（P1）
交付：GitHub 公开仓库、README（中）、一键安装说明。
指标：
- 全新环境 clone → install → G3 冒烟通过 ≤15 分钟

## 里程碑顺序

G1 → G3（协议先于 UI，可被 todi-hub 立即验证）→ G4 → G2 → G6 → G5 → G7

## 验证记录（2026-09-03，隔离 DSH_HOME=/tmp/dsh-smoke + NAS qwen 真模型）

- **G1 ✅**：`dsh plugin --profile web add <dir>` 自动入 bundles；`--dump-config` 组合树含 grokbot 节点；boot 无 error
- **G2 ✅（核心）**：crew 自动生成（幕僚长）；真模型 chat 回复 9.9s，人设正确；inbox 任务热路径 6s
- **G3 ✅**：HTTP 投递（POST /inbox）与纯文件投递（手写 prompt.md + queue.jsonl，todi-hub 同构）均 6s 出 reply.md；status 状态机正确
- **G4 ✅**：首页出现「Agent 团队 · 常驻接活」卡片（渲染于 conversation.input.dock 插槽）；点击在窗口内浮层对话（shell.overlay），全程不新开窗口；发送→真模型回复 UI 内呈现
- **G5 ✅（watcher）**：文件 watcher + 5s 轮询双保险，投递后秒级被发现

## 已知问题与约束

- **上游模型端**：NAS qwen 端点在多轮工具调用后发送 `tools: []` 会返回 400（`tools must not be an empty array`）。影响：带工具的多步任务最后一轮失败，插件按"已产出文本则回复 + 日志告警，无文本则任务失败"处理。无工具任务完全正常。修法在服务端（vLLM/网关侧省略空 tools 字段），不在本插件
- 思考型模型（qwen3.8）的工具前导思考文本可能成为回复内容（取最后一个有文本的 step）；已按 turn/end 错误原因区分并告警
- 首页 dock 插槽在未选择 workspace 时不渲染（DSH 前端行为，与 arena 一致）；Electron 桌面版有原生 picker 不受影响

## 已知约束与依赖

- 本机 `dsh` CLI 通过 app 内包运行（系统 node 22）；插件构建产物提交进仓库，安装端无需 TS 工具链
- 模型走用户自配 provider（settings.yaml 的 local/qwen），端到端依赖 LOCAL_API_KEY 在运行环境可用
- GitHub 发布依赖 gh 登录修复（当前 keyring 中两个账号 token 均失效）
- 海外网络当前不可用（代理故障），npm 安装使用国内镜像
