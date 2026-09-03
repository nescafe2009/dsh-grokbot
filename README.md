# dsh-grokbot

在 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 上复刻 Grok Bot 模式的常驻 agent 团队插件。

**一切皆插件**：本项目是纯树外插件，不修改 DSH 本体，`dsh plugin` 一条命令安装。

## 它做什么

- **常驻 agent 团队**：在 `crew.json` 里定义若干具名 bot（头像、人格、专属工作区），DSH 启动即常驻
- **首页原生存在**：bot 卡片直接出现在 DSH 首页输入区下方，显示实时状态（待命/工作中），点击即聊——不新开窗口
- **todi-hub 兼容 inbox 协议**：`queue.jsonl` + `<jobId>/job.json` + `reply.md`，与 Grok Bot 的文件驱动方式同构，外部系统（手机、webhook、定时器）投文件即接活
- **每 bot 一台"电脑"**：默认 `~/.dsh/grokbot/workspaces/<botId>` 专属工作区，后台任务在隔离会话中执行

## 安装

```bash
# 构建产物已提交，安装端无需 TS 工具链
dsh plugin --profile web add <本目录>
# 或从 GitHub
dsh plugin --profile web add github:<owner>/dsh-grokbot
```

重启 DSH 后首页出现「Agent 团队」区块。

## 配置

状态目录：`~/.dsh/grokbot/`

`crew.json` 示例：

```json
{
  "routing": { "default": "chief" },
  "bots": [
    {
      "id": "chief",
      "name": "幕僚长",
      "avatar": "🎖️",
      "persona": "你是团队的幕僚长，用简体中文直接处理任务。",
      "workspace": "",
      "model": null
    },
    {
      "id": "coder",
      "name": "工程师",
      "avatar": "🛠️",
      "persona": "你是团队的工程师，负责编码与调试。",
      "workspace": ""
    }
  ]
}
```

## inbox 协议（外部投递任务）

```bash
INBOX=~/.dsh/grokbot/inbox
mkdir -p "$INBOX/myjob"
echo "帮我总结这个目录" > "$INBOX/myjob/prompt.md"
echo '{"jobId":"myjob","text":"帮我总结这个目录","dir":"'$INBOX'/myjob"}' >> "$INBOX/queue.jsonl"
# 等待 $INBOX/myjob/reply.md 出现
```

HTTP API（前端与外部系统通用）：

- `GET  /api/plugins/grokbot/state` —— bots 状态、队列、最近任务
- `POST /api/plugins/grokbot/inbox` —— `{ text, toBot?, images? }` 入队
- `POST /api/plugins/grokbot/bots/:id/chat` —— `{ text }` 同步对话一轮
- `GET/PUT /api/plugins/grokbot/crew` —— 读取/更新团队定义

## 开发

```bash
npm install
npm run check   # 语法 + 单元测试
npm run build   # tsdown 构建 lib/（服务端 ESM + 客户端 CJS）
```

本地验证（隔离环境，不动真实 `~/.dsh`）：

```bash
DSH_HOME=/tmp/dsh-smoke dsh --profile web --dump-config   # 树中应出现 grokbot
```

## 路线图

见 [GOALS.md](./GOALS.md)：常驻团队（已实现）→ 首页 UI（已实现）→ 触发器（cron/webhook/watcher）→ 幕僚长路由编排。

## License

MIT
