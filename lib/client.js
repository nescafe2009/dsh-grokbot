window.__ModuleLoader__.load({
	id: "dsh-grokbot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/index.tsx
		const API_ROOT = "/api/plugins/grokbot";
		const POLL_MS = 2e3;
		const GROKBOT_CSS = `
.grokbot-dock { margin: 10px 0 4px; }
.grokbot-dock__title { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; opacity:.75; margin: 0 2px 8px; }
.grokbot-dock__title .grokbot-dot { width:7px; height:7px; border-radius:50%; background:#8a8f98; }
.grokbot-dock__title .grokbot-dot.on { background:#2ea043; box-shadow:0 0 6px #2ea04388; }
.grokbot-crew { display:flex; flex-wrap:wrap; gap:10px; }
.grokbot-card {
  display:flex; align-items:center; gap:10px; padding:10px 14px; border:1px solid var(--border, #d8dbe0);
  border-radius:12px; background:var(--background, #fff); cursor:pointer; min-width:210px; text-align:left;
  transition: box-shadow .15s ease, transform .15s ease; font: inherit; color: inherit;
}
.grokbot-card:hover { box-shadow:0 2px 12px rgba(0,0,0,.10); transform: translateY(-1px); }
.grokbot-card__avatar { font-size:22px; line-height:1; }
.grokbot-card__main { flex:1; min-width:0; }
.grokbot-card__name { font-weight:600; font-size:14px; }
.grokbot-card__status { font-size:12px; opacity:.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-card__badge { width:8px; height:8px; border-radius:50%; background:#2ea043; flex:none; }
.grokbot-card__badge.working { background:#f0883e; animation: grokbot-pulse 1.2s infinite; }
@keyframes grokbot-pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
.grokbot-overlay { position:fixed; inset:0; z-index:1200; display:flex; align-items:stretch; justify-content:flex-end; background:rgba(0,0,0,.32); }
.grokbot-panel { width:min(440px, 92vw); height:100%; display:flex; flex-direction:column; background:var(--background, #fff); box-shadow:-8px 0 32px rgba(0,0,0,.18); }
.grokbot-panel__head { display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid var(--border, #e3e5e8); }
.grokbot-panel__title { flex:1; font-weight:700; }
.grokbot-panel__meta { font-size:12px; opacity:.65; }
.grokbot-panel__close { border:none; background:none; font-size:20px; cursor:pointer; opacity:.6; padding:2px 6px; }
.grokbot-panel__close:hover { opacity:1; }
.grokbot-log { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px; }
.grokbot-msg { max-width:86%; border-radius:12px; padding:9px 12px; font-size:14px; white-space:pre-wrap; word-break:break-word; }
.grokbot-msg.user { align-self:flex-end; background:#3b82f6; color:#fff; border-bottom-right-radius:4px; }
.grokbot-msg.bot { align-self:flex-start; background:var(--background-muted, #f2f3f5); border-bottom-left-radius:4px; }
.grokbot-msg.error { align-self:center; background:#fff1f0; color:#cf1322; font-size:12px; }
.grokbot-msg .grokbot-msg__time { display:block; font-size:10px; opacity:.55; margin-top:4px; }
.grokbot-empty { margin:auto; text-align:center; opacity:.55; font-size:13px; }
.grokbot-inputbar { display:flex; gap:8px; padding:12px; border-top:1px solid var(--border, #e3e5e8); }
.grokbot-inputbar textarea { flex:1; resize:none; border:1px solid var(--border, #d8dbe0); border-radius:10px; padding:9px 11px; font: inherit; min-height:44px; max-height:140px; background:transparent; color:inherit; }
.grokbot-inputbar button { border:none; border-radius:10px; background:#3b82f6; color:#fff; padding:0 16px; font-weight:600; cursor:pointer; }
.grokbot-inputbar button:disabled { opacity:.5; cursor:default; }
`;
		let openBotId = null;
		const listeners = /* @__PURE__ */ new Set();
		function openBot(botId) {
			openBotId = botId;
			for (const listener of listeners) listener();
		}
		function closeBot() {
			openBotId = null;
			for (const listener of listeners) listener();
		}
		const histories = /* @__PURE__ */ new Map();
		function historyOf(botId) {
			let list = histories.get(botId);
			if (!list) {
				list = [];
				histories.set(botId, list);
			}
			return list;
		}
		function appendHistory(botId, message) {
			historyOf(botId).push(message);
		}
		async function api(path, init) {
			const res = await fetch(`${API_ROOT}${path}`, {
				...init,
				headers: {
					"content-type": "application/json",
					...init?.headers ?? {}
				}
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(String(body?.error || `HTTP ${res.status}`));
			return body;
		}
		function useGrokbotState() {
			const [state, setState] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let alive = true;
				const tick = () => {
					api("/state").then((next) => {
						if (alive) setState(next);
					}).catch(() => void 0);
				};
				tick();
				const timer = setInterval(tick, POLL_MS);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, []);
			return state;
		}
		function useOverlayOpen() {
			const [, force] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const listener = () => force((n) => n + 1);
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}, []);
			return openBotId;
		}
		function GrokbotHomeCrew() {
			const state = useGrokbotState();
			const bots = state?.bots ?? [];
			if (bots.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-dock",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "grokbot-dock__title",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `grokbot-dot${state && state.queueDepth + state.running.length > 0 ? " on" : ""}` }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Agent 团队 · 常驻接活" }),
						state && state.queueDepth > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							"（队列 ",
							state.queueDepth,
							"）"
						] }) : null
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "grokbot-crew",
					children: bots.map((bot) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						className: "grokbot-card",
						type: "button",
						onClick: () => openBot(bot.id),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-card__avatar",
								children: bot.avatar
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "grokbot-card__main",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-card__name",
									children: bot.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-card__status",
									children: bot.status === "working" ? `工作中 · ${bot.currentJob ?? ""}` : "待命 · 点击对话"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `grokbot-card__badge${bot.status === "working" ? " working" : ""}` })
						]
					}, bot.id))
				})]
			});
		}
		function BotChatPanel(props) {
			const { bot } = props;
			const [draft, setDraft] = (0, react.useState)("");
			const [sending, setSending] = (0, react.useState)(false);
			const logRef = (0, react.useRef)(null);
			const messages = (0, react.useMemo)(() => historyOf(bot.id), [bot.id, sending]);
			(0, react.useEffect)(() => {
				logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
			}, [messages.length, sending]);
			const send = (0, react.useCallback)(async () => {
				const text = draft.trim();
				if (!text || sending) return;
				setDraft("");
				appendHistory(bot.id, {
					id: `${Date.now()}-u`,
					role: "user",
					text,
					at: Date.now()
				});
				setSending(true);
				try {
					const outcome = await api(`/bots/${encodeURIComponent(bot.id)}/chat`, {
						method: "POST",
						body: JSON.stringify({ text })
					});
					appendHistory(bot.id, {
						id: `${Date.now()}-b`,
						role: "bot",
						text: String(outcome?.reply ?? ""),
						at: Date.now()
					});
				} catch (error) {
					appendHistory(bot.id, {
						id: `${Date.now()}-e`,
						role: "error",
						text: String(error?.message ?? error),
						at: Date.now()
					});
				} finally {
					setSending(false);
				}
			}, [
				bot.id,
				draft,
				sending
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-panel",
				onKeyDown: (event) => {
					if (event.key === "Escape") closeBot();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-panel__head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { fontSize: 20 },
								children: bot.avatar
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-panel__title",
								children: bot.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-panel__meta",
								children: bot.status === "working" ? "工作中…" : "待命"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "grokbot-panel__close",
								type: "button",
								onClick: closeBot,
								"aria-label": "关闭",
								children: "✕"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-log",
						ref: logRef,
						children: [messages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-empty",
							children: [
								"和 ",
								bot.name,
								" 对话，或投递任务给它。",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"它有自己的工作区，会真实执行操作。"
							]
						}) : messages.map((message) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: `grokbot-msg ${message.role}`,
							children: [message.text, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-msg__time",
								children: new Date(message.at).toLocaleTimeString()
							})]
						}, message.id)), sending ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "grokbot-empty",
							children: "思考中…"
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-inputbar",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							value: draft,
							placeholder: `发消息给 ${bot.name}…`,
							rows: 2,
							onChange: (event) => setDraft(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									send();
								}
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: sending || draft.trim().length === 0,
							onClick: () => void send(),
							children: "发送"
						})]
					})
				]
			});
		}
		function GrokbotOverlay() {
			const openId = useOverlayOpen();
			const bot = useGrokbotState()?.bots.find((entry) => entry.id === openId) ?? null;
			if (!bot) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "grokbot-overlay",
				onClick: (event) => {
					if (event.target === event.currentTarget) closeBot();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotChatPanel, { bot })
			});
		}
		const inject = ["slots"];
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.dshGrokbot = "";
				style.textContent = GROKBOT_CSS;
				document.head.append(style);
				return () => style.remove();
			}, "grokbot: styles");
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "grokbot-crew",
				order: 6
			}, GrokbotHomeCrew));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "grokbot-overlay",
				order: 51
			}, GrokbotOverlay));
		}
		//#endregion
		exports.GrokbotHomeCrew = GrokbotHomeCrew;
		exports.GrokbotOverlay = GrokbotOverlay;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
