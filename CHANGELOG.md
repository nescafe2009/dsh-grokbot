# Changelog

## v0.2.0（2026-09-04）—— 统一会话实体 · 1:1 交互复刻

对齐 Grok Bot 磁盘级研究结论（DESIGN.md 附录 A）的架构升级。

### 架构
- **统一会话实体**：rooms 并入 conversations（1 成员=私聊、2-6=群，同一实体）；旧 rooms 自动迁移
- **私聊加成员即成群**：详情面板添加成员，聊天历史自动并入群转录
- 电脑组织：共享 workspace + `agents/<botId>/` 个人目录（对齐 sand-data/agents）
- 上次会话记忆迁移至服务端（DSH 端口随启动变化，localStorage 按 origin 隔离不可用）

### 交互（对齐 Grok 实机）
- UI 1:1 复刻：侧栏完全接管（移除 New Session/Task Board/默认区，⇆ 可还原）、消息应用式布局
- 「＋」统一入口：创建新 Bot / 拉群聊 / 点名单聊；**预设专家库 11 个**（幕僚长/工程师/调研员/写作官/数据分析师/产品经理/运维官/翻译官/秘书/审核官/空白）一键召唤
- 新建 Bot 对话式初始化（无表单），创建期"正在召唤专家…"过渡页
- 消息富组件：Markdown 渲染、代码块（复制/折叠）、`[[选项]]` 可点击快捷选项
- 会话内审批卡（approval 桥：同意/取消）、停止回合、启动恢复上次会话

### 能力
- 记忆体系：团队章程 + 专家 PROFILE.md 注入，bot 自维护记忆；持久对话（稳定 sessionId + 重启 resume）
- 模型三层优先级（专家级 > 团队默认 > 全局）+ 模型目录 API
- 群聊自主应答 + @定向 + bot↔bot 异步交接；Skills（`/` 引用）与 Routines（调度/试运行/历史）
- todi-hub `handoffDsh` 适配器（手机 → DSH inbox → 回复，实测"DSH 通路 OK"）

### 修复
- 创建 Bot 闪现 DSH 首页（activeKey 依赖轮询数据的竞态）
- import 丢失 atomicWrite 导致持久化静默失败
- claimed 超时任务清扫器（2×timeout 释放队列）

## v0.1.0（2026-09-03）—— 首个可用版

- cordis 插件骨架：一条命令安装进 DSH web profile，零侵入
- Bot 团队（crew.json）、todi-hub 兼容 inbox 文件协议（queue.jsonl / reply.md）
- 常驻会话 + 真模型对话（9.9s）与 inbox 任务（6s）双通路
- 首页 Agent 团队区块、HTTP API（/state /inbox /bots/:id/chat /crew）
