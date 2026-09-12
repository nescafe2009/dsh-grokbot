# DeepSeekBot · v0.6.0-rc.1

同事试用版（Pre-release）。已验证宿主为 macOS arm64 的 DSH Desktop 0.8.1；其他平台和宿主版本尚未完成本版实机验收。

先阅读 [安装、升级与回退](docs/INSTALL.md) 和 [试用手册](docs/USER-GUIDE.md)。包名仍为 `dsh-grokbot`，不是独立桌面安装程序，也不附带模型额度或 API key。

**当前限制**：成员跨项目独占、动态招聘调度和防止 bot 修改宿主的强制隔离尚未实现；共享工作区会排队，不能当作安全沙箱。建议从独立试用目录的小任务开始。

## 定位

**DeepSeekBot（npm 包名 dsh-grokbot）是一个纯 out-of-tree DSH 插件**：安装即得 Grok Bot 式的常驻团队（多专家/群聊/派发回流/幕僚长协调/任务闭环）。bots 用 DSH 原生工具在**宿主本机**执行（本地调用、无 SSH 绕行；本插件通过 profile patch 启用 web profile 默认禁用的 bash/fs 等执行工具，沙箱与审批沿用 DSH 原生体系。不承诺固定耗时——同任务下插件路径与直连的额外回合/耗时如实计量，见效率验收）。

可选配件：配置 computer.json 后获得一台团队共享电脑（Linux VM）——用于无头构建、长时任务、托管可试玩的 HTML（noVNC 观摩）。默认不启用，不影响插件本体。

# dsh-grokbot

在 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 上复刻 Grok Bot 模式的常驻 agent 团队插件。

> 展示名已改为 **DeepSeekBot**；技术标识（npm 包名 `dsh-grokbot`、API 路由、状态目录、localStorage 键、插件注册名等）保持兼容不变。本插件与 DeepSeek 官方无隶属关系，不代表 DeepSeek 官方出品。

**一切皆插件**：本项目是纯树外插件，不修改 DSH 本体，`dsh plugin` 一条命令安装。

## 它做什么

- **常驻 agent 团队**：在 `crew.json` 里定义若干具名 bot（头像、人格、可配置工作区），DSH 启动即常驻
- **首页原生存在**：bot 卡片直接出现在 DSH 首页输入区下方，显示实时状态（待命/工作中），点击即聊——不新开窗口
- **todi-hub 兼容 inbox 协议**：`queue.jsonl` + `<jobId>/job.json` + `reply.md`，与 Grok Bot 的文件驱动方式同构，外部系统（手机、webhook、定时器）投文件即接活
- **共享本机工作区**：默认使用插件状态目录下的共享 workspace（`<stateDir>/workspace`，个人子目录 `agents/<botId>`），bot 可覆盖为独立工作区；后台任务在按 (会话,bot) 隔离的 DSH 会话中执行

## 安装

```bash
# 构建产物已提交，安装端无需 TS 工具链
dsh plugin --profile web add <本目录>
# 或从 GitHub
dsh plugin --profile web add github:nescafe2009/dsh-grokbot
```

重启 DSH 后，从团队侧栏进入幕僚长、成员私聊或项目群聊。

当前版本：**v0.6.0-rc.1**。固定版本可从 [GitHub Releases](https://github.com/nescafe2009/dsh-grokbot/releases/tag/v0.6.0-rc.1) 下载 `dsh-grokbot-0.6.0-rc.1.tgz`，使用 `dsh plugin --profile web add /路径/dsh-grokbot-0.6.0-rc.1.tgz` 安装。升级前请备份插件状态目录；升级不删除会话与项目文件。

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

见 [GOALS.md](./GOALS.md)：常驻团队 ✅ → 首页 UI ✅ → inbox 协议 ✅ → 触发器（cron/webhook，规划中）→ 幕僚长路由编排（规划中）。

### 已知问题

- 多轮工具调用后，部分 OpenAI 兼容端点（如自建 vLLM 网关）会因请求携带空 `tools` 数组返回 400，导致带工具任务最后一轮失败；无工具任务不受影响。需在模型服务端修复（省略空 `tools` 字段）

## License

MIT


### 审批与成员权限

审批集中在幕僚长会话，侧栏显示待审批数量。卡片展示申请人、目标文件、申请原因，并可展开修改前后内容；原始工具参数默认折叠。

- **允许一次**（默认）：仅放行本次工具操作。
- **持久权限**：通过 DSH 宿主原生授权管理。插件不提供开启持久完全访问的入口。
- **关闭历史完全访问**：如旧配置仍启用，可在对应 Bot 或成员权限页面关闭。

### 项目与模型管理

与幕僚长对话即可安排验收、返工、暂停、继续或归档。归档保留快照，不代表全部阶段已验收。各 Bot 的「工作进展」可查看真实派工、工具记录与交付。

「团队默认模型」入口提供常用模型库和按成员快捷分配。选择后立即保存，下次对话或任务生效；未单独指定模型的成员跟随团队默认。服务商连接和凭据仍由 DSH 管理。

生命周期与恢复机制详见 [设计说明](docs/LIFECYCLE-RELIABILITY.md)。

## 预置角色

角色库包含架构师、QA、鸿蒙、macOS、Windows 及原有通用专业角色。姓名、职位、专业规范与用户补充职责分别管理；私聊、群聊和派工使用同一份当前身份。现有成员按职位兼容，无需重新创建。可直接让幕僚长调整成员职责。来源、许可、映射与兼容规则见 [角色设计与来源](docs/role-sources.md)。

### 项目复盘与成长

对幕僚长说「复盘这个项目」，即可按实际阶段、交付与验收记录总结经验并评价各角色。改进建议进入后续工作的实践提醒，经过后续项目验证有效才获得成长经验。报告可在 Computer → 复盘档案回看。详见 [复盘机制](docs/retrospective.md)。
