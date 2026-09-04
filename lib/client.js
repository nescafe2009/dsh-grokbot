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
.grokbot-newmenu { display:flex; flex-direction:column; gap:1px; margin:2px 2px 8px; padding:5px; border:1px solid var(--border,#e3e5e8); border-radius:10px; background:var(--background,#fff); box-shadow:0 4px 16px rgba(0,0,0,.08); }
.grokbot-newmenu__item { display:flex; align-items:center; gap:8px; width:100%; padding:7px 10px; border:none; border-radius:8px; background:transparent; cursor:pointer; font:inherit; font-size:13px; color:inherit; text-align:left; }
.grokbot-newmenu__item:hover { background:rgba(127,127,127,.12); }
.grokbot-newmenu__icon { width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; font-size:15px; flex:none; }
.grokbot-newmenu__divider { height:1px; background:var(--border,#e3e5e8); margin:4px 2px; }
.grokbot-sidebar__new { margin-left:auto; border:none; background:none; cursor:pointer; opacity:.55; font-size:14px; padding:0 5px; border-radius:5px; line-height:1; }
.grokbot-sidebar__new:hover { opacity:1; background:rgba(127,127,127,.15); }
.grokbot-sidebar__section { font-size:10px; opacity:.45; margin:8px 4px 3px; letter-spacing:.04em; }
.grokbot-botrow.pinned .grokbot-botrow__name::after { content:"📌"; font-size:9px; margin-left:4px; vertical-align:top; }
.grokbot-form { display:flex; flex-direction:column; gap:8px; padding:10px; margin:0 4px 8px; border:1px solid var(--border,#e3e5e8); border-radius:10px; background:rgba(127,127,127,.05); }
.grokbot-form__row { display:flex; gap:6px; }
.grokbot-form input, .grokbot-form textarea, .grokbot-form select { flex:1; min-width:0; border:1px solid var(--border,#d8dbe0); border-radius:8px; padding:6px 9px; font:inherit; font-size:12.5px; background:transparent; color:inherit; }
.grokbot-form textarea { resize:vertical; min-height:52px; }
.grokbot-form__actions { display:flex; gap:6px; justify-content:flex-end; }
.grokbot-form__actions button { border:none; border-radius:8px; padding:5px 12px; font-size:12px; cursor:pointer; font-weight:600; }
.grokbot-form__submit { background:#3b82f6; color:#fff; }
.grokbot-form__cancel { background:rgba(127,127,127,.15); color:inherit; }
.grokbot-chat__edit { border:none; background:none; cursor:pointer; opacity:.5; font-size:12px; padding:3px 8px; border-radius:7px; }
.grokbot-chat__edit:hover { opacity:1; background:rgba(127,127,127,.12); }
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
.grokbot-chat { width:min(880px, 96vw); height:100%; display:flex; flex-direction:column; background:var(--background, #fff); }
.grokbot-chat--main { box-shadow:none; }
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
.grokbot-msg.activity { align-self:center; background:rgba(127,127,127,.1); font-size:11.5px; opacity:.75; padding:4px 12px; }
.grokbot-msg .grokbot-msg__time { display:block; font-size:10px; opacity:.5; margin-top:5px; }
.grokbot-empty { margin:auto; text-align:center; opacity:.5; font-size:13px; }
.grokbot-inputbar { display:flex; gap:10px; padding:16px 22px 20px; border-top:1px solid var(--border, #e3e5e8); }
.grokbot-inputbar textarea { flex:1; resize:none; border:1px solid var(--border, #d8dbe0); border-radius:12px; padding:11px 14px; font:inherit; min-height:48px; max-height:160px; background:transparent; color:inherit; }
.grokbot-inputbar textarea:focus { outline:2px solid #3b82f655; }
.grokbot-inputbar button { border:none; border-radius:12px; background:#3b82f6; color:#fff; padding:0 20px; font-weight:600; cursor:pointer; }
.grokbot-inputbar button:disabled { opacity:.45; cursor:default; }
`;
		let openTarget = null;
		let nativeSidebarVisible = false;
		const listeners = /* @__PURE__ */ new Set();
		function openBot(botId) {
			openTarget = {
				kind: "bot",
				id: botId
			};
			for (const listener of listeners) listener();
		}
		function openRoom(roomId) {
			openTarget = {
				kind: "room",
				id: roomId
			};
			for (const listener of listeners) listener();
		}
		function closeTarget() {
			openTarget = null;
			for (const listener of listeners) listener();
		}
		function toggleNativeSidebar() {
			nativeSidebarVisible = !nativeSidebarVisible;
			for (const listener of listeners) listener();
		}
		function useOpenTarget() {
			const [, force] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const listener = () => force((n) => n + 1);
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}, []);
			return openTarget;
		}
		function openBot(botId) {
			openBotId = botId;
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
		let catalogCache = null;
		async function fetchCatalog() {
			if (catalogCache && Date.now() - catalogCache.at < 6e4) return catalogCache.providers;
			const providers = (await api("/model-catalog").catch(() => null))?.catalog ?? [];
			catalogCache = {
				at: Date.now(),
				providers
			};
			return providers;
		}
		function RoomForm(props) {
			const [name, setName] = (0, react.useState)("");
			const [selected, setSelected] = (0, react.useState)([]);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const toggle = (botId) => {
				setSelected((prev) => prev.includes(botId) ? prev.filter((entry) => entry !== botId) : [...prev, botId]);
			};
			const submit = (0, react.useCallback)(async () => {
				if (busy) return;
				if (selected.length < 2) {
					setError("群聊需要选择 2-6 位成员");
					return;
				}
				setBusy(true);
				setError("");
				try {
					const outcome = await api("/rooms", {
						method: "POST",
						body: JSON.stringify({
							name: name.trim() || "新群聊",
							memberBotIds: selected
						})
					});
					props.onSaved(String(outcome?.room?.id ?? ""));
				} catch (err) {
					setError(String(err?.message ?? err));
				} finally {
					setBusy(false);
				}
			}, [
				name,
				selected,
				busy,
				props
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-form",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: name,
						onChange: (e) => setName(e.target.value),
						placeholder: "群聊名称（可空）",
						"aria-label": "群聊名称"
					}),
					props.bots.map((bot) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 8,
							fontSize: 12.5,
							cursor: "pointer"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							style: {
								width: "auto",
								flex: "none"
							},
							checked: selected.includes(bot.id),
							onChange: () => toggle(bot.id)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							bot.avatar,
							" ",
							bot.name
						] })]
					}, bot.id)),
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							color: "#cf1322",
							fontSize: 11.5
						},
						children: error
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-form__actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-form__cancel",
							onClick: props.onCancel,
							children: "取消"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-form__submit",
							disabled: busy,
							onClick: () => void submit(),
							children: "创建群聊"
						})]
					})
				]
			});
		}
		function BotForm(props) {
			const { initial } = props;
			const [avatar, setAvatar] = (0, react.useState)(initial?.avatar ?? "🤖");
			const [name, setName] = (0, react.useState)(initial?.name ?? "");
			const [title, setTitle] = (0, react.useState)(initial?.title ?? "");
			const [persona, setPersona] = (0, react.useState)("");
			const [advanced, setAdvanced] = (0, react.useState)(false);
			const [providers, setProviders] = (0, react.useState)([]);
			const [providerId, setProviderId] = (0, react.useState)("");
			const [modelId, setModelId] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				if (!advanced || providers.length > 0) return;
				fetchCatalog().then(setProviders).catch(() => void 0);
			}, [advanced, providers.length]);
			const submit = (0, react.useCallback)(async () => {
				if (busy) return;
				if (!name.trim()) {
					setError("名称必填");
					return;
				}
				setBusy(true);
				setError("");
				try {
					const payload = {
						name: name.trim(),
						avatar: avatar.trim() || "🤖",
						title: title.trim()
					};
					if (persona.trim()) payload.persona = persona.trim();
					if (providerId && modelId) payload.model = {
						provider: providerId,
						model: modelId
					};
					else if (initial && !providerId) payload.model = null;
					const outcome = initial ? await api(`/bots/${encodeURIComponent(initial.id)}`, {
						method: "PATCH",
						body: JSON.stringify(payload)
					}) : await api("/bots", {
						method: "POST",
						body: JSON.stringify(payload)
					});
					props.onSaved(outcome?.bot);
				} catch (err) {
					setError(String(err?.message ?? err));
				} finally {
					setBusy(false);
				}
			}, [
				avatar,
				name,
				title,
				persona,
				providerId,
				modelId,
				busy,
				initial,
				props
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-form",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-form__row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: {
								maxWidth: 52,
								textAlign: "center"
							},
							value: avatar,
							onChange: (e) => setAvatar(e.target.value),
							"aria-label": "头像"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: name,
							onChange: (e) => setName(e.target.value),
							placeholder: "名称（必填）",
							"aria-label": "名称"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: title,
						onChange: (e) => setTitle(e.target.value),
						placeholder: "头衔，如：检索与情报专家",
						"aria-label": "头衔"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						value: persona,
						onChange: (e) => setPersona(e.target.value),
						placeholder: initial ? "补充职责/规则（留空不改）" : "职责与持久规则：它负责什么、怎么做事、安全边界",
						"aria-label": "职责"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "grokbot-form__cancel",
						style: { alignSelf: "flex-start" },
						onClick: () => setAdvanced((v) => !v),
						children: advanced ? "收起高级设置" : "高级设置（模型）"
					}),
					advanced ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-form__row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: providerId,
							onChange: (e) => {
								setProviderId(e.target.value);
								setModelId("");
							},
							"aria-label": "provider",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: "模型：跟随团队默认"
							}), providers.map((provider) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: provider.id,
								children: provider.name
							}, provider.id))]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: modelId,
							onChange: (e) => setModelId(e.target.value),
							"aria-label": "model",
							disabled: !providerId,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: "选择模型"
							}), (providers.find((provider) => provider.id === providerId)?.models ?? []).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: model.id,
								children: model.name
							}, model.id))]
						})]
					}) : null,
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							color: "#cf1322",
							fontSize: "11.5px"
						},
						children: error
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-form__actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-form__cancel",
							onClick: props.onCancel,
							children: "取消"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-form__submit",
							disabled: busy,
							onClick: () => void submit(),
							children: initial ? "保存" : "创建"
						})]
					})
				]
			});
		}
		/**
		* 侧栏 agent 团队列表：挂进 sidebar.workspaces 插槽。
		* 挂载后把同容器的原有节点（默认工作区/会话树）结构化隐藏，
		* 实现整栏替换；卸载时恢复显示。
		*/
		function GrokbotSidebarCrew() {
			const state = useGrokbotState();
			const target = useOpenTarget();
			const nativeVisible = useNativeSidebarVisible();
			const [creating, setCreating] = (0, react.useState)(false);
			const [grouping, setGrouping] = (0, react.useState)(false);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
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
			const allBots = state?.bots ?? [];
			const busy = (state?.running.length ?? 0) + (state?.queueDepth ?? 0);
			const visible = allBots.filter((bot) => !bot.hidden).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, "zh"));
			const groups = [];
			for (const bot of visible) {
				const last = groups[groups.length - 1];
				if (last && last.section === bot.section) last.bots.push(bot);
				else groups.push({
					section: bot.section,
					bots: [bot]
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-sidebar",
				ref: rootRef,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-sidebar__title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `grokbot-dot${busy > 0 ? " on" : ""}` }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Agent 团队" }),
							state && state.queueDepth > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "grokbot-sidebar__queue",
								children: ["队列 ", state.queueDepth]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-sidebar__new",
								title: "新建：创建 Bot / 拉群聊 / 与 Bot 单聊",
								onClick: () => setMenuOpen((v) => !v),
								children: "＋"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-sidebar__native",
								title: nativeVisible ? "隐藏原始列表" : "显示原始工作区/会话列表",
								onClick: () => toggleNativeSidebar(),
								children: "⇅"
							})
						]
					}),
					menuOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-newmenu",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "grokbot-newmenu__item",
								onClick: () => {
									setMenuOpen(false);
									setCreating(true);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-newmenu__icon",
									children: "➕"
								}), "创建新 Bot"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "grokbot-newmenu__item",
								onClick: () => {
									setMenuOpen(false);
									setGrouping(true);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-newmenu__icon",
									children: "👥"
								}), "创建群聊"]
							}),
							allBots.filter((bot) => !bot.hidden).length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "grokbot-newmenu__divider" }) : null,
							allBots.filter((bot) => !bot.hidden).map((bot) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "grokbot-newmenu__item",
								onClick: () => {
									setMenuOpen(false);
									openBot(bot.id);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-newmenu__icon",
									children: bot.avatar
								}), bot.name]
							}, bot.id))
						]
					}) : null,
					creating ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotForm, {
						onCancel: () => setCreating(false),
						onSaved: () => setCreating(false)
					}) : null,
					grouping ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RoomForm, {
						bots: allBots.filter((bot) => !bot.hidden),
						onCancel: () => setGrouping(false),
						onSaved: (roomId) => {
							setGrouping(false);
							openRoom(roomId);
						}
					}) : null,
					(state?.rooms ?? []).length > 0 || grouping ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "grokbot-sidebar__section",
						children: "群聊"
					}) : null,
					(state?.rooms ?? []).map((room) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: `grokbot-botrow${target?.kind === "room" && target.id === room.id ? " active" : ""}`,
						onClick: () => openRoom(room.id),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "grokbot-botrow__avatar",
							children: "👥"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "grokbot-botrow__main",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-botrow__name",
								children: room.name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-botrow__status",
								children: room.memberBotIds.map((botId) => allBots.find((bot) => bot.id === botId)?.name ?? botId).join("、")
							})]
						})]
					}, room.id)),
					groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [group.section ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "grokbot-sidebar__section",
						children: group.section
					}) : null, group.bots.map((bot) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: `grokbot-botrow${target?.kind === "bot" && target.id === bot.id ? " active" : ""}${bot.pinned ? " pinned" : ""}`,
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
									children: bot.title || statusLine(bot)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `grokbot-botrow__badge${bot.status === "working" ? " working" : ""}` })
						]
					}, bot.id))] }, group.section || "__default__"))
				]
			});
		}
		function BotChatView(props) {
			const { bot } = props;
			const [draft, setDraft] = (0, react.useState)("");
			const [sending, setSending] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(false);
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
					const activity = outcome?.activity ?? [];
					if (activity.length > 0) {
						const counted = activity.reduce((acc, name) => {
							acc[name] = (acc[name] ?? 0) + 1;
							return acc;
						}, {});
						appendHistory(bot.id, {
							id: `${Date.now()}-a`,
							role: "activity",
							text: Object.entries(counted).map(([name, count]) => `🔧 ${name}${count > 1 ? ` ×${count}` : ""}`).join("　"),
							at: Date.now()
						});
					}
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
					if (event.key === "Escape") closeTarget();
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
									children: bot.title || (bot.status === "working" ? "正在执行任务…" : "常驻待命")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "grokbot-chat__edit",
								type: "button",
								onClick: () => setEditing(true),
								children: "编辑"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "grokbot-chat__close",
								type: "button",
								onClick: closeTarget,
								"aria-label": "关闭",
								children: "✕"
							})
						]
					}),
					editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotForm, {
						initial: bot,
						onCancel: () => setEditing(false),
						onSaved: () => setEditing(false)
					}) : null,
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
		function GroupChatView(props) {
			const { room, bots } = props;
			const [messages, setMessages] = (0, react.useState)([]);
			const [draft, setDraft] = (0, react.useState)("");
			const [sending, setSending] = (0, react.useState)(false);
			const logRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				let alive = true;
				const tick = () => {
					api(`/rooms/${encodeURIComponent(room.id)}`).then((outcome) => {
						if (alive) setMessages(outcome?.messages ?? []);
					}).catch(() => void 0);
				};
				tick();
				const timer = setInterval(tick, 3e3);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [room.id]);
			(0, react.useEffect)(() => {
				logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
			}, [messages.length, sending]);
			const botOf = (botId) => bots.find((bot) => bot.id === botId);
			const send = (0, react.useCallback)(async () => {
				const text = draft.trim();
				if (!text || sending) return;
				setDraft("");
				setSending(true);
				try {
					const outcome = await api(`/rooms/${encodeURIComponent(room.id)}/chat`, {
						method: "POST",
						body: JSON.stringify({ text })
					});
					setMessages((outcome?.messages ?? []).slice());
				} catch (error) {
					setMessages((prev) => [...prev, {
						ts: Date.now(),
						role: "system",
						text: `发送失败：${String(error?.message ?? error)}`
					}]);
				} finally {
					setSending(false);
				}
			}, [
				draft,
				sending,
				room.id
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-chat",
				style: {
					width: "100%",
					height: "100%"
				},
				onKeyDown: (event) => {
					if (event.key === "Escape") closeTarget();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-chat__head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-chat__avatar",
								children: "👥"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "grokbot-chat__title",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-chat__name",
									children: room.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-chat__meta",
									children: room.memberBotIds.map((botId) => `${botOf(botId)?.avatar ?? "🤖"}${botOf(botId)?.name ?? botId}`).join("　")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "grokbot-chat__close",
								type: "button",
								onClick: closeTarget,
								"aria-label": "关闭",
								children: "✕"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-log",
						ref: logRef,
						children: [messages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "grokbot-empty",
							children: "群聊成员会自主决定谁应答；@成员名 可定向，bot 之间也会互相转交。"
						}) : messages.map((message, index) => {
							if (message.role === "user") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "grokbot-msg user",
								children: [message.text, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-msg__time",
									children: new Date(message.ts).toLocaleTimeString()
								})]
							}, index);
							if (message.role === "handoff") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "grokbot-msg activity",
								children: [
									"↪ ",
									botOf(message.fromBotId)?.name ?? message.fromBotId,
									" → ",
									botOf(message.toBotId)?.name ?? message.toBotId,
									"：",
									message.text
								]
							}, index);
							if (message.role === "system") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "grokbot-msg activity",
								children: message.text
							}, index);
							const bot = botOf(message.botId);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "grokbot-msg bot",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [bot?.avatar ?? "", bot?.name ?? message.botId] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: message.text }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "grokbot-msg__time",
										children: new Date(message.ts).toLocaleTimeString()
									})
								]
							}, index);
						}), sending ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "grokbot-empty",
							children: "成员思考中…"
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-inputbar",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							value: draft,
							placeholder: `发到 ${room.name}…（@成员名 定向）`,
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
		/**
		* 主区视图：选中 bot 后就地接管 centerCol——隐藏默认内容与 detailsCol，
		* 会话视图对位 centerCol 矩形（ResizeObserver 跟随），关闭即还原。
		*/
		function GrokbotMainView() {
			const target = useOpenTarget();
			const state = useGrokbotState();
			const bot = target?.kind === "bot" ? state?.bots.find((entry) => entry.id === target.id) ?? null : null;
			const room = target?.kind === "room" ? state?.rooms.find((entry) => entry.id === target.id) ?? null : null;
			const activeKey = bot ? `bot:${bot.id}` : room ? `room:${room.id}` : null;
			const [box, setBox] = (0, react.useState)(null);
			const hiddenRef = (0, react.useRef)([]);
			(0, react.useEffect)(() => {
				hiddenRef.current = [];
				if (!activeKey) return;
				const center = document.querySelector("[class*=\"centerCol\"]") ?? null;
				const details = document.querySelector("[class*=\"detailsCol\"]") ?? null;
				if (!center) return;
				const takeover = () => {
					const rect = center.getBoundingClientRect();
					setBox({
						left: rect.left,
						top: rect.top,
						width: rect.width,
						height: rect.height
					});
				};
				const hide = (el) => {
					if (!el || el.dataset.grokbotPrevDisplay !== void 0) return;
					el.dataset.grokbotPrevDisplay = el.style.display;
					el.style.display = "none";
					hiddenRef.current.push(el);
				};
				for (const child of [...center.children]) hide(child);
				hide(details);
				takeover();
				const observer = new ResizeObserver(takeover);
				observer.observe(center);
				window.addEventListener("resize", takeover);
				return () => {
					observer.disconnect();
					window.removeEventListener("resize", takeover);
					for (const el of hiddenRef.current) {
						el.style.display = el.dataset.grokbotPrevDisplay || "";
						delete el.dataset.grokbotPrevDisplay;
					}
					hiddenRef.current = [];
					setBox(null);
				};
			}, [activeKey]);
			if (!box || !activeKey) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "grokbot-chat grokbot-chat--main",
				style: {
					position: "fixed",
					left: box.left,
					top: box.top,
					width: box.width,
					height: box.height,
					zIndex: 900
				},
				children: bot ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotChatView, { bot }) : room ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupChatView, {
					room,
					bots: state?.bots ?? []
				}) : null
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
				id: "grokbot-main",
				order: 51
			}, GrokbotMainView));
		}
		//#endregion
		exports.GrokbotMainView = GrokbotMainView;
		exports.GrokbotSidebarCrew = GrokbotSidebarCrew;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
