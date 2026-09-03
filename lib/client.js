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
.grokbot-sidebar { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px 10px; }
.grokbot-sidebar__title { display:flex; align-items:center; gap:8px; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; opacity:.55; margin:6px 2px 6px; }
.grokbot-sidebar__title .grokbot-dot { width:6px; height:6px; border-radius:50%; background:#8a8f98; flex:none; }
.grokbot-sidebar__title .grokbot-dot.on { background:#2ea043; box-shadow:0 0 5px #2ea04399; }
.grokbot-sidebar__queue { margin-left:auto; font-size:10px; opacity:.6; text-transform:none; letter-spacing:0; }
.grokbot-sidebar__native { margin-left:auto; border:none; background:none; cursor:pointer; opacity:.45; font-size:12px; padding:1px 5px; border-radius:5px; }
.grokbot-sidebar__native:hover { opacity:1; background:rgba(127,127,127,.15); }
.grokbot-sidebar__queue + .grokbot-sidebar__native { margin-left:0; }
.grokbot-botrow {
  display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; border:none; border-radius:10px;
  background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit; transition: background .12s ease;
}
.grokbot-botrow:hover { background:rgba(127,127,127,.14); }
.grokbot-botrow.active { background:rgba(59,130,246,.16); }
.grokbot-botrow__avatar { font-size:20px; line-height:1; flex:none; }
.grokbot-botrow__main { flex:1; min-width:0; }
.grokbot-botrow__name { font-size:13px; font-weight:600; }
.grokbot-botrow__status { font-size:11px; opacity:.6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-botrow__badge { width:8px; height:8px; border-radius:50%; background:#2ea043; flex:none; }
.grokbot-botrow__badge.working { background:#f0883e; animation: grokbot-pulse 1.2s infinite; }
@keyframes grokbot-pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
.grokbot-stage { position:fixed; inset:0; z-index:1200; display:flex; align-items:stretch; justify-content:center; background:rgba(15,17,21,.46); backdrop-filter: blur(2px); }
.grokbot-chat { width:min(880px, 96vw); height:100%; display:flex; flex-direction:column; background:var(--background, #fff); box-shadow:0 0 48px rgba(0,0,0,.25); }
.grokbot-chat__head { display:flex; align-items:center; gap:12px; padding:16px 22px; border-bottom:1px solid var(--border, #e3e5e8); }
.grokbot-chat__avatar { font-size:26px; }
.grokbot-chat__title { flex:1; display:flex; flex-direction:column; }
.grokbot-chat__name { font-weight:700; font-size:16px; }
.grokbot-chat__meta { font-size:12px; opacity:.6; }
.grokbot-chat__close { border:none; background:none; font-size:20px; cursor:pointer; opacity:.55; padding:2px 8px; border-radius:8px; }
.grokbot-chat__close:hover { opacity:1; background:rgba(127,127,127,.14); }
.grokbot-log { flex:1; overflow-y:auto; padding:26px 30px; display:flex; flex-direction:column; gap:14px; }
.grokbot-msg { max-width:78%; border-radius:14px; padding:10px 14px; font-size:14.5px; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
.grokbot-msg.user { align-self:flex-end; background:#3b82f6; color:#fff; border-bottom-right-radius:5px; }
.grokbot-msg.bot { align-self:flex-start; background:var(--background-muted, #f2f3f5); border-bottom-left-radius:5px; }
.grokbot-msg.error { align-self:center; background:#fff1f0; color:#cf1322; font-size:12px; }
.grokbot-msg .grokbot-msg__time { display:block; font-size:10px; opacity:.5; margin-top:5px; }
.grokbot-empty { margin:auto; text-align:center; opacity:.5; font-size:13px; }
.grokbot-inputbar { display:flex; gap:10px; padding:16px 22px 20px; border-top:1px solid var(--border, #e3e5e8); }
.grokbot-inputbar textarea { flex:1; resize:none; border:1px solid var(--border, #d8dbe0); border-radius:12px; padding:11px 14px; font:inherit; min-height:48px; max-height:160px; background:transparent; color:inherit; }
.grokbot-inputbar textarea:focus { outline:2px solid #3b82f655; }
.grokbot-inputbar button { border:none; border-radius:12px; background:#3b82f6; color:#fff; padding:0 20px; font-weight:600; cursor:pointer; }
.grokbot-inputbar button:disabled { opacity:.45; cursor:default; }
`;
		let openBotId = null;
		let nativeSidebarVisible = false;
		const listeners = /* @__PURE__ */ new Set();
		function toggleNativeSidebar() {
			nativeSidebarVisible = !nativeSidebarVisible;
			for (const listener of listeners) listener();
		}
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
		function useOpenBotId() {
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
		function useNativeSidebarVisible() {
			const [visible, setVisible] = (0, react.useState)(nativeSidebarVisible);
			(0, react.useEffect)(() => {
				const listener = () => setVisible(nativeSidebarVisible);
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}, []);
			return visible;
		}
		function statusLine(bot) {
			if (bot.status === "working") return `工作中${bot.currentJob ? ` · ${bot.currentJob}` : ""}`;
			return "待命";
		}
		/**
		* 侧栏 agent 团队列表：挂进 sidebar.workspaces 插槽。
		* 挂载后把同容器的原有节点（默认工作区/会话树）结构化隐藏，
		* 实现整栏替换；卸载时恢复显示。
		*/
		function GrokbotSidebarCrew() {
			const state = useGrokbotState();
			const openId = useOpenBotId();
			const nativeVisible = useNativeSidebarVisible();
			const rootRef = (0, react.useRef)(null);
			const hiddenRef = (0, react.useRef)([]);
			(0, react.useEffect)(() => {
				if (nativeVisible) return;
				const root = rootRef.current;
				const container = root?.parentElement;
				if (!container) return;
				const apply = () => {
					for (const child of [...container.children]) {
						if (child === root || child.contains(root)) continue;
						const el = child;
						if (el.dataset.grokbotKept === void 0 && el.style.display !== "none") {
							el.dataset.grokbotPrevDisplay = el.style.display;
							el.style.display = "none";
							hiddenRef.current.push(el);
						}
					}
				};
				apply();
				const observer = new MutationObserver(apply);
				observer.observe(container, { childList: true });
				return () => {
					observer.disconnect();
					for (const el of hiddenRef.current) {
						el.style.display = el.dataset.grokbotPrevDisplay || "";
						delete el.dataset.grokbotPrevDisplay;
					}
					hiddenRef.current = [];
				};
			}, [nativeVisible]);
			const bots = state?.bots ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-sidebar",
				ref: rootRef,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "grokbot-sidebar__title",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `grokbot-dot${(state?.running.length ?? 0) + (state?.queueDepth ?? 0) > 0 ? " on" : ""}` }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Agent 团队" }),
						state && state.queueDepth > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "grokbot-sidebar__queue",
							children: ["队列 ", state.queueDepth]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-sidebar__native",
							title: nativeVisible ? "隐藏原始列表" : "显示原始工作区/会话列表",
							onClick: () => toggleNativeSidebar(),
							children: "⇅"
						})
					]
				}), bots.map((bot) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: `grokbot-botrow${openId === bot.id ? " active" : ""}`,
					onClick: () => openBot(bot.id),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "grokbot-botrow__avatar",
							children: bot.avatar
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "grokbot-botrow__main",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-botrow__name",
								children: bot.name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-botrow__status",
								children: statusLine(bot)
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `grokbot-botrow__badge${bot.status === "working" ? " working" : ""}` })
					]
				}, bot.id))]
			});
		}
		function BotChatView(props) {
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
				className: "grokbot-chat",
				onKeyDown: (event) => {
					if (event.key === "Escape") closeBot();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-chat__head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-chat__avatar",
								children: bot.avatar
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "grokbot-chat__title",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-chat__name",
									children: bot.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-chat__meta",
									children: bot.status === "working" ? "正在执行任务…" : "常驻待命 · 有自己的工作区"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "grokbot-chat__close",
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
								"它会真实使用工具并在自己的工作区里干活。"
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
		function GrokbotStage() {
			const openId = useOpenBotId();
			const bot = useGrokbotState()?.bots.find((entry) => entry.id === openId) ?? null;
			if (!bot) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "grokbot-stage",
				onClick: (event) => {
					if (event.target === event.currentTarget) closeBot();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotChatView, { bot })
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
			ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
				name: "sidebar.workspaces",
				id: "grokbot-crew",
				order: -100
			}, GrokbotSidebarCrew));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "grokbot-stage",
				order: 51
			}, GrokbotStage));
		}
		//#endregion
		exports.GrokbotSidebarCrew = GrokbotSidebarCrew;
		exports.GrokbotStage = GrokbotStage;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
