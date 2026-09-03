# DESIGN v2 — dsh-grokbot 整体逻辑（复刻 Grok Bot）

依据（三轮 review 后定稿）：
- xAI 官方发布：常驻 agent 团队、记住对话、有自己的电脑、7×24
- Cursor 官方文档《Work with Grok Bot》全文（操作语义权威来源）
- 布局资料：消息应用式——侧栏=agent 列表，主区=选中 agent 的会话
- 本机逆向：todi-hub 文件协议、桌面版 harness home、客户端插槽机制

## 0. v1→v2 关键纠正

| v1 设计（错） | Grok Bot 实际（对） |
|---|---|
| 每 bot 一台专属电脑 | **全队共享一台电脑**（文件/登录/浏览器会话共享，bot 可接力）；每 bot 一个"屏幕"= 并发工作面；隔离在用户之间 |
| 记忆含安全边界 | **安全边界放 description**；记忆只存稳定偏好/事实/摘要，不是权威源 |
| 群聊无@时按路由规则选人 | **正常说话让 bot 们自己决定谁应答**；@=定向交接；@everyone=群发 |
| 模型三层是核心 | Grok Bot 用户不选模型；多层模型是我们基于 DSH 多provider 的**增强项**，降为高级设置 |
| 会话是插件私有的 | **会话即对话本身**，transcript 里内联渲染工具活动/电脑操作/产出文件/审批请求 |

## 1. 概念模型（对齐官方语义）

```
Team（账号级，对应 Grok Bot 账户）
 ├─ Computer（一台共享电脑 = <stateDir>/workspace/）
 │   ├─ 项目文件夹；文件/凭证全队共享、跨任务持久
 │   └─ Screen × N（每 bot 一个并发工作面 = 一个 agent 会话）
 ├─ Bot（≤50，含群聊总数）
 │   ├─ Profile：name / title / description(持久规则+安全边界) / avatar
 │   ├│ conversation（独立持久对话；任务指令放这里，不放 description）
 │   ├─ memory（稳定偏好/重要事实/工作摘要；复制不带记忆）
 │   ├─ routines ≤50（定时/事件触发，归此 bot 所有）
 │   └─ pinned / section（侧栏置顶与分组）/ hidden（隐藏不停摆）
 ├─ Group（2-6 bot 群聊）：共享 outcome 与可见交接
 ├─ Skill（跨 bot 复用的做法说明；/ 引用；不属任何 bot）
 └─ Transcript 统一形态：消息 + 工具活动 + 文件卡片 + 审批 + 提问 内联混排
```

## 2. Bot 生命周期（复刻官方流程）

- **创建**：侧栏「＋ New」→ Create new agent → 首个真实任务即上岗（官方：发一个有明确完成线的任务）
- **编辑**：Edit Profile 改 name/title/description/avatar；**发现持久偏好/边界/职责时更新 description**（消息只承载本次任务指令）
- **组织**：Pin 置顶；Sidebar Sections 按项目/客户分组；Hide from sidebar（工作与 routines 不停）；Duplicate（复制 profile/settings/skills/routines/avatar，**不带**对话史/记忆/附件）
- **删除**：删 profile+对话+routines；电脑上的文件不隔离、需单独清理；不确定就 Hide
- **上限**：bots+groups ≤ 50
- bot 也可以在对话中建议/创建新 bot（当某类工作值得长期 owner）——v2

## 3. 共享电脑（v2 核心变更）

- 全队一个 `workspace/`，默认 `workspace/<项目名>/` 组织
- **bot 间接力**：A 存的文件 B 直接可用（同一 cwd）
- 凭证/登录全队共享 → 我们不在插件里做 bot 间隔离（与官方一致）；敏感步骤走审批
- 每屏一个 computer-use 任务；我们的"屏"= 独立 agent 会话（可并行）

## 4. 对话与协作（复刻官方语义）

- **私聊优先**：用户私聊可打断/重定向当前后台回合；"立即停止"不撤销已完成动作
- **群聊**：正常书写让 bots 决定谁应答（实现：默认由路由 bot 判断并回应，可点名他人）；
  `@名字` 定向交接；`@everyone` 群发；**每阶段一个 owner**；bot→bot 交接消息纯文本
- **bot↔bot 异步交接**：A 给 B 发消息 → 唤醒 B 处理 → 可稍后回复；交接在 transcript 可见
  （实现：A 的工具调用 `handoff(botId, text)` → 服务端向 B 的会话注入 followup）
- **附件**：图/文/链接/PDF/表格…，须说明"这是什么、怎么用"；上限对齐官方（6/条）
- **可审查产出**：要求源链接/截图/时间戳/动作日志/未验证清单；产物以卡片呈现（预览/保存/反馈）

## 5. 记忆（收敛为官方语义）

- **内容**：稳定偏好、重要事实、工作摘要（不回放全部历史）
- **边界**：记忆≠权威源；变化的事实放源系统；安全边界放 description
- **实现**：`bots/<id>/memory/PROFILE.md`（bot 自维护）+ episodic 摘要；
  注入只进自己的会话；团队共享记忆降级为 `workspace/TEAM.md`（项目章程，可选）
- **持久对话**：稳定 sessionId + 重启 resume（对话存在电脑之外——与官方一致）
- 复制 bot 不复制记忆 ✅（天然：按 botId 隔离）

## 6. Skills 与 Routines

- **Skill**：跨 bot 的可复用做法（步骤/决策规则/期望输出/安全边界）；
  `/` 菜单引用；存 `<stateDir>/skills/*.md`；v2 支持对话中"把这次的做法存成 skill"
- **Routine**：归**单个 bot** 所有；schedule(cron) 或窄事件规则（webhook/inbox 匹配）；
  必须 Test run + 运行历史（≤20 条）；产物回到 owning bot 的会话
- 信任分级：准备类可自动化；发送/采购/删除/发布/生产变更必须审批

## 7. 模型（DSH 增强项，非复刻必需）

bot.model → team.defaultModel → agentDefaultModel.currentSelection()；
模型目录 API 供表单下拉；utilityModel 干摘要杂活。放"高级设置"，不进主流程。

## 8. 实现路线（goal 模式，每步可验收）

- **M1 Bot 对象与对话底座**：bots CRUD（profile 五字段+pin/section/hidden/duplicate）+ 热加载 +
  共享 workspace（替换 per-bot 工作区）+ 稳定 sessionId 持久对话 + 重启 resume + 侧栏 New/编辑表单
- **M2 记忆**：PROFILE.md 注入/沉淀 + episodic 摘要（utilityModel）+ description/任务指令分离
- **M3 群聊与交接**：group（2-6）+ 自主应答 + @handoff + bot↔bot 异步交接 + 私聊打断/Stop
- **M4 Transcript 观感**：会话内联渲染 工具活动/文件卡片/审批卡（读 session.events）；workspace 文件浏览
- **M5 Skills & Routines**：skills 目录 + / 菜单 + cron/事件 routine + test run + 历史
- **M6 集成发布**：todi-hub handoffDsh、webhook 事件、GitHub 开源
- 验收总标准：与 Grok Bot 官方工作流逐条对照可跑通（创建→派活→看活动→交接→群聊→routine→记忆延续）
