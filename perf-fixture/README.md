# 独立效率采样 fixture

无秘密的独立 DSH 采样环境。所有文件不含 API key 值。

## 前置条件

- macOS，DSH Desktop.app 已安装（只读引用其 node_modules）
- 环境变量 `ZAI_API_KEY` 已 export（SDK 认证路径见下方）
- 可选：`TESTED_SHA=<sha>` 显式指定待测版本（不从工作树猜测）

## 认证说明（源码核查结论）

DSH `llm-pi-ai` SDK 的 credential 解析（`dsh-llm-pi-ai/lib/index.js:2474`）：

```js
const credentials = ctx.get("credentials");
const hit = credentials !== void 0
  ? (await credentials.resolve(ref))?.value
  : launchEnvironmentOf(ctx).get(ref)?.value;
```

**注意**：三元表达式判断的是 **credentials 服务是否存在**，不是存储是否有值。
服务存在但 `resolve(ref)` 未命中时，**不会自动走冒号分支**（环境变量路径）。
credentials 服务内部是否回退环境变量需引用其 `resolve` 实现——当前未验证。

独立 fixture 中 credentials 服务存在（dsh-base 注册）但 resolve 未命中 → MISSING_CREDENTIAL。
`ZAI_API_KEY` 环境变量是否被 credentials 服务内部使用取决于其实现，需进一步核查。

## 启动与退出

```bash
# 1. 构建 fixture（每批唯一目录，输出 FIXTURE_DIR=...）
./setup.sh

# 2. 采样（传入 fixture 目录 + 认证）
FIXTURE_DIR=<dir> ZAI_API_KEY=<key> TESTED_SHA=<sha> node sample.mjs
# 输出: <dir>/paired-results.json
# 退出: ok → 0; incomplete/failed → 1
# 生命周期: 统一 try/finally（SIGTERM → 5s → SIGKILL → 确认 exit）

# 3. 清理（仅限有所有权标记的 fixture 目录）
./cleanup.sh <dir>
```

## 认证预检

采样前执行两次预检：
1. 环境变量 `ZAI_API_KEY` 是否设置（不打印值）
2. 真实模型调用 `/__perf/direct`，status≠ok → **exit 1 不记任何时延**

## 配对结果 schema

```json
{
  "commit": "<git SHA 或显式 TESTED_SHA>",
  "libHash": "<lib/index.mjs SHA-256 前16位>",
  "overall": "ok | incomplete | failed",
  "summary": { "total": 0, "ok": 0, "failed": 0, "cancelled": 0, "empty": 0, "blocked": 0 },
  "samples": [
    {
      "round": 1,
      "pair": "cold-qa | cold-tool | warm-plugin | warm-direct",
      "side": "direct | plugin",
      "order": 1,
      "ms": 12345,
      "status": "ok | failed | cancelled | empty | blocked | fetch_error",
      "toolCalls": 0,
      "toolEvidence": false,
      "targetMatch": false,
      "reply": "...",
      "error": null
    }
  ]
}
```

**判定规则**：`overall=ok` 仅当所有样本 status=ok。任何 failed/cancelled/empty/blocked/fetch_error → incomplete 或 failed。暖直连未实现 → 恒 incomplete。

## 工具证据验证

- 直连侧：`toolCalls > 0`（事件解析真实计数）
- 插件侧：`activity` 数组含 bash/exec 工具调用 + 回复含目标文本（如 `COLD-TOOL`）
- 仅回复含文字**不能**证明工具执行——必须两项同时满足

## 差异披露

| 差异项 | 直连（裸 DSH session） | 插件（grokbot 路径） |
|---|---|---|
| 系统提示 | DSH 默认模板 | persona + team/task/deliver 工具描述 |
| 工具集 | DSH 自带（含 bash/fs） | DSH 自带 + 插件注册的额外工具 |
| 历史 | 无（冷启）/ 有（暖复用） | 无（冷启）/ 有（暖复用） |
| 模型 | 相同（settings.yaml 指定） | 相同 |

"无插件工具"≠"无工具"——直连路径仍有 DSH 自带的 bash/fs 等工具可用。

## 采样设计

| 组 | 方法 |
|---|---|
| 冷↔冷 | 每轮交替先后（奇数轮 direct→plugin，偶数轮 plugin→direct） |
| 暖插件 | 独立 bot 预热 1 次（排除） + 采样 5 次同文本 |
| 暖直连 | 需 fixture 私有 handle（保留专用 session 多次 followup + finally dispose）——当前未实现，恒 incomplete |

## 清理

```bash
./cleanup.sh /tmp/dsh-perf-fixture-<run-id>
# 仅删除有 .dsh-perf-fixture-owner 标记且名称匹配 dsh-perf-fixture-* 的目录
```
