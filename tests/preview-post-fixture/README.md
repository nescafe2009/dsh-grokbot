# 预览 POST 边界 fixture（独立验证）

验证目标：CSP sandbox（opaque origin）预览页内的脚本/表单尝试 POST（含携带宿主 token 的
「借授权」场景）不得产生服务端副作用。**以服务端请求日志与计数器前后为准，不以客户端
`Failed to fetch` 当无写入**（请求实际都会到达服务端，见下）。

## 依赖的防御层（不放宽）

1. 宿主授权层（线上为 DSH 的 `?token=`；本 fixture 用仿真层模拟，不改插件认证语义）：无 token → 401
2. 插件 `assertSameOrigin`：预览沙箱 origin 为字面量 `"null"`（`new URL` 解析失败）→ 403
3. 测试端点默认关闭（`config.testEndpoints` 或 `GROKBOT_TEST_ENDPOINTS=1` 才注册）→ 生产 404

## 用法

```sh
npm run build   # 先构建（fixture 驱动 lib/index.mjs 真实产物）
node tests/preview-post-fixture/run.mjs          # 自检：预览/保存响应头 + 计数不变，退出
node tests/preview-post-fixture/run.mjs --serve  # 浏览器验证：打印 previewUrl，SIGINT 打印证据后退出
```

`--serve` 模式端口固定 8791，只用 mock agents（不真实模型），临时 stateDir 随进程清理，
不触碰用户安装（只退出本 fixture）。

## 已验证的浏览器证据（2026-09-06，Safari WebKit IAB）

页面 6 次尝试与服务端日志一一对应：

| 尝试 | 客户端表现 | 服务端处置 |
| --- | --- | --- |
| fetch 无 token | TypeError: Failed to fetch | `POST origin="null" token=false → 401` |
| fetch 带 token (cors) | TypeError: Failed to fetch | `POST origin="null" token=true → 403` |
| fetch 带 token (no-cors) | status 0 (opaque) | `POST origin="null" token=true → 403` |
| GET count 带 token | TypeError: Failed to fetch | `GET origin="null" token=true → 403` |
| form 无 token | submitted（请求已发出） | `POST token=false → 401` |
| form 带 token | submitted（请求已发出） | `POST token=true → 403` |

计数器 before/after = 0/0；agents 会话创建 = 0；预览 GET 200（CSP
`sandbox allow-scripts allow-popups allow-forms`）；「保存副本」点击 →
`GET ?download=1 → 200` + `content-disposition: attachment`（页面不导航）。

永久回归（无浏览器）：`tests/preview-endpoints.test.mjs`。
