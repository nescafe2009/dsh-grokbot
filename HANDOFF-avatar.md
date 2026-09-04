# HANDOFF · Q 版头像体系设计（交给 Codex）

> 目标：在 **H1-EVO 果冻豆**方向上把 dsh-grokbot 的头像做得**更可爱**，并实现完整的角色分配体系。
> 你（Codex）负责美术精修与 SVG 产出；架构、接入点、约束、验收均已写明，照此执行即可。
> 仓库：`github.com/nescafe2009/dsh-grokbot`（本地 `/Users/moltbot/Documents/Workspaces/Zcode/DshCustomize`）

---

## 1. 背景：头像体系现状

- 应用是 DSH（DeepSeek Harness）桌面端的**纯插件**，全部 UI 在 `src/client/index.tsx` 单文件里（React + 内联 SVG，无 CSS 框架、无外部依赖，最终经 tsdown 打包成 CJS 注入宿主）。
- 当前头像组件：`AvatarView`（`src/client/index.tsx` 搜 `AvatarView`）：
  - API：`<AvatarView seed={botId} name={botName} glyph={roleGlyph?} size={36} fontSize={15} />`
  - 底色：`botGradient(id)`（id 哈希 → HSL 双色渐变）
  - 内容：单字（名字首字）或 `GLYPHS` 里的白描线条图标
- 调用点（共 6 处，均已统一走 AvatarView）：侧栏行、私聊会话头、群聊会话头、成员面板、设置向导角色卡、（向导内角色图标走 `AvatarGlyph`）。

**用户已确认的方向**：果冻豆（H1-EVO）+ 大眼高光 + 腮红 + 角色专属耳朵/配件/嘴型。用户唯一的不满是"还不够可爱"——**你的任务就是把可爱度拉满**。

## 2. 美学规格（必须遵守）

1. **身躯**：横躺果冻豆（宽 > 高，约 46×38 视觉体量，画布 64×64），轮廓带 1-2 处不对称"软凹凸"，顶部椭圆高光（奶盖感）。
2. **可爱度要求**（重点，比现有草图再进一步）：
   - 眼睛：占脸高约 1/4~1/3，纯白眼底 + 深色大瞳 + 左上白色高光点（可再加右下 30% 小高光，"水汪汪"）
   - 全员腮红：两颊柔粉椭圆（透明度 0.4-0.55，忌实心）
   - 嘴型小而低：弧线/o/w/波浪/方，尺寸克制（嘴越小越可爱）
   - 可加"挤压感"：豆体下缘轻微压扁、两侧微鼓（squash & stretch）
   - 配色：糖果奶油系渐变（上浅下深），禁止高饱和荧光色
3. **角色要素**：每角色 = 身色渐变 + 头顶要素（耳朵/呆毛/天线/皇冠）+ 眼部要素（眼镜/放大镜/特殊瞳）+ 嘴型。见 §4 矩阵。
4. **技术硬约束**：
   - 纯 inline SVG（`viewBox="0 0 64 64"`），**禁止**外部图片/字体/依赖/emoji
   - 渐变 `<defs><linearGradient>` 的 id 必须全局唯一（多个头像同屏渲染，id 冲突会串色——用 `q1`+botId 之类的唯一后缀，或改用 `<radialGradient>` 内联 fill 不带 id 的方案）
   - 36px 下必须可辨认（把 SVG 缩到 36px 自查：眼睛/配件不能糊成一团）
   - 确定性：同 seed 渲染结果完全一致（哈希只用于自定义角色的色相/气泡）

## 3. 基准草图（12 格，用户已认可的结构，你来精修可爱度）

以下 SVG 是"结构正确、可爱度待拉满"的基准。保留结构，提升圆润度/比例/质感：

```svg
<!-- 幕僚长：小熊耳 + 星星眼 + 皇冠 + o嘴，蓝 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb0ff"/><stop offset="1" stop-color="#4c5fd7"/></linearGradient></defs><circle cx="14" cy="13" r="6" fill="#4c5fd7"/><circle cx="50" cy="13" r="6" fill="#4c5fd7"/><circle cx="14" cy="13" r="3" fill="#ffc9de"/><circle cx="50" cy="13" r="3" fill="#ffc9de"/><path d="M11 37C10 26 20 18 33 18c14 0 23 8 22 19-1 12-11 15-23 15S13 49 11 37z" fill="url(#e1)"/><ellipse cx="26" cy="22" rx="6" ry="2.8" fill="#fff" opacity=".45"/><path d="M26 10l2 4 4.4-2.2-.8 4.6 3.2 2.6-4.4.8-1.6 4-2.6-3.2-4.4.8 2.4-4-1.6-4 4 1z" fill="#ffd84d" stroke="#fff" stroke-width="1.6"/><path d="M24 25l1.6 3.4 3.4 1.6-3.4 1.6-1.6 3.4-1.6-3.4-3.4-1.6 3.4-1.6z" fill="#fff"/><path d="M42 25l1.6 3.4 3.4 1.6-3.4 1.6-1.6 3.4-1.6-3.4-3.4-1.6 3.4-1.6z" fill="#fff"/><ellipse cx="33" cy="45" rx="3.2" ry="2.1" fill="#24304d"/><circle cx="16.5" cy="42" r="3" fill="#ff9db1" opacity=".55"/><circle cx="49.5" cy="42" r="3" fill="#ff9db1" opacity=".55"/></svg>

<!-- 工程师：兔耳 + 圆眼镜 + 方嘴，绿 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fe0b4"/><stop offset="1" stop-color="#1f9d72"/></linearGradient></defs><path d="M20 19C16 10 18 5 22 5c4 0 6 5 5.6 13z" fill="#1f9d72"/><path d="M44 19C48 10 46 5 42 5c-4 0-6 5-5.6 13z" fill="#1f9d72"/><path d="M21.8 17C19.6 11 20.4 8 22.4 8c2 0 3 3 3.2 8z" fill="#ffc9de"/><path d="M42.2 17C44.4 11 43.6 8 41.6 8c-2 0-3 3-3.2 8z" fill="#ffc9de"/><path d="M11 36C10 25 20 17 33 17c14 0 23 8 22 19-1 12-11 16-23 16S13 48 11 36z" fill="url(#e2)"/><ellipse cx="26" cy="22" rx="6" ry="2.8" fill="#fff" opacity=".4"/><circle cx="24" cy="36" r="6.4" fill="none" stroke="#0e2b1f" stroke-width="2.6"/><circle cx="42" cy="36" r="6.4" fill="none" stroke="#0e2b1f" stroke-width="2.6"/><path d="M30.4 36h5.2" stroke="#0e2b1f" stroke-width="2.6"/><circle cx="24" cy="36" r="2.6" fill="#0e2b1f"/><circle cx="42" cy="36" r="2.6" fill="#0e2b1f"/><rect x="27" y="46" width="11" height="3.6" rx="1.8" fill="#0e2b1f"/><circle cx="16.5" cy="41" r="3" fill="#ff9db1" opacity=".5"/><circle cx="49.5" cy="41" r="3" fill="#ff9db1" opacity=".5"/></svg>

<!-- 调研员：猫耳 + 举放大镜 + 睫毛 + w嘴，橙 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset="1" stop-color="#f08c1d"/></linearGradient></defs><path d="M14 21C10 11 13 6 18 7c5 1 5.6 9 4.4 15z" fill="#f08c1d"/><path d="M50 21C54 11 51 6 46 7c-5 1-5.6 9-4.4 15z" fill="#f08c1d"/><path d="M17 19C15 13 16 9.5 18.4 10 20.6 10.5 21 14 20 18z" fill="#ffc9de"/><path d="M47 19C49 13 48 9.5 45.6 10 43.4 10.5 43 14 44 18z" fill="#ffc9de"/><path d="M11 36C10 25 20 17 33 17c14 0 23 8 22 19-1 12-11 16-23 16S13 48 11 36z" fill="url(#e3)"/><ellipse cx="26" cy="22" rx="6" ry="2.8" fill="#fff" opacity=".45"/><circle cx="50" cy="34" r="7" fill="none" stroke="#3d2a05" stroke-width="2.8"/><path d="M55 39l4 4" stroke="#3d2a05" stroke-width="3.2" stroke-linecap="round"/><circle cx="24" cy="35" r="5.8" fill="#fff"/><circle cx="38" cy="35" r="5.8" fill="#fff"/><circle cx="25.2" cy="36.2" r="3" fill="#3d2a05"/><circle cx="39.2" cy="36.2" r="3" fill="#3d2a05"/><path d="M24 30l1.8-3.6M38 30l-1.8-3.6" stroke="#3d2a05" stroke-width="2.2" stroke-linecap="round"/><path d="M28 46l2 2 2-2 2 2 2-2" stroke="#3d2a05" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16.5" cy="41" r="3" fill="#ff8a8a" opacity=".5"/></svg>

<!-- 写作官：呆毛 + 叼笔 + 波浪嘴，紫 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dcb4ff"/><stop offset="1" stop-color="#8b46eb"/></linearGradient></defs><path d="M32 8c-2.6 5.4-1 9.4.6 12 1.6-2.6 3.2-6.6.6-12z" fill="#8b46eb"/><path d="M31 9.6c-1.2 3.2-.4 6 1 8.4l1.8-1.8c-.8-1.8-1.8-4-2.8-6.6z" fill="#ffc9de"/><path d="M11 36C10 25 20 18 33 18c14 0 23 8 22 18-1 12-11 15-23 15S13 48 11 36z" fill="url(#e4)"/><ellipse cx="26" cy="22" rx="6" ry="2.8" fill="#fff" opacity=".45"/><path d="M44 40l6.4 11" stroke="#3d2a05" stroke-width="3" stroke-linecap="round"/><path d="M42.4 39.4l3.4-2.8 3.8 4.4-3.4 2z" fill="#ffd84d" stroke="#3d2a05" stroke-width="1.4"/><circle cx="24" cy="34" r="5.8" fill="#fff"/><circle cx="38" cy="34" r="5.8" fill="#fff"/><circle cx="25.2" cy="35.2" r="3" fill="#241238"/><circle cx="39.2" cy="35.2" r="3" fill="#241238"/><path d="M26 44q4 4 8-1t8 1" stroke="#241238" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="16.5" cy="40" r="3" fill="#ff9db1" opacity=".5"/><circle cx="48.5" cy="40" r="3" fill="#ff9db1" opacity=".5"/></svg>

<!-- 数据分析师：尖耳 + 十字瞳 + o嘴，青 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e5" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a3e8ff"/><stop offset="1" stop-color="#2f9dc4"/></linearGradient></defs><path d="M20 17c-4-4-6-9-3-11s7 2 9 8z" fill="#2f9dc4"/><path d="M44 17c4-4 6-9 3-11s-7 2-9 8z" fill="#2f9dc4"/><path d="M11 36C10 25 20 17 33 17c14 0 23 8 22 19-1 12-11 16-23 16S13 48 11 36z" fill="url(#e5)"/><ellipse cx="26" cy="22" rx="6" ry="2.8" fill="#fff" opacity=".5"/><circle cx="24" cy="35" r="5.8" fill="#fff"/><circle cx="40" cy="35" r="5.8" fill="#fff"/><path d="M20.4 35h7.2M24 31.4v7.2M36.4 35h7.2M40 31.4v7.2" stroke="#0b3346" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="33" cy="45" rx="3" ry="2" fill="#0b3346"/><circle cx="16.5" cy="41" r="3" fill="#ff9db1" opacity=".5"/><circle cx="49.5" cy="41" r="3" fill="#ff9db1" opacity=".5"/></svg>

<!-- 产品经理：呆毛 + 看板镜 + 微笑，红 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e6" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb3b3"/><stop offset="1" stop-color="#e85660"/></linearGradient></defs><path d="M32 7c-2.8 5.6-1 9.8.6 12.4 1.6-2.6 3.4-6.8.8-12.4z" fill="#e85660"/><path d="M11 36C10 25 20 18 33 18c14 0 23 8 22 18-1 12-11 15-23 15S13 48 11 36z" fill="url(#e6)"/><ellipse cx="26" cy="23" rx="6" ry="2.8" fill="#fff" opacity=".45"/><rect x="17" y="29" width="12" height="10" rx="3.4" fill="none" stroke="#4d1218" stroke-width="2.5"/><rect x="35" y="29" width="12" height="10" rx="3.4" fill="none" stroke="#4d1218" stroke-width="2.5"/><path d="M29 34h6" stroke="#4d1218" stroke-width="2.5"/><circle cx="23" cy="34" r="2.2" fill="#4d1218"/><circle cx="41" cy="34" r="2.2" fill="#4d1218"/><path d="M28 46q5 4 10 0" stroke="#4d1218" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="16.5" cy="41" r="3" fill="#fff" opacity=".4"/></svg>

<!-- 运维官：天线 + 示波眼 + 旋钮，灰蓝 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e7" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ccd9ef"/><stop offset="1" stop-color="#5f7cad"/></linearGradient></defs><path d="M32 6v8" stroke="#5f7cad" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="5" r="2.8" fill="#ffd84d"/><path d="M11 36C10 25 20 18 33 18c14 0 23 8 22 18-1 12-11 15-23 15S13 48 11 36z" fill="url(#e7)"/><ellipse cx="26" cy="23" rx="6" ry="2.8" fill="#fff" opacity=".5"/><rect x="16" y="30" width="32" height="7" rx="3.4" fill="none" stroke="#1c2a4d" stroke-width="2.5"/><circle cx="22" cy="33.5" r="1.8" fill="#1c2a4d"/><path d="M30 33.5h12" stroke="#1c2a4d" stroke-width="2.2" stroke-linecap="round"/><circle cx="24" cy="43" r="5" fill="none" stroke="#1c2a4d" stroke-width="2.5"/><circle cx="42" cy="43" r="5" fill="none" stroke="#1c2a4d" stroke-width="2.5"/><circle cx="24" cy="43" r="2" fill="#1c2a4d"/><circle cx="42" cy="43" r="2" fill="#1c2a4d"/><circle cx="16.5" cy="42" r="3" fill="#ff9db1" opacity=".45"/></svg>

<!-- 翻译官：叶耳 + 地球眼 + 微笑，绿 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e8" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bdf2cf"/><stop offset="1" stop-color="#3aa866"/></linearGradient></defs><path d="M15 20c-5-6-4-12 1-11 4 1 6 7 6 13z" fill="#3aa866"/><path d="M49 20c5-6 4-12-1-11-4 1-6 7-6 13z" fill="#3aa866"/><path d="M11 36C10 25 20 18 33 18c14 0 23 8 22 18-1 12-11 15-23 15S13 48 11 36z" fill="url(#e8)"/><ellipse cx="26" cy="23" rx="6" ry="2.8" fill="#fff" opacity=".5"/><circle cx="24" cy="34" r="7" fill="none" stroke="#0c3a20" stroke-width="2.5"/><path d="M24 27v14M17.5 34h13M19 29.5c3.4 3 3.4 6.5 0 9.4M29 29.5c-3.4 3-3.4 6.5 0 9.4" stroke="#0c3a20" stroke-width="1.8" fill="none"/><circle cx="42" cy="34" r="5.6" fill="#fff"/><circle cx="43.2" cy="35.2" r="2.9" fill="#0c3a20"/><path d="M28 46q5 4 10 0" stroke="#0c3a20" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="16.5" cy="41" r="3" fill="#ff9db1" opacity=".5"/></svg>

<!-- 秘书：呆毛 + 双弧嘴 + 侧星，粉 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e9" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd6e4"/><stop offset="1" stop-color="#e8739c"/></linearGradient></defs><path d="M32 7c-2.8 5.6-1 9.8.6 12.4 1.6-2.6 3.4-6.8.8-12.4z" fill="#e8739c"/><path d="M11 36C10 25 20 18 33 18c14 0 23 8 22 18-1 12-11 15-23 15S13 48 11 36z" fill="url(#e9)"/><ellipse cx="26" cy="23" rx="6" ry="2.8" fill="#fff" opacity=".55"/><circle cx="24" cy="34" r="5.8" fill="#fff"/><circle cx="40" cy="34" r="5.8" fill="#fff"/><circle cx="25.2" cy="35.2" r="3" fill="#4d1230"/><circle cx="41.2" cy="35.2" r="3" fill="#4d1230"/><path d="M27 44q3 3 6 0t6 0" stroke="#4d1230" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M15 30l1.6 3.2 3.2 1.6-3.2 1.6L15 40l-1.6-3.2-3.2-1.6 3.2-1.6z" fill="#fff" opacity=".7"/><circle cx="16.5" cy="41" r="3" fill="#fff" opacity=".45"/></svg>

<!-- 审核官：角耳 + 星星眼 + 平嘴，紫蓝 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e10" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dcd6ff"/><stop offset="1" stop-color="#7a68d4"/></linearGradient></defs><path d="M18 18c-6-3-8-8-4-9 4-1 8 4 10 10z" fill="#7a68d4"/><path d="M46 18c6-3 8-8 4-9-4-1-8 4-10 10z" fill="#7a68d4"/><path d="M11 36C10 25 20 18 33 18c14 0 23 8 22 18-1 12-11 15-23 15S13 48 11 36z" fill="url(#e10)"/><ellipse cx="26" cy="23" rx="6" ry="2.8" fill="#fff" opacity=".5"/><path d="M23 30l1.8 3.8 3.8 1.8-3.8 1.8-1.8 3.8-1.8-3.8-3.8-1.8 3.8-1.8z" fill="#fff"/><path d="M41 30l1.8 3.8 3.8 1.8-3.8 1.8-1.8 3.8-1.8-3.8-3.8-1.8 3.8-1.8z" fill="#fff"/><path d="M28 46h10" stroke="#2d2450" stroke-width="3" stroke-linecap="round"/><circle cx="16.5" cy="41" r="3" fill="#ff9db1" opacity=".45"/></svg>

<!-- 群聊：三联云 -->
<svg viewBox="0 0 64 64"><defs><linearGradient id="e13" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c5d2e0"/><stop offset="1" stop-color="#5c718c"/></linearGradient></defs><path d="M6 30c0-8 7-13 14-12 2-6 12-7 15-1 7-2 13 3 12 9 6 1 9 8 4 12 3 6-2 12-9 11-5 4-12 4-16-1-6 3-14 0-16-6-6-1-9-7-4-12z" fill="url(#e13)"/><circle cx="20" cy="30" r="3.8" fill="#fff"/><circle cx="34" cy="28" r="3.8" fill="#fff"/><circle cx="46" cy="33" r="3.8" fill="#fff"/><circle cx="21" cy="31" r="1.9" fill="#1c2735"/><circle cx="35" cy="29" r="1.9" fill="#1c2735"/><circle cx="47" cy="34" r="1.9" fill="#1c2735"/><path d="M24 38q4 3.4 8 0M40 38q4 3.4 8 0" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>
```

自定义角色两种（结构同上，要素来自关键词/哈希）：
- **关键词命中**（如描述含"法律/合规"）→ 盾徽/天平族 + 金棕色调
- **名字哈希** → 糖果色相（id 哈希）+ 内部气泡/星光 + 随机嘴型（3-4 种池子）

## 4. 角色分配逻辑（服务端已有一半，补齐即可）

| 场景 | 分配规则 | 已有基础 |
|---|---|---|
| 向导选角色 | `roleTemplate`（chief/coder/researcher/writer/analyst/pm/ops/translator/secretary/reviewer）→ 九套固定映射 | `src/templates.mjs` 有模板 id；`bots/<id>/setup.json` 存 roleTemplate |
| 自定义角色 | 角色描述关键词 → 要素族（盾/天平/书本…自定 4-6 族）；未命中 → 名字哈希 | 需新增 |
| 改名/改头衔 | title 关键词重匹配；用户可在 ⚙ 锁定 | 需新增锁定字段 |
| 幂等 | 幕僚长永远皇冠蓝（id=chief 全局唯一已实现）；群聊永远三联云 | 已实现 |
| 兜底 | ⚙ 编辑表单加 12 宫格头像选择器 | 需新增 |

## 5. 技术接入与交付要求

1. **改动范围**：`src/client/index.tsx`（AvatarView/GLYPHS 替换为果冻豆体系）+ 少量服务端（`src/index.mjs` 的 /state 给 bot 附 `roleTemplate`，读取 setup.json）。不改其它模块。
2. **组件 API 不变**：`AvatarView({ seed, name?, glyph?, size, fontSize? })` 签名保留（glyph 值换成模板 id），6 个调用点无需改。
3. **构建**：`npm run build`（已内置原子部署：先 lib.tmp 再换名，别绕过）。**构建后必须跑冒烟**：
   ```bash
   node -e '/* 加载 lib/client.js 并以 stub 执行 factory，确认无异常 */'
   ```
   （仓库根有现成命令的历史，参照 commit 89f3782 的消息。）
4. **验收清单**：
   - [ ] 12 个基准草图全部替换为精修版，36px 下眼睛/配件可辨
   - [ ] 同屏多头像无渐变 id 串色
   - [ ] 同 seed 两次渲染像素一致
   - [ ] 桌面端（DSH Desktop 重启后）侧栏/会话头/成员面板/向导角色卡全部生效
   - [ ] 向导选角色 → 头像即时切换正确角色
5. **风格红线**：不做写实、不引依赖、不改变 AvatarView 调用方、不动与头像无关的代码。

## 6. 参考坐标

- Grok Bot 桌面应用本机路径：`/Applications/Grok Bot.app`（只读参考其 roster 头像的"简单+有趣"度）
- MiniMax Mavis（agent.minimax.io）：圆润拟人参考
- 本仓库 `DESIGN.md` 附录 A：Grok 头像数据结构（avatarShape/avatarColor/avatarVersion）

---

## 7. 数量清单（交付规模，按此执行）

### 手绘固定款：18 个（你要精修的全部工作量）

| # | 名称 | 要素 | 
|---|---|---|
| 1 | chief 幕僚长 | 小熊耳+皇冠+星星眼+o嘴+蓝 |
| 2 | coder 工程师 | 兔耳+圆眼镜+方嘴+绿 |
| 3 | researcher 调研员 | 猫耳+举放大镜+睫毛+w嘴+橙 |
| 4 | writer 写作官 | 呆毛+叼笔+波浪嘴+紫 |
| 5 | analyst 数据分析师 | 尖耳+十字瞳+o嘴+青 |
| 6 | pm 产品经理 | 呆毛+看板镜+微笑弧+红 |
| 7 | ops 运维官 | 天线+示波眼+旋钮+灰蓝 |
| 8 | translator 翻译官 | 叶耳+地球眼+微笑弧+绿 |
| 9 | secretary 秘书 | 呆毛+双弧嘴+侧星+粉 |
| 10 | reviewer 审核官 | 角耳+星星眼+平嘴+紫蓝 |
| 11 | group 群聊 | 三联云 |
| 12 | blank 空白 Bot | 中性奶白+好奇脸（大瞳+歪头高光）——向导未选角色时用 |
| 13 | shield 关键词族·盾徽 | 盾形胸章+金棕（"法律/合规/安全"命中） |
| 14 | scales 关键词族·天平 | 头顶小天平+暖灰（"公平/评审/仲裁"命中） |
| 15 | book 关键词族·书本 | 怀抱小书+墨绿（"教育/知识/文档"命中） |
| 16 | gear 关键词族·齿轮 | 头顶小齿轮+钢青（"流程/自动化/运维类自定义"命中） |
| 17 | note 关键词族·音符 | 头顶音符+珊瑚（"音乐/创意/营销"命中） |
| 18 | flame 关键词族·火焰 | 头顶小火苗+绯红（"增长/冲刺/热情"命中） |

### 程序拼装款：576 种组合（一个函数，零手绘增量）

名字哈希（自定义未命中关键词时）从零件池确定性拼装：

```
糖果色板 12（离散，不用连续色相）× 嘴型 4（微笑弧/o/w/波浪）
× 内景 3（气泡/星光/无）× 头顶 4（无/呆毛/圆耳/尖耳）
= 576 种；同名恒定同组合
```

零件与 §3 基准草图的豆身/眼睛/腮红完全复用——拼装函数只是把这些零件按哈希组合。

---

## 8. 评级体系视觉素材（v0.3.1 已上线的数据，需要你补美术）

后端已提供 `bot.rating`（/state 每个 bot 附带）：
`{ level: 1-5, title: 见习/熟练/资深/专家/大师, exp, nextAt, stars: 1-5|null, tasksDone, tasksFailed, thumbsUp, thumbsDown }`

### 需要设计的素材

1. **等级徽章（5 档）**：替换现在纯文字的 "Lv3" 色块。建议方向：
   - Lv1 见习：木牌/灰色小盾
   - Lv2 熟练：铜色
   - Lv3 资深：银色（当前幕僚长）
   - Lv4 专家：金色
   - Lv5 大师：鎏金+宝石，可带微光效
   - 尺寸约束：会话头 meta 内高约 16px，详情面板可放大到 48px 展示
2. **质量星（1-5★）**：实心/空心两态 SVG 星（当前用的字符 ★ 样式一般），悬停态微放大
3. **头像等级联动（重点）**：AvatarView 增加可选 `level` 参数——
   - Lv4+：头像外圈金色细光环（box-shadow 或 SVG 描边环）
   - Lv5：光环 + 右上角小皇冠角标（复用幕僚长皇冠元素缩小版）
   - Lv1-3：无装饰（保持干净）
   - 调用点：AvatarView({... , level: bot.rating?.level})，从 6 个调用点透传
4. **EXP 进度条**：现用纯 CSS 渐变条，可升级为果冻风格（圆角+微光+端点小豆点），与头像质感统一
5. **反馈按钮**：👍👎 当前用字符，换成与头像同风的单线 SVG 图标（12px 级别，透明度 0.4→1 悬停）

### 渲染位置（现状代码参考）
- 会话头 meta：`src/client/index.tsx` 搜 `Lv${bot.rating.level}`（文字徽章处）
- 详情面板评级卡：搜 `grokbot-rating`（CSS 块）
- 反馈按钮：搜 `grokbot-fb`

### 约束
- 全部纯 SVG/CSS，无外部资源；16px 下可辨
- 等级联动不得破坏头像 36px 可读性（光环用极细描边，角标 ≤10px）
- AvatarView 的 `level` 参数可选，缺省行为与现在完全一致（向后兼容）
