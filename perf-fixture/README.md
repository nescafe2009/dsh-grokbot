# 独立效率采样 fixture

无秘密的独立 DSH 采样环境。所有文件不含 API key 值。

## 前置条件

- macOS，DSH Desktop.app 已安装（只读引用其 node_modules）
- 环境变量 `ZAI_API_KEY` 已 export（SDK 支持启动环境变量，见下方认证说明）

## 认证配置

DSH `llm-pi-ai` SDK 的 credential 解析顺序（源码 `dsh-llm-pi-ai/lib/index.js:2474`）：

```js
const hit = credentials !== void 0
  ? (await credentials.resolve(ref))?.value      // ① credentials service（web Models 页写入）
  : launchEnvironmentOf(ctx).get(ref)?.value    // ② 启动时进程环境变量（process.env）
```

独立 fixture 没有 credentials service 存储，走路径②。
**所需环境变量名：`ZAI_API_KEY`**（值不含在本仓库中）。

## 启动

```bash
# 1. 构建 fixture 环境（首次）
./setup.sh

# 2. 启动独立 harness（本机独立端口，不注册服务）
ZAI_API_KEY=<your-key> node sample.mjs
# 采样脚本自带启动和退出（SIGTERM 后自动清理）

# 3. 退出
# 采样脚本自动退出（child.kill('SIGTERM')）
```

## 预检

采样脚本启动后先做认证预检（发送一次直连请求检查 status）：
- 预检失败（`ZAI_API_KEY` 未设置/无效）→ 脚本以 exit code 1 退出，不记录任何成功时延
- 预检通过 → 开始交替顺序配对采样

## 配对结果 schema

```json
{
  "commit": "<git SHA>",
  "timestamp": "<ISO 8601>",
  "model": "zai/glm-5.3",
  "samples": [
    {
      "round": 1,              // 第几轮交替
      "pair": "cold-qa",       // cold-qa | cold-tool | warm-plugin | warm-direct
      "side": "direct|plugin", // 直连 or 插件
      "ms": 12345,             // 从请求发起到响应的总耗时
      "status": "ok|failed|cancelled|empty",
      "toolCalls": 0,          // 实际工具调用次数
      "reply": "...",          // 截断的回复文本
      "error": null             // 失败时的错误信息
    }
  ]
}
```

## 差异披露

| 差异项 | 直连（裸 DSH session） | 插件（grokbot 路径） |
|---|---|---|
| 系统提示 | DSH 默认模板 | persona + team/task/deliver 工具描述 |
| 工具集 | DSH 自带（含 bash/fs） | DSH 自带 + 插件注册的额外工具 |
| 历史 | 无（冷启）/ 有（暖复用） | 无（冷启）/ 有（暖复用） |
| 模型 | 相同（settings.yaml 指定） | 相同 |

"无插件工具"≠"无工具"——直连路径仍有 DSH 自带的 bash/fs 等工具可用。

## 清理

```bash
./cleanup.sh  # 删除 /tmp/dsh-perf-fixture 和临时文件
```
