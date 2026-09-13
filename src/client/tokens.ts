/*
 * 冻结设计 token（R1-c，v2 修订：按 Codex 抽查纠正参照误读）
 * 来源：Grok Bot 0.39.0 实测（design-ref/NOTES.md，2x Retina 像素 → pt=px/2）
 * 修订记录：
 *  - AI 消息为浅灰圆角气泡（固定左缘、自适应右缘），此前"裸文本"系弹窗遮挡+视觉误读
 *  - 任务卡（完成态）为浅灰卡体（区域 61% #EEE 系）+ 绿完成标记 + 描边按钮；
 *    深色卡体证据不足已撤销（grok-06 仅一块 306×154pt 深区，不足定论）
 * 约定：不得凭空调整；改动需附对照图重新测量。未测项标记 [est]。
 */

export const TOKENS = {
  color: {
    bgSide: '#f7f7f7',        // 侧栏 (247,247,247)
    bgMain: '#fcfcfc',        // 主区 (252,252,252)
    bubbleUser: '#070707',    // 用户气泡 (7,7,7)
    bubbleUserText: '#ffffff',
    bubbleBot: '#eeeeee',     // AI 消息气泡 (238,238,238)
    bubbleBotText: '#1d1d1f',
    noticeCard: '#eeeeee',    // 系统通知卡（原"实测"已撤销——系弹窗误读；取浅灰中性色，与 AI 气泡同族）,
    taskCard: '#eeeeee',      // 任务卡体（完成态实测 61% #EEE 系）
    taskCardPanel: '#ffffff', // 卡内白色子面板（按钮/代码区 32% 白）
    badgeDone: '#409050',     // 完成标记·绿 (64,144,80)
    badgeRunning: '#e67e22',  // 运行/等待 (230,126,34)（grok-06 徽章）
    badgeInfo: '#38bcf8',     // 信息/链接 (56,189,248)
    dotDone: '#409050',
    dotFail: '#b03030',
    unread: '#2563eb',        // 未读点（沿用具内值，Grok 为蓝点）
    text1: '#1d1d1f',
    text2: '#62626b',
    text3: '#73737c',
    line: 'rgba(29,29,31,.08)',
  },
  layout: {
    sidebarWidth: 280,        // pt（窄窗观测 302；是否固定机制未证明，勿据此写死响应式）
    gutter: 16,               // 侧栏与主区之间白沟 [est 边界即分隔]
    padMainX: 16,             // 主区左右内边距（左14/右16.5 → 16）
    msgRightInset: 16.5,      // 用户气泡距窗右缘
    bubbleBotMaxWidth: 640,   // AI 气泡最大观测宽（592-1871px）
  },
  radius: {
    bubbleUser: 18,           // 实测 squircle 18–21pt
    bubbleBot: 18,            // [est] 与用户气泡同级（AI 气泡圆角未逐像素测）
    taskCard: 12,             // [est] 视觉估读
    composer: 22,             // 胶囊
    noticeCard: 12,
  },
  size: {
    avatarRow: 44,            // 侧栏头像直径 28–30pt
    rowHeight: 72,            // 行距 48–62pt 区间取中
    sendBtn: 22,              // 黑色圆发送钮直径
    bubbleMaxWidth: 620,      // 用户气泡最大宽（实测样本 300pt 两行）
  },
  font: {
    family: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", "Segoe UI", sans-serif',
    // 字号层级 [est]（参照粗估 12–16 逻辑px）；实现 CSS 以逻辑 px 为单位，勿与 2x 物理px 混写
    name: 14,
    preview: 12,
    time: 12,
    body: 15,
    sender: 14,
    meta: 12,
  },
} as const

export const GKF_CSS = `
.gkf-root { font-family: ${TOKENS.font.family}; color: ${TOKENS.color.text1}; }
/* --- Message --- */
.gkf-msg { flex:none; display:flex; flex-direction:column; max-width:100%; }
.gkf-msg__meta { font-size:${TOKENS.font.meta}px; color:${TOKENS.color.text3}; margin-bottom:3px; font-variant-numeric:tabular-nums; }
.gkf-msg__meta--left { text-align:left; }
.gkf-msg__meta--right { text-align:right; }
.gkf-msg__meta--center { text-align:center; }
.gkf-msg--user { align-items:flex-end; }
.gkf-msg--user .gkf-msg__bubble { background:${TOKENS.color.bubbleUser}; color:${TOKENS.color.bubbleUserText}; border-radius:${TOKENS.radius.bubbleUser}px; padding:10px 16px; max-width:min(75%, ${TOKENS.size.bubbleMaxWidth}px); font-size:${TOKENS.font.body}px; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
.gkf-msg--bot { align-items:flex-start; }
.gkf-msg--bot .gkf-msg__bubble { background:${TOKENS.color.bubbleBot}; color:${TOKENS.color.bubbleBotText}; border-radius:${TOKENS.radius.bubbleBot}px; padding:10px 16px; max-width:min(72%, ${TOKENS.layout.bubbleBotMaxWidth}px); font-size:${TOKENS.font.body}px; line-height:1.6; word-break:break-word; }
.gkf-msg--bot .gkf-msg__bubble .grokbot-code { background:#fff; }
.gkf-msg__sender { font-size:${TOKENS.font.sender}px; font-weight:650; color:${TOKENS.color.text1}; margin-bottom:2px; }
.gkf-msg--notice { align-self:stretch; }
.gkf-msg--notice .gkf-msg__card { background:${TOKENS.color.noticeCard}; border-radius:${TOKENS.radius.noticeCard}px; padding:12px 16px; font-size:var(--gk-font-label); color:${TOKENS.color.text1}; }
.gkf-msg--activity { align-items:center; }
.gkf-msg--activity .gkf-msg__card { font-size:${TOKENS.font.meta}px; color:${TOKENS.color.text3}; padding:2px 0; text-align:center; }
.gkf-msg--error .gkf-msg__card { background:rgba(176,48,48,.08); border:1px solid rgba(176,48,48,.25); border-radius:${TOKENS.radius.noticeCard}px; padding:10px 14px; font-size:var(--gk-font-label); color:${TOKENS.color.dotFail}; }
/* --- Composer --- */
.gkf-composer { display:flex; flex-direction:column; padding:6px ${TOKENS.layout.padMainX}px 12px; }
.gkf-composer__pill { display:flex; align-items:flex-end; gap:8px; background:#fff; border:1px solid ${TOKENS.color.line}; border-radius:${TOKENS.radius.composer}px; padding:7px 8px 7px 14px; box-shadow:0 1px 3px rgba(29,29,31,.05); transition:border-color .15s, box-shadow .15s; }
.gkf-composer__pill:focus-within { border-color:rgba(29,29,31,.22); box-shadow:0 2px 10px rgba(29,29,31,.07); }
.gkf-composer__input { flex:1; border:none; outline:none; resize:none; font:inherit; font-size:${TOKENS.font.body}px; line-height:1.5; max-height:160px; padding:4px 0; background:transparent; color:${TOKENS.color.text1}; }
.gkf-composer__input::placeholder { color:${TOKENS.color.text3}; }
.gkf-composer__send { flex:none; width:${TOKENS.size.sendBtn}px; height:${TOKENS.size.sendBtn}px; border:none; border-radius:50%; background:${TOKENS.color.bubbleUser}; color:#fff; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; font-size:var(--gk-font-label); transition:opacity .12s, transform .12s; }
.gkf-composer__send:disabled { opacity:.3; cursor:default; }
.gkf-composer__send:not(:disabled):hover { transform:scale(1.06); }
.gkf-composer__plus { flex:none; width:26px; height:26px; border:none; background:none; color:${TOKENS.color.text2}; font-size:var(--gk-font-title); cursor:pointer; border-radius:50%; }
.gkf-composer__plus:disabled { opacity:.4; cursor:default; }
/* --- SidebarRow --- */
.gkf-row { display:flex; align-items:center; gap:10px; width:100%; min-height:${TOKENS.size.rowHeight}px; padding:8px 10px; border:none; border-radius:12px; background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit; position:relative; transition:background .14s; }
.gkf-row:hover { background:rgba(29,29,31,.05); }
.gkf-row.active { background:#fff; box-shadow:0 0 0 1px ${TOKENS.color.line}, 0 1px 3px rgba(29,29,31,.06); }
.gkf-row__main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.gkf-row__line1 { display:flex; align-items:baseline; gap:6px; }
.gkf-row__name { font-size:${TOKENS.font.name}px; font-weight:600; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gkf-row__time { margin-left:auto; font-size:${TOKENS.font.time}px; color:${TOKENS.color.text3}; flex:none; font-variant-numeric:tabular-nums; }
.gkf-row__preview { font-size:${TOKENS.font.preview}px; color:${TOKENS.color.text2}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gkf-row__unread { position:absolute; right:10px; bottom:10px; width:8px; height:8px; border-radius:50%; background:${TOKENS.color.unread}; }
/* --- TaskCard（浅色卡体，完成态实测；运行态样式 [est] 同构换色）--- */
.gkf-task { flex:none; border-radius:${TOKENS.radius.taskCard}px; overflow:hidden; background:${TOKENS.color.taskCard}; color:${TOKENS.color.text1}; max-width:min(100%, 760px); }
.gkf-task__head { display:flex; align-items:center; gap:8px; padding:12px 16px 4px; }
.gkf-task__icon { width:18px; height:18px; border-radius:5px; flex:none; display:inline-flex; align-items:center; justify-content:center; font-size:var(--gk-font-meta); }
.gkf-task__title { flex:1; min-width:0; font-size:var(--gk-font-label); font-weight:650; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gkf-task__time { font-size:${TOKENS.font.time}px; color:${TOKENS.color.text3}; flex:none; font-variant-numeric:tabular-nums; }
.gkf-task__body { padding:6px 16px 10px; display:flex; flex-direction:column; gap:7px; }
.gkf-task__member { display:flex; align-items:center; gap:8px; font-size:var(--gk-font-label); }
.gkf-task__member-dot { width:7px; height:7px; border-radius:50%; flex:none; }
.gkf-task__member-name { font-weight:600; flex:none; }
.gkf-task__member-desc { color:${TOKENS.color.text2}; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gkf-task__foot { display:flex; align-items:center; gap:8px; padding:0 16px 12px; flex-wrap:wrap; }
.gkf-task__badge { display:inline-flex; align-items:center; gap:5px; font-size:var(--gk-font-meta); font-weight:600; border-radius:99px; padding:3px 10px; background:${TOKENS.color.taskCardPanel}; border:1px solid ${TOKENS.color.line}; color:${TOKENS.color.text1}; }
.gkf-task__badge i { width:7px; height:7px; border-radius:50%; display:inline-block; }
.gkf-task__badge--done i { background:${TOKENS.color.badgeDone}; }
.gkf-task__badge--running i { background:${TOKENS.color.badgeRunning}; animation:grokbot-pulse 1.3s ease-in-out infinite; }
.gkf-task__badge--info i { background:${TOKENS.color.badgeInfo}; }
.gkf-task__badge--failed i { background:${TOKENS.color.dotFail}; }
.gkf-task__badge--interrupted i { background:${TOKENS.color.text3}; }
.gkf-task__spacer { flex:1; }
.gkf-task__btn { border:1px solid rgba(29,29,31,.22); border-radius:99px; padding:5px 13px; font-size:var(--gk-font-meta); font-weight:600; cursor:pointer; background:${TOKENS.color.taskCardPanel}; color:${TOKENS.color.text1}; transition:filter .12s; }
.gkf-task__btn:hover { filter:brightness(.96); }
.gkf-task__btn--primary { background:${TOKENS.color.text1}; border-color:${TOKENS.color.text1}; color:#fff; }
.gkf-task__btn:disabled { opacity:.5; cursor:default; }
/* --- ArtifactCard --- */
.gkf-artifact { flex:none; display:flex; align-items:center; gap:12px; border:1px solid ${TOKENS.color.line}; border-radius:${TOKENS.radius.noticeCard}px; background:#fff; padding:12px 14px; max-width:min(100%, 560px); box-shadow:0 1px 3px rgba(29,29,31,.05); }
.gkf-artifact__icon { width:38px; height:38px; border-radius:10px; background:${TOKENS.color.noticeCard}; display:flex; align-items:center; justify-content:center; font-size:var(--gk-font-title); flex:none; }
.gkf-artifact__main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.gkf-artifact__name { font-size:var(--gk-font-label); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gkf-artifact__meta { font-size:${TOKENS.font.time}px; color:${TOKENS.color.text3}; font-variant-numeric:tabular-nums; }
.gkf-artifact__actions { display:flex; gap:6px; flex:none; }
.gkf-artifact__btn { border:none; border-radius:99px; padding:6px 12px; font-size:var(--gk-font-meta); font-weight:600; cursor:pointer; background:rgba(29,29,31,.06); color:${TOKENS.color.text1}; transition:background .12s; }
.gkf-artifact__btn:hover { background:rgba(29,29,31,.12); }
.gkf-artifact__btn--primary { background:#111; color:#fff; }
.gkf-artifact__btn--primary:hover { background:#000; }
`
