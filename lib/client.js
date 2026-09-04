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
.grokbot-sidebar { display:flex; flex-direction:column; min-height:0; flex:1; }
.grokbot-sidebar__top { display:flex; align-items:center; justify-content:flex-end; gap:4px; padding:20px 10px 6px; }
.grokbot-iconbtn { border:none; background:none; cursor:pointer; opacity:.55; font-size:15px; padding:3px 7px; border-radius:7px; line-height:1; }
.grokbot-iconbtn:hover { opacity:1; background:rgba(127,127,127,.14); }
.grokbot-sidebar__search { margin:2px 10px 8px; }
.grokbot-sidebar__search input { width:100%; box-sizing:border-box; border:none; border-radius:8px; background:rgba(127,127,127,.12); padding:7px 12px; font:inherit; font-size:12.5px; color:inherit; outline:none; }
.grokbot-sidebar__search input::placeholder { opacity:.5; }
.grokbot-newchat { margin:0 10px 10px; border:none; border-radius:9px; background:rgba(59,130,246,.14); color:inherit; padding:8px 0; font:inherit; font-size:13px; font-weight:600; cursor:pointer; }
.grokbot-newchat:hover { background:rgba(59,130,246,.22); }
.grokbot-sidebar__list { flex:1; overflow-y:auto; padding:0 6px 8px; }
.grokbot-sidebar__section { font-size:10.5px; opacity:.45; margin:10px 6px 3px; letter-spacing:.04em; }
.grokbot-chatrow { display:flex; align-items:center; gap:9px; width:100%; padding:7px 8px; border:none; border-radius:10px; background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit; transition:background .1s; }
.grokbot-chatrow:hover { background:rgba(127,127,127,.10); }
.grokbot-chatrow.active { background:rgba(127,127,127,.16); }
.grokbot-avatar { position:relative; flex:none; }
.grokbot-avatar__circle { width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:17px; background:rgba(127,127,127,.14); }
.grokbot-avatar__dot { position:absolute; right:-1px; bottom:-1px; width:10px; height:10px; border-radius:50%; background:#2ea043; border:2px solid var(--background,#fff); box-sizing:content-box; }
.grokbot-avatar__dot.working { background:#f0883e; animation: grokbot-pulse 1.2s infinite; }
.grokbot-chatrow__main { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
.grokbot-chatrow__line1 { display:flex; align-items:baseline; gap:6px; }
.grokbot-chatrow__name { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chatrow__time { margin-left:auto; font-size:10.5px; opacity:.45; flex:none; }
.grokbot-chatrow__preview { font-size:11.5px; opacity:.55; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-sidebar__foot { border-top:1px solid var(--border,#e3e5e8); padding:8px 10px; display:flex; align-items:center; gap:8px; }
.grokbot-sidebar__user { display:flex; align-items:center; gap:7px; flex:1; min-width:0; font-size:12.5px; font-weight:600; opacity:.8; }
.grokbot-sidebar__user .uavatar { width:24px; height:24px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#3b82f6); color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; }
@keyframes grokbot-pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
.grokbot-newmenu { display:flex; flex-direction:column; gap:1px; margin:0 10px 8px; padding:5px; border:1px solid var(--border,#e3e5e8); border-radius:10px; background:var(--background,#fff); box-shadow:0 4px 16px rgba(0,0,0,.08); }
.grokbot-newmenu__item { display:flex; align-items:center; gap:8px; width:100%; padding:7px 10px; border:none; border-radius:8px; background:transparent; cursor:pointer; font:inherit; font-size:13px; color:inherit; text-align:left; }
.grokbot-newmenu__item:hover { background:rgba(127,127,127,.12); }
.grokbot-newmenu__icon { width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; font-size:15px; flex:none; }
.grokbot-newmenu__divider { height:1px; background:var(--border,#e3e5e8); margin:4px 2px; }
.grokbot-form { display:flex; flex-direction:column; gap:8px; padding:10px; margin:0 10px 8px; border:1px solid var(--border,#e3e5e8); border-radius:10px; background:rgba(127,127,127,.05); }
.grokbot-form__row { display:flex; gap:6px; }
.grokbot-form input, .grokbot-form textarea, .grokbot-form select { flex:1; min-width:0; border:1px solid var(--border,#d8dbe0); border-radius:8px; padding:6px 9px; font:inherit; font-size:12.5px; background:transparent; color:inherit; }
.grokbot-form textarea { resize:vertical; min-height:52px; }
.grokbot-form__actions { display:flex; gap:6px; justify-content:flex-end; }
.grokbot-form__actions button { border:none; border-radius:8px; padding:5px 12px; font-size:12px; cursor:pointer; font-weight:600; }
.grokbot-form__submit { background:#3b82f6; color:#fff; }
.grokbot-form__cancel { background:rgba(127,127,127,.15); color:inherit; }
.grokbot-chat { width:100%; height:100%; display:flex; flex-direction:column; background:var(--background,#fff); }
.grokbot-chat__head { display:flex; align-items:center; gap:10px; padding:12px 20px; border-bottom:1px solid var(--border,#eceef1); }
.grokbot-chat__avatar { font-size:22px; }
.grokbot-chat__title { flex:1; display:flex; flex-direction:column; min-width:0; cursor:pointer; }
.grokbot-chat__name { font-weight:600; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chat__meta { font-size:11.5px; opacity:.55; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chat__stop { border:1px solid #f0988e; background:#fff1f0; color:#cf1322; border-radius:8px; padding:4px 12px; font-size:12px; cursor:pointer; font-weight:600; }
.grokbot-chat__stop:hover { background:#ffdedb; }
.grokbot-chat__close { border:none; background:none; cursor:pointer; opacity:.5; font-size:18px; padding:2px 8px; border-radius:8px; }
.grokbot-chat__close:hover { opacity:1; background:rgba(127,127,127,.12); }
.grokbot-body { flex:1; display:flex; min-height:0; }
.grokbot-log { flex:1; overflow-y:auto; padding:24px 28px; display:flex; flex-direction:column; gap:12px; }
.grokbot-msg { max-width:72%; border-radius:14px; padding:9px 14px; font-size:14px; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
.grokbot-msg.user { align-self:flex-end; background:#ececf1; color:inherit; border-bottom-right-radius:5px; }
.grokbot-msg.bot { align-self:flex-start; background:rgba(127,127,127,.07); border-bottom-left-radius:5px; }
.grokbot-msg.error { align-self:center; background:#fff1f0; color:#cf1322; font-size:12px; }
.grokbot-msg.activity { align-self:center; background:transparent; font-size:11px; opacity:.55; padding:2px 12px; }
.grokbot-msg.approval { align-self:flex-start; border:1px solid #f0c98e; background:#fffaf0; border-radius:12px; padding:10px 14px; }
.grokbot-approval__title { font-size:13px; font-weight:600; margin-bottom:3px; }
.grokbot-approval__reason { font-size:12px; opacity:.7; margin-bottom:9px; white-space:pre-wrap; }
.grokbot-approval__actions { display:flex; gap:8px; }
.grokbot-approval__actions button { border:none; border-radius:8px; padding:5px 16px; font-size:12.5px; font-weight:600; cursor:pointer; }
.grokbot-approval__ok { background:#2ea043; color:#fff; }
.grokbot-approval__no { background:rgba(127,127,127,.15); color:inherit; }
.grokbot-msg .grokbot-msg__time { display:block; font-size:10px; opacity:.45; margin-top:4px; text-align:inherit; }
.grokbot-empty { margin:auto; text-align:center; opacity:.5; font-size:13px; }
.grokbot-details { width:264px; flex:none; border-left:1px solid var(--border,#eceef1); overflow-y:auto; padding:14px 14px 20px; display:flex; flex-direction:column; gap:14px; }
.grokbot-details__title { font-size:12px; font-weight:700; opacity:.55; letter-spacing:.04em; }
.grokbot-member { display:flex; align-items:center; gap:9px; padding:6px 4px; font-size:13px; }
.grokbot-member .mavatar { width:28px; height:28px; border-radius:50%; background:rgba(127,127,127,.14); display:flex; align-items:center; justify-content:center; font-size:14px; }
.grokbot-details__hint { font-size:11.5px; opacity:.5; padding:4px 4px 0; }
.grokbot-routine { border:1px solid var(--border,#eceef1); border-radius:10px; padding:8px 10px; font-size:12px; }
.grokbot-routine__prompt { opacity:.8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-routine__sched { font-size:11px; opacity:.5; margin-top:2px; }
.grokbot-details__new { border:1px dashed var(--border,#d8dbe0); border-radius:10px; background:transparent; color:inherit; padding:7px; font-size:12.5px; cursor:pointer; width:100%; }
.grokbot-details__new:hover { background:rgba(127,127,127,.06); }
.grokbot-inputbar { display:flex; align-items:flex-end; gap:4px; padding:12px 18px 16px; }
.grokbot-inputbar textarea { flex:1; resize:none; border:1px solid var(--border,#d8dbe0); border-radius:12px; padding:10px 14px; font:inherit; font-size:13.5px; min-height:44px; max-height:150px; background:transparent; color:inherit; }
.grokbot-inputbar textarea:focus { outline:2px solid rgba(59,130,246,.35); }
.grokbot-inputbar .side { border:none; background:none; cursor:pointer; opacity:.5; font-size:17px; padding:6px 9px; border-radius:9px; }
.grokbot-inputbar .side:hover { opacity:.9; background:rgba(127,127,127,.12); }
.grokbot-inputbar .side:disabled { opacity:.25; cursor:default; }
`;
		let openTarget = null;
		let nativeSidebarVisible = false;
		const listeners = /* @__PURE__ */ new Set();
		function notify() {
			for (const listener of listeners) listener();
		}
		function persistLastTarget(target) {
			try {
				if (target) localStorage.setItem("grokbot.lastTarget", JSON.stringify(target));
				else localStorage.removeItem("grokbot.lastTarget");
			} catch {}
		}
		function readLastTarget() {
			try {
				const raw = localStorage.getItem("grokbot.lastTarget");
				if (!raw) return null;
				const parsed = JSON.parse(raw);
				if (parsed && (parsed.kind === "bot" || parsed.kind === "room") && typeof parsed.id === "string") return parsed;
				return null;
			} catch {
				return null;
			}
		}
		function openBot(botId) {
			openTarget = {
				kind: "bot",
				id: botId
			};
			persistLastTarget(openTarget);
			notify();
		}
		function openRoom(roomId) {
			openTarget = {
				kind: "room",
				id: roomId
			};
			persistLastTarget(openTarget);
			notify();
		}
		function closeTarget() {
			openTarget = null;
			notify();
		}
		function toggleNativeSidebar() {
			nativeSidebarVisible = !nativeSidebarVisible;
			notify();
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
		const histories = /* @__PURE__ */ new Map();
		const loadedHistoryFor = /* @__PURE__ */ new Set();
		function historyOf(botId) {
			let list = histories.get(botId);
			if (!list) {
				list = [];
				histories.set(botId, list);
			}
			return list;
		}
		function appendLocal(botId, message) {
			historyOf(botId).push(message);
			notify();
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
		function timeLabel(ts) {
			if (!ts) return "";
			const date = new Date(ts);
			const today = /* @__PURE__ */ new Date();
			if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit"
			});
			return date.toLocaleDateString([], { weekday: "short" });
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
							children: initial ? "保存" : "创建"
						})]
					})
				]
			});
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
		function RoutineForm(props) {
			const [every, setEvery] = (0, react.useState)("60");
			const [prompt, setPrompt] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const submit = (0, react.useCallback)(async () => {
				if (busy) return;
				const minutes = Number(every);
				if (!Number.isInteger(minutes) || minutes < 1) {
					setError("间隔分钟数须为正整数");
					return;
				}
				if (!prompt.trim()) {
					setError("要做什么不能为空");
					return;
				}
				setBusy(true);
				try {
					await api("/routines", {
						method: "POST",
						body: JSON.stringify({
							botId: props.botId,
							schedule: { everyMinutes: minutes },
							prompt: prompt.trim()
						})
					});
					props.onSaved();
				} catch (err) {
					setError(String(err?.message ?? err));
				} finally {
					setBusy(false);
				}
			}, [
				every,
				prompt,
				busy,
				props
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-form",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: every,
						onChange: (e) => setEvery(e.target.value),
						placeholder: "间隔（分钟）",
						"aria-label": "间隔分钟"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						value: prompt,
						onChange: (e) => setPrompt(e.target.value),
						placeholder: "每次运行做什么？",
						"aria-label": "任务"
					}),
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
							children: "创建例行任务"
						})]
					})
				]
			});
		}
		function GrokbotSidebarCrew() {
			const state = useGrokbotState();
			const target = useOpenTarget();
			const nativeVisible = useNativeSidebarVisible();
			const [creating, setCreating] = (0, react.useState)(false);
			const [grouping, setGrouping] = (0, react.useState)(false);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [filter, setFilter] = (0, react.useState)("");
			const rootRef = (0, react.useRef)(null);
			const hiddenRef = (0, react.useRef)([]);
			(0, react.useEffect)(() => {
				if (nativeVisible) return;
				const root = rootRef.current;
				if (!root) return;
				const sidebarCol = root.closest("[class*=\"sidebarCol\"]");
				if (!sidebarCol) return;
				const chain = [];
				let node = root;
				while (node && node !== sidebarCol) {
					chain.unshift(node);
					node = node.parentElement;
				}
				const onPath = new Set(chain);
				const apply = () => {
					for (const el of chain) {
						const parent = el.parentElement;
						if (!parent) continue;
						for (const child of [...parent.children]) {
							if (onPath.has(child) || child.contains(root)) continue;
							const target = child;
							if (target.dataset.grokbotPrevDisplay === void 0 && target.style.display !== "none") {
								target.dataset.grokbotPrevDisplay = target.style.display;
								target.style.display = "none";
								hiddenRef.current.push(target);
							}
						}
					}
				};
				apply();
				const observer = new MutationObserver(apply);
				observer.observe(sidebarCol, {
					childList: true,
					subtree: true
				});
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
			const visible = allBots.filter((bot) => !bot.hidden).filter((bot) => !filter.trim() || bot.name.includes(filter.trim()) || (bot.title || "").includes(filter.trim())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastAt ?? 0) - (a.lastAt ?? 0));
			const rooms = (state?.rooms ?? []).filter((room) => !filter.trim() || room.name.includes(filter.trim()));
			const routines = state?.routines ?? [];
			const rowPreview = (bot) => {
				if (bot.status === "working") return `工作中${bot.currentJob ? ` · ${bot.currentJob}` : ""}`;
				if (bot.lastMessage) return `${bot.lastFrom === "user" ? "我: " : ""}${bot.lastMessage}`;
				return bot.title || "待命";
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-sidebar",
				ref: rootRef,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-sidebar__top",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-iconbtn",
							title: "新建：创建 Bot / 拉群聊 / 与 Bot 单聊",
							onClick: () => {
								setMenuOpen((v) => !v);
								setCreating(false);
								setGrouping(false);
							},
							children: "＋"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-iconbtn",
							title: nativeVisible ? "隐藏原始列表" : "显示原始工作区/会话列表",
							onClick: () => toggleNativeSidebar(),
							children: "⇆"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "grokbot-sidebar__search",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: filter,
							onChange: (e) => setFilter(e.target.value),
							placeholder: "搜索",
							"aria-label": "搜索"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-sidebar__list",
						children: [
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
							rooms.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "grokbot-sidebar__section",
								children: "群聊"
							}) : null,
							rooms.map((room) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `grokbot-chatrow${target?.kind === "room" && target.id === room.id ? " active" : ""}`,
								onClick: () => openRoom(room.id),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-avatar",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "grokbot-avatar__circle",
										children: "👥"
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "grokbot-chatrow__main",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "grokbot-chatrow__line1",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "grokbot-chatrow__name",
											children: room.name
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "grokbot-chatrow__preview",
										children: [room.memberBotIds.length, " 位成员"]
									})]
								})]
							}, room.id)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "grokbot-sidebar__section",
								children: "Bot"
							}),
							visible.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									opacity: .5,
									padding: "4px 10px"
								},
								children: "没有匹配的 Bot"
							}) : null,
							visible.map((bot) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `grokbot-chatrow${target?.kind === "bot" && target.id === bot.id ? " active" : ""}`,
								onClick: () => openBot(bot.id),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "grokbot-avatar",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "grokbot-avatar__circle",
										children: bot.avatar
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `grokbot-avatar__dot${bot.status === "working" ? " working" : ""}` })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "grokbot-chatrow__main",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "grokbot-chatrow__line1",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "grokbot-chatrow__name",
											children: bot.name
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "grokbot-chatrow__time",
											children: timeLabel(bot.lastAt ?? bot.lastActivity)
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "grokbot-chatrow__preview",
										children: rowPreview(bot)
									})]
								})]
							}, bot.id))
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-sidebar__foot",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "grokbot-sidebar__user",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "uavatar",
								children: "B"
							}), "bo zhao"]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-iconbtn",
							title: routines.length > 0 ? `${routines.length} 个例行任务` : "例行任务",
							children: "⏱"
						})]
					})
				]
			});
		}
		function ApprovalCard(props) {
			const [busy, setBusy] = (0, react.useState)(false);
			const decide = (0, react.useCallback)(async (outcome) => {
				if (busy) return;
				setBusy(true);
				try {
					await api(`/approvals/${encodeURIComponent(props.approval.id)}`, {
						method: "POST",
						body: JSON.stringify({ outcome })
					});
				} catch {} finally {
					setBusy(false);
				}
			}, [busy, props]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-msg approval",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-approval__title",
						children: ["🛡️ 需要审批：", props.approval.toolName || "工具操作"]
					}),
					props.approval.reason ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "grokbot-approval__reason",
						children: props.approval.reason
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-approval__actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-approval__ok",
							disabled: busy,
							onClick: () => void decide("allowed-once"),
							children: "同意"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-approval__no",
							disabled: busy,
							onClick: () => void decide("rejected"),
							children: "取消"
						})]
					})
				]
			});
		}
		function BotChatView(props) {
			const { bot, state } = props;
			const [draft, setDraft] = (0, react.useState)("");
			const [sending, setSending] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(false);
			const [detailsOpen, setDetailsOpen] = (0, react.useState)(false);
			const [newRoutine, setNewRoutine] = (0, react.useState)(false);
			const [, forceRefresh] = (0, react.useState)(0);
			const logRef = (0, react.useRef)(null);
			const messages = (0, react.useMemo)(() => historyOf(bot.id), [bot.id, sending]);
			const pending = (state?.approvals ?? []).filter((approval) => approval.botId === bot.id);
			(0, react.useEffect)(() => {
				if (loadedHistoryFor.has(bot.id) || histories.get(bot.id)?.length) return;
				loadedHistoryFor.add(bot.id);
				api(`/bots/${encodeURIComponent(bot.id)}/history`).then((outcome) => {
					const list = outcome?.messages ?? [];
					if (list.length === 0 || histories.get(bot.id)?.length) return;
					histories.set(bot.id, list.map((message, index) => message.role === "user" ? {
						id: `h${index}`,
						role: "user",
						text: message.text,
						at: message.ts
					} : {
						id: `h${index}`,
						role: "bot",
						text: message.text,
						at: message.ts
					}));
					forceRefresh((n) => n + 1);
				}).catch(() => void 0);
			}, [bot.id]);
			(0, react.useEffect)(() => {
				logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
			}, [
				messages.length,
				sending,
				pending.length
			]);
			const stop = (0, react.useCallback)(async () => {
				await api(`/bots/${encodeURIComponent(bot.id)}/stop`, { method: "POST" }).catch(() => void 0);
			}, [bot.id]);
			const send = (0, react.useCallback)(async () => {
				const text = draft.trim();
				if (!text || sending) return;
				setDraft("");
				appendLocal(bot.id, {
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
						appendLocal(bot.id, {
							id: `${Date.now()}-a`,
							role: "activity",
							text: Object.entries(counted).map(([name, count]) => `🔧 ${name}${count > 1 ? ` ×${count}` : ""}`).join("　"),
							at: Date.now()
						});
					}
					appendLocal(bot.id, {
						id: `${Date.now()}-b`,
						role: "bot",
						text: String(outcome?.reply ?? ""),
						at: Date.now()
					});
				} catch (error) {
					appendLocal(bot.id, {
						id: `${Date.now()}-e`,
						role: "error",
						text: String(error?.message ?? error),
						at: Date.now()
					});
				} finally {
					setSending(false);
				}
			}, [
				draft,
				sending,
				bot.id
			]);
			const routines = (state?.routines ?? []).filter((routine) => routine.botId === bot.id);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-chat",
				onKeyDown: (event) => {
					if (event.key === "Escape" && !detailsOpen && !editing) closeTarget();
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
								onClick: () => setDetailsOpen((v) => !v),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-chat__name",
									children: bot.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-chat__meta",
									children: bot.status === "working" ? "正在执行任务…" : bot.title || "常驻待命"
								})]
							}),
							sending ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-chat__stop",
								onClick: () => void stop(),
								children: "停止"
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-iconbtn",
								title: "编辑资料",
								onClick: () => setEditing((v) => !v),
								children: "⚙"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-chat__close",
								onClick: closeTarget,
								"aria-label": "关闭",
								children: "✕"
							})
						]
					}),
					editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { padding: "0 20px" },
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotForm, {
							initial: bot,
							onCancel: () => setEditing(false),
							onSaved: () => setEditing(false)
						})
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-body",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-log",
							ref: logRef,
							children: [
								messages.length === 0 && pending.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "grokbot-empty",
									children: [
										"和 ",
										bot.name,
										" 对话，或投递任务给它。",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"它会真实使用工具、在团队共享电脑里干活。"
									]
								}) : null,
								messages.map((message) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: `grokbot-msg ${message.role}`,
									children: [
										message.role === "bot" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
											style: {
												display: "block",
												fontSize: 11.5,
												opacity: .55,
												marginBottom: 2
											},
											children: [
												bot.avatar,
												" ",
												bot.name
											]
										}) : null,
										message.text,
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "grokbot-msg__time",
											children: new Date(message.at).toLocaleTimeString()
										})
									]
								}, message.id)),
								pending.map((approval) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ApprovalCard, { approval }, approval.id)),
								sending && pending.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "grokbot-empty",
									children: "思考中…"
								}) : null
							]
						}), detailsOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-details",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "grokbot-details__title",
									children: "成员"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "grokbot-member",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "mavatar",
										children: bot.avatar
									}), bot.name]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "grokbot-details__hint",
									children: "创建更多 Bot 后即可添加到这里，组成群聊协作。"
								})
							] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "grokbot-details__title",
									children: "例行任务"
								}),
								routines.map((routine) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "grokbot-routine",
									style: { marginBottom: 6 },
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "grokbot-routine__prompt",
										children: routine.prompt
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "grokbot-routine__sched",
										children: [
											routine.schedule.everyMinutes ? `每 ${routine.schedule.everyMinutes} 分钟` : `每天 ${routine.schedule.time}`,
											" · ",
											routine.enabled ? "启用" : "停用"
										]
									})]
								}, routine.id)),
								newRoutine ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RoutineForm, {
									botId: bot.id,
									onCancel: () => setNewRoutine(false),
									onSaved: () => setNewRoutine(false)
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "grokbot-details__new",
									onClick: () => setNewRoutine(true),
									children: "＋ 创建例行任务"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "grokbot-details__hint",
									children: "例行任务让这个 Bot 按时间表定期运行。"
								})
							] })]
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-inputbar",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "side",
								title: "附件（待实现）",
								disabled: true,
								children: "＋"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								value: draft,
								placeholder: `发消息给 ${bot.name}`,
								rows: 1,
								onChange: (event) => setDraft(event.target.value),
								onKeyDown: (event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										send();
									}
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "side",
								title: "语音输入（待实现）",
								disabled: true,
								children: "🎤"
							})
						]
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
								type: "button",
								className: "grokbot-chat__close",
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
										style: {
											display: "block",
											fontSize: 11.5,
											opacity: .55,
											marginBottom: 2
										},
										children: [bot?.avatar ?? "", bot?.name ?? message.botId]
									}),
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
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "side",
								title: "附件（待实现）",
								disabled: true,
								children: "＋"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								value: draft,
								placeholder: `发到 ${room.name}…（@成员名 定向）`,
								rows: 1,
								onChange: (event) => setDraft(event.target.value),
								onKeyDown: (event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										send();
									}
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "side",
								title: "语音输入（待实现）",
								disabled: true,
								children: "🎤"
							})
						]
					})
				]
			});
		}
		function GrokbotMainView() {
			const target = useOpenTarget();
			const state = useGrokbotState();
			const restoredRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (restoredRef.current || openTarget || !state) return;
				restoredRef.current = true;
				const saved = readLastTarget();
				if (!saved) return;
				if (saved.kind === "bot" && state.bots.some((bot) => bot.id === saved.id)) openBot(saved.id);
				else if (saved.kind === "room" && state.rooms.some((room) => room.id === saved.id)) openRoom(saved.id);
			}, [state]);
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
				children: bot ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotChatView, {
					bot,
					state
				}) : room ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupChatView, {
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
