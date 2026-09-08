# dsh-grokbot 安装 / 启停 / 卸载（R3）

## 已验证宿主

- DSH Desktop **0.7.2**（macOS arm64）
- `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` **0.1.2-alpha.1**
- 插件注入面：`agents`（create/resume）、`webServer.register(prefix)`、`agentDefaultModel`、`llm`；客户端经宿主 `ModuleLoader`（CJS 包裹）加载 `lib/client.js`

## 依赖

- **服务端零 npm 运行时依赖**（`lib/index.mjs` 仅用 node: 内建模块）
- 客户端 `lib/client.js` 的 react/react-dom 由宿主运行时提供（external，不随包分发）
- 测试环境固定版本（不随包分发）：react 19.2.8 / react-dom 19.2.8 / happy-dom 20.14.0

## 安装

1. 取得 `dsh-grokbot-<version>.tgz`（构建方式见 `tests/package-build/build-tgz.sh`：固定 git SHA 干净导出 + npm pack + 私人内容扫描 + manifest hash）
2. 在目标 profile（`$DSH_HOME/profiles/<name>`）的 `package.json`：
   ```json
   {
     "dependencies": { "dsh-grokbot": "file:/path/to/dsh-grokbot-<version>.tgz" },
     "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-grokbot"] } }
   }
   ```
3. 安装依赖（等价桌面端 `dsh plugin --profile <name> install --no-frozen-lockfile`）；离线场景可直接把 tgz 解包为 `profile/node_modules/dsh-grokbot/`（R3 验收脚本 `tests/package-build/r3-accept.mjs` 即此形态）
4. 启动宿主（桌面选择该 profile，或 `dsh --profile <name> --no-open --host 127.0.0.1 --port <p>`）

## 启停

- 启动：随宿主 profile 启动自动加载（无需单独进程）
- 停止：停止宿主即停止（插件无守护进程；SIGTERM 退出干净，R3 验收已验证）
- 临时停用：从 `dsh.profile.bundles` 移除 `dsh-grokbot` 后重启宿主——数据不删

## 卸载与产物保留

- 卸载：移除 profile 依赖与 bundles 条目（`dsh plugin --profile <name> remove dsh-grokbot`）——**不删除任何用户数据**
- 用户数据/产物目录：`<宿主工作目录>/.dsh-grokbot/`（可经插件 config `stateDir` 覆盖）。含：
  - `crew.json`（成员与会话）、`bots/<id>/`（DM 转录、记忆、stats）
  - `tasks/`（任务与 run 历史）、`artifacts/<id>/`（成果快照 + meta，SHA256 校验）
  - `rooms/`（群转录）、`inbox/`（派发队列）、`memory/`、`skills/`
- 卸载后需要彻底清理时手动删除该目录（成果快照在 `artifacts/`，删除前自行备份）

## 测试端点

`__probe/echo`、`__probe/count`、`__perf/direct` **默认关闭**（路由不注册，404，不建会话不写计数）。仅显式配置启用：插件 config `testEndpoints: true` 或环境变量 `GROKBOT_TEST_ENDPOINTS=1`；`/state` 的 `config.testEndpoints` 字段可见当前开关态。仍走同一宿主认证与 origin 检查。

## 包完整性

每个 tgz 附 `dist/r3/manifest.json`：git SHA、tgz SHA256、逐文件 SHA256。构建脚本扫描机器特定绝对路径与凭据痕迹，命中即失败。
