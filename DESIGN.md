# DESIGN — dsh-grokbot 整体逻辑

对标 Grok Bot 的产品逻辑（xAI 官方：常驻 agent 团队、每 bot 记住对话越用越懂你；MindStudio：幕僚长委派 + 共享记忆 + routines；Cursor 论坛：记忆绑定 bot 实例），
在 DSH 插件体系内给出完整概念模型、数据流与实现路径。

## 1. 概念模型

```
Crew（团队，v1 全局一个，v2 多团队）
 ├─ 章程：TEAM.md（团队偏好/规矩，人可编辑）
 ├─ 共享记忆：memory/decisions.md（群聊与任务沉淀的决议）
 ├─ 默认模型 + 路由策略（defaultBot / 规则 / 幕僚长自主委派）
 ├─ Bot × N（专家）
 │   ├─ 档案：id/name/avatar/title/persona（= Grok Bot 的 Edit Profile）
 │   ├─ 模型绑定：{provider, model} 可空 → 团队默认 → 全局默认
 │   ├─ 电脑：workspaces/<botId>/ 专属目录（文件、工具产物）
 │   ├─ 记忆：memory/PROFILE.md（长期自我记忆，bot 自己维护）
 │   ├─ 会话：持久 sessionId，重启 resume（对话不丢）
 │   └─ 状态：idle / working(+currentJob)
 ├─ Room（群聊，v1.5）：多 bot + 人同室；@提及定向，未@时按路由
 └─ Routine（v2）：cron / webhook / 文件触发，产物统一走 inbox
```

一切遵循「文件即接口」：配置（crew.json）、任务（inbox/）、记忆（*.md）都是plain文件，人和 bot 都能读写。

## 2. 增加专家（Bot 生命周期）

- **创建**：侧栏「＋ 新建专家」→ 表单（名称/头像/职责一句话/模型/工作区）→ `POST /api/plugins/grokbot/bots`
  - 服务端：写 crew.json + 建 `workspaces/<id>/` + 种子 `memory/PROFILE.md` + 继承团队默认模型
  - 热加载：无需重启，crew 变更即时生效（内存 crew + 文件落盘）
- **模板**：内置 工程师🛠️ / 调研员🔎 / 秘书📋 / 审核员🛡️ 四种 persona 模板，一键创建
- **编辑/停用/删除**：`PATCH/DELETE /bots/:id`；删除保留 workspace 与记忆（可恢复），仅摘出团队

## 3. 组建团队与群聊

- **单团队（现在）**：crew.json 的 `routing.default` 决定无目标任务的收件人
- **路由策略（渐进）**：
  1. `toBot` 显式指定（inbox/群聊 @）
  2. 规则表 `routing.rules: [{match, bot}]`（关键词/前缀）
  3. 都不中 → defaultBot（幕僚长）；幕僚长可在回复中给出委派建议（v1）
  4. 幕僚长自主委派（v2）：spawn 子任务投递到专家队列，汇总结论
- **群聊 Room（v1.5）**：
  - `rooms: [{id, name, memberBotIds}]`；消息记录 `rooms/<id>/transcript.jsonl`
  - @bot 定向回复；无 @ 时按路由选一个应答（避免全员刷屏，Grok Bot 同款克制）
  - 参考 dsh-agent-arena 的会议实现，但我们走文件协议 + 轻量轮询

## 4. 模型制定

三层优先级（已实现前两层）：
```
bot.model（专家级）→ crew.defaultModel（团队级）→ agentDefaultModel.currentSelection()（全局）
```
- **模型目录**：`GET /model-catalog` 从 `ctx.llm.listProviders()/listModels()` 聚合（arena 的 modelCatalog 模式）供 UI 下拉
- **任务级模型**：例行摘要/标题生成可配 `crew.utilityModel`（便宜模型），主对话用强模型
- 每次会话创建时锁定选择（会话中途不改模型，保持上下文一致）

## 5. 记忆体系（群聊记忆 ↔ 专家记忆的关联）

Grok Bot 的语义：每个 bot 有绑定自身的长期记忆；群聊是共享上下文场所；复制 bot 不共享记忆。

### 目录结构
```
<stateDir>/
  memory/
    TEAM.md          # 团队章程：用户偏好、协作规矩（人可手改，bot 只读）
    decisions.md     # 共享决议：群聊/任务沉淀（bot 追加，最新在前）
  bots/<botId>/
    memory/
      PROFILE.md     # 专家长期记忆：我是谁/擅长/和用户打交道的经验（bot 自己维护）
      episodic/YYYY-MM-DD.md   # 当日会话摘要（收尾自动生成）
    workspace/       # 它的电脑（工具产物）
```

### 关联机制（三条链路）
1. **注入（读）**：每次专家回合的 systemPrompt 分三段：
   - `grokbot:team`：TEAM.md 全文 + decisions.md 最近 N 条
   - `grokbot:identity`：persona + PROFILE.md 全文
   - `grokbot:workspace`：工作区路径与工具说明
   → 群聊沉淀天然进入**所有**专家的上下文；个人记忆只进**自己**的。
2. **沉淀（写）**：回合收尾（turn/end）触发轻量摘要任务（utilityModel）：
   - 有团队级决议 → 追加 `decisions.md`（一行式：日期/结论/来源）
   - 有个人经验 → 追加自己的 `PROFILE.md`（"这次学到…"）
   - 摘要失败不阻塞回复（记忆是尽力而为）
3. **延续（存）**：每个 bot 的聊天会话用稳定 sessionId 持久化（sessionPersistence），
   进程重启后 `ctx.agents.resume()` 恢复——对话连续是记忆的底线；episodic 摘要是跨会话压缩层。

### 边界
- 记忆文件有体积上限（PROFILE.md > 32KB 时提示 bot 自行精炼）
- 删除 bot：记忆归档到 `archive/<botId>/`，不污染新同名 bot

## 6. 任务与编排流（端到端）

```
入口（手机/hub、webhook、cron、UI 群聊/私聊）
   → inbox（queue.jsonl）或 chat API
   → 路由（§3）→ bot（模型 §4，记忆注入 §5.1）
   → agent 回合（工具在它的 workspace 里真实执行）
   → 收尾：reply.md / 会话消息 + 记忆沉淀（§5.2）
   → （v2）幕僚长委派：拆分任务 → 投递子任务 → 汇总
```

## 7. 与现状的差距盘点（2026-09-04）

| 能力 | 现状 | 缺口 |
|---|---|---|
| 专家 CRUD | 手改 crew.json + 重启 | API/表单/热加载/模板 ❌ |
| 团队/群聊 | 单 default 路由 | rules、Room、@提及 ❌ |
| 模型 | 三层优先级已实现 | 目录 API、选择 UI、utilityModel ❌ |
| 记忆 | 无；chat 会话进程内存，重启丢 | 注入/沉淀/resume 全套 ❌（最高优） |
| 编排 | 无 | 幕僚长委派 ❌ |
| 触发器 | 文件 watcher ✅ | cron/webhook ❌ |
| 会话观感 | 纯文本气泡 | 工具轨迹卡片 ❌ |

## 8. 实现顺序（每步独立可验收）

- **M1 记忆与会话持久化**：记忆目录 + systemPrompt 三段注入 + bot 稳定 sessionId + 重启 resume + 收尾摘要
- **M2 专家管理**：bots CRUD API + 热加载 + 侧栏新建/编辑表单 + 模板
- **M3 模型目录**：/model-catalog + 表单下拉 + utilityModel
- **M4 群聊 Room**：rooms + transcript + @路由 + 群聊 UI
- **M5 编排与触发**：幕僚长委派、cron routine、webhook
- **M6 观感**：会话内工具轨迹卡片（读 session.events 渲染）
- G6/G7（todi-hub 适配、GitHub 发布）并行推进
