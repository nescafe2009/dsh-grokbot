# CODE REVIEW · 稳定性审查报告（2026-09-05）

> 审查范围：全部 3,813 行源码（服务端 1,453 + 客户端 1,523 + 数据层 636 + 头像 201）
> 方法：静态分析 + 已知事故复盘 + 运行时行为验证

---

## 🔴 严重（必须修复）

### R1. crew.json 并发写入竞态
**位置**：`src/index.mjs` 17 处 `persistCrew()` 调用，无任何锁或串行化。
**风险**：routine 调度器（30s 间隔）、API 请求、inbox 扫描器可能同时修改内存中的 `crewState.crew` 并写盘。`atomicWrite` 只是文件级原子（写入不受污染），但 **读-改-写** 之间可能丢失另一方的变更（如同时删除 bot + 添加成员）。
**修复方案**：加一个 Promise 链互斥锁：
```js
let crewLock = Promise.resolve()
function withCrewLock(fn) {
  crewLock = crewLock.then(fn, fn)
  return crewLock
}
```

### R2. 客户端 import 死引用（已修复但需防御）
**事故记录**：本轮开发中 `AvatarGlyph` 引用残留导致点击特定 bot 时组件崩溃。
**残留**：
- `import { renderBadge, renderStar, renderStateIcon } from './avatars'` — **3 个函数已不使用**（切换为 img 后遗留）
- `function hueOf()` / `function botGradient()` — **零调用的死函数**
**风险**：死 import 在 tree-shake 后不会报错，但如果未来重构 avatars.ts 删掉这些导出，import 会静默变 undefined。
**修复**：清理 import，只保留 `renderAvatarSVG, renderLevelRing, ROLE_DEFS`。

### R3. MainView 中未使用的 hiddenRef
**位置**：`src/client/index.tsx` GrokbotMainView 内 `const hiddenRef = useRef<HTMLElement[]>([])` — CSS 接管后不再需要。
**风险**：低（仅声明未使用），但混淆代码意图。
**修复**：删除。

---

## 🟡 中等（应修复）

### Y1. appendDm 在群聊路径下静默跳过
**位置**：`appendConversationMsg()` 中 `if (conversation.memberBotIds.length === 1) return`。
**风险**：设计意图正确（dm 由 chatTurn 负责转录），但如果未来 conversationTurn 的群聊路径改用此函数，会静默丢消息。
**修复**：改为 `console.warn` 或直接删除（让调用方明确）。

### Y2. setupStage 推断链的 title 匹配可能误报
**位置**：服务端 /state 的 title 关键词匹配（如 `bot.title.startsWith('工程师')` → `coder`）。
**风险**：用户自定义 title "工程师团队主管" 会误匹配到 `coder` 角色模板。
**修复**：改为精确匹配已知头衔集合，或要求 `title.startsWith(prefix + ' · ')`。

### Y3. evalScript 频繁动态 import
**位置**：`const { appendFile } = await import('node:fs/promises')` 在 `appendRoomMsg` / `appendRoutineHistory` 内。
**风险**：Node 的模块缓存使重复 import 开销极低，但在热路径（每条消息调用一次）中仍不必要。
**修复**：提升到文件顶部静态 import。

### Y4. 客户端 histories Map 无上限
**位置**：`histories = new Map<string, ChatMessage[]>()`。
**风险**：长时间运行后内存缓慢增长（每 bot 的聊天记录永久驻留内存）。50 个 bot × 无限消息 = 潜在泄漏。
**修复**：加 `MAX_HISTORY = 200` 截断。

### Y5. inbox sweepStale 可能与 runInboxJob 竞态
**位置**：`sweepStale()` 扫描 claimed 状态超时的任务并标记失败，同时 `runInboxJob()` 可能正在处理同一任务。
**风险**：如果任务即将完成（比如模型正在生成回复），sweep 判定超时写 failJob，然后 runInboxJob 也写 completeJob——最终 reply.md 被 failJob 覆盖。
**修复**：sweepStale 检查 `runningJobs` 是否包含该 jobId，跳过正在运行的任务。

---

## 🟢 低（建议改进）

### G1. 测试覆盖不足
- 现有 19 个测试全部针对数据层（crew/inbox），**0 个覆盖 HTTP API 路由、agent 生命周期、routine 调度器**
- 客户端 0 个测试（React 组件、AvatarView、SetupWizard）
- 建议：至少给 conversations CRUD + chat + approval 路由加集成测试

### G2. 素材路由的 cache-control 应区分环境
- 当前统一 `max-age=3600`，开发时改 SVG 需要强刷
- 建议：开发模式 `no-cache`，生产 `max-age=86400`

### G3. README 安装指南不含 assets-design 目录说明
- `dsh plugin add` 从 GitHub 拉取时，`files` 数组已包含 `assets-design`，但 README 未提及
- 建议：补充分发说明

### G4. CHANGELOG 中 v0.2.x 的修复条目散落
- 同一问题的两次修复（e5da9e0 + de3aa9e）分属两条，阅读困难
- 建议：合并为一条完整描述

---

## 📊 已知事故复盘（从开发过程中学习）

| 事故 | 根因 | 修复 | 防御措施 |
|---|---|---|---|
| `atomicWrite is not defined` | python 补丁丢 import | 补回 import | ✅ 已加 FACTORY 冒烟 |
| `"<CSS>" is not a function` | CSS 替换残留双反引号→标签模板调用 | 清除 13KB 残留 | ✅ FACTORY 冒烟捕获 |
| `AvatarGlyph is not defined` | 删旧组件时漏了一个调用点 | 替换为 AvatarView | ⚠ 需要加死引用扫描 |
| 侧栏 hiddenRef 被误删 | `replace(..., 1)` 匹配第一个出现而非目标 | 手动定位恢复 | ⚠ 建议用精确锚点 |
| "探索未知"反复闪现 | effect cleanup 置空 box / CSS 接管前 JS 空窗 | CSS 常驻接管 | ✅ CSS 方案根治 |
| loadUiState 不认 conversation | 写入端升级但读取端校验漏改 | 补上 kind 白名单 | ⚠ 建议版本化存储 |

---

## 执行计划

| 优先级 | 项目 | 预计 |
|---|---|---|
| 🔴 R1 | crewLock 互斥 | 15 min |
| 🔴 R2 | 清理死 import + 死函数 | 5 min |
| 🔴 R3 | 删 hiddenRef | 1 min |
| 🟡 Y1-Y5 | 逐项修复 | 45 min |
| 🟢 G1 | API 集成测试 | 2 h |
| 🟢 G2-G4 | 文档/缓存/CHANGELOG | 30 min |
