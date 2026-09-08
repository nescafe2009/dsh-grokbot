# 最终只读对账（R0 / 证据台账 / 效率三项 / 建议顺序）

本文档为只读对账：未改动任何真实进程数据、未读取会话正文或凭据、未采样、未查 Keychain。

## 一、R0 迁移对账

**结论：R0 的实际交付物是能力映射（`docs/capability-map.md`，d471dd3），不是数据迁移；新旧状态的数量/hash 对照因缺基线不能证明。**

- 本仓历史上的"迁移"性质工作 = chat-sessions 机制（DSH 原生 sessionId 复合键持久化 + resume 往返，capability-map #1 记录"迁移往返后 153 会话仍可续"）与 DM/群 transcript 自管存储；VM 时期产物**未形成可对账的旧状态基线**（design-ref/ 为 gitignored 私有参考，不入账）——因此"旧 vs 新"的任务/会话/成果数量或 hash 对照**缺基线，不能证明**，如实声明。
- **当前状态盘点（只读，仅计数与文件 hash，未读正文）**：
  - 实际 stateDir：`~/Library/Application Support/dsh-desktop/harness/grokbot`（桌面宿主 userData/harness 下的 `dshHomePath('grokbot')`，与随包 cordis.patch 一致）
  - 计数：tasks 24 · artifacts 35 · 群 transcript 22 · bots 50 · DM transcripts 38 · inbox job 目录 180 · workspace 文件 118 · crew.json sha256 前 16 位 `52e5438c567fdd4b`
- **单消费者**：成立——单一宿主实例（用户 DSH Desktop），无第二消费者路径。
- **Mac workspace**：成立——执行工具（bash/fs）经 cordis.patch 启用于宿主环境（Mac 本机，workspace-write + 审批）；共享 workspace 在 stateDir/workspace（上列 118 文件）。
- **VM 非必需**：成立——`ensureComputerServices` 无 computer 配置即返回（本机未配置 enabled）；隧道/镜像路径默认不触发；R3 全部验收（含浏览器前后对照）均未使用 VM。

## 二、证据台账（候选源码 SHA / tgz / 宿主 / 已验收 / 余项与欠项）

| 项 | 值 |
|---|---|
| 产品面最后源码提交 | `e67f453`（此后 3 个提交均为测试设施，`git diff e67f453..HEAD -- src lib` = 0 行） |
| 当前 HEAD | `32994de`（测试提交，**不冒称重建产品包**——已测 tgz 仍以 e67f453 为准） |
| 已测 tgz | `dsh-grokbot-0.3.2.tgz` · 61 文件 · SHA256 `72f54a3fe1bcad58ee44e0069f7a6c72d1f6f25378cb689bccc8e8def1c210b2` · `builtFromSource @e67f453` |
| 宿主版本 | DSH Desktop 0.7.2 · `@deepseek-ai/dsh-base`/`dsh-web-app` 0.1.2-alpha.1（实测） |
| peer 声明 | `^0.1.0-rc.6` **未收敛**到实测矩阵（R3-C 项） |

**已验收证据**（均在本 issue 前序评论）：六态 UI 组件冻结与异步切换（真实 React 21→23 项）；重试槽代次/序号/结算（探针 12/14/22 关闭）；测试端点门控 + 预览 POST 边界（真实路由 + IAB 六请求 401/403 + 计数 0→0）；重启恢复三生命周期幂等（132 项期）；产物故事 V1→V2→handoff 消费→V3→重启稳定；跨视图卸载/重挂（draft-store + 浏览器实操）；R3-A 干净包（源码构建 + 扫描 + 注入回归）与隔离 profile 16 步；R3-B 浏览器前后对照 20/20 + stageWindow 身份绑定负例/成功路径（145 项期）。

**余项**：R3-C 真实模型全链 + 卸载后长时观察；取消/重试服务端端到端联调；效率三项修复与真实配对采样；peer 版本矩阵锁定。

**欠项（如实）**：测试依赖 `/tmp/react-test-env`（react 19.2.8/react-dom 19.2.8/happy-dom 20.14.0，不随包分发）；browser fixture 在仓库根 node_modules 建 react 符号链接（指向上述环境）；`dist/r3/` 全部产物 gitignored（tgz/manifest/截图/evidence 本地留存）；浏览器截图留存于本地与会话记录而非仓库。

## 三、效率三项逐项核对（不采样、不找凭据）

| 项 | 当前位置与形态 | 无模型可修 | 需模型条件 |
|---|---|---|---|
| `hasPluginToolEvidence` ??/三元混写 | `perf-fixture/sample.mjs:136`：`outcome.activity ?? outcome.perf?.toolCalls !== undefined ? (...) : []` —— `??` 与三元混写使真实 `outcome.activity` 内容从不被检验（非空数组恒真，实际退化为 `perf.toolCalls>0` 伪 activity） | **是**：纯逻辑修正（显式分支判 `Array.isArray(outcome.activity)`）+ 构造 outcome 形状的单元测试 | 修复后的采样验证需真实模型 |
| 直连 `targetMatch` 字节冒充 | `perf-fixture/sample.mjs:223`：`directTarget = (d.replyBytes ?? 0) > 0`（"至少有回复"冒充目标内容验证）；且 `__perf/direct` 响应（`src/index.mjs` 路由）只回 `replyBytes` 不回 `reply`，结构上无法验证目标内容 | **是**：端点响应补截断 `reply`（测试端点已默认门控，无新增暴露面），fixture 改 `reply.includes('COLD-TOOL')`（与插件侧同标准）+ 路由单测 | 同上 |
| 暖直连私有 handle | `perf-fixture/sample.mjs:277`（blocked 恒 incomplete）+ `perf-fixture/README.md:108`：需保留专用 session 多次 followup + finally dispose 的私有 handle | **是（实现）**：`__perf/direct` 扩展会话保留模式（fixture 持 sessionId 续测、显式释放）+ 单测 | 暖启动效果验证需真实模型 |

## 四、建议顺序（有限，供派工）

1. **效率三修复**（无模型：上述三项代码修正 + 单元回归）——工具先于测量。
2. **取消/重试服务端端到端联调**（无模型：mock agent 驱动 chat/inbox×首轮/交接×取消路径）。
3. **R3-C 真实模型全链 + 效率真实配对采样**（需凭据/授权，见下）+ peer 版本矩阵锁定（在同批干净 profile 实测后收敛）。
4. **卸载后长时观察**（用户日常使用期，被动收集）。

## 五、真实模型验收所需非秘密配置/授权条件

- **凭据注入由用户完成**：在隔离验收 profile 的 DSH 设置界面（或用户自管环境变量）配置 llm provider API key——密钥不经过开发/审核方，不落仓库/日志/issue。
- **预检只查存在性**：`ZAI_API_KEY`（或对应 provider）是否设置，由用户执行并回报"已设置/未设置"，不回显值。
- **采样范围授权**：仅 fixture 专用 bot（如 `冷启动N`/`暖采样`），**不采样用户 chief 会话**；每轮样本数与总时长明确（如冷 4 轮、暖 5 次，单轮超时上限沿用 jobTimeoutMs）。
- **开关**：`config.testEndpoints: true` 显式开启（验收后关闭）；全程无 CSP/认证/隔离放宽。
- **停止条件**：任一轮 status≠ok 即停（沿用 fixture 预检语义）；验收后卸载 fixture profile 并清理其 DSH_HOME。
