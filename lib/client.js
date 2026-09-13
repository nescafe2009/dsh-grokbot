window.__ModuleLoader__.load({
	id: "dsh-grokbot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/character-state.ts
		function characterActivity(bot, snapshot, now = Date.now()) {
			if (!snapshot || snapshot.stale) return {
				state: "unknown",
				label: "状态待同步"
			};
			const approval = snapshot.approvals?.find((a) => a.botId === bot.id);
			if (approval) return {
				state: "waiting",
				label: approval.stage === "chief" ? "等待幕僚长审核" : "等待你审批"
			};
			if (bot.status === "working") return {
				state: bot.motionPhase === "working" ? "working" : "active",
				label: bot.motionPhase === "working" ? "工具执行中" : "正在处理",
				eventId: bot.currentJob || void 0
			};
			if (snapshot.queued?.some((j) => j.botId === bot.id)) return {
				state: "queued",
				label: "等待调度"
			};
			const recent = snapshot.recentJobs?.find((j) => j.botId === bot.id);
			if (recent?.endedAt && now - recent.endedAt < 15e3 && !(bot.lastFrom === "user" && (bot.lastAt || 0) > recent.endedAt)) {
				if ([
					"replied",
					"done",
					"completed"
				].includes(recent.status)) return {
					state: "done",
					label: "本次执行已结束",
					eventId: recent.jobId
				};
				if (["failed", "interrupted"].includes(recent.status)) return {
					state: "error",
					label: "执行受阻，查看详情",
					eventId: recent.jobId
				};
				if (recent.status === "cancelled") return {
					state: "paused",
					label: "本次执行已取消",
					eventId: recent.jobId
				};
			}
			return {
				state: "idle",
				label: "待命"
			};
		}
		//#endregion
		//#region src/client/avatar-mark.ts
		/** Small-scale, flat character marks. No remote assets, gradients or shared SVG IDs. */
		const colors = [
			"#06C674",
			"#15BBAE",
			"#A679F5",
			"#FF50AB",
			"#FFAE32",
			"#6488E8",
			"#BA855B",
			"#EC7765"
		];
		const shapes = [
			"M8 33C8 23 15 17 25 17h15c11 0 17 6 17 16s-7 16-18 16H24C14 49 8 43 8 33Z",
			"M54 31c4 14-4 24-19 25C20 57 9 48 9 34 8 19 17 8 31 9c13 0 20 9 23 22Z",
			"M17 20c0-8 11-12 17-5 8-5 18 2 17 11 10 7 7 20-3 23-5 8-16 9-23 4-12 3-20-5-18-14-2-8 2-15 10-19Z",
			"M25 11c3-5 10-5 13 1l19 34c3 6 0 10-7 10H14c-7 0-10-5-7-11Z",
			"M16 13h30c7 0 11 5 11 12v21c0 7-5 11-12 11H19C10 57 7 51 7 43V25c0-7 3-12 9-12Z",
			"M9 28C12 13 27 7 41 12c14 4 21 17 15 30-5 13-21 17-35 11C9 48 5 39 9 28Z"
		];
		const roles = {
			chief: [0, 0],
			coder: [1, 2],
			researcher: [4, 1],
			writer: [3, 0],
			analyst: [5, 4],
			pm: [7, 3],
			ops: [6, 3],
			translator: [1, 5],
			secretary: [3, 1],
			reviewer: [2, 1],
			blank: [5, 0],
			"kw-shield": [5, 4],
			"kw-scales": [6, 3],
			"kw-book": [0, 4],
			"kw-gear": [1, 2],
			"kw-note": [3, 0],
			"kw-flame": [7, 2]
		};
		function identityParts(role, identity) {
			let hash = 2166136261;
			for (const ch of identity.normalize("NFC")) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
			hash = Math.imul(hash ^ hash >>> 16, 2246822507) >>> 0;
			hash = (hash ^ hash >>> 13) >>> 0;
			const [color, shape] = (role !== "blank" ? roles[role || ""] : void 0) || [hash % colors.length || 2, (hash >>> 8) % shapes.length];
			const eyes = shape === 3 ? "M27 34l2 5m10-5 2 5" : "M27 28l2 5m10-5 2 5";
			return {
				shape: shapes[shape],
				color: colors[color],
				eyes,
				triangle: shape === 3
			};
		}
		function identityMark(role, identity) {
			const parts = identityParts(role, identity);
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="${parts.shape}" fill="${parts.color}"/><path d="${parts.eyes}" fill="none" stroke="white" stroke-width="4.5" stroke-linecap="round"/></svg>`;
		}
		//#endregion
		//#region src/client/character.tsx
		const modeKey = "grokbot-character-motion-v1";
		function readMotionMode() {
			try {
				const v = localStorage.getItem(modeKey);
				return v === "quiet" || v === "off" ? v : "standard";
			} catch {
				return "standard";
			}
		}
		function setMotionMode(mode) {
			try {
				localStorage.setItem(modeKey, mode);
			} catch {}
			window.dispatchEvent(new Event("grokbot-motion-change"));
		}
		function MotionSettings() {
			const [mode, setMode] = (0, react.useState)(readMotionMode);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "gk-motion-setting",
				children: [
					"角色动作",
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						"aria-label": "角色动作",
						value: mode,
						onChange: (e) => {
							const m = e.target.value;
							setMode(m);
							setMotionMode(m);
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "standard",
								children: "标准 · 明显动作"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "quiet",
								children: "安静 · 减少动作"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "off",
								children: "关闭"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "遵循系统“减少动态效果”；历史消息头像保持静止。" })
				]
			});
		}
		const Character = (0, react.memo)(function Character({ seed, name, role, size, activity, quiet = false, specialty = "" }) {
			const ref = (0, react.useRef)(null), [mode, setMode] = (0, react.useState)(readMotionMode), [visible, setVisible] = (0, react.useState)(true), [foreground, setForeground] = (0, react.useState)(() => !document.hidden);
			const token = `${activity.state}:${activity.eventId || ""}`;
			const last = (0, react.useRef)(token), [event, setEvent] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const update = () => setMode(readMotionMode());
				window.addEventListener("grokbot-motion-change", update);
				return () => window.removeEventListener("grokbot-motion-change", update);
			}, []);
			(0, react.useEffect)(() => {
				const update = () => setForeground(!document.hidden);
				document.addEventListener("visibilitychange", update);
				let observer;
				if (typeof IntersectionObserver !== "undefined") {
					observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
					if (ref.current) observer.observe(ref.current);
				}
				return () => {
					observer?.disconnect();
					document.removeEventListener("visibilitychange", update);
				};
			}, []);
			(0, react.useEffect)(() => {
				const fresh = activity.eventId && token !== last.current;
				last.current = token;
				setEvent(null);
				if (fresh && visible && foreground && !quiet && ["done", "error"].includes(activity.state)) {
					setEvent(activity.eventId);
					const timer = setTimeout(() => setEvent(null), 1200);
					return () => clearTimeout(timer);
				}
			}, [
				activity.eventId,
				activity.state,
				visible,
				foreground,
				quiet
			]);
			const parts = identityParts(role, name || seed), personality = role === "chief" ? "chief" : role === "researcher" || role === "analyst" || /架构|技术负责人|architect/i.test(specialty) ? "architect" : role === "reviewer" || /测试|质量|\bQA\b/i.test(specialty) ? "qa" : "developer";
			const phase = Array.from(seed).reduce((n, c) => n + c.charCodeAt(0), 0), pace = 1.5 + phase % 5 * .16;
			const pose = activity.state === "done" && !event ? "idle" : activity.state;
			const frozen = mode === "off" || !visible || !foreground || quiet && (mode === "quiet" || activity.state === "idle");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				ref,
				className: "gk-character",
				role: "img",
				"aria-label": `${name} · ${activity.label}`,
				"data-state": pose,
				"data-personality": personality,
				"data-static": frozen,
				"data-quiet": quiet,
				"data-motion": mode,
				"data-event": Boolean(event),
				style: {
					width: size,
					height: size,
					"--pace": `${pace}s`,
					"--blink-delay": `${-(phase % 6)}s`
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					viewBox: "0 0 64 64",
					"aria-hidden": "true",
					"data-avatar-role": role || "custom",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
						className: "body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								d: parts.shape,
								fill: parts.color
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("g", {
								className: "eyes",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("g", {
									className: "blink",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										d: parts.eyes,
										fill: "none",
										stroke: "white",
										strokeWidth: "4.5",
										strokeLinecap: "round"
									})
								})
							}),
							size >= 48 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
								className: "hand",
								cx: "12",
								cy: "46",
								rx: "4.5",
								ry: "3",
								fill: parts.color
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
								className: "hand right",
								cx: "53",
								cy: "46",
								rx: "4.5",
								ry: "3",
								fill: parts.color
							})] }) : null
						]
					}), [
						"waiting",
						"queued",
						"error",
						"paused"
					].includes(activity.state) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "54",
						cy: "12",
						r: "7",
						fill: activity.state === "error" ? "#a44530" : "#6f746b"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
						x: "54",
						y: "15.7",
						fontSize: "11",
						fontFamily: "sans-serif",
						fill: "white",
						textAnchor: "middle",
						children: activity.state === "error" ? "!" : activity.state === "waiting" ? "?" : activity.state === "paused" ? "Ⅱ" : "·"
					})] }) : null]
				})
			});
		});
		//#endregion
		//#region src/client/character-css.ts
		const CHARACTER_CSS = `.gk-character{width:var(--size);height:var(--size)}.sample small{width:auto;text-align:center;font-size:9px}.live{font-size:11px;color:#6f766c;min-width:150px}
.gk-character{width:var(--size,56px);height:var(--size,56px);display:inline-block;flex:none;overflow:visible}.gk-character svg{display:block;width:100%;height:100%;overflow:visible}.body,.eyes,.blink,.hand,.ground,.signal{transform-box:view-box;transform-origin:32px 48px}.eyes{transform-origin:32px 32px}.blink{transform-origin:32px 31px}.hand{opacity:0;transform-origin:32px 42px}.ground{opacity:.09;transform-origin:32px 57px}.signal{opacity:0;transform-origin:52px 14px}.gk-character[data-state=idle] .blink{animation:gkc-blink 6.7s infinite}.gk-character[data-state=idle] .body{animation:gkc-settle 7s ease-in-out infinite}.gk-character[data-state=active] .body{animation:gkc-ponder 3.1s ease-in-out infinite}.gk-character[data-state=active] .eyes{animation:gkc-look 3.1s ease-in-out infinite}.gk-character[data-state=active] .blink{animation:gkc-blink 4.3s infinite}.gk-character[data-state=working] .body{animation:gkc-work var(--pace,1.6s) ease-in-out infinite}.gk-character[data-state=working] .eyes{animation:gkc-scan 2s ease-in-out infinite}.gk-character[data-state=working] .hand{opacity:1;animation:gkc-tap .48s ease-in-out infinite alternate}.gk-character[data-state=working] .hand.right{animation-delay:-.35s}.gk-character[data-personality=architect][data-state=working] .body{animation:gkc-ponder 2.6s ease-in-out infinite}.gk-character[data-personality=qa][data-state=working] .eyes{animation:gkc-scan .95s ease-in-out infinite}.gk-character[data-personality=chief][data-state=working] .body{animation:gkc-coordinate 2.3s ease-in-out infinite}.gk-character[data-state=waiting] .body{animation:gkc-attend 6s ease-in-out 1}.gk-character[data-state=waiting] .signal{opacity:1}.gk-character[data-state=waiting] .blink{animation:gkc-blink 5s infinite}.gk-character[data-state=done] .body{animation:gkc-celebrate 1.05s ease-out 1}.gk-character[data-state=done] .signal{opacity:1}.gk-character[data-state=error] .body{animation:gkc-shake .5s ease-out 1}.gk-character[data-state=error] .signal{opacity:1}.gk-character[data-state=paused] .eyes{transform:translateY(2px) scaleY(.55)}.gk-character[data-state=paused] .body{transform:translateY(2px)}.gk-character[data-state=unknown] svg{opacity:.6}.gk-character[data-state=unused-gkc-greet] .body{animation:gkc-greet 1.15s ease-out 1}.gk-character[data-state=unused-gkc-greet] .hand.right{opacity:1;animation:gkc-wave 1.15s ease-out 1}.gk-character[data-surface=small] .hand,.gk-character[data-surface=small] .ground{display:none}.gk-character[data-surface=small] .signal{transform:scale(.8)}
@keyframes gkc-blink{0%,40%,44%,100%{transform:scaleY(1)}42%{transform:scaleY(.08)}}@keyframes gkc-settle{0%,63%,100%{transform:none}68%{transform:translateY(-1.5px) scale(1.02,.98)}74%{transform:none}}@keyframes gkc-ponder{0%,100%{transform:rotate(0)}25%,65%{transform:rotate(-9deg) translateY(-2px)}80%{transform:rotate(3deg)}}@keyframes gkc-look{0%,100%{transform:none}25%,65%{transform:translate(3px,-3px)}80%{transform:translate(-2px,0)}}@keyframes gkc-scan{0%,100%{transform:translate(-3px,1px)}50%{transform:translate(3px,1px)}}@keyframes gkc-work{0%,100%{transform:translateY(1px) scale(1.04,.96)}25%{transform:translate(-2px,-3px) rotate(-5deg)}50%{transform:translateY(1px) scale(1.04,.96)}75%{transform:translate(2px,-3px) rotate(5deg)}}@keyframes gkc-coordinate{0%,100%{transform:none}20%{transform:rotate(-8deg)}40%{transform:none}65%{transform:rotate(8deg) translateY(-2px)}80%{transform:scale(1.06,.94)}}@keyframes gkc-tap{from{transform:translateY(2px)}to{transform:translateY(-4px)}}@keyframes gkc-attend{0%,10%,100%{transform:none}3%,7%{transform:translateY(-4px) rotate(5deg)}5%{transform:none}}@keyframes gkc-celebrate{0%{transform:none}15%{transform:scale(1.15,.85)}45%{transform:translateY(-11px) rotate(-10deg) scale(.94,1.06)}70%{transform:translateY(1px) scale(1.13,.87)}85%{transform:translateY(-3px)}100%{transform:none}}@keyframes gkc-shake{0%,100%{transform:none}20%,60%{transform:translateX(-4px) rotate(-5deg)}40%,80%{transform:translateX(4px) rotate(5deg)}}@keyframes gkc-greet{0%,100%{transform:none}30%{transform:translateY(-5px) rotate(-8deg)}65%{transform:rotate(6deg)}}@keyframes gkc-wave{0%,100%{transform:none}25%,65%{transform:translateY(-12px) rotate(-14deg)}45%,80%{transform:translateY(-9px) rotate(4deg)}}

.gk-character{flex:none;overflow:visible;display:inline-flex}.gk-character .blink{animation-delay:var(--blink-delay,0s)!important}
.gk-character[data-state=active] .hand{display:none}
.gk-character[data-state=error][data-event=false] .body{animation:none}
.gk-character[data-static=true] *{animation:none!important}
.gk-character[data-quiet=true] .body{animation:none!important}.gk-character[data-quiet=true] .hand{display:none}
.gk-character[data-motion=quiet] .body,.gk-character[data-motion=quiet] .hand{animation:none!important}
@media(prefers-reduced-motion:reduce){.gk-character *{animation:none!important}.gk-character .hand{display:none}}
.gk-motion-setting{display:flex;align-items:center;flex-wrap:wrap;gap:14px;font-size:14px;padding:22px 0;border-top:1px solid var(--gk-line)}.gk-motion-setting select{font:inherit;min-height:40px;border:1px solid var(--gk-line);border-radius:8px;padding:6px 12px;color:inherit;background:var(--gk-bg)}.gk-motion-setting small{flex-basis:100%;font-size:12px;color:var(--gk-text-2)}
`;
		//#endregion
		//#region src/client/permission-rules.tsx
		function PermissionRules({ api, bots, onBack }) {
			const [rules, setRules] = (0, react.useState)(null), [error, setError] = (0, react.useState)(""), [busy, setBusy] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				let alive = true;
				api("/approval-rules").then((r) => {
					if (alive) setRules(r.rules);
				}).catch((e) => {
					if (alive) setError(e.message);
				});
				return () => {
					alive = false;
				};
			}, [api]);
			const revoke = async (id) => {
				setBusy(id);
				setError("");
				try {
					await api("/approval-rules/" + id, { method: "DELETE" });
					setRules((rows) => rows?.filter((r) => r.id !== id) || []);
				} catch (e) {
					setError(e.message);
				} finally {
					setBusy("");
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "gk-permissions",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						onClick: onBack,
						children: "← 返回首页"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: "授权规则" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "你明确记住的操作，在 24 小时内按相同成员、会话、工作目录、完整命令和权限复用。命令执行的脚本内容仍可能变化。" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "撤销后，下次匹配的操作重新询问；已获准运行的操作不会因此中止。" }),
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: error
					}) : null,
					rules === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: error ? "读取失败，请返回后重试。" : "正在读取…" }) : !rules.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "没有已保存的规则。在审批卡中勾选“24 小时内记住此操作”后，这里会显示可撤销的授权。" }) : rules.map((rule) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: bots.find((b) => b.id === rule.botId)?.name || rule.botId }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: Boolean(busy),
							onClick: () => void revoke(rule.id),
							children: busy === rule.id ? "撤销中…" : "撤销"
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
							rule.workspace,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
							"会话：",
							rule.conversationId,
							" · 权限：",
							rule.mode,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
							"有效至 ",
							new Date(rule.expiresAt).toLocaleString()
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: rule.commandPreview })
					] }, rule.id))
				]
			});
		}
		//#endregion
		//#region src/client/ux.ts
		const UX_CSS = `
:root{--gk-font-meta:12px;--gk-font-label:14px;--gk-font-body:15px;--gk-font-title:18px;--gk-font-display:26px;--gk-text-2:#62626b;--gk-text-3:#73737c}
.grokbot-chat{position:relative}
.gk-profile-overlay{position:absolute;inset:76px 0 0;z-index:40;display:flex;align-items:flex-start;justify-content:center;padding:20px;background:rgba(247,247,247,.94);overflow:auto}
.gk-profile-form button{font:inherit;font-size:var(--gk-font-label);min-height:40px;padding:8px 14px;border:1px solid var(--gk-line);border-radius:10px;background:var(--gk-bg);cursor:pointer}.gk-profile-form button.grokbot-form__submit{background:var(--gk-text);color:var(--gk-bg)}
.grokbot-chat,.grokbot-sidebar,.gk-board,.gk-work{font-size:var(--gk-font-body);line-height:1.55}
.grokbot-log{overflow-anchor:none;overscroll-behavior:contain;scroll-behavior:auto;scrollbar-gutter:stable}
.grokbot-log pre{overscroll-behavior:auto}
.grokbot-chat__head{min-height:76px;gap:14px}
.grokbot-chat__name{font-size:var(--gk-font-title)}
.grokbot-chat__close,.grokbot-iconbtn,.gk-board-toggle{min-width:44px;min-height:44px;border-radius:12px}
.gk-board-toggle{font:inherit;font-size:var(--gk-font-label);padding:8px 14px;background:var(--gk-bg-soft);border:1px solid var(--gk-line);color:var(--gk-text);cursor:pointer;white-space:nowrap}
.gkf-row{min-height:72px;gap:12px;padding:10px 12px}
.gk-profile-form{box-sizing:border-box;width:min(620px,100%);max-width:620px;margin:12px auto;padding:24px!important;border:1px solid var(--gk-line);border-radius:18px;background:var(--gk-bg);max-height:100%;overflow:auto;box-shadow:0 8px 32px #00000008}
.gk-profile-form header strong{font-size:var(--gk-font-title)}.gk-profile-form header p{color:var(--gk-text-2);margin:6px 0 18px;font-size:var(--gk-font-label)}
.gk-profile-form>label{font-size:var(--gk-font-label);font-weight:600;margin-top:12px}.gk-profile-form input,.gk-profile-form select{min-height:44px}.gk-profile-form textarea{min-height:130px}.gk-profile-form .grokbot-form__actions{position:sticky;bottom:-24px;background:var(--gk-bg);padding-bottom:16px;z-index:2;margin-top:16px;padding-top:16px;border-top:1px solid var(--gk-line)}
.gk-work{background:var(--gk-bg);scrollbar-width:thin}.gk-work>button{min-height:36px;font:inherit;font-weight:600}.gk-work small{font-size:var(--gk-font-meta);color:var(--gk-text-2)}.gk-work summary{cursor:pointer;padding:8px 0;font-size:var(--gk-font-label)}.gk-work p{font-size:var(--gk-font-label);line-height:1.65}.gk-work pre{font-size:var(--gk-font-meta)}
.gk-execution{margin-top:16px;border-left:2px solid var(--gk-line);padding-left:16px}.gk-execution h4{margin:0 0 12px;font-size:var(--gk-font-label)}.gk-execution time{font-size:var(--gk-font-meta);color:var(--gk-text-2)}.gk-execution__tool{border:1px solid var(--gk-line);border-radius:12px;margin:10px 0;background:var(--gk-bg-soft);padding:4px 12px}.gk-execution__tool summary{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.gk-execution__state{margin-left:auto;color:var(--gk-text-2);font-size:var(--gk-font-meta)}.gk-execution pre{max-height:340px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--gk-bg);padding:12px;border-radius:8px}.gk-execution__progress p{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:4px}
 .gk-shot{position:relative;flex:none}.gk-shot-menu{position:absolute;bottom:48px;left:0;width:280px;padding:12px;background:var(--gk-bg);border:1px solid var(--gk-line);border-radius:16px;box-shadow:0 12px 40px #00000020;z-index:60;color:var(--gk-text)}.gk-shot-menu>strong{display:block;padding:4px 10px 8px;font-size:14px}.gk-shot-menu button{display:flex;flex-direction:column;gap:3px;width:100%;border:0;background:transparent;border-radius:10px;padding:10px;text-align:left;cursor:pointer;color:inherit;font:inherit;font-size:14px}.gk-shot-menu button:hover,.gk-shot-menu button:focus-visible{background:var(--gk-bg-soft)}.gk-shot-menu small,.gk-shot-menu p{font-size:12px;color:var(--gk-text-2);line-height:1.6}.gk-shot-menu p{margin:8px 10px 4px;border-top:1px solid var(--gk-line);padding-top:12px}.gk-shot-menu kbd{font:inherit;font-weight:600;color:var(--gk-text)}.gk-shot-status{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;font-size:13px;border-radius:12px;background:var(--gk-bg-soft);margin-bottom:8px}.gk-shot-status button{font:inherit;border:0;background:transparent;cursor:pointer;min-height:32px}.gk-shot-error{font-size:13px;color:#a32929}

.gk-capture-button{flex:none;width:36px;height:36px;background:transparent;border:0;border-radius:9px;color:var(--gk-text-2);cursor:pointer;display:grid;place-items:center}.gk-capture-button:hover{background:var(--gk-bg-soft)}.gk-capture-button:disabled{opacity:.4}.gk-capture-preview{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 0}.gk-capture-preview figure{margin:0;display:flex;gap:8px;align-items:center}.gk-capture-preview img{width:100px;height:70px;object-fit:contain;border:1px solid var(--gk-line);border-radius:8px}.gk-capture-preview span{font-size:var(--gk-font-meta);color:var(--gk-text-2)}.gk-capture-preview button{font:inherit;font-size:var(--gk-font-meta);background:transparent;border:0;cursor:pointer;min-height:36px}
.gkf-composer__plus:disabled{display:none}.gkf-composer__send{width:36px;height:36px}.gkf-composer__input{min-width:0}
.grokbot-chat :focus-visible,.gkf-row:focus-visible{outline:2px solid var(--gk-accent);outline-offset:3px}
.gkf-composer{flex-shrink:0;padding:12px 20px 16px}
.gkf-composer__pill{display:flex;flex-direction:column;align-items:stretch;gap:8px;border-radius:20px;padding:14px 14px 8px;background:var(--gk-bg);border:1px solid var(--gk-line);box-shadow:0 2px 8px #00000005}
.gkf-composer__pill:focus-within{border-color:#94949c;box-shadow:0 0 0 2px #73737c18}
.grokbot-chat .gkf-composer__input,.grokbot-chat .gkf-composer__input:focus-visible{box-sizing:border-box;display:block;flex:none;width:100%;min-width:0;min-height:56px;max-height:200px;padding:2px 4px;border:0;border-radius:0;outline:none;box-shadow:none;font:inherit;font-size:15px;line-height:24px;resize:none;overflow-y:auto;background:transparent}
.gkf-composer__toolbar{display:flex;align-items:center;gap:8px;min-height:44px}
.gkf-composer__hint{flex:1;font-size:12px;color:var(--gk-text-2);padding:0 4px}
.gkf-composer__send,.gkf-composer__plus,.gk-capture-button{width:44px;height:44px}
.gk-capture-preview{padding:0 4px;max-height:150px;overflow:auto}
@media(max-width:600px){.gkf-composer{padding:8px 12px 12px}.gkf-composer__hint{font-size:12px}.gk-shot-menu{width:min(280px,70vw)}}

.grokbot-home{display:block!important;box-sizing:border-box;overflow:auto;min-height:100%;padding:clamp(60px,10vh,120px) clamp(28px,6vw,96px) 72px;background:var(--gk-bg)!important;text-align:left}
.grokbot-home__content{max-width:690px;margin:0 auto}.grokbot-home__eyebrow{font-size:11px;font-weight:600;letter-spacing:3.5px;color:var(--gk-text-2)}
.grokbot-home .grokbot-home__title{font-size:clamp(28px,2.6vw,36px);font-weight:600;letter-spacing:-1px;line-height:1.3;margin:22px 0 15px;text-align:left}
.grokbot-home .grokbot-home__sub{font-size:17px;color:var(--gk-text-2);margin:0 0 44px;line-height:1.6}
.grokbot-home__chief{display:flex;align-items:center;gap:20px;padding:14px 0 28px;width:100%;border:0;border-bottom:1px solid var(--gk-line);background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.grokbot-home__chief strong{display:block;font-size:20px;font-weight:600}.grokbot-home__chief small{display:block;font-size:14px;color:var(--gk-text-2);margin-top:7px}
.grokbot-home__arrow{display:grid;place-items:center;margin-left:auto;width:44px;height:44px;border-radius:50%;background:var(--gk-text);color:var(--gk-bg);font-size:25px;flex:none;transition:transform .18s ease-out}.grokbot-home__chief:hover .grokbot-home__arrow{transform:translateX(3px)}
.grokbot-home__section{display:flex;align-items:center;justify-content:space-between;margin:22px 0 14px;color:var(--gk-text-2);font-size:13px}.grokbot-home__textlink{border:0;background:transparent;cursor:pointer;color:var(--gk-text-2);font:inherit;font-size:12px;min-height:40px;padding:8px 0}
.grokbot-home .grokbot-home__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 34px;max-width:none;width:100%}
.grokbot-home__member{display:flex;align-items:center;gap:14px;min-height:72px;padding:8px 10px 8px 0;border:0;border-radius:10px;background:transparent;color:inherit;text-align:left;cursor:pointer;min-width:0;font:inherit;transition:background .18s}
.grokbot-home__member:hover{background:var(--gk-bg-soft)}.grokbot-home__member>span:last-child{min-width:0}.grokbot-home__member strong{display:block;font-size:15px;font-weight:600}.grokbot-home__member small{display:block;font-size:12px;line-height:1.6;color:var(--gk-text-2);margin-top:5px;overflow-wrap:anywhere}
.grokbot-home__utilities{display:flex;gap:24px;margin-top:44px}.grokbot-home__utilities button{font:inherit;font-size:12px;color:var(--gk-text-2);border:0;background:transparent;min-height:40px;cursor:pointer;padding:0}.grokbot-home :focus-visible{outline:2px solid var(--gk-text);outline-offset:4px}
.grokbot-brand{margin-right:auto;font:inherit;font-size:21px;font-weight:750;letter-spacing:-.7px;color:var(--gk-text);border:0;background:transparent;cursor:pointer;min-height:44px;padding:0 6px}.gk-rail .grokbot-brand{display:none}
.gk-permissions{padding:32px;box-sizing:border-box;overflow:auto;height:100%;max-width:900px;margin:0 auto;color:var(--gk-text)}.gk-permissions h1{font-size:26px}.gk-permissions p{font-size:14px;line-height:1.8;color:var(--gk-text-2)}.gk-permissions article{padding:20px 0;border-bottom:1px solid var(--gk-line)}.gk-permissions header{display:flex;justify-content:space-between;align-items:center}.gk-permissions small{display:block;overflow-wrap:anywhere;font-size:12px;color:var(--gk-text-2);line-height:1.8}.gk-permissions pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:var(--gk-bg-soft);padding:14px;border-radius:8px}.gk-permissions button{font:inherit;font-size:13px;min-height:40px;background:transparent;border:1px solid var(--gk-line);border-radius:8px;color:inherit;padding:6px 12px;cursor:pointer}
@media(max-width:650px){.grokbot-home{padding:44px 24px}.grokbot-home .grokbot-home__grid{gap:12px;grid-template-columns:1fr}.grokbot-home__sub{margin-bottom:24px!important}.grokbot-home__chief{gap:12px}}
@media(prefers-reduced-motion:reduce){.grokbot-home__arrow,.grokbot-home__member{transition:none}.grokbot-home__chief:hover .grokbot-home__arrow{transform:none}}
`;
		//#endregion
		//#region src/client/screenshot-control.tsx
		function useScreenshot({ conversationId, draft, onDraft, sending }) {
			const [open, setOpen] = (0, react.useState)(false), [busy, setBusy] = (0, react.useState)(false), [error, setError] = (0, react.useState)(""), [deadline, setDeadline] = (0, react.useState)(0), [seconds, setSeconds] = (0, react.useState)(0);
			const latest = (0, react.useRef)({
				conversationId,
				draft,
				onDraft
			});
			latest.current = {
				conversationId,
				draft,
				onDraft
			};
			const controller = (0, react.useRef)(null), container = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				setOpen(false);
				setError("");
				return () => controller.current?.abort();
			}, [conversationId]);
			(0, react.useEffect)(() => {
				if (!deadline) return;
				const tick = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1e3)));
				tick();
				const t = setInterval(tick, 200);
				return () => clearInterval(t);
			}, [deadline]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const outside = (e) => {
					if (!container.current?.contains(e.target)) setOpen(false);
				};
				const key = (e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						setOpen(false);
					}
				};
				document.addEventListener("mousedown", outside);
				document.addEventListener("keydown", key, true);
				return () => {
					document.removeEventListener("mousedown", outside);
					document.removeEventListener("keydown", key, true);
				};
			}, [open]);
			const request = async (payload, path = "/screenshots") => {
				if (controller.current || !conversationId) return;
				const id = conversationId, c = new AbortController();
				controller.current = c;
				setBusy(true);
				setError("");
				setOpen(false);
				const delay = Number(payload.delay || 0);
				setSeconds(delay);
				setDeadline(delay ? Date.now() + delay * 1e3 : 0);
				try {
					const r = await fetch("/api/plugins/grokbot" + path, {
						method: "POST",
						signal: c.signal,
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							conversationId: id,
							...payload
						})
					});
					const data = await r.json();
					if (!r.ok) throw Error(data.error || "截图未完成，请重试");
					if (!c.signal.aborted && latest.current.conversationId === id && !data.cancelled) latest.current.onDraft(`${latest.current.draft}${latest.current.draft ? "\n" : ""}[截图](${data.url})`);
				} catch (e) {
					if (!c.signal.aborted && latest.current.conversationId === id) setError(String(e.message));
				} finally {
					if (controller.current === c) {
						controller.current = null;
						setBusy(false);
						setDeadline(0);
						setSeconds(0);
					}
				}
			};
			const onPaste = (e) => {
				const file = [...e.clipboardData.items].find((i) => i.kind === "file" && i.type === "image/png")?.getAsFile();
				if (!file || !conversationId) return;
				e.preventDefault();
				if (busy) return;
				if (file.size > 12 * 1024 * 1024) {
					setError("截图超过 12 MB，请缩小截图区域");
					return;
				}
				const id = conversationId, reader = new FileReader();
				reader.onload = () => {
					if (latest.current.conversationId === id) request({ image: reader.result }, "/screenshots/import");
				};
				reader.onerror = () => setError("无法读取剪贴板图片，请重新复制");
				reader.readAsDataURL(file);
			};
			return {
				control: conversationId ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "gk-shot",
					ref: container,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "gk-capture-button",
						onClick: () => setOpen((v) => !v),
						disabled: busy,
						"aria-label": "截图",
						"aria-expanded": open,
						title: "截图与粘贴",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							width: "20",
							height: "20",
							viewBox: "0 0 24 24",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.6",
							"aria-hidden": "true",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 5 10 3h4l2 2h4v15H4V5Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: "12",
								cy: "12",
								r: "4"
							})]
						})
					}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "gk-shot-menu",
						role: "group",
						"aria-label": "截图选项",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "截图" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => void request({
									mode: "screen",
									delay: 5
								}),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "5 秒后截图" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "先点击，再打开菜单栏弹窗" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => void request({
									mode: "screen",
									delay: 10
								}),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "10 秒后截图" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "留出更多操作时间" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => void request({ mode: "region" }),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "立即选择区域" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "适合普通窗口内容" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								"也可以在目标界面按 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("kbd", { children: "⌃⇧⌘4" }),
								" 截图到剪贴板，再回来按 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("kbd", { children: "⌘V" }),
								" 粘贴。"
							] })
						]
					}) : null]
				}) : null,
				status: busy ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "gk-shot-status",
					role: "status",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: seconds > 0 ? `${seconds} 秒后自动截屏 · 现在打开要截取的菜单，无需返回此窗口` : "正在准备截图…" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => controller.current?.abort(),
						children: "取消"
					})]
				}) : error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "gk-shot-error",
					role: "alert",
					children: error
				}) : null,
				onPaste
			};
		}
		//#endregion
		//#region src/client/avatars.ts
		const ROLE_DEFS = {
			chief: {
				palette: 0,
				mouth: "o",
				top: "round",
				accessory: "crown+star"
			},
			coder: {
				palette: 1,
				mouth: "smile",
				top: "point",
				accessory: "glasses"
			},
			researcher: {
				palette: 2,
				mouth: "w",
				top: "point",
				accessory: "magnifier"
			},
			writer: {
				palette: 3,
				mouth: "wave",
				top: "tuft",
				accessory: "pen"
			},
			analyst: {
				palette: 4,
				mouth: "o",
				top: "point",
				accessory: "cross-eye"
			},
			pm: {
				palette: 5,
				mouth: "smile",
				top: "tuft",
				accessory: "kanban"
			},
			ops: {
				palette: 6,
				mouth: "smile",
				top: "tuft",
				accessory: "antenna"
			},
			translator: {
				palette: 7,
				mouth: "smile",
				top: "round",
				accessory: "globe"
			},
			secretary: {
				palette: 8,
				mouth: "wave",
				top: "tuft",
				accessory: "sparkle"
			},
			reviewer: {
				palette: 9,
				mouth: "smile",
				top: "point",
				accessory: "star-eye"
			},
			blank: {
				palette: 11,
				mouth: "o",
				top: "none"
			},
			group: {
				palette: 6,
				mouth: "smile",
				top: "none",
				accessory: "cloud"
			},
			"kw-shield": {
				palette: 10,
				mouth: "smile",
				top: "none",
				accessory: "shield"
			},
			"kw-scales": {
				palette: 6,
				mouth: "smile",
				top: "none",
				accessory: "scales"
			},
			"kw-book": {
				palette: 7,
				mouth: "smile",
				top: "none",
				accessory: "book"
			},
			"kw-gear": {
				palette: 4,
				mouth: "smile",
				top: "none",
				accessory: "gear"
			},
			"kw-note": {
				palette: 8,
				mouth: "wave",
				top: "none",
				accessory: "note"
			},
			"kw-flame": {
				palette: 5,
				mouth: "smile",
				top: "none",
				accessory: "flame"
			}
		};
		const EMOJI_GLYPH = {
			"🤖": "blank",
			"🎖️": "chief",
			"🛠️": "coder",
			"🔎": "researcher",
			"✍️": "writer",
			"📊": "analyst",
			"📋": "pm",
			"🖥️": "ops",
			"🌐": "translator",
			"🗂️": "secretary",
			"🛡️": "reviewer"
		};
		/** 显示层统一解析：已知角色键原样；emoji 映射到角色；其余 undefined（果冻豆回退） */
		function resolveGlyph(glyph) {
			if (!glyph) return void 0;
			const key = String(glyph).trim();
			if (ROLE_DEFS[key] !== void 0) return key;
			const mapped = EMOJI_GLYPH[key] ?? Object.entries(EMOJI_GLYPH).find(([emoji]) => emoji.replace(/\uFE0F/g, "") === key.replace(/\uFE0F/g, ""))?.[1];
			return mapped !== void 0 ? mapped : void 0;
		}
		//#endregion
		//#region src/client/tokens.ts
		const TOKENS = {
			color: {
				bgSide: "#f7f7f7",
				bgMain: "#fcfcfc",
				bubbleUser: "#070707",
				bubbleUserText: "#ffffff",
				bubbleBot: "#eeeeee",
				bubbleBotText: "#1d1d1f",
				noticeCard: "#eeeeee",
				taskCard: "#eeeeee",
				taskCardPanel: "#ffffff",
				badgeDone: "#409050",
				badgeRunning: "#e67e22",
				badgeInfo: "#38bcf8",
				dotDone: "#409050",
				dotFail: "#b03030",
				unread: "#2563eb",
				text1: "#1d1d1f",
				text2: "#62626b",
				text3: "#73737c",
				line: "rgba(29,29,31,.08)"
			},
			layout: {
				sidebarWidth: 280,
				gutter: 16,
				padMainX: 16,
				msgRightInset: 16.5,
				bubbleBotMaxWidth: 640
			},
			radius: {
				bubbleUser: 18,
				bubbleBot: 18,
				taskCard: 12,
				composer: 22,
				noticeCard: 12
			},
			size: {
				avatarRow: 44,
				rowHeight: 72,
				sendBtn: 22,
				bubbleMaxWidth: 620
			},
			font: {
				family: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Helvetica Neue\", \"Segoe UI\", sans-serif",
				name: 14,
				preview: 12,
				time: 12,
				body: 15,
				sender: 14,
				meta: 12
			}
		};
		const GKF_CSS = `
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
`;
		//#endregion
		//#region src/client/components.tsx
		function AvatarView(props) {
			const role = resolveGlyph(props.glyph);
			const label = props.name || (role === "chief" ? "幕僚长" : "Bot");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "gk-avatar-mark",
				style: {
					width: props.size,
					height: props.size,
					display: "inline-flex",
					flex: "none",
					position: "relative"
				},
				children: [props.activity && props.size >= 30 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Character, {
					seed: props.seed,
					name: label,
					role,
					size: props.size,
					activity: props.activity,
					quiet: props.quiet,
					specialty: props.specialty
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: `data:image/svg+xml,${encodeURIComponent(identityMark(role, props.name || props.seed))}`,
					"data-avatar-role": role || "custom",
					width: props.size,
					height: props.size,
					alt: label,
					draggable: false,
					style: {
						display: "block",
						width: "100%",
						height: "100%"
					}
				}), props.level && props.level >= 4 && props.size >= 30 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-label": `等级 ${props.level}`,
					style: {
						position: "absolute",
						right: -1,
						bottom: -1,
						borderRadius: 5,
						background: "var(--gk-bg-side, #f7f7f7)",
						color: "#947126",
						fontSize: 12,
						fontWeight: 700,
						padding: "0 2px",
						lineHeight: "13px"
					},
					children: "★"
				}) : null]
			});
		}
		function GroupAvatarView({ members, size, name }) {
			const visible = members.slice(0, members.length > 4 ? 3 : 4);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				role: "img",
				"aria-label": `${name || "群聊"}，${members.length} 位成员`,
				className: "gk-group-avatar",
				style: {
					width: size,
					height: size,
					flex: "none",
					display: "grid",
					gridTemplateColumns: "1fr 1fr",
					gridTemplateRows: members.length === 2 ? "1fr" : "1fr 1fr",
					gap: 1,
					padding: 2,
					boxSizing: "border-box",
					borderRadius: size * .26,
					background: "var(--gk-bg-card, rgba(120,120,128,.08))",
					alignItems: "center",
					justifyItems: "center"
				},
				children: [visible.map((member, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					style: {
						display: "flex",
						...members.length === 3 && i === 2 ? { gridColumn: "1 / -1" } : {}
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
						...member,
						size: (size - 5) / 2
					})
				}, member.seed)), members.length > 4 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					"aria-hidden": "true",
					style: {
						fontSize: Math.max(9, size * .25),
						fontWeight: 650,
						lineHeight: 1,
						color: "var(--gk-text-2, #666)",
						fontVariantNumeric: "tabular-nums"
					},
					children: ["+", members.length - 3]
				}) : null]
			});
		}
		function renderInline(text) {
			let mdKeySeed = 0;
			const parts = [];
			const re = /(\*\*[^*]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/[^\s)]+|\/api\/plugins\/grokbot\/artifacts\/[a-z0-9-]+)\)|https?:\/\/[^\s)]+)/g;
			let last = 0;
			let match;
			while (match = re.exec(text)) {
				if (match.index > last) parts.push(text.slice(last, match.index));
				const token = match[0];
				const key = `i${mdKeySeed++}`;
				if (token.startsWith("**")) parts.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: token.slice(2, -2) }, key));
				else if (token.startsWith("`")) parts.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
					className: "grokbot-md__icode",
					children: token.slice(1, -1)
				}, key));
				else if (token.startsWith("[")) {
					const link = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/api\/plugins\/grokbot\/artifacts\/[a-z0-9-]+)\)/.exec(token);
					if (link) parts.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: link[2],
						target: "_blank",
						rel: "noreferrer",
						className: "grokbot-md__link",
						children: link[1]
					}, key));
					else parts.push(token);
				} else parts.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
					href: token,
					target: "_blank",
					rel: "noreferrer",
					className: "grokbot-md__link",
					children: token.length > 48 ? `${token.slice(0, 45)}…` : token
				}, key));
				last = match.index + token.length;
			}
			if (last < text.length) parts.push(text.slice(last));
			return parts;
		}
		function MarkdownText(props) {
			let mdKeySeed = 0;
			const lines = props.text.split("\n");
			const out = [];
			let list = [];
			const flushList = () => {
				if (list.length === 0) return;
				out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "grokbot-md__ul",
					children: list.map((item, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: renderInline(item) }, i))
				}, `l${mdKeySeed++}`));
				list = [];
			};
			for (const raw of lines) {
				const line = raw.trimEnd();
				const heading = /^(#{1,4})\s+(.*)$/.exec(line);
				const bullet = /^[-*•]\s+(.*)$/.exec(line);
				const ordered = /^(\d+)[.、)]\s+(.*)$/.exec(line);
				const quote = /^>\s?(.*)$/.exec(line);
				if (bullet) {
					list.push(bullet[1]);
					continue;
				}
				if (ordered) {
					list.push(`${ordered[1]}. ${ordered[2]}`);
					continue;
				}
				flushList();
				if (!line.trim()) {
					out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "grokbot-md__spacer" }, `s${mdKeySeed++}`));
					continue;
				}
				if (heading) {
					const level = heading[1].length;
					out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `grokbot-md__h${level}`,
						children: renderInline(heading[2])
					}, `h${mdKeySeed++}`));
				} else if (quote) out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", {
					className: "grokbot-md__quote",
					children: renderInline(quote[1])
				}, `q${mdKeySeed++}`));
				else if (/^---+$/.test(line.trim())) out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { className: "grokbot-md__hr" }, `r${mdKeySeed++}`));
				else out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "grokbot-md__p",
					children: renderInline(line)
				}, `p${mdKeySeed++}`));
			}
			flushList();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: out });
		}
		function CodeBlock(props) {
			const lines = props.code.replace(/\n$/, "").split("\n");
			const long = lines.length > 14;
			const [collapsed, setCollapsed] = (0, react.useState)(long);
			const [copied, setCopied] = (0, react.useState)(false);
			const copy = (0, react.useCallback)(async () => {
				try {
					await navigator.clipboard.writeText(props.code);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {}
			}, [props.code]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-code",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-code__bar",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "grokbot-code__lang",
							children: props.lang || "text"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-code__actions",
							children: [long ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => setCollapsed((v) => !v),
								children: collapsed ? `展开 ${lines.length} 行` : "折叠"
							}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => void copy(),
								children: copied ? "已复制 ✓" : "复制"
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: `grokbot-code__pre${collapsed ? " collapsed" : ""}`,
						children: collapsed ? "" : props.code.replace(/\n$/, "")
					}),
					collapsed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "grokbot-code__peek",
						onClick: () => setCollapsed(false),
						children: [props.code.split("\n").slice(0, 3).join("\n").slice(0, 120), "…"]
					}) : null
				]
			});
		}
		const MarkdownView = (0, react.memo)(function MarkdownView(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: props.text.split(/```/).map((segment, index) => {
				if (index % 2 === 1) {
					const body = segment.replace(/^\n/, "");
					const lang = /^[a-zA-Z0-9_+-]*\n/.exec(body)?.[0]?.trim() || "";
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CodeBlock, {
						code: lang ? body.slice(lang.length) : body,
						lang
					}, `c${index}`);
				}
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownText, { text: segment }, `t${index}`);
			}) });
		});
		function splitChips(text) {
			const match = /\n?\[\[([^\]\n]+)\]\]\s*$/.exec(text);
			if (!match) return {
				body: text,
				chips: []
			};
			return {
				body: text.slice(0, match.index),
				chips: match[1].split("|").map((entry) => entry.trim()).filter(Boolean).slice(0, 6)
			};
		}
		function SidebarRow(props) {
			const size = TOKENS.size.avatarRow;
			const avatar = props.stack && props.stack.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupAvatarView, {
				members: props.stack,
				size,
				name: props.name
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
				seed: props.seed,
				name: props.name,
				glyph: props.glyph,
				size,
				activity: props.activity,
				specialty: props.specialty,
				quiet: true,
				level: props.working ? void 0 : props.level
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				"data-working": !!props.working,
				className: `gkf-row${props.active ? " active" : ""}`,
				onClick: props.onClick,
				children: [
					avatar,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "gkf-row__main",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "gkf-row__line1",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "gkf-row__name",
								children: props.name
							}), props.time ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "gkf-row__time",
								children: props.time
							}) : null]
						}), props.preview ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "gkf-row__preview",
							children: props.preview
						}) : null]
					}),
					props.unread ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "gkf-row__unread" }) : null
				]
			});
		}
		function timeOf(at) {
			if (!at) return "";
			return new Date(at).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit"
			});
		}
		function MessageView(props) {
			const time = timeOf(props.at);
			if (props.role === "user") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "gkf-msg gkf-msg--user",
				children: [time ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "gkf-msg__meta gkf-msg__meta--right",
					children: time
				}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "gkf-msg__bubble",
					children: [props.text.replace(/\[截图\]\(\/api\/plugins\/grokbot\/artifacts\/art-[a-z0-9-]+\)/g, "").trim(), [...props.text.matchAll(/\[截图\]\((\/api\/plugins\/grokbot\/artifacts\/art-[a-z0-9-]+)\)/g)].map((m, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: m[1],
						target: "_blank",
						rel: "noreferrer",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							src: m[1],
							alt: "截图附件",
							style: {
								display: "block",
								maxWidth: "100%",
								maxHeight: 260,
								borderRadius: 10,
								marginTop: 8
							}
						})
					}, i))]
				})]
			});
			if (props.role === "bot") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "gkf-msg gkf-msg--bot",
				children: [
					props.senderName ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "gkf-msg__sender",
						style: {
							display: "inline-flex",
							alignItems: "center",
							gap: 5
						},
						children: [
							props.senderGlyph ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
								seed: props.senderName ?? "bot",
								name: props.senderName,
								glyph: props.senderGlyph,
								size: 15
							}) : null,
							props.senderName,
							time ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontWeight: 400,
									color: TOKENS.color.text3,
									fontSize: TOKENS.font.time,
									marginLeft: 8
								},
								children: time
							}) : null
						]
					}) : time ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "gkf-msg__meta gkf-msg__meta--left",
						children: time
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "gkf-msg__bubble",
						children: props.markdown === false ? props.text : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownView, { text: props.text })
					}),
					props.artifact ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArtifactCard, {
						name: props.artifact.name,
						size: props.artifact.size ?? null,
						mime: props.artifact.mime ?? null,
						actions: [
							...props.artifact.taskId && props.onContinueArtifact ? [{
								label: "继续修改",
								primary: true,
								onClick: () => props.onContinueArtifact(props.artifact)
							}] : [],
							{
								label: "预览",
								onClick: () => window.open(`/api/plugins/grokbot/artifacts/${props.artifact.id}`, "_blank")
							},
							{
								label: "保存副本",
								onClick: () => window.open(`/api/plugins/grokbot/artifacts/${props.artifact.id}?download=1`, "_blank")
							},
							{
								label: "在 Finder 显示工作文件",
								onClick: () => {
									fetch(`/api/plugins/grokbot/artifacts/${props.artifact.id}?action=reveal`, { method: "POST" }).then(async (r) => {
										if (!r.ok) window.alert(`无法显示工作文件：${await r.text().catch(() => r.status)}`);
									}).catch((e) => window.alert(`无法显示工作文件：${String(e)}`));
								}
							}
						]
					}) : null,
					props.children
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: `gkf-msg ${props.role === "activity" ? "gkf-msg--activity" : props.role === "error" ? "gkf-msg--error" : "gkf-msg--notice"}`,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "gkf-msg__card",
					children: props.text
				})
			});
		}
		function Composer(props) {
			const screenshot = useScreenshot(props);
			const text = props.draft.replace(/\n?\[截图\]\(\/api\/plugins\/grokbot\/artifacts\/art-[a-z0-9-]+\)/g, "");
			const shots = [...props.draft.matchAll(/\[截图\]\((\/api\/plugins\/grokbot\/artifacts\/art-[a-z0-9-]+)\)/g)];
			const ref = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const el = ref.current;
				if (!el) return;
				el.style.height = "auto";
				el.style.height = `${Math.min(200, Math.max(56, el.scrollHeight))}px`;
			}, [props.draft]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "gkf-composer",
				onPaste: screenshot.onPaste,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "gkf-composer__pill",
					children: [
						shots.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "gk-capture-preview",
							children: [shots.map((shot, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("figure", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								src: shot[1],
								alt: "待发送截图"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-label": "移除截图",
								onClick: () => props.onDraft(props.draft.replace("\n" + shot[0], "").replace(shot[0], "")),
								children: "移除"
							})] }, i)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "截图将在发送消息时提交" })]
						}) : null,
						screenshot.status,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							ref,
							className: "gkf-composer__input",
							rows: 1,
							value: text,
							"aria-label": props.placeholder ?? "消息内容",
							placeholder: props.placeholder ?? "发消息…",
							onChange: (event) => props.onDraft([event.target.value, ...shots.map((s) => s[0])].filter(Boolean).join("\n")),
							onKeyDown: (event) => {
								if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
									event.preventDefault();
									if (!props.sending && props.draft.trim()) props.onSend();
								}
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "gkf-composer__toolbar",
							children: [
								props.onPlus ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gkf-composer__plus",
									title: props.plusTitle ?? "添加附件",
									"aria-label": props.plusTitle ?? "添加附件",
									onClick: props.onPlus,
									children: "＋"
								}) : null,
								screenshot.control,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "gkf-composer__hint",
									children: props.sending ? "正在回复，可先写下一条消息" : "Shift + Enter 换行"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"aria-label": "发送消息",
									className: "gkf-composer__send",
									disabled: props.sending || !props.draft.trim(),
									title: "发送",
									onClick: props.onSend,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
										width: "20",
										height: "20",
										viewBox: "0 0 24 24",
										fill: "none",
										stroke: "currentColor",
										strokeWidth: "2",
										"aria-hidden": "true",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m6 12 6-6 6 6M12 6v13" })
									})
								})
							]
						})
					]
				})
			});
		}
		const STATUS_LABEL = {
			queued: {
				label: "排队中",
				cls: "gkf-task__badge--info"
			},
			running: {
				label: "处理中",
				cls: "gkf-task__badge--running"
			},
			"waiting-you": {
				label: "等待你",
				cls: "gkf-task__badge--running"
			},
			"confirm-stop": {
				label: "停止确认中",
				cls: "gkf-task__badge--running"
			},
			done: {
				label: "已完成",
				cls: "gkf-task__badge--done"
			},
			failed: {
				label: "失败",
				cls: "gkf-task__badge--failed"
			},
			interrupted: {
				label: "已中断",
				cls: "gkf-task__badge--interrupted"
			}
		};
		function TaskCard(props) {
			const badge = STATUS_LABEL[props.status];
			const dotColor = (state) => state === "done" ? TOKENS.color.dotDone : state === "running" ? TOKENS.color.badgeRunning : state === "failed" ? TOKENS.color.dotFail : TOKENS.color.text3;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "gkf-task",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "gkf-task__head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "gkf-task__icon",
								style: { background: "linear-gradient(135deg,#38bcf8,#2563eb)" },
								children: "▶"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "gkf-task__title",
								children: props.title
							}),
							props.time ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "gkf-task__time",
								children: timeOf(props.time)
							}) : null
						]
					}),
					(props.members ?? []).length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "gkf-task__body",
						children: [(props.members ?? []).map((member) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "gkf-task__member",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "gkf-task__member-dot",
									style: { background: dotColor(member.state) }
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "gkf-task__member-name",
									style: {
										display: "inline-flex",
										alignItems: "center",
										gap: 5
									},
									children: [member.glyph ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
										seed: member.name ?? "bot",
										name: member.name,
										glyph: member.glyph,
										size: 15
									}) : null, member.name]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "gkf-task__member-desc",
									children: member.desc
								})
							]
						}, member.name)), props.executor ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								fontSize: TOKENS.font.time,
								color: TOKENS.color.text3
							},
							children: ["执行机：", props.executor]
						}) : null]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "gkf-task__foot",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: `gkf-task__badge ${badge.cls}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}), badge.label]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "gkf-task__spacer" }),
							(props.actions ?? []).map((action) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `gkf-task__btn${action.primary ? " gkf-task__btn--primary" : ""}`,
								disabled: action.disabled,
								onClick: action.onClick,
								children: action.label
							}, action.label))
						]
					})
				]
			});
		}
		function ArtifactCard(props) {
			const kb = typeof props.size === "number" && props.size > 0 ? `${(props.size / 1024).toFixed(props.size < 10240 ? 1 : 0)} KB` : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "gkf-artifact",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "gkf-artifact__icon",
						children: props.icon ?? "📄"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "gkf-artifact__main",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "gkf-artifact__name",
							children: props.name
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "gkf-artifact__meta",
							children: [kb, props.mime].filter(Boolean).join(" · ") || "成果文件"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "gkf-artifact__actions",
						children: (props.actions ?? []).map((action) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: `gkf-artifact__btn${action.primary ? " gkf-artifact__btn--primary" : ""}`,
							disabled: action.disabled,
							onClick: action.onClick,
							children: action.label
						}, action.label))
					})
				]
			});
		}
		//#endregion
		//#region src/client/archive-library.tsx
		const date = (at) => at ? new Date(at).toLocaleDateString("zh-CN", {
			year: "numeric",
			month: "short",
			day: "numeric"
		}) : "日期未记录";
		const size = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.ceil(n / 1024)} KB` : `${n} B`;
		const fileUrl = (f) => `/api/plugins/grokbot/artifacts/${encodeURIComponent(f.id)}`;
		function Mark({ web = false }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 48 48",
				width: "48",
				height: "48",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				"aria-hidden": "true",
				children: web ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "5",
					y: "8",
					width: "38",
					height: "31",
					rx: "5"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5 17h38M12 13h1m4 0h1M21 24l-5 5 5 5m7-10 5 5-5 5" })] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9 15V11a3 3 0 013-3h9l5 5h10a3 3 0 013 3v3M8 18h32a3 3 0 013 4l-4 15a3 3 0 01-3 2H12a3 3 0 01-3-2L5 22a3 3 0 013-4Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M17 29h14" })] })
			});
		}
		function FileRow({ file }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "gka-file",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "gka-file-info",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: file.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							size(file.size),
							" · ",
							date(file.createdAt)
						] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: fileUrl(file),
						target: "_blank",
						rel: "noreferrer",
						children: file.mime.startsWith("text/html") ? "打开作品 ↗" : "查看文件 ↗"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: `${fileUrl(file)}?download=1`,
						"aria-label": `保存 ${file.name}`,
						children: "保存"
					})
				]
			});
		}
		function FileOutput({ file: f }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "gka-output",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileRow, { file: f }), (f.versions?.length || 0) > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
					"查看 ",
					f.versions.length - 1,
					" 个早期版本"
				] }), f.versions.slice(1).map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileRow, { file: v }, v.id))] }) : null]
			}, f.id);
		}
		function ArchiveComputer({ api, onConversation }) {
			const [data, setData] = (0, react.useState)(null), [error, setError] = (0, react.useState)(""), [loading, setLoading] = (0, react.useState)(false), [tab, setTab] = (0, react.useState)("archive"), [query, setQuery] = (0, react.useState)(""), [selected, setSelected] = (0, react.useState)(null), [revealing, setRevealing] = (0, react.useState)(false);
			const [revision, setRevision] = (0, react.useState)(0);
			const [reports, setReports] = (0, react.useState)([]), [retroError, setRetroError] = (0, react.useState)(""), [retroLoading, setRetroLoading] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (tab !== "retro") return;
				let alive = true;
				setRetroLoading(true);
				setRetroError("");
				api("/retrospectives").then((d) => {
					if (alive) setReports((d.reports || []).slice().reverse());
				}).catch((e) => {
					if (alive) setRetroError(e.message || "无法读取复盘");
				}).finally(() => {
					if (alive) setRetroLoading(false);
				});
				return () => {
					alive = false;
				};
			}, [
				api,
				tab,
				revision
			]);
			(0, react.useEffect)(() => {
				let alive = true;
				setLoading(true);
				api("/workspace").then((d) => {
					if (alive) {
						setData(d);
						setError("");
					}
				}).catch((e) => {
					if (alive) setError(e.message || "暂时无法读取工作成果");
				}).finally(() => {
					if (alive) setLoading(false);
				});
				return () => {
					alive = false;
				};
			}, [api, revision]);
			const projects = data?.archive?.projects || [], project = projects.find((p) => p.id === selected);
			const list = projects.filter((p) => `${p.name} ${p.summary} ${p.members.map((m) => m.name).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
				className: "gka",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: CSS }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "gka-wrap",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "gka-header",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "gka-eyebrow",
									children: "COMPUTER"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: "工作成果" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "把做过的项目，留在这里。" })
							] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "gka-secondary",
								disabled: revealing || !data,
								onClick: () => {
									setRevealing(true);
									api("/workspace/reveal", { method: "POST" }).catch((e) => setError(e.message)).finally(() => setRevealing(false));
								},
								children: revealing ? "正在打开…" : "打开工作区 ↗"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
							className: "gka-toolbar",
							"aria-label": "成果分类",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "gka-tabs",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										"aria-pressed": tab === "archive",
										onClick: () => {
											setTab("archive");
											setSelected(null);
										},
										children: ["归档项目 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: projects.length })]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										"aria-pressed": tab === "recent",
										onClick: () => {
											setTab("recent");
											setSelected(null);
										},
										children: "最近成果"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										"aria-pressed": tab === "retro",
										onClick: () => {
											setTab("retro");
											setSelected(null);
										},
										children: "复盘档案"
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "gka-refresh",
								disabled: loading,
								onClick: () => setRevision((v) => v + 1),
								children: loading ? "刷新中…" : "刷新"
							})]
						}),
						error ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "gka-notice",
							role: "alert",
							children: [error, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => setRevision((v) => v + 1),
								children: "重试"
							})]
						}) : null,
						data?.archive?.warnings.map((w) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "gka-notice",
							children: w
						}, w)),
						!data && loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "gka-empty",
							role: "status",
							children: "正在整理项目与成果…"
						}) : null,
						tab === "retro" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "gka-listhead",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "回看角色表现、开发经验，以及经过验证的改进。" })
						}), retroError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							className: "gka-notice",
							children: retroError
						}) : retroLoading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "status",
							children: "正在读取复盘…"
						}) : reports.length ? reports.map((r) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "gka-output",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "gka-file",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "gka-file-info",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: r.projectName }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											date(r.createdAt),
											" · ",
											r.phase
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: r.summary.slice(0, 180) })
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									href: r.url,
									target: "_blank",
									rel: "noreferrer",
									children: "查看复盘 ↗"
								})]
							})
						}, r.id)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "gka-empty",
							children: "还没有项目复盘。对幕僚长说「复盘这个项目」，这里会留下团队的成长记录。"
						})] }) : null,
						data && tab === "archive" && !project ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "gka-listhead",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "按项目回看交付，也能回到当时的对话。" }), projects.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "gka-search",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "gka-sr",
									children: "搜索归档项目"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "search",
									"aria-label": "搜索归档项目",
									placeholder: "搜索项目或成员",
									value: query,
									onChange: (e) => setQuery(e.target.value)
								})]
							}) : null]
						}), list.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "gka-grid",
							children: list.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: "gka-card",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									className: "gka-cover",
									onClick: () => setSelected(p.id),
									"aria-label": `查看归档项目 ${p.name}`,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Mark, { web: p.artifacts[0]?.mime.startsWith("text/html") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: p.artifacts.some((a) => a.mime.startsWith("text/html")) ? "可交互作品" : "项目档案" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "gka-archived",
											children: "已归档"
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "gka-cardbody",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "gka-carddate",
											children: date(p.archivedAt)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											onClick: () => setSelected(p.id),
											children: p.name
										}) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "gka-summary",
											children: p.summary || "当时的交付与协作记录已保留。"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "gka-meta",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupAvatarView, {
													name: p.name,
													members: p.members.map((m) => ({
														seed: m.id,
														name: m.name,
														glyph: m.roleTemplate || m.avatar
													})),
													size: 28
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [p.artifacts.length, " 份成果"] }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: p.total && p.accepted === p.total ? "阶段验收已齐" : "保留未验收事项" })
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											className: "gka-primary",
											onClick: () => setSelected(p.id),
											children: ["查看项目 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												"aria-hidden": "true",
												children: "→"
											})]
										}), p.artifacts[0]?.mime.startsWith("text/html") ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
											href: fileUrl(p.artifacts[0]),
											target: "_blank",
											rel: "noreferrer",
											children: "打开作品 ↗"
										}) : null] })
									]
								})]
							}, p.id))
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "gka-empty",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Mark, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: query ? "没有匹配的项目" : "项目归档后，会出现在这里" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: query ? "试试项目名称或成员名字。" : "与幕僚长对话完成归档后，可以在这里回看成果和过程。" }),
								query ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									onClick: () => setQuery(""),
									children: "清除搜索"
								}) : null
							]
						})] }) : null,
						tab === "archive" && project ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "gka-detail",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "gka-back",
									onClick: () => setSelected(null),
									children: "← 全部归档项目"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "gka-detailhead",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "gka-carddate",
										children: ["归档于 ", date(project.archivedAt)]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: project.name })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "gka-secondary",
										onClick: () => onConversation(project.id),
										children: "查看原会话 ↗"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "gka-detail-summary",
									children: project.summary || "未记录归档摘要。"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "gka-detail-layout",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", { children: ["交付成果 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: project.artifacts.length })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "gka-hint",
											children: "归档前保存的成果快照；同一文件优先显示最近版本。"
										}),
										project.artifacts.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [project.artifacts.slice(0, 8).map((f) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileOutput, { file: f }, f.id)), project.artifacts.length > 8 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
											className: "gka-more",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
												"展开其余 ",
												project.artifacts.length - 8,
												" 份文件"
											] }), project.artifacts.slice(8).map((f) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileOutput, { file: f }, f.id))]
										}) : null] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "gka-empty-small",
											children: "没有关联的交付快照，可在原会话查看交付记录。"
										})
									] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "归档时的阶段" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											className: "gka-hint",
											children: [project.total ? `${project.accepted} / ${project.total} 阶段有有效验收记录` : "未记录阶段计划", "。归档不代表验收完成。"]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
											className: "gka-steps",
											children: project.steps.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: s.accepted ? "gka-status gka-accepted" : "gka-status",
													children: s.accepted ? "已验收" : "未确认验收"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: s.title }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: s.owner })
											] }, s.id))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											className: "gka-continue",
											children: [
												"想继续这个项目？",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
												"把需求告诉幕僚长，由他安排后续工作。"
											]
										})
									] })]
								})
							]
						}) : null,
						data && tab === "recent" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "gka-recent",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "gka-hint",
								children: "团队最近保存的 12 份成果快照。"
							}), data.artifacts.length ? data.artifacts.map((f) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileRow, { file: f }, f.id)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "gka-empty",
								children: "还没有交付成果。"
							})]
						}) : null,
						data?.computer.vncUrl ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
							className: "gka-remote",
							href: data.computer.vncUrl,
							target: "_blank",
							rel: "noreferrer",
							children: "打开远程桌面 ↗"
						}) : null
					]
				})]
			});
		}
		const CSS = `
.gka{height:100%;overflow:auto;box-sizing:border-box;background:var(--gk-bg,#fff);color:var(--gk-text,#202024);container-type:inline-size}.gka *{box-sizing:border-box}.gka-wrap{max-width:1120px;margin:auto;padding:36px 38px 64px}.gka button,.gka input{font:inherit;color:inherit}.gka button,.gka a{touch-action:manipulation}.gka button{cursor:pointer}.gka button:disabled{cursor:default;opacity:.5}.gka a{color:inherit;text-decoration:none}.gka button:focus-visible,.gka a:focus-visible,.gka input:focus-visible,.gka summary:focus-visible{outline:2px solid var(--gk-text);outline-offset:4px}.gka-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:32px}.gka-eyebrow{font-size:var(--gk-font-meta);letter-spacing:.18em;font-weight:600;color:var(--gk-text-2,#686870);margin-bottom:12px}.gka h1{font-size:var(--gk-font-display);letter-spacing:-1px;margin:0 0 9px;font-weight:650}.gka-header p,.gka-listhead p{margin:0;font-size:var(--gk-font-label);color:var(--gk-text-2,#686870);line-height:1.7}.gka-secondary{border:1px solid var(--gk-line,#e6e6e8);border-radius:10px;min-height:42px;padding:8px 14px;background:transparent;font-size:var(--gk-font-meta)!important;white-space:nowrap}.gka-toolbar{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--gk-line,#e6e6e8);margin-bottom:22px}.gka-tabs{display:flex;gap:25px}.gka-tabs button{border:0;border-bottom:2px solid transparent;min-height:46px;padding:0 0 12px;background:none;font-size:var(--gk-font-label);color:var(--gk-text-2,#686870)}.gka-tabs button[aria-pressed=true]{border-bottom-color:var(--gk-text,#202024);color:var(--gk-text,#202024);font-weight:600}.gka-tabs span{font-size:var(--gk-font-meta);margin-left:6px;background:var(--gk-bg-soft,#f2f2f4);border-radius:5px;padding:2px 6px}.gka-refresh,.gka-back{border:0;background:none;min-height:40px;font-size:var(--gk-font-meta)!important;color:var(--gk-text-2,#686870)!important}.gka-listhead{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.gka-search input{width:210px;max-width:100%;border:1px solid var(--gk-line,#e6e6e8);border-radius:9px;background:transparent;padding:10px 12px;font-size:var(--gk-font-meta);min-height:40px}.gka-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px}.gka-card{border:1px solid var(--gk-line,#e6e6e8);border-radius:16px;overflow:hidden;background:var(--gk-bg,#fff);transition:box-shadow .18s,border-color .18s}.gka-card:hover{border-color:#bdbdc3;box-shadow:0 7px 24px #00000008}.gka-cover{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;width:100%;height:154px;border:0;border-bottom:1px solid var(--gk-line,#e6e6e8);background:linear-gradient(135deg,var(--gk-bg-soft,#f6f6f7),var(--gk-bg,#fff));color:var(--gk-text-2,#686870)!important}.gka-cover>span:not(.gka-archived){font-size:var(--gk-font-meta);letter-spacing:.07em}.gka-archived{position:absolute;top:14px;right:14px;font-size:var(--gk-font-meta);padding:4px 8px;border:1px solid var(--gk-line,#e6e6e8);border-radius:99px;background:var(--gk-bg,#fff)}.gka-cardbody{padding:21px}.gka-carddate{font-size:var(--gk-font-meta);color:var(--gk-text-2,#686870);margin-bottom:8px}.gka-card h2{font-size:var(--gk-font-title);line-height:1.5;margin:0 0 10px}.gka-card h2 button{padding:0;text-align:left;background:none;border:0;font-weight:600;line-height:inherit}.gka-summary{font-size:var(--gk-font-meta);color:var(--gk-text-2,#686870);line-height:1.8;margin:0 0 18px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:65px}.gka-meta{display:flex;align-items:center;gap:9px;font-size:var(--gk-font-meta);color:var(--gk-text-2,#686870);flex-wrap:wrap}.gka-meta>span:last-child{margin-left:auto}.gka-card footer{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--gk-line,#e6e6e8);margin-top:18px;padding-top:14px;font-size:var(--gk-font-meta)}.gka-primary{display:flex;align-items:center;gap:24px;border:0;background:none;font-size:var(--gk-font-meta)!important;font-weight:600!important;padding:8px 0;min-height:36px}.gka-card footer a{padding:8px 0}.gka-empty{text-align:center;padding:65px 20px;color:var(--gk-text-2,#686870);font-size:var(--gk-font-label)}.gka-empty svg{margin-bottom:16px}.gka-empty h2{font-size:var(--gk-font-title);color:var(--gk-text,#202024);font-weight:500}.gka-empty p{line-height:1.7}.gka-empty button,.gka-notice button{border:0;background:none;text-decoration:underline;padding:12px}.gka-detailhead{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:20px}.gka-detailhead h2{font-size:var(--gk-font-display);line-height:1.4;letter-spacing:-.5px;margin:0}.gka-detail-summary{font-size:var(--gk-font-label);line-height:1.9;white-space:pre-wrap;margin:20px 0 30px;color:var(--gk-text-2,#686870)}.gka-detail-layout{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(230px,1fr);gap:36px}.gka h3{font-size:var(--gk-font-label);font-weight:600;margin:0 0 10px}.gka h3>span{font-size:var(--gk-font-meta);margin-left:6px;color:var(--gk-text-2,#686870)}.gka-hint{font-size:var(--gk-font-meta);color:var(--gk-text-2,#686870);line-height:1.8;margin:0 0 14px}.gka-file{display:flex;align-items:center;gap:13px;min-height:72px;padding:14px 0;border-bottom:1px solid var(--gk-line,#e6e6e8);font-size:var(--gk-font-meta)}.gka-file-info{flex:1;min-width:0}.gka-file strong{display:block;font-size:var(--gk-font-meta);overflow-wrap:anywhere;font-weight:500;margin-bottom:6px}.gka-file-info>span{font-size:var(--gk-font-meta);color:var(--gk-text-2,#686870)}.gka-file>a{white-space:nowrap;min-height:36px;align-content:center}.gka-file>a:last-child{color:var(--gk-text-2,#686870)}.gka-output details{font-size:var(--gk-font-meta);margin:7px 0 14px;color:var(--gk-text-2,#686870)}.gka-output summary{cursor:pointer;min-height:32px;align-content:center}.gka-output details .gka-file{padding-left:12px}.gka-steps{padding:0;margin:0;list-style:none}.gka-steps li{border-bottom:1px solid var(--gk-line,#e6e6e8);padding:13px 0;display:flex;flex-direction:column;gap:7px}.gka-steps strong{font-size:var(--gk-font-meta);font-weight:400;line-height:1.7}.gka-steps li>span:last-child{font-size:var(--gk-font-meta);color:var(--gk-text-2,#686870)}.gka-status{font-size:var(--gk-font-meta);color:var(--gk-text-2,#686870)}.gka-accepted{color:#387451}.gka-continue{font-size:var(--gk-font-meta);line-height:1.9;color:var(--gk-text-2,#686870);background:var(--gk-bg-soft,#f5f5f6);border-radius:12px;padding:16px;margin-top:22px}.gka-more{font-size:var(--gk-font-meta);margin-top:16px}.gka-more>summary{cursor:pointer;min-height:44px;align-content:center}.gka-empty-small,.gka-notice{padding:16px;border:1px solid var(--gk-line,#e6e6e8);border-radius:10px;font-size:var(--gk-font-meta);line-height:1.7}.gka-remote{display:block;font-size:var(--gk-font-meta);margin-top:32px}.gka-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
@container(max-width:680px){.gka-wrap{padding:25px 20px 45px}.gka-detail-layout{grid-template-columns:1fr;gap:28px}.gka-listhead{align-items:flex-start;flex-direction:column}.gka-search,.gka-search input{width:100%}.gka-grid{grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}.gka-header{align-items:flex-start}.gka-header h1{font-size:var(--gk-font-display)}.gka-detailhead{align-items:flex-start;flex-direction:column}}
@media(prefers-reduced-motion:reduce){.gka-card{transition:none}}
`;
		//#endregion
		//#region src/client/model-library.tsx
		const same = (a, b) => !!a && !!b && a.provider === b.provider && a.model === b.model;
		const chip = {
			border: "1px solid var(--gk-border, #ddd)",
			borderRadius: 9,
			padding: "7px 11px",
			font: "inherit",
			fontSize: 14,
			cursor: "pointer"
		};
		function ModelLibrary({ api, defaultEditor, onDefaultChange }) {
			const [presets, setPresets] = (0, react.useState)([]), [bots, setBots] = (0, react.useState)([]), [providers, setProviders] = (0, react.useState)([]);
			const [team, setTeam] = (0, react.useState)(null), [loading, setLoading] = (0, react.useState)(true), [busy, setBusy] = (0, react.useState)(false), [error, setError] = (0, react.useState)(""), [notice, setNotice] = (0, react.useState)("");
			const [editorOpen, setEditorOpen] = (0, react.useState)(false), [scope, setScope] = (0, react.useState)("library");
			const [name, setName] = (0, react.useState)(""), [provider, setProvider] = (0, react.useState)(""), [model, setModel] = (0, react.useState)(""), [editing, setEditing] = (0, react.useState)(null);
			const load = async () => {
				setLoading(true);
				setError("");
				try {
					const [c, p] = await Promise.all([api("/crew"), api("/model-catalog")]);
					setPresets(c.crew?.modelPresets || []);
					setBots(c.crew?.bots || []);
					setTeam(c.crew?.defaultModel || null);
					setProviders(p.catalog || []);
				} catch (e) {
					setError(e.message);
				} finally {
					setLoading(false);
				}
			};
			(0, react.useEffect)(() => {
				load();
			}, []);
			const perform = async (action, where = "library") => {
				setScope(where);
				setBusy(true);
				setError("");
				setNotice("");
				try {
					await action();
				} catch (e) {
					setError(e.message);
				} finally {
					setBusy(false);
				}
			};
			const reset = () => {
				setEditing(null);
				setName("");
				setModel("");
			};
			const save = () => perform(async () => {
				const item = {
					name: name.trim() || model.trim(),
					provider,
					model: model.trim()
				};
				const next = editing === null ? [...presets, item] : presets.map((p, i) => i === editing ? item : p);
				const result = await api("/crew", {
					method: "PATCH",
					body: JSON.stringify({ modelPresets: next })
				});
				setPresets(result.crew.modelPresets);
				reset();
				setEditorOpen(false);
				setNotice("常用模型已保存，可以在下方分配。");
			});
			const remove = (index) => perform(async () => {
				const result = await api("/crew", {
					method: "PATCH",
					body: JSON.stringify({ modelPresets: presets.filter((_, i) => i !== index) })
				});
				setPresets(result.crew.modelPresets);
				reset();
				setNotice("已移除快捷选项，现有 Bot 的模型设置保留。");
			});
			const assign = (bot, value) => perform(async () => {
				const result = await api(`/bots/${encodeURIComponent(bot.id)}`, {
					method: "PATCH",
					body: JSON.stringify({ model: value })
				});
				setBots((list) => list.map((b) => b.id === bot.id ? {
					...b,
					model: result.bot.model
				} : b));
				setNotice("已保存，下次执行生效");
			}, bot.id);
			const chooseDefault = (value) => perform(async () => {
				const result = await api("/crew", {
					method: "PATCH",
					body: JSON.stringify({ defaultModel: value })
				});
				setTeam(result.crew.defaultModel);
				onDefaultChange(result.crew.defaultModel);
				setNotice("默认模型已保存");
			}, "team");
			const choice = (label, selected, click, key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				disabled: busy,
				"aria-pressed": selected,
				onClick: click,
				className: "gkm-choice",
				style: {
					...chip,
					background: selected ? "var(--gk-text, #222)" : "transparent",
					color: selected ? "var(--gk-bg, #fff)" : "inherit",
					opacity: busy ? .6 : 1
				},
				children: label
			}, key);
			const feedback = (id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "gkm-feedback",
				"aria-live": "polite",
				children: scope === id ? busy ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "正在保存…" }) : error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					role: "alert",
					className: "gkm-error",
					children: error
				}) : notice ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					role: "status",
					children: notice
				}) : null : null
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "gkm",
				style: { maxWidth: 1040 },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: `
      .gkm{container-type:inline-size;color:var(--gk-text,#222)}
      .gkm button:focus-visible,.gkm input:focus-visible,.gkm select:focus-visible{outline:2px solid var(--gk-text,#222);outline-offset:3px}
      .gkm button{min-height:36px;transition:background .15s,opacity .15s}
      .gkm button:not(:disabled):hover{filter:brightness(.94)}
      .gkm button:disabled{cursor:default;opacity:.5}
      .gkm h3{font-size:var(--gk-font-body);margin:0}
      .gkm-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
      .gkm-sub{font-size:var(--gk-font-label);color:var(--gk-text-2,#666);margin:6px 0 0;line-height:1.5}
      .gkm-feedback{font-size:var(--gk-font-meta);min-height:18px;color:var(--gk-text-2,#666);line-height:18px}
      .gkm-error{color:var(--gk-red,#b42318)}
      .gkm .grokbot-form{box-shadow:none;border:0;background:var(--gk-bg-side,#f7f7f7);padding:16px;border-radius:10px}
      .gkm .grokbot-form label{display:flex;flex-direction:column;align-items:stretch;gap:7px;font-size:var(--gk-font-meta);min-width:0}
      .gkm input,.gkm select{width:100%;min-height:38px;box-sizing:border-box}
      .gkm-assignment{display:grid;grid-template-columns:minmax(150px,200px) minmax(0,1fr);gap:16px;align-items:center;padding:12px 0;border-top:1px solid var(--gk-border,#ddd)}
      .gkm-person{display:flex;align-items:center;gap:10px;min-width:0}
      .gkm-person strong{font-size:var(--gk-font-label)}
      .gkm-current{font-size:var(--gk-font-meta);color:var(--gk-text-2,#666);margin-top:4px;overflow-wrap:anywhere}
      .gkm-options{display:flex;flex-wrap:wrap;gap:8px}
      .gkm-selected-label{font-size:var(--gk-font-meta);margin-left:6px;color:var(--gk-text-2,#666)}
      @container(max-width:580px){.gkm-assignment{grid-template-columns:1fr;gap:10px}.gkm-head{align-items:flex-start}.gkm-options button{min-height:44px}}
      @media(prefers-reduced-motion:reduce){.gkm button{transition:none}}
    ` }),
					error && loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "alert",
						children: [
							error,
							" ",
							loading ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy,
								onClick: () => void load(),
								children: "重新加载"
							})
						]
					}) : null,
					loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "正在加载模型配置…" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						"aria-label": "常用模型配置",
						style: {
							border: "1px solid var(--gk-border, #ddd)",
							borderRadius: 14,
							padding: 20,
							marginBottom: 22
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "gkm-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", { children: ["常用模型 ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "gkm-selected-label",
									children: [presets.length, " 个"]
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "gkm-sub",
									children: "配置一次，团队成员直接选用。"
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: chip,
									disabled: busy,
									onClick: () => {
										reset();
										setEditorOpen((v) => !v);
									},
									"aria-expanded": editorOpen || !presets.length,
									children: editorOpen ? "收起表单" : "+ 添加模型"
								})]
							}),
							editorOpen || !presets.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "grokbot-form",
								style: {
									margin: 0,
									maxWidth: "none"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
										gap: 12
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["显示名称", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											"aria-label": "常用模型名称",
											placeholder: "例如：快速响应",
											value: name,
											maxLength: 80,
											disabled: busy,
											onChange: (e) => setName(e.target.value)
										})] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["服务商", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											"aria-label": "常用模型服务商",
											value: provider,
											disabled: busy,
											onChange: (e) => {
												setProvider(e.target.value);
												setModel("");
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: "选择服务商"
												}),
												provider && !providers.some((p) => p.id === provider) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
													value: provider,
													children: [provider, "（当前未连接）"]
												}) : null,
												providers.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: p.id,
													children: p.name
												}, p.id))
											]
										})] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
											"模型 ID",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												"aria-label": "常用模型ID",
												list: "gk-model-suggestions",
												placeholder: "输入或选择模型 ID",
												value: model,
												maxLength: 200,
												disabled: busy,
												onChange: (e) => setModel(e.target.value)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
												id: "gk-model-suggestions",
												children: (providers.find((p) => p.id === provider)?.models || []).map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: m.id,
													children: m.name
												}, m.id))
											})
										] })
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: 8
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "grokbot-form__submit",
										disabled: busy || !provider || !model.trim() || presets.length >= 30 && editing === null,
										onClick: () => void save(),
										children: editing === null ? "添加常用模型" : "保存模型修改"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: busy,
										style: chip,
										onClick: () => {
											reset();
											setEditorOpen(false);
										},
										children: "取消"
									})]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "gkm-sub",
								children: "模型 ID 可直接输入；服务商连接在 DSH 中配置。修改常用项后，已分配的 Bot 保持原选择。"
							})] }) : null,
							feedback("library"),
							!presets.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									fontSize: 14,
									opacity: .65
								},
								children: "还没有常用模型。添加后，下方会出现对应的快捷按钮。"
							}) : presets.map((p, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 12,
									alignItems: "center",
									borderTop: "1px solid var(--gk-border, #ddd)",
									padding: "12px 0",
									flexWrap: "wrap"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											flex: 1,
											minWidth: 150
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: p.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												fontSize: 12,
												opacity: .6,
												overflowWrap: "anywhere"
											},
											children: [
												p.provider,
												" / ",
												p.model
											]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										disabled: busy,
										style: chip,
										onClick: () => {
											setEditorOpen(true);
											setEditing(i);
											setName(p.name);
											setProvider(p.provider);
											setModel(p.model);
										},
										children: "编辑"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										disabled: busy,
										style: chip,
										title: "仅移除快捷选项，保留 Bot 当前配置",
										onClick: () => void remove(i),
										children: "移除"
									})
								]
							}, JSON.stringify([p.provider, p.model])))
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						"aria-label": "Bot模型快捷分配",
						style: {
							border: "1px solid var(--gk-border, #ddd)",
							borderRadius: 14,
							padding: 20
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "gkm-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "模型分配" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "gkm-sub",
									children: "点击即保存，运行中的任务不受影响。"
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "gkm-selected-label",
									children: [
										bots.filter((b) => !b.model).length,
										" / ",
										bots.length,
										" 位跟随默认"
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: { paddingBottom: 14 },
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "gkm-assignment",
									style: {
										borderTop: 0,
										paddingTop: 0
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "团队默认" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "gkm-current",
										children: team ? `${team.provider} / ${team.model}` : "DSH 全局默认"
									})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "gkm-options",
										children: [choice("DSH 全局默认", !team, () => void chooseDefault(null), "host"), presets.map((p) => choice(p.name, same(team, p), () => void chooseDefault({
											provider: p.provider,
											model: p.model
										}), JSON.stringify(p)))]
									}), feedback("team")] })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
									style: { marginTop: 12 },
									onToggle: (e) => {
										if (!e.currentTarget.open) api("/crew").then((c) => setTeam(c.crew.defaultModel || null)).catch(() => {});
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "从服务商列表选择其他默认模型" }), defaultEditor]
								})]
							}),
							bots.map((bot) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "gkm-assignment",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "gkm-person",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
										seed: bot.id,
										name: bot.name,
										glyph: bot.roleTemplate || bot.avatar,
										size: 32
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: bot.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "gkm-current",
										children: bot.model ? `${bot.model.provider} / ${bot.model.model}` : `默认 · ${team?.model || "DSH 全局模型"}`
									})] })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "gkm-options",
									children: [choice("跟随团队默认", !bot.model, () => void assign(bot, null), "default"), presets.map((p) => choice(p.name, same(bot.model, p), () => void assign(bot, {
										provider: p.provider,
										model: p.model
									}), JSON.stringify(p)))]
								}), feedback(bot.id)] })]
							}, bot.id))
						]
					})] })
				]
			});
		}
		//#endregion
		//#region src/client/bot-work.tsx
		let requestedBot = null;
		function focusBotWork(botId) {
			requestedBot = botId;
		}
		const labels$1 = {
			pending: "等待调度",
			running: "正在执行",
			queued: "等待执行",
			replied: "已交付",
			cancelled: "已取消",
			failed: "执行失败",
			interrupted: "执行中断，待核对"
		};
		const when = (at) => at ? new Date(at).toLocaleString() : "尚无记录";
		function age(at, now) {
			if (!at) return "尚未开始";
			const s = Math.max(0, Math.floor((now - at) / 1e3));
			return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分钟`;
		}
		function BotWorkPanel({ botId, botName }) {
			const [snapshot, setSnapshot] = (0, react.useState)(null), [error, setError] = (0, react.useState)(""), [expanded, setExpanded] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setSnapshot(null);
				setExpanded(requestedBot === botId);
				if (requestedBot === botId) requestedBot = null;
			}, [botId]);
			(0, react.useEffect)(() => {
				let stopped = false, timer;
				const controller = new AbortController();
				setError("");
				const poll = async () => {
					try {
						const response = await fetch(`/api/plugins/grokbot/bots/${encodeURIComponent(botId)}/work?detail=${expanded ? "1" : "0"}`, { signal: controller.signal });
						if (!response.ok) throw Error("工作记录暂时无法刷新");
						const next = await response.json();
						if (!stopped) {
							setSnapshot(next);
							setError("");
						}
					} catch (e) {
						if (!stopped) setError(String(e.message));
					}
					if (!stopped) timer = setTimeout(() => {
						if (document.hidden) timer = setTimeout(poll, 1e4);
						else poll();
					}, 5e3);
				};
				poll();
				return () => {
					stopped = true;
					controller.abort();
					clearTimeout(timer);
				};
			}, [botId, expanded]);
			const data = snapshot?.botId === botId ? snapshot : null;
			const active = data?.jobs.filter((j) => j.status === "running" || j.status === "queued") || [];
			const now = data?.observedAt || Date.now();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"aria-label": `${botName}工作详情`,
				className: "gk-work",
				style: {
					padding: "12px 20px",
					borderBottom: "1px solid var(--gk-line)",
					flexShrink: 0,
					maxHeight: expanded ? "65%" : void 0,
					overflowY: "auto"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						onClick: () => setExpanded((v) => !v),
						"aria-expanded": expanded,
						style: {
							width: "100%",
							textAlign: "left",
							background: "transparent",
							color: "inherit",
							border: 0,
							cursor: "pointer"
						},
						children: [
							expanded ? "▾" : "▸",
							" 执行进展 · ",
							active.length ? `${labels$1[active[0].status]} · ${active[0].title}` : data?.live?.status === "working" ? "正在处理会话" : data ? "当前没有执行中的派工任务" : "正在读取实际状态…"
						]
					}),
					active[0] ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						active[0].project ? `${active[0].project} · ` : "",
						"耗时 ",
						age(active[0].startedAt, now),
						" · 最近活动 ",
						when(active[0].lastActivityAt),
						active[0].stale ? " · 采样已过期" : ""
					] }) }) : null,
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "status",
						children: [error, " · 保留上次记录，状态可能已过期"]
					}) : null,
					expanded && data ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
							"更新于 ",
							when(data.observedAt),
							" · ",
							data.recordScope
						] }),
						data.efficiency ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EfficiencyPanel, { data: data.efficiency }) : null,
						data.conversations?.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [c.title, " · 会话执行记录"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExecutionTimeline, { activity: c.activity })] }, c.id)),
						!data.jobs.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "尚无派工记录。会话消息显示在下方。" }) : null,
						data.jobs.map((j, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							open: i === 0,
							style: {
								marginTop: 10,
								borderTop: "1px solid var(--gk-line)",
								paddingTop: 8
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
									labels$1[j.status] || j.status,
									" · ",
									j.project ? `${j.project} / ` : "",
									j.title
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
									"开始：",
									when(j.startedAt),
									" · 耗时：",
									age(j.startedAt, j.endedAt || now),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
									"最近活动：",
									when(j.lastActivityAt),
									" ",
									j.stale ? "（进度采样已过期，等待刷新）" : ""
								] }),
								j.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: j.observation === "awaiting-approval" ? "等待审批" : j.activeTools.length ? `等待工具返回：${j.activeTools.join("、")}` : j.observation === "quiet" ? "暂时没有新的可见活动" : "执行器正在运行" }) : null,
								j.reason ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: j.reason }) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "派工与交付（实际记录）" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
										j.from,
										" → ",
										botName,
										" · ",
										when(j.createdAt)
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										style: {
											whiteSpace: "pre-wrap",
											overflowWrap: "anywhere"
										},
										children: j.request
									}),
									j.reply ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
										botName,
										" → ",
										j.from,
										" · ",
										when(j.endedAt)
									] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										style: {
											whiteSpace: "pre-wrap",
											overflowWrap: "anywhere"
										},
										children: j.reply
									})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "尚无交付回复" })
								] }),
								j.checkpoint ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "工作检查点（Bot 自报，未独立核验）" }),
									[
										"completed",
										"validation",
										"remaining",
										"blockers"
									].map((k, n) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
										[
											"已完成",
											"验证",
											"剩余",
											"阻塞"
										][n],
										"：",
										j.checkpoint[k] || "未报告"
									] }, k)),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										style: { whiteSpace: "pre-wrap" },
										children: j.checkpoint.files.join("\n")
									})
								] }) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExecutionTimeline, { activity: j.activity })
							]
						}, j.id))
					] }) : null
				]
			});
		}
		const metricNumber = (n) => n == null ? "未知" : n.toLocaleString();
		const metricTime = (n) => n == null ? "未知" : n < 1e3 ? `${Math.round(n)} ms` : `${(n / 1e3).toFixed(1)} 秒`;
		function EfficiencyPanel({ data }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"aria-label": "调用效率",
				style: {
					margin: "16px 0",
					padding: 16,
					border: "1px solid var(--gk-line)",
					borderRadius: 12,
					fontSize: 13,
					lineHeight: 1.6
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						style: {
							margin: "0 0 12px",
							fontSize: 14
						},
						children: "调用效率"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
							gap: 12
						},
						children: [
							["已采样步骤", metricNumber(data.observedCalls)],
							["首响应 P50", metricTime(data.firstResponseP50Ms)],
							["首响应 P95", metricTime(data.firstResponseP95Ms)],
							["重试次数", metricNumber(data.retryCount)]
						].map(([label, value]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
							style: {
								fontSize: 18,
								fontVariantNumeric: "tabular-nums"
							},
							children: value
						})] }, label))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [data.scope, " 不用于角色能力排名。"] }),
					!data.calls.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "尚无调用指标。未知数据不会显示为 0。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
						style: {
							cursor: "pointer",
							padding: "8px 0"
						},
						children: "逐次调用 · 上下文、时延与重试"
					}), data.calls.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						style: {
							borderTop: "1px solid var(--gk-line)",
							padding: "8px 0"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
								when(c.startedAt),
								" · ",
								c.model || "模型未知",
								" · 输入 ",
								metricNumber(c.inputReported),
								" · 首响应 ",
								metricTime(c.firstResponseMs)
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								c.provider || "提供方未知",
								" / ",
								c.model || "模型未知",
								" · 回合 ",
								c.turn,
								" / 步骤 ",
								c.step,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"输入已报告合计：",
								metricNumber(c.inputReported),
								" token · 缓存读取：",
								metricNumber(c.usage?.cacheReadTokens),
								" token",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"输出：",
								metricNumber(c.usage?.outputTokens),
								" token · 步骤耗时：",
								metricTime(c.elapsedMs),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"工具：",
								c.toolCount,
								" 次 / ",
								metricTime(c.toolMs),
								" · 重试：",
								c.retryCount,
								" 次",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"采样于 ",
								when(c.observedAt),
								!c.endedAt ? " · 尚未记录结束，时间截至采样点" : ""
							] }),
							c.attempts.map((a, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								"请求尝试 ",
								i + 1,
								" · ",
								a.outcome === "pending" ? "等待中" : a.outcome === "completed" ? "已完成" : a.outcome === "ended" ? "已结束，结果类型未知" : a.outcome,
								" · 首响应 ",
								metricTime(a.firstResponseMs),
								" · 耗时 ",
								metricTime(a.elapsedMs)
							] }, i))
						]
					}, `${c.sessionId}:${c.turn}:${c.step}`))] })
				]
			});
		}
		function ExecutionTimeline({ activity }) {
			const rows = activity.filter((a) => a.kind !== "result" || !activity.some((c) => c.kind === "call" && c.callId && c.callId === a.callId));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "gk-execution",
				"aria-label": "执行过程",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "执行过程" }), !rows.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "尚无已保存的执行事件。旧任务不会补造记录。" }) : rows.map((a, i) => {
					const result = a.kind === "call" ? activity.find((r) => r.kind === "result" && r.callId === a.callId) : null;
					if (a.kind === "progress") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "gk-execution__progress",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", { children: when(a.at) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: a.text })]
					}, a.id + ":" + i);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "gk-execution__tool",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: a.name || "工具结果" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "gk-execution__state",
									children: (result || a).failed ? "执行出错" : result ? "已返回" : a.kind === "call" ? "等待结果" : "已返回"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", { children: when(a.at) })
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "输入" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: a.text || "未保存输入" }),
							result ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "输出" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: result.text || "工具未返回文本" })] }) : null
						]
					}, a.id + ":" + i);
				})]
			});
		}
		//#endregion
		//#region src/client/message-identity.ts
		/** Explicit transport identity only; identical text can be two intentional messages. */
		function uniqueMessages(messages) {
			const seen = /* @__PURE__ */ new Set();
			return messages.filter((message) => {
				const key = message.messageId || (message.requestId ? `${message.requestId}:${message.role}` : null);
				if (!key) return true;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		}
		//#endregion
		//#region src/approval-data.mjs
		function decodeToolArguments(value) {
			for (let i = 0; i < 3 && typeof value === "string"; i++) try {
				value = JSON.parse(value);
			} catch {
				return null;
			}
			return value && typeof value === "object" && !Array.isArray(value) ? value : null;
		}
		//#endregion
		//#region src/client/approval-view.tsx
		function ApprovalView({ approval: a, onDecision }) {
			const [remember, setRemember] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false), [error, setError] = (0, react.useState)(""), [settled, setSettled] = (0, react.useState)(false);
			const raw = decodeToolArguments(a.details), args = {
				...raw,
				...a.arguments
			};
			const reason = String(args.justification || a.reason || a.reviewReason || "").replace(/^escalate sandbox to [\w-]+:\s*/, "");
			const path = String(args.file_path || args.path || "");
			const action = {
				edit: "修改文件",
				write: "写入文件",
				read: "读取文件",
				bash: "执行命令"
			}[a.toolName] || a.toolName || "执行操作";
			const decide = async (reject = false) => {
				if (busy || settled) return;
				setBusy(true);
				setError("");
				try {
					await onDecision(reject ? "rejected" : "allowed-once", !reject && remember);
					setSettled(true);
				} catch (e) {
					setError(String(e.message));
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "gk-approval",
				"aria-label": `${a.botName || a.botId}的审批请求`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "gk-approval__icon",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
								width: "22",
								height: "22",
								viewBox: "0 0 24 24",
								fill: "none",
								stroke: "currentColor",
								strokeWidth: "1.5",
								"aria-hidden": "true",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 8v5m0 3v1" })]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: a.stage === "chief" ? "幕僚长正在代审" : "需要你审批" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
							a.botName || a.botId,
							" 申请",
							action
						] })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "gk-approval__badge",
							children: settled ? "已处理" : a.stage === "chief" ? "审核中" : "等待决定"
						})
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "gk-approval__body",
						children: [
							path ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "gk-approval__target",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "目标文件" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: path })]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "gk-approval__reason",
								children: reason
							}),
							a.reviewReason && a.reviewReason !== reason ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "gk-approval__review",
								children: ["幕僚长：", a.reviewReason]
							}) : null,
							typeof args.command === "string" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								className: "gk-approval__code",
								children: args.command
							}) : null,
							typeof args.old_string === "string" || typeof args.new_string === "string" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: "gk-approval__change",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "查看修改内容" }),
									typeof args.old_string === "string" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "修改前" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: args.old_string })] }) : null,
									typeof args.new_string === "string" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "修改后" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: args.new_string })] }) : null
								]
							}) : null,
							a.details ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: "gk-approval__raw",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "原始参数" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: raw ? JSON.stringify(raw, null, 2) : a.details })]
							}) : null
						]
					}),
					a.stage !== "chief" && !settled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "gk-approval__scope",
							children: remember ? "仅复用下方范围内的相同操作，命令或权限变化会重新询问。" : "只允许当前这一项操作，不改变工作区默认权限。"
						}),
						a.ruleCandidate ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "gk-approval__remember",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: remember,
								onChange: (e) => setRemember(e.target.checked)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "24 小时内记住此操作" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
								a.botName || a.botId,
								" · ",
								a.ruleCandidate.workspace,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"相同完整命令及权限范围（",
								a.ruleCandidate.mode,
								"）；可在主页「授权规则」撤销。"
							] })] })]
						}) : null,
						error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							className: "gk-approval__error",
							children: error
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "gk-approval__actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => void decide(true),
								disabled: busy,
								children: "拒绝"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "primary",
								onClick: () => void decide(),
								disabled: busy,
								children: busy ? "正在处理…" : remember ? "允许并记住" : "允许一次"
							})]
						})
					] }) : null
				]
			});
		}
		const APPROVAL_CSS = `
.gk-approval{box-sizing:border-box;width:100%;max-width:680px;border:1px solid var(--gk-line);border-radius:16px;background:var(--gk-bg);color:var(--gk-text);overflow:hidden;box-shadow:0 2px 8px #00000005;font-size:var(--gk-font-label);line-height:1.6;flex-shrink:0}
.gk-approval header{display:flex;gap:12px;align-items:center;padding:18px 20px;border-bottom:1px solid var(--gk-line)}.gk-approval header strong{font-size:var(--gk-font-body)}.gk-approval header p{margin:2px 0 0;color:#62626b;font-size:var(--gk-font-meta)}.gk-approval__icon{display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:11px;background:var(--gk-bg-soft);flex:none}.gk-approval__badge{margin-left:auto;border-radius:99px;background:#fff4dc;color:#805800;padding:3px 9px;white-space:nowrap;font-size:var(--gk-font-meta)}
.gk-approval__body{padding:18px 20px}.gk-approval__target{display:flex;flex-direction:column;gap:6px}.gk-approval__target>span,.gk-approval__change>div>span{font-size:var(--gk-font-meta);font-weight:600;color:#62626b}.gk-approval code,.gk-approval pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:var(--gk-font-meta);white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.gk-approval__target code{display:block;background:var(--gk-bg-soft);border-radius:8px;padding:10px 12px}.gk-approval__reason{white-space:pre-wrap;overflow-wrap:anywhere;margin:14px 0 10px}.gk-approval__review{color:#62626b;font-size:var(--gk-font-meta);margin:8px 0}.gk-approval details{margin-top:8px;border-top:1px solid var(--gk-line);padding-top:8px}.gk-approval summary{cursor:pointer;min-height:32px;display:list-item;align-content:center;font-size:var(--gk-font-meta)}.gk-approval pre{max-height:260px;overflow:auto;padding:12px;border-radius:8px;background:var(--gk-bg-soft);margin:6px 0 12px}.gk-approval__change>div{margin-top:10px}.gk-approval footer{padding:16px 20px;border-top:1px solid var(--gk-line);background:var(--gk-bg-side)}.gk-approval fieldset{margin:0;padding:0;border:0;display:flex;gap:8px;min-width:0}.gk-approval legend{font-size:var(--gk-font-meta);color:#62626b;margin-bottom:8px}.gk-approval label{display:flex;align-items:flex-start;gap:8px;flex:1;border:1px solid var(--gk-line);border-radius:10px;padding:10px;cursor:pointer;background:var(--gk-bg);min-width:0}.gk-approval label.selected{border-color:var(--gk-text)}.gk-approval label input{margin:4px 0 0;accent-color:var(--gk-text)}.gk-approval label strong{display:block;font-size:var(--gk-font-meta)}.gk-approval label small{display:block;color:#62626b;font-size:var(--gk-font-meta)}.gk-approval__scope{font-size:var(--gk-font-meta);color:#62626b;line-height:1.6;margin:12px 0}.gk-approval__actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.gk-approval button,.gk-access-banner button,.gk-access-settings button{font:inherit;min-height:40px;padding:8px 16px;border:1px solid var(--gk-line);border-radius:9px;background:var(--gk-bg);color:var(--gk-text);cursor:pointer}.gk-approval button.primary{background:var(--gk-text);color:var(--gk-bg);border-color:var(--gk-text)}.gk-approval button:disabled{opacity:.5;cursor:wait}.gk-approval button:hover{filter:brightness(.93)}.gk-approval :focus-visible{outline:2px solid var(--gk-accent);outline-offset:3px}.gk-approval__error{color:#a32929;white-space:pre-wrap}.gk-access-banner{padding:8px 20px;border-bottom:1px solid var(--gk-line);display:flex;align-items:center;justify-content:space-between;font-size:var(--gk-font-meta)}.gk-access-banner button{min-height:32px;padding:4px 10px}.gk-access-settings{max-width:620px;margin-top:28px;border-top:1px solid var(--gk-line);padding-top:20px}.gk-access-settings>div{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--gk-line)}.gk-access-settings small{color:#62626b;display:block}.gk-approval-entry{margin:6px 10px;padding:10px 12px;border:1px solid var(--gk-line);border-radius:10px;background:var(--gk-bg);color:var(--gk-text);text-align:left;font:inherit;font-size:var(--gk-font-meta);cursor:pointer}.gkf-msg__card{white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:600px){.gk-approval header,.gk-approval__body,.gk-approval footer{padding:14px}.gk-approval fieldset{flex-direction:column}}
`;
		//#endregion
		//#region src/client/project-board.tsx
		const labels = {
			rework_required: "待返工",
			reworking: "返工中",
			rework_failed: "返工执行失败",
			awaiting_retest: "待复测",
			retesting: "复测中",
			retest_review: "复测待核验",
			retest_failed: "复测执行失败",
			held: "已停止派工",
			awaiting_acceptance: "交付待验收",
			planned: "待开始",
			blocked: "等待前置任务",
			queued: "排队中",
			running: "进行中",
			review: "幕僚长审核中",
			approval: "需要你审批",
			failed: "执行失败",
			cancelled: "已取消",
			done: "已验收",
			unknown: "待核实"
		};
		function ProjectBoard({ conversationId, bots, load, onApproval, onBot }) {
			const [data, setData] = (0, react.useState)(null), [error, setError] = (0, react.useState)(""), [historyOpen, setHistoryOpen] = (0, react.useState)(false), [collapsed, setCollapsed] = (0, react.useState)(false);
			const storeData = (value) => setData((previous) => previous?.conversationId === value.conversationId && (previous.lifecycle?.revision ?? 0) > (value.lifecycle?.revision ?? 0) ? previous : value);
			(0, react.useEffect)(() => {
				let alive = true, busy = false;
				setData(null);
				setError("");
				setHistoryOpen(false);
				setCollapsed(false);
				const tick = async () => {
					if (busy) return;
					busy = true;
					try {
						const value = await load(conversationId);
						if (!value || value.conversationId !== conversationId || !Array.isArray(value.rows)) throw Error("进度数据尚未就绪");
						if (alive) {
							storeData(value);
							setError("");
						}
					} catch (e) {
						if (alive) setError(String(e.message));
					} finally {
						busy = false;
					}
				};
				tick();
				const timer = setInterval(() => void tick(), 3e3);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [conversationId, load]);
			const current = data?.conversationId === conversationId ? data : null, rows = current?.rows ?? [];
			const tasks = current?.hasPlan ? rows.filter((r) => r.source === "plan") : rows.filter((r) => r.source !== "live");
			const history = current?.hasPlan ? rows.filter((r) => r.source !== "plan") : [];
			const done = tasks.filter((r) => r.source === "plan" && r.status === "done").length;
			const renderRow = (row, index) => {
				const owner = bots.find((b) => b.id === row.botId)?.name || "未指定负责人";
				const deps = row.dependsOn.map((id) => tasks.findIndex((r) => r.id === id) + 1).filter((n) => n > 0);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					"data-status": row.status,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "gk-board__number",
						"aria-hidden": "true",
						children: row.status === "done" ? "✓" : ["running", "review"].includes(row.status) ? "→" : ["failed", "approval"].includes(row.status) ? "!" : "○"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "gk-board__item",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
								title: row.title,
								children: [
									index + 1,
									". ",
									row.title
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "gk-board__meta",
								children: [onBot ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "gk-board__owner",
									onClick: () => onBot(row.botId),
									title: "查看成员执行记录",
									children: [owner, " ↗"]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: owner }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "gk-board__status",
									children: row.status === "done" && row.source !== "plan" ? "执行结束 · 待核实" : row.status === "awaiting_acceptance" ? row.reviewMode === "chief" ? "等待幕僚长核验" : row.reviewMode === "codex" ? "等待 Codex 验收" : "等待审阅决定" : labels[row.status] || "待核实"
								})]
							}),
							deps.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "gk-board__deps",
								children: [
									"前置：第 ",
									deps.join("、"),
									" 项"
								]
							}) : null,
							row.progress ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								{
									"active": "有执行进展",
									"awaiting-tool": "等待工具返回",
									"awaiting-approval": "等待审批",
									"quiet": "暂未观察到新进展"
								}[row.progress.observation] || row.progress.observation,
								" · 已运行 ",
								Math.floor(row.progress.elapsedMs / 6e4),
								" 分钟",
								row.progress.reviewNeeded ? " · 建议检查进展（未自动停止）" : ""
							] }) : null,
							row.rework ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
									"第 ",
									row.rework.cycle,
									" 轮返工",
									row.rework.needsReview ? " · 需要重新分析原因" : ""
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["退回原因：", row.rework.reason] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["修复负责人：", bots.find((b) => b.id === (row.rework?.ownerBotId || row.botId))?.name || "待核实"] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["复测要求：", row.rework.criteria] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["复测负责人：", bots.find((b) => b.id === row.rework?.testerBotId)?.name || "待核实"] })
							] }) : null,
							row.checkpoint ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "工作检查点（待核实）" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["已完成：", row.checkpoint.completed || "未记录"] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["验证：", row.checkpoint.validation || "未记录"] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["剩余：", row.checkpoint.remaining || "未记录剩余事项，仍需验收"] }),
								row.checkpoint.blockers ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["阻塞：", row.checkpoint.blockers] }) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: row.checkpoint.files.join("\n") })
							] }) : null,
							row.reason ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: row.status === "failed" ? "失败原因" : "状态说明" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: row.reason })] }) : null,
							row.status === "approval" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "gk-board__approval",
								onClick: onApproval,
								children: "去幕僚长审批"
							}) : null
						]
					})]
				}, `${row.source}:${row.id}`);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: "gk-board",
				"data-collapsed": collapsed,
				"aria-label": "群聊任务列表",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "任务" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "gk-board__count",
					children: current ? `${done} / ${tasks.length}` : "加载中"
				})] }), !collapsed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "alert",
						className: "gk-board__error",
						children: [
							"更新失败：",
							error,
							current ? "。当前显示上次记录。" : ""
						]
					}) : null,
					!current && !error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "gk-board__note",
						children: "正在读取任务…"
					}) : null,
					current ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "gk-board__note",
							children: [done, " 项已验收，成员交付与执行结束不自动计入"]
						}),
						current.lifecycle ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							"aria-label": "项目生命周期",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["项目状态：", {
									active: "进行中",
									paused: "已暂停",
									blocked: "阻塞",
									completed: "已完成",
									cancelled: "已取消",
									archived: "已归档"
								}[current.lifecycle.status]] }),
								current.lifecycle.summary ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "状态记录" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: current.lifecycle.summary })] }) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "gk-board__note",
									children: "由幕僚长管理；需要审阅时会在对话中告诉你。暂停、继续或归档，直接告诉幕僚长。"
								})
							]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
							className: "gk-board__tasks",
							children: tasks.map(renderRow)
						}),
						!tasks.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "gk-board__note",
							children: "尚未登记任务，请幕僚长安排计划。"
						}) : null,
						history.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "gk-board__history",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								"aria-expanded": historyOpen,
								onClick: () => setHistoryOpen((v) => !v),
								children: [
									historyOpen ? "收起" : "查看",
									"其他执行记录（",
									history.length,
									"）"
								]
							}), historyOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
								className: "gk-board__tasks",
								children: history.map(renderRow)
							}) : null]
						}) : null
					] }) : null
				] }) : null]
			});
		}
		const BOARD_CSS = `
.grokbot-group-shell{display:flex;flex:1;min-width:0;min-height:0;height:100%;container-type:inline-size;font-family:var(--gk-font);color:var(--gk-text)}
.grokbot-group-shell>.grokbot-chat{flex:1;min-width:0}
.gk-board{box-sizing:border-box;width:300px;flex:none;overflow:auto;padding:20px 18px;border-left:1px solid var(--gk-line);background:var(--gk-bg-side);font-size:var(--gk-font-label);line-height:1.5;scrollbar-width:thin}
.gk-board header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.gk-board h2{font-size:var(--gk-font-body);font-weight:650;margin:0}.gk-board__count{font-size:var(--gk-font-meta);color:var(--gk-text-2);font-variant-numeric:tabular-nums}.gk-board progress{display:block;width:100%;height:4px;accent-color:var(--gk-text)}.gk-board__note{font-size:var(--gk-font-meta);color:var(--gk-text-2);margin:8px 0 12px}
.gk-board__tasks{list-style:none;margin:0;padding:0}.gk-board__tasks>li{display:flex;gap:10px;padding:14px 0;border-bottom:1px solid var(--gk-line)}.gk-board__number{font-variant-numeric:tabular-nums;min-width:19px;color:var(--gk-text-2);padding-top:1px}.gk-board__item{flex:1;min-width:0}.gk-board h3{font-size:var(--gk-font-label);font-weight:550;margin:0 0 7px;overflow-wrap:anywhere;line-height:1.55}.gk-board__meta{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 10px;font-size:var(--gk-font-meta);color:var(--gk-text-2)}.gk-board__status{font-size:var(--gk-font-meta)}.gk-board [data-status=running] .gk-board__status{color:#2256aa;font-weight:600}.gk-board [data-status=failed] .gk-board__status,.gk-board [data-status=approval] .gk-board__status,.gk-board__error{color:#a32929}.gk-board [data-status=done] .gk-board__status{color:#276c41}.gk-board__deps{display:block;margin-top:4px;color:var(--gk-text-2);font-size:var(--gk-font-meta)}.gk-board details{font-size:var(--gk-font-meta);margin-top:6px;overflow-wrap:anywhere}.gk-board summary{cursor:pointer;min-height:26px;align-content:center}.gk-board details p{white-space:pre-wrap}
.gk-board textarea,.gk-board select{box-sizing:border-box;width:100%;font:inherit;color:var(--gk-text);background:var(--gk-bg);border:1px solid var(--gk-line);border-radius:6px;margin:4px 0;padding:6px}.gk-board textarea{min-height:58px;resize:vertical}.gk-board button:disabled{opacity:.5;cursor:default}
.gk-board button{font:inherit;cursor:pointer;border:1px solid var(--gk-line);border-radius:8px;background:var(--gk-bg);color:var(--gk-text);min-height:34px;padding:6px 10px}.gk-board button:hover{background:var(--gk-bg-soft)}.gk-board button:focus-visible,.gk-board summary:focus-visible{outline:2px solid var(--gk-accent);outline-offset:2px}.gk-board__approval{margin-top:8px}.gk-board__history{margin-top:18px}.gk-board__history>button{border:none;padding:4px 0;background:none;font-size:var(--gk-font-meta);color:var(--gk-text-2);text-align:left}
.gk-board-toggle{font:inherit;font-size:var(--gk-font-meta);border:1px solid var(--gk-line);border-radius:8px;background:var(--gk-bg);color:var(--gk-text);padding:8px;cursor:pointer;flex:none}
@container(max-width:760px){.grokbot-group-shell>.gk-board{width:270px}.grokbot-group-shell:has(>.gk-board)>.grokbot-chat .grokbot-chat__meta{display:none}}
@container(max-width:600px){.grokbot-group-shell{position:relative}.grokbot-group-shell>.gk-board{position:absolute;right:0;top:64px;bottom:0;width:min(300px,100%);z-index:20;box-shadow:var(--gk-shadow-md)}}
.grokbot-group-shell{position:relative}
.grokbot-group-shell:has(>.gk-board)>.grokbot-chat{margin-right:332px}
.grokbot-group-shell>.gk-board{position:absolute;right:16px;top:76px;bottom:auto;width:300px;max-height:calc(100% - 96px);padding:14px 16px;border:1px solid var(--gk-line);border-radius:16px;background:var(--gk-bg);box-shadow:0 2px 5px #00000012,0 8px 24px #00000005;z-index:10}
.gk-board header{justify-content:flex-start;gap:12px;margin:0}.gk-board h2{font-size:var(--gk-font-label);font-weight:500;color:var(--gk-text-2)}.gk-board__count{font-size:var(--gk-font-meta)}.gk-board button.gk-board__collapse{margin-left:auto;border:0;min-height:24px;width:24px;padding:0;font-size:var(--gk-font-title);background:none;color:var(--gk-text-2)}
.gk-board__note{font-size:var(--gk-font-meta);margin:8px 0;color:var(--gk-text-2)}.gk-board__tasks>li{border:0;padding:9px 0;gap:8px}.gk-board__number{font-size:var(--gk-font-body);min-width:16px;padding-top:0}.gk-board h3{font-size:var(--gk-font-meta);font-weight:400;line-height:1.55;margin:0 0 3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.gk-board__meta{font-size:var(--gk-font-meta);gap:4px 8px}.gk-board__status{font-size:var(--gk-font-meta)}.gk-board__deps{display:none}.gk-board [data-status=done] h3{color:var(--gk-text-2)}.gk-board [data-status=running] .gk-board__number{color:var(--gk-text)}.gk-board [data-status=done] .gk-board__number{color:#276c41}.gk-board__history{margin-top:8px;border-top:1px solid var(--gk-line);padding-top:6px}
.grokbot-group-shell:has(>.gk-board[data-collapsed=true])>.grokbot-chat{margin-right:0}.grokbot-group-shell>.gk-board[data-collapsed=true]{width:170px;padding:10px 14px;border-radius:99px}
@container(max-width:900px){.grokbot-group-shell:has(>.gk-board)>.grokbot-chat{margin-right:0}.grokbot-group-shell>.gk-board{width:min(300px,calc(100% - 24px));right:12px;top:72px;max-height:calc(100% - 92px)}}
`;
		const store = /* @__PURE__ */ new Map();
		/** 每会话已结算（成功清除/失败写入）的最高序号——旧回调不能低于此水印写槽 */
		const settledWatermark = /* @__PURE__ */ new Map();
		function setPendingRetry(retry) {
			const existing = store.get(retry.conversationId);
			if (existing && (existing.seq ?? 0) > (retry.seq ?? 0)) return;
			const wm = settledWatermark.get(retry.conversationId) ?? 0;
			if ((retry.seq ?? 0) < wm) return;
			const record = existing && existing.requestId === retry.requestId ? {
				...retry,
				createdAt: existing.createdAt
			} : retry;
			store.set(retry.conversationId, record);
			settledWatermark.set(retry.conversationId, Math.max(wm, retry.seq ?? 0));
		}
		/** 新发送前声明该会话的下一个请求序号（send 递增后写 store），旧回调只能写 ≤ 自己序号的槽 */
		let nextSeq = 1;
		function allocateSeq() {
			return nextSeq++;
		}
		function clearPendingRetry(conversationId, seq) {
			if (seq === void 0) {
				store.delete(conversationId);
				return;
			}
			const wm = settledWatermark.get(conversationId) ?? 0;
			settledWatermark.set(conversationId, Math.max(wm, seq));
			const existing = store.get(conversationId);
			if (existing && (existing.seq ?? 0) <= seq) store.delete(conversationId);
		}
		function getPendingRetry(conversationId) {
			return store.get(conversationId) ?? null;
		}
		/** 重试仅作用于原会话：当前会话与记录不一致时不发送（防 URL 取到新会话） */
		function retryMatches(retry, conversationId) {
			return Boolean(retry) && retry.conversationId === conversationId;
		}
		/**
		* 风险分级（仅文案，不是安全承诺）：30s 内高把握命中去重（失败缓存最短边界）；
		* 30s~5min 中风险；超 5min 低把握（且服务端重启会清空，任何时候重启都不保证）。
		* 首次失败时间不因重复失败刷新（同 requestId 重复失败保留原 createdAt，见 setPendingRetry）。
		*/
		function retryRiskLevel(retry, now = Date.now()) {
			const age = now - retry.createdAt;
			if (age < 3e4) return "high";
			if (age < 3e5) return "medium";
			return "low";
		}
		//#endregion
		//#region src/client/draft-store.ts
		const drafts = /* @__PURE__ */ new Map();
		function saveDraft(conversationId, entry) {
			if (!conversationId) return;
			drafts.set(conversationId, entry);
		}
		function loadDraft(conversationId) {
			return drafts.get(conversationId ?? "") ?? {
				draft: "",
				draftTask: null
			};
		}
		//#endregion
		//#region src/client/chat-scroll.ts
		function useChatScroll(revision, conversationId) {
			const ref = (0, react.useRef)(null);
			const schedule = (0, react.useRef)(() => {});
			const following = (0, react.useRef)(true);
			const resumeIntent = (0, react.useRef)(false);
			const [paused, setPaused] = (0, react.useState)(false);
			const jumpToLatest = (0, react.useCallback)(() => {
				following.current = true;
				resumeIntent.current = false;
				setPaused(false);
				const node = ref.current;
				if (node) node.scrollTop = node.scrollHeight;
			}, []);
			(0, react.useLayoutEffect)(() => {
				jumpToLatest();
			}, [conversationId, jumpToLatest]);
			(0, react.useLayoutEffect)(() => {
				const node = ref.current;
				if (!node) return;
				let frame = 0;
				let lastTop = node.scrollTop;
				let touchY = 0;
				const pause = () => {
					following.current = false;
					resumeIntent.current = false;
					setPaused(true);
					cancelAnimationFrame(frame);
					frame = 0;
				};
				const onScroll = () => {
					const top = node.scrollTop;
					if (Math.abs(top - lastTop) < 1) return;
					if (top < lastTop) pause();
					else if (resumeIntent.current && node.scrollHeight - node.clientHeight - top <= 4) {
						following.current = true;
						setPaused(false);
					}
					lastTop = top;
				};
				const onWheel = (event) => {
					if (event.deltaY < 0) pause();
					else if (event.deltaY > 0) resumeIntent.current = true;
				};
				const onTouchStart = (event) => {
					touchY = event.touches[0]?.clientY ?? 0;
				};
				const onTouchMove = (event) => {
					const y = event.touches[0]?.clientY ?? touchY;
					if (y > touchY) pause();
					else if (y < touchY) resumeIntent.current = true;
					touchY = y;
				};
				const onKeyDown = (event) => {
					if ([
						"ArrowUp",
						"PageUp",
						"Home"
					].includes(event.key)) pause();
					else if ([
						"ArrowDown",
						"PageDown",
						"End",
						" "
					].includes(event.key)) resumeIntent.current = true;
				};
				const onPointerDown = () => {
					resumeIntent.current = true;
				};
				const scroll = () => {
					if (!following.current) return;
					if (frame) return;
					frame = requestAnimationFrame(() => {
						frame = 0;
						if (!following.current) return;
						node.scrollTop = node.scrollHeight;
						lastTop = node.scrollTop;
					});
				};
				schedule.current = scroll;
				node.addEventListener("pointerdown", onPointerDown, { passive: true });
				node.addEventListener("scroll", onScroll, { passive: true });
				node.addEventListener("wheel", onWheel, { passive: true });
				node.addEventListener("touchstart", onTouchStart, { passive: true });
				node.addEventListener("touchmove", onTouchMove, { passive: true });
				node.addEventListener("keydown", onKeyDown);
				scroll();
				const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scroll);
				observer?.observe(node);
				const observed = /* @__PURE__ */ new Set();
				const observeChildren = () => {
					for (const child of observed) if (child.parentElement !== node) {
						observer?.unobserve(child);
						observed.delete(child);
					}
					for (const child of node.children) if (!observed.has(child)) {
						observer?.observe(child);
						observed.add(child);
					}
				};
				observeChildren();
				const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
					observeChildren();
					scroll();
				});
				mutations?.observe(node, {
					childList: true,
					subtree: true,
					characterData: true
				});
				return () => {
					schedule.current = () => {};
					cancelAnimationFrame(frame);
					observer?.disconnect();
					mutations?.disconnect();
					node.removeEventListener("pointerdown", onPointerDown);
					node.removeEventListener("scroll", onScroll);
					node.removeEventListener("wheel", onWheel);
					node.removeEventListener("touchstart", onTouchStart);
					node.removeEventListener("touchmove", onTouchMove);
					node.removeEventListener("keydown", onKeyDown);
				};
			}, [conversationId]);
			(0, react.useLayoutEffect)(() => {
				schedule.current();
			}, [revision]);
			return {
				ref,
				paused,
				jumpToLatest
			};
		}
		//#endregion
		//#region src/client/index.tsx
		const API_ROOT = "/api/plugins/grokbot";
		const POLL_MS = 2e3;
		const GROKBOT_CSS = BOARD_CSS + APPROVAL_CSS + `
:root {
  --gk-bg-side: #f7f7f7;
  --gk-bg: #fcfcfc;
  --gk-bg-soft: #f2f2f7;
  --gk-text: #1d1d1f;
  --gk-text-2: rgba(29,29,31,.55);
  --gk-text-3: rgba(29,29,31,.35);
  --gk-line: rgba(29,29,31,.08);
  --gk-accent: #2563eb;
  --gk-accent-2: #3b82f6;
  --gk-accent-soft: rgba(37,99,235,.10);
  --gk-green: #22c55e;
  --gk-amber: #f59e0b;
  --gk-red: #ef4444;
  --gk-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", "Segoe UI", sans-serif;
  --gk-shadow-sm: 0 1px 3px rgba(29,29,31,.06), 0 1px 2px rgba(29,29,31,.04);
  --gk-shadow-md: 0 6px 24px rgba(29,29,31,.10);
}
.grokbot-sidebar, .grokbot-chat, .grokbot-wizard { font-family: var(--gk-font); color: var(--gk-text); }
.grokbot-sidebar { display:flex; flex-direction:column; min-height:0; flex:1; background:var(--gk-bg-side); }
.grokbot-sidebar__top { display:flex; align-items:center; justify-content:flex-end; gap:2px; padding:16px 12px 6px; }
.grokbot-iconbtn { border:none; background:none; cursor:pointer; color:var(--gk-text-2); font-size:var(--gk-font-body); width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; transition:all .16s cubic-bezier(.4,0,.2,1); }
.grokbot-iconbtn:hover { color:var(--gk-text); background:rgba(29,29,31,.07); }
.grokbot-sidebar__search { margin:4px 12px 10px; }
.grokbot-sidebar__search input { width:100%; box-sizing:border-box; border:none; border-radius:9px; background:rgba(29,29,31,.06); padding:7px 12px; font:inherit; font-size:var(--gk-font-label); color:var(--gk-text); outline:none; transition:all .16s; }
.grokbot-sidebar__search input:focus { background:#fff; box-shadow:0 0 0 3px var(--gk-accent-soft); }
.grokbot-sidebar__search input::placeholder { color:var(--gk-text-3); }
.grokbot-sidebar__list { flex:1; overflow-y:auto; padding:0 8px 8px; scrollbar-width:thin; }
.grokbot-sidebar__list::-webkit-scrollbar { width:4px; }
.grokbot-sidebar__list::-webkit-scrollbar-thumb { background:rgba(29,29,31,.15); border-radius:4px; }
.grokbot-sidebar__section { font-size:var(--gk-font-meta); font-weight:600; color:var(--gk-text-3); margin:12px 8px 4px; letter-spacing:.06em; text-transform:uppercase; }
.grokbot-chatrow { display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; border:none; border-radius:11px; background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit; position:relative; transition:background .14s; }
.grokbot-chatrow:hover { background:rgba(29,29,31,.05); }
.grokbot-chatrow.active { background:var(--gk-accent-soft); }
.grokbot-chatrow.active::before { content:""; position:absolute; left:-2px; top:22%; bottom:22%; width:3px; border-radius:3px; background:linear-gradient(180deg,var(--gk-accent-2),var(--gk-accent)); }
.grokbot-avatar { position:relative; flex:none; }
.grokbot-avatar__circle { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:var(--gk-font-body); color:#fff; box-shadow:inset 0 -1px 2px rgba(0,0,0,.12), var(--gk-shadow-sm); }
.grokbot-avatar__dot { position:absolute; right:-1px; bottom:-1px; width:11px; height:11px; border-radius:50%; background:var(--gk-green); border:2.5px solid var(--gk-bg-side); box-sizing:content-box; }
.grokbot-avatar__dot.working { background:var(--gk-amber); animation:grokbot-pulse 1.3s ease-in-out infinite; }
.grokbot-chatrow__main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.grokbot-chatrow__line1 { display:flex; align-items:baseline; gap:6px; }
.grokbot-chatrow__name { font-size:var(--gk-font-label); font-weight:600; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chatrow__time { margin-left:auto; font-size:var(--gk-font-meta); color:var(--gk-text-3); flex:none; font-variant-numeric:tabular-nums; }
.grokbot-chatrow__preview { font-size:var(--gk-font-meta); color:var(--gk-text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-sidebar__computer { display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px; border:none; border-radius:9px; background:transparent; cursor:pointer; font:inherit; font-size:var(--gk-font-label); color:var(--gk-text); transition:background .12s; }
.grokbot-sidebar__computer:hover { background:rgba(29,29,31,.06); }
.grokbot-sidebar__computer-status { width:8px; height:8px; border-radius:50%; background:var(--gk-green); }
.grokbot-sidebar__foot { border-top:1px solid var(--gk-line); padding:10px 14px; display:flex; align-items:center; gap:8px; }
.gk-ico { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; font-size:var(--gk-font-body); line-height:1; flex:none; }
.gk-lbl { flex:1; text-align:left; }
.gk-foot-ico { width:34px; height:34px; padding:0; display:inline-flex; align-items:center; justify-content:center; }
/* 窄窗 rail 模式：宿主折叠侧栏列（~79px）时只保留头像/图标列 */
.grokbot-sidebar.gk-rail { overflow:hidden; }
.gk-rail .grokbot-sidebar__search, .gk-rail .grokbot-sidebar__section, .gk-rail .gkf-row__main,
.gk-rail .grokbot-newmenu, .gk-rail .grokbot-form, .gk-rail .grokbot-sidebar__user, .gk-rail .grokbot-avatar__dot { display:none !important; }
.gk-rail .grokbot-sidebar__top { justify-content:center; padding:14px 4px 8px; }
.gk-rail .grokbot-sidebar__list { padding:0 4px 8px; }
.gk-rail .gkf-row { justify-content:center; padding:10px 2px; min-height:52px; }
.gk-rail .grokbot-sidebar__foot { flex-direction:column; padding:8px 0; gap:10px; }
.gk-rail .grokbot-sidebar__computer { width:auto; padding:4px; justify-content:center; }
.gk-rail .gk-lbl, .gk-rail .grokbot-sidebar__computer-status { display:none !important; }
.gk-rail .grokbot-routinemenu { display:none !important; }
.gk-rail .grokbot-sidebar__computer { padding:6px; font-size:0; }
.gk-rail .grokbot-sidebar__computer-status { display:none; }
.grokbot-sidebar__user { display:flex; align-items:center; gap:8px; flex:1; min-width:0; font-size:var(--gk-font-label); font-weight:600; color:var(--gk-text-2); }
.grokbot-sidebar__user .uavatar { width:26px; height:26px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; display:flex; align-items:center; justify-content:center; font-size:var(--gk-font-meta); font-weight:700; }
@keyframes grokbot-pulse { 0%,100% { opacity:1; transform:scale(1) } 50% { opacity:.4; transform:scale(.85) } }
.grokbot-newmenu { display:flex; flex-direction:column; gap:2px; margin:0 10px 10px; padding:6px; border:1px solid var(--gk-line); border-radius:13px; background:#fff; box-shadow:var(--gk-shadow-md); }
.grokbot-newmenu__item { display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; border:none; border-radius:9px; background:transparent; cursor:pointer; font:inherit; font-size:var(--gk-font-label); color:var(--gk-text); text-align:left; transition:background .12s; }
.grokbot-newmenu__item:hover { background:var(--gk-bg-soft); }
.grokbot-newmenu__item:disabled { opacity:.5; }
.grokbot-newmenu__icon { width:24px; height:24px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; font-size:var(--gk-font-label); flex:none; background:var(--gk-bg-soft); }
.grokbot-newmenu__divider { height:1px; background:var(--gk-line); margin:4px 6px; }
.grokbot-form { display:flex; flex-direction:column; gap:8px; padding:12px; margin:0 10px 8px; border:1px solid var(--gk-line); border-radius:13px; background:#fff; box-shadow:var(--gk-shadow-sm); }
.grokbot-form__row { display:flex; gap:6px; }
.grokbot-form input, .grokbot-form textarea, .grokbot-form select { flex:1; min-width:0; border:1px solid var(--gk-line); border-radius:9px; padding:7px 10px; font:inherit; font-size:var(--gk-font-label); background:var(--gk-bg); color:var(--gk-text); transition:border-color .14s, box-shadow .14s; }
.grokbot-form input:focus, .grokbot-form textarea:focus, .grokbot-form select:focus { outline:none; border-color:var(--gk-accent-2); box-shadow:0 0 0 3px var(--gk-accent-soft); }
.grokbot-form textarea { resize:vertical; min-height:52px; }
.grokbot-form__actions { display:flex; gap:8px; justify-content:flex-end; }
.grokbot-form__actions button { border:none; border-radius:9px; padding:6px 16px; font-size:var(--gk-font-label); cursor:pointer; font-weight:600; transition:all .14s; }
.grokbot-form__submit { background:linear-gradient(135deg,var(--gk-accent-2),var(--gk-accent)); color:#fff; box-shadow:0 2px 8px rgba(37,99,235,.28); }
.grokbot-form__submit:hover { filter:brightness(1.06); box-shadow:0 4px 12px rgba(37,99,235,.36); }
.grokbot-form__submit:disabled { opacity:.5; box-shadow:none; }
.grokbot-form__cancel { background:var(--gk-bg-soft); color:var(--gk-text); }
.grokbot-form__cancel:hover { background:rgba(29,29,31,.10); }
.grokbot-chat { width:100%; height:100%; min-height:0; overflow:hidden; display:flex; flex-direction:column; background:var(--gk-bg); }
.grokbot-chat__head { display:flex; align-items:center; gap:11px; padding:13px 20px; border-bottom:1px solid var(--gk-line); background:rgba(255,255,255,.85); backdrop-filter:blur(12px); }
.grokbot-chat__avatar { width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:var(--gk-font-title); color:#fff; box-shadow:inset 0 -1px 2px rgba(0,0,0,.12), var(--gk-shadow-sm); }
.grokbot-chat__title { flex:1; display:flex; flex-direction:column; min-width:0; cursor:pointer; }
.grokbot-chat__name { font-weight:650; font-size:var(--gk-font-body); letter-spacing:-.015em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chat__meta { font-size:var(--gk-font-meta); color:var(--gk-text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px; }
.grokbot-chat__stop { border:1px solid rgba(239,68,68,.35); background:rgba(239,68,68,.08); color:var(--gk-red); border-radius:9px; padding:5px 14px; font-size:var(--gk-font-meta); cursor:pointer; font-weight:600; transition:all .14s; }
.grokbot-chat__stop:hover { background:rgba(239,68,68,.16); }
.grokbot-chat__close { border:none; background:none; cursor:pointer; color:var(--gk-text-2); font-size:var(--gk-font-body); width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; transition:all .14s; }
.grokbot-chat__close:hover { color:var(--gk-text); background:rgba(29,29,31,.07); }
.grokbot-body { position:relative; flex:1; display:flex; min-height:0; }
.grokbot-log { flex:1; min-width:0; min-height:0; overflow-y:auto; padding:26px 20px; display:flex; flex-direction:column; gap:13px; scrollbar-width:thin; }
.grokbot-jump-latest { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); z-index:3; border:1px solid var(--gk-line); border-radius:99px; padding:10px 16px; background:var(--gk-bg); color:var(--gk-text); box-shadow:0 3px 14px #0002; font:inherit; font-size:var(--gk-font-meta); cursor:pointer; }
.grokbot-log > * { flex-shrink:0; }
.grokbot-log::-webkit-scrollbar { width:5px; }
.grokbot-log::-webkit-scrollbar-thumb { background:rgba(29,29,31,.15); border-radius:5px; }
.grokbot-msg { max-width:72%; }
.grokbot-msg.approval { align-self:flex-start; border:1px solid rgba(245,158,11,.4); background:linear-gradient(180deg,#fffbeb,#fff8e6); border-radius:14px; padding:11px 15px; box-shadow:var(--gk-shadow-sm); }
.grokbot-approval__title { font-size:var(--gk-font-label); font-weight:650; margin-bottom:4px; }
.grokbot-approval__reason { font-size:var(--gk-font-label); color:var(--gk-text-2); margin-bottom:10px; white-space:pre-wrap; }
.grokbot-approval__actions { display:flex; gap:8px; }
.grokbot-approval__actions button { border:none; border-radius:9px; padding:6px 18px; font-size:var(--gk-font-label); font-weight:600; cursor:pointer; transition:all .14s; }
.grokbot-approval__ok { background:linear-gradient(135deg,#34d399,#22c55e); color:#fff; box-shadow:0 2px 8px rgba(34,197,94,.3); }
.grokbot-approval__ok:hover { filter:brightness(1.05); }
.grokbot-approval__no { background:var(--gk-bg-soft); color:var(--gk-text); }
.grokbot-empty { margin:auto; text-align:center; color:var(--gk-text-3); font-size:var(--gk-font-label); line-height:1.7; }
.grokbot-details { width:272px; flex:none; border-left:1px solid var(--gk-line); overflow-y:auto; padding:16px 16px 24px; display:flex; flex-direction:column; gap:18px; background:#fafafc; }
.grokbot-rating { border:1px solid var(--gk-line); border-radius:12px; padding:11px 13px; background:#fff; }
.grokbot-rating__head { display:flex; align-items:center; gap:8px; }
.grokbot-rating__level { background:linear-gradient(135deg,var(--gk-accent-2),var(--gk-accent)); color:#fff; font-size:var(--gk-font-meta); font-weight:700; border-radius:7px; padding:2px 8px; }
.grokbot-rating__title { font-size:var(--gk-font-label); font-weight:650; }
.grokbot-rating__stars { margin-left:auto; color:#f5a623; font-size:var(--gk-font-meta); letter-spacing:1px; }
.grokbot-rating__bar { height:6px; border-radius:3px; background:var(--gk-bg-soft); margin:9px 0 6px; overflow:hidden; }
.grokbot-rating__fill { height:100%; border-radius:3px; background:linear-gradient(90deg,var(--gk-accent-2),var(--gk-accent)); transition:width .3s; }
.grokbot-rating__nums { font-size:var(--gk-font-meta); color:var(--gk-text-3); font-variant-numeric:tabular-nums; }
.grokbot-fb { margin-left:8px; white-space:nowrap; }
.grokbot-fb button { border:none; background:none; cursor:pointer; font-size:var(--gk-font-meta); opacity:.4; padding:0 2px; transition:opacity .12s, transform .12s; }
.grokbot-fb button:hover { opacity:1; transform:scale(1.2); }
.grokbot-details__title { font-size:var(--gk-font-meta); font-weight:700; color:var(--gk-text-3); letter-spacing:.07em; text-transform:uppercase; }
.grokbot-member { display:flex; align-items:center; gap:10px; padding:7px 6px; font-size:var(--gk-font-label); font-weight:500; border-radius:9px; }
.grokbot-member:hover { background:rgba(29,29,31,.04); }
.grokbot-member .mavatar { width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:var(--gk-font-label); color:#fff; box-shadow:var(--gk-shadow-sm); }
.grokbot-details__hint { font-size:var(--gk-font-meta); color:var(--gk-text-3); padding:4px 6px 0; line-height:1.5; }
.grokbot-routine { border:1px solid var(--gk-line); border-radius:11px; padding:9px 11px; font-size:var(--gk-font-meta); background:#fff; }
.grokbot-routine__prompt { color:var(--gk-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-routine__sched { font-size:var(--gk-font-meta); color:var(--gk-text-3); margin-top:3px; }
.grokbot-details__new { border:1px dashed rgba(37,99,235,.4); border-radius:11px; background:rgba(37,99,235,.04); color:var(--gk-accent); padding:8px; font-size:var(--gk-font-label); font-weight:600; cursor:pointer; width:100%; transition:all .14s; }
.grokbot-details__new:hover { background:var(--gk-accent-soft); border-color:var(--gk-accent-2); }
.gk-modelbar { display:flex; align-items:center; gap:8px; padding:5px 20px; border-bottom:1px solid var(--gk-line); background:#fafafc; font-family:ui-monospace,"SF Mono",Menlo,monospace; }
.gk-modelbar__label { font-size:var(--gk-font-meta); font-weight:700; color:var(--gk-text-3); letter-spacing:.1em; }
.gk-modelbar__select { border:1px solid var(--gk-line); border-radius:6px; padding:2px 8px; font:inherit; font-size:var(--gk-font-meta); background:#fff; color:var(--gk-text); outline:none; cursor:pointer; max-width:280px; }
.gk-modelbar__select:focus { border-color:var(--gk-accent-2); }
.gk-modelbar__custom { font-size:var(--gk-font-meta); color:var(--gk-accent); font-weight:700; }
.gk-modelbar__default { font-size:var(--gk-font-meta); color:var(--gk-text-3); }
.grokbot-md__p { white-space:pre-wrap; }
.grokbot-md__h1, .grokbot-md__h2, .grokbot-md__h3, .grokbot-md__h4 { font-weight:700; margin:8px 0 3px; letter-spacing:-.01em; }
.grokbot-md__h1 { font-size:var(--gk-font-title); } .grokbot-md__h2 { font-size:var(--gk-font-body); } .grokbot-md__h3 { font-size:var(--gk-font-body); } .grokbot-md__h4 { font-size:var(--gk-font-label); }
.grokbot-md__ul { margin:3px 0; padding-left:19px; }
.grokbot-md__ul li { margin:2px 0; }
.grokbot-md__quote { border-left:3px solid var(--gk-line); margin:5px 0; padding:2px 11px; color:var(--gk-text-2); }
.grokbot-md__hr { border:none; border-top:1px solid var(--gk-line); margin:9px 0; }
.grokbot-md__spacer { height:6px; }
.grokbot-md__icode { background:rgba(29,29,31,.07); border-radius:6px; padding:1.5px 6px; font-size:var(--gk-font-label); font-family:ui-monospace,"SF Mono",Menlo,monospace; }
.grokbot-md__link { color:var(--gk-accent); text-decoration:none; font-weight:500; }
.grokbot-md__link:hover { text-decoration:underline; }
.grokbot-code { align-self:stretch; max-width:100%; border:1px solid var(--gk-line); border-radius:13px; overflow:hidden; margin:5px 0; background:#fafafc; box-shadow:var(--gk-shadow-sm); }
.grokbot-code__bar { display:flex; align-items:center; justify-content:space-between; padding:5px 12px; border-bottom:1px solid var(--gk-line); font-size:var(--gk-font-meta); }
.grokbot-code__lang { color:var(--gk-text-3); text-transform:uppercase; letter-spacing:.07em; font-weight:700; font-family:ui-monospace,Menlo,monospace; }
.grokbot-code__actions { display:flex; gap:8px; }
.grokbot-code__actions button { border:none; background:none; cursor:pointer; font-size:var(--gk-font-meta); color:var(--gk-accent); font-weight:600; padding:2px 4px; }
.grokbot-code__actions button:hover { text-decoration:underline; }
.grokbot-code__pre { margin:0; padding:11px 14px; overflow-x:auto; font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:var(--gk-font-label); line-height:1.55; white-space:pre; color:var(--gk-text); }
.grokbot-code__pre.collapsed { display:none; }
.grokbot-code__peek { border:none; background:none; cursor:pointer; text-align:left; padding:9px 14px; font-family:ui-monospace,Menlo,monospace; font-size:var(--gk-font-meta); color:var(--gk-text-3); width:100%; }
.grokbot-chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:9px; }
.grokbot-chips__item { border:1px solid rgba(37,99,235,.35); background:var(--gk-accent-soft); color:var(--gk-accent); border-radius:16px; padding:5px 16px; font-size:var(--gk-font-label); cursor:pointer; font-weight:600; transition:all .14s; }
.grokbot-chips__item:hover { background:rgba(37,99,235,.18); transform:translateY(-1px); }
.grokbot-chips__item:disabled { opacity:.45; cursor:default; transform:none; }
.grokbot-blank { flex:1; }
.grokbot-home { flex:1; overflow-y:auto; display:flex; flex-direction:column; align-items:center; gap:34px; padding:72px 32px; background:radial-gradient(1200px 500px at 50% 20%, #f8f9fc 0%, var(--gk-bg) 60%); }
.grokbot-home__hero { text-align:center; display:flex; flex-direction:column; align-items:center; gap:10px; }
.grokbot-home__title { font-size:var(--gk-font-display); font-weight:750; letter-spacing:-.02em; }
.grokbot-home__sub { font-size:var(--gk-font-label); color:var(--gk-text-2); }
.grokbot-home__new { margin-top:10px; border:none; border-radius:99px; padding:11px 26px; font:inherit; font-size:var(--gk-font-label); font-weight:650; cursor:pointer; background:#111; color:#fff; transition:transform .14s, filter .14s; }
.grokbot-home__new:hover { transform:translateY(-1px); filter:brightness(1.15); }
.grokbot-home__grid { display:flex; flex-wrap:wrap; gap:14px; justify-content:center; max-width:720px; }
.grokbot-home__card { width:158px; display:flex; flex-direction:column; align-items:center; gap:6px; padding:20px 12px 14px; border:1px solid var(--gk-line); border-radius:16px; background:#fff; cursor:pointer; font:inherit; color:inherit; transition:all .16s cubic-bezier(.4,0,.2,1); box-shadow:var(--gk-shadow-sm); }
.grokbot-home__card:hover { border-color:rgba(29,29,31,.22); transform:translateY(-2px); box-shadow:0 8px 22px rgba(29,29,31,.10); }
.grokbot-home__name { font-size:var(--gk-font-label); font-weight:650; }
.grokbot-home__desc { font-size:var(--gk-font-meta); color:var(--gk-text-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:130px; }
.grokbot-creating { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; font-size:var(--gk-font-label); color:var(--gk-text-2); font-weight:500; }
.grokbot-creating__spinner { width:28px; height:28px; border-radius:50%; border:3px solid var(--gk-accent-soft); border-top-color:var(--gk-accent); animation:grokbot-spin .75s linear infinite; }
@keyframes grokbot-spin { to { transform:rotate(360deg) } }
.grokbot-wizard { flex:1; overflow-y:auto; display:flex; flex-direction:column; align-items:center; gap:22px; padding:52px 32px; font-family:var(--gk-font); color:var(--gk-text); background:radial-gradient(900px 380px at 50% 12%, #f6f8ff 0%, #fff 55%); }
.grokbot-wizard__steps { display:flex; gap:16px; font-size:var(--gk-font-meta); color:var(--gk-text-3); font-weight:600; letter-spacing:.02em; }
.grokbot-wizard__steps .on { color:var(--gk-accent); font-weight:700; }
.grokbot-wizard__steps .ok { color:var(--gk-text-2); }
.grokbot-wizard__steps .ok::after { content:" ✓"; color:var(--gk-green); font-weight:700; }
.grokbot-wizard__title { font-size:var(--gk-font-title); font-weight:750; letter-spacing:-.02em; }
.grokbot-wizard__roles { display:flex; flex-wrap:wrap; gap:13px; justify-content:center; max-width:660px; }
.grokbot-role { width:152px; display:flex; flex-direction:column; align-items:center; gap:7px; padding:20px 10px 15px; border:1px solid var(--gk-line); border-radius:16px; background:#fff; cursor:pointer; font:inherit; color:inherit; transition:all .18s cubic-bezier(.4,0,.2,1); box-shadow:var(--gk-shadow-sm); }
.grokbot-role:hover { border-color:var(--gk-accent-2); transform:translateY(-3px); box-shadow:0 10px 28px rgba(37,99,235,.16); }
.grokbot-role:disabled { opacity:.5; cursor:default; transform:none; }
.grokbot-role__avatar { width:48px; height:48px; border-radius:16px; display:flex; align-items:center; justify-content:center; box-shadow:var(--gk-shadow-sm); }
.grokbot-role__avatar svg { width:58%; height:58%; }
.grokbot-role__name { font-size:var(--gk-font-body); font-weight:700; letter-spacing:-.01em; }
.grokbot-role__desc { font-size:var(--gk-font-meta); color:var(--gk-text-3); }
.grokbot-wizard__names { display:flex; gap:9px; flex-wrap:wrap; justify-content:center; }
.grokbot-wizard__custom { display:flex; gap:8px; width:min(380px,90%); }
.grokbot-wizard__custom input { flex:1; min-width:0; border:1px solid var(--gk-line); border-radius:11px; padding:10px 14px; font:inherit; font-size:var(--gk-font-label); background:#fff; color:var(--gk-text); outline:none; transition:all .16s; }
.grokbot-wizard__custom input:focus { border-color:var(--gk-accent-2); box-shadow:0 0 0 4px var(--gk-accent-soft); }
.grokbot-wizard__skip { border:none; background:none; color:var(--gk-text-3); font-size:var(--gk-font-label); cursor:pointer; padding:4px 10px; transition:color .14s; }
.grokbot-wizard__skip:hover { color:var(--gk-accent); }
.grokbot-wizard__hint { font-size:var(--gk-font-label); color:var(--gk-text-3); }
`;
		let openTarget = null;
		let creatingUi = false;
		let nativeSidebarVisible = false;
		const listeners = /* @__PURE__ */ new Set();
		function notify() {
			for (const listener of listeners) listener();
		}
		function setCreatingUi(value) {
			creatingUi = value;
			notify();
		}
		function persistLastTarget(target) {
			fetch(`${API_ROOT}/ui-state`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(target)
			}).catch(() => void 0);
		}
		function openConversation(conversationId) {
			openTarget = {
				kind: "conversation",
				id: conversationId
			};
			persistLastTarget(openTarget);
			notify();
			refreshState?.();
		}
		function openComputer() {
			openTarget = {
				kind: "computer",
				id: "computer"
			};
			notify();
		}
		function openBot(botId) {
			openConversation(botId);
		}
		function openRoom(roomId) {
			openConversation(roomId);
		}
		function closeTarget() {
			openTarget = null;
			notify();
		}
		function toggleNativeSidebar() {
			nativeSidebarVisible = !nativeSidebarVisible;
			if (typeof document !== "undefined") if (nativeSidebarVisible) document.body.classList.remove("grokbot-takeover");
			else document.body.classList.add("grokbot-takeover");
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
		const pendingMessages = /* @__PURE__ */ new Map();
		const historyListeners = /* @__PURE__ */ new Map();
		function notifyHistory(id) {
			for (const fn of historyListeners.get(id) ?? []) fn();
		}
		const loadedHistoryFor = /* @__PURE__ */ new Set();
		const historyFetchGen = /* @__PURE__ */ new Map();
		function historyOf(botId) {
			let list = histories.get(botId);
			if (!list) {
				list = [];
				histories.set(botId, list);
			}
			return list;
		}
		function appendLocal(botId, message) {
			histories.set(botId, [...historyOf(botId).filter((entry) => entry.id !== message.id), message].slice(-200));
			notifyHistory(botId);
		}
		let refreshState = null;
		const feedbacked = /* @__PURE__ */ new Set();
		async function sendFeedback(botId, messageId, good) {
			if (feedbacked.has(messageId)) return;
			feedbacked.add(messageId);
			try {
				await api(`/bots/${encodeURIComponent(botId)}/feedback`, {
					method: "POST",
					body: JSON.stringify(good ? { good: true } : { bad: true })
				});
				refreshState?.();
			} catch {
				feedbacked.delete(messageId);
			}
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
		let lastKnownState = null;
		function useGrokbotState() {
			const [state, setState] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let alive = true, inFlight = false;
				const tick = () => {
					if (inFlight) return;
					inFlight = true;
					api("/state").then((next) => {
						if (alive) {
							const s = next;
							setState(s);
							lastKnownState = s;
						}
					}).catch(() => {
						if (alive) {
							setState((previous) => previous ? {
								...previous,
								stale: true
							} : null);
							if (lastKnownState) lastKnownState = {
								...lastKnownState,
								stale: true
							};
						}
					}).finally(() => {
						inFlight = false;
					});
				};
				tick();
				refreshState = tick;
				const timer = setInterval(tick, POLL_MS);
				return () => {
					alive = false;
					refreshState = null;
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
		function ModelSettingsView({ accessSupported = false } = {}) {
			const [providers, setProviders] = (0, react.useState)([]);
			const [provider, setProvider] = (0, react.useState)("");
			const [model, setModel] = (0, react.useState)("");
			const [loading, setLoading] = (0, react.useState)(true);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [saved, setSaved] = (0, react.useState)(false);
			const load = (0, react.useCallback)(async () => {
				setLoading(true);
				setError("");
				try {
					const [catalog, crew] = await Promise.all([api("/model-catalog"), api("/crew")]);
					setProviders(catalog.catalog ?? []);
					setProvider(crew.crew?.defaultModel?.provider ?? "");
					setModel(crew.crew?.defaultModel?.model ?? "");
				} catch (e) {
					setError(String(e.message));
				} finally {
					setLoading(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const save = async () => {
				setBusy(true);
				setSaved(false);
				setError("");
				try {
					await api("/crew", {
						method: "PATCH",
						body: JSON.stringify({ defaultModel: provider ? {
							provider,
							model
						} : null })
					});
					setSaved(true);
				} catch (e) {
					setError(String(e.message));
				} finally {
					setBusy(false);
				}
			};
			const valid = !provider || !!providers.find((p) => p.id === provider)?.models.some((m) => m.id === model);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					padding: 28,
					overflowY: "auto",
					height: "100%",
					boxSizing: "border-box"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: { marginTop: 0 },
						children: "团队模型"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "管理常用模型，为团队和成员选择合适的配置。" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelLibrary, {
						api,
						onDefaultChange: (value) => {
							setProvider(value?.provider || "");
							setModel(value?.model || "");
							setSaved(false);
						},
						defaultEditor: loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "加载中…" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-form",
							style: { maxWidth: 560 },
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["服务商", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									"aria-label": "默认模型服务商",
									value: provider,
									onChange: (e) => {
										setProvider(e.target.value);
										setModel("");
										setSaved(false);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "跟随 DSH 全局默认"
									}), providers.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: p.id,
										children: p.name
									}, p.id))]
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["模型", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									"aria-label": "团队默认模型选择",
									value: model,
									disabled: !provider,
									onChange: (e) => {
										setModel(e.target.value);
										setSaved(false);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "选择模型"
									}), (providers.find((p) => p.id === provider)?.models ?? []).map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: m.id,
										children: m.name
									}, m.id))]
								})] }),
								!valid ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									role: "alert",
									children: "请选择当前可用的模型。"
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "grokbot-form__submit",
									disabled: busy || !valid || !!error,
									onClick: () => void save(),
									children: busy ? "保存中…" : "保存默认模型"
								}),
								saved ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									role: "status",
									children: "默认模型已保存，下次对话或任务生效。"
								}) : null
							]
						})
					}),
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "alert",
						children: [
							error,
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => void load(),
								children: "重新加载"
							})
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MotionSettings, {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "grokbot-home__textlink",
						onClick: () => {
							openTarget = {
								kind: "permissions",
								id: "permissions"
							};
							notify();
						},
						children: "授权规则 →"
					}),
					accessSupported ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccessSettings, {}) : null
				]
			});
		}
		function BotForm(props) {
			const { initial } = props;
			const [avatar, setAvatar] = (0, react.useState)(initial?.avatar ?? "🤖");
			const [name, setName] = (0, react.useState)(initial?.name ?? "");
			const [title, setTitle] = (0, react.useState)(initial?.title ?? "");
			const [persona, setPersona] = (0, react.useState)("");
			const [profileLoaded, setProfileLoaded] = (0, react.useState)(!initial);
			const [roleTemplate, setRoleTemplate] = (0, react.useState)(initial?.roleTemplate || "");
			const [roleOptions, setRoleOptions] = (0, react.useState)([]);
			(0, react.useEffect)(() => {
				let alive = true;
				api("/bot-templates").then((r) => {
					if (alive) setRoleOptions(Array.isArray(r) ? r : r.templates || []);
				}).catch(() => {});
				if (initial) api(`/bots/${encodeURIComponent(initial.id)}`).then((r) => {
					if (alive) {
						setPersona(r.bot.persona || "");
						setProfileLoaded(true);
					}
				}).catch(() => {
					if (alive) setError("资料读取失败，请关闭后重试；未保存任何修改");
				});
				return () => {
					alive = false;
				};
			}, [initial?.id]);
			const [advanced, setAdvanced] = (0, react.useState)(false);
			const [providers, setProviders] = (0, react.useState)([]);
			const [providerId, setProviderId] = (0, react.useState)(initial?.model?.provider ?? "");
			const [modelId, setModelId] = (0, react.useState)(initial?.model?.model ?? "");
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
					if (profileLoaded) payload.persona = persona.trim();
					payload.roleTemplate = roleTemplate || null;
					if (providerId && !modelId) {
						setError("请选择模型，或选择跟随团队默认");
						setBusy(false);
						return;
					}
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
				props,
				profileLoaded,
				roleTemplate
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-form gk-profile-form",
				role: "region",
				"aria-label": "成员资料",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: initial ? "编辑成员资料" : "创建成员" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "名称和职位决定身份，补充职责用于约定工作方式。" })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "头像与名称" }),
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "职位" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: title,
						onChange: (e) => setTitle(e.target.value),
						placeholder: "头衔，如：检索与情报专家",
						"aria-label": "头衔"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "专业角色模板" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						"aria-label": "专业角色模板",
						value: roleTemplate,
						disabled: initial?.id === "chief",
						onChange: (e) => setRoleTemplate(e.target.value),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: "按职位识别"
						}), roleOptions.map((r) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: r.id,
							children: r.title
						}, r.id))]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "补充职责" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						value: persona,
						onChange: (e) => setPersona(e.target.value),
						placeholder: initial ? "补充预置职责与工作偏好；清空后恢复预置职责" : "职责与持久规则：它负责什么、怎么做事、安全边界",
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
							fontSize: 12
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
							disabled: busy || !profileLoaded,
							onClick: () => void submit(),
							children: busy ? "正在保存…" : initial ? "保存" : "创建"
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
					const outcome = await api("/conversations", {
						method: "POST",
						body: JSON.stringify({
							name: name.trim() || "新群聊",
							memberBotIds: selected
						})
					});
					props.onSaved(String(outcome?.conversation?.id ?? ""));
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
							fontSize: 14,
							cursor: "pointer"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								style: {
									width: "auto",
									flex: "none"
								},
								checked: selected.includes(bot.id),
								onChange: () => toggle(bot.id)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
								seed: bot.id,
								name: bot.name,
								glyph: bot.roleTemplate || bot.avatar,
								size: 17
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: bot.name })
						]
					}, bot.id)),
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							color: "#cf1322",
							fontSize: 12
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
							fontSize: 12
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
			const [grouping, setGrouping] = (0, react.useState)(false);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [creatingBot, setCreatingBot] = (0, react.useState)(false);
			const [filter, setFilter] = (0, react.useState)("");
			const [showArchived, setShowArchived] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const hiddenRef = (0, react.useRef)([]);
			const createFromTemplate = (0, react.useCallback)(() => {
				if (creatingBot) return;
				setMenuOpen(false);
				openTarget = null;
				setCreatingUi(true);
				setCreatingBot(true);
				api("/bots", {
					method: "POST",
					body: JSON.stringify({})
				}).then((outcome) => {
					const id = String(outcome?.bot?.id || "");
					if (id) openBot(id);
				}).catch(() => void 0).finally(() => {
					setCreatingBot(false);
					setCreatingUi(false);
				});
			}, [creatingBot]);
			(0, react.useEffect)(() => {
				const root = rootRef.current;
				if (!root) return;
				const apply = () => {
					root.classList.toggle("gk-rail", root.getBoundingClientRect().width < 170);
				};
				apply();
				const ro = new ResizeObserver(apply);
				ro.observe(root);
				return () => ro.disconnect();
			}, []);
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
			const botOf = (botId) => allBots.find((bot) => bot.id === botId);
			const conversations = (state?.conversations ?? []).filter((c) => showArchived ? c.lifecycle?.status === "archived" : c.lifecycle?.status !== "archived").filter((conversation) => conversation.memberBotIds.every((botId) => botOf(botId) && !botOf(botId).hidden)).filter((conversation) => {
				if (!filter.trim()) return true;
				return (conversation.memberBotIds.length > 1 ? conversation.name || conversation.memberBotIds.map((botId) => botOf(botId)?.name ?? botId).join("、") : botOf(conversation.memberBotIds[0])?.name ?? "").includes(filter.trim());
			}).sort((a, b) => {
				const pinnedOf = (conversation) => conversation.memberBotIds.length === 1 ? Number(botOf(conversation.memberBotIds[0])?.pinned ?? false) : 0;
				return pinnedOf(b) - pinnedOf(a) || (b.lastAt ?? 0) - (a.lastAt ?? 0);
			});
			const rowTitle = (conversation) => conversation.memberBotIds.length > 1 ? conversation.name || conversation.memberBotIds.map((botId) => botOf(botId)?.name ?? botId).join("、") : botOf(conversation.memberBotIds[0])?.name ?? conversation.id;
			const rowPreview = (conversation) => {
				if (conversation.memberBotIds.length === 1) {
					const bot = botOf(conversation.memberBotIds[0]);
					if (bot?.status === "working") return `工作中 · ${bot.currentWorkTitle || "点击查看实际进展"}`;
					if (conversation.lastMessage) return `${conversation.lastFrom === "user" ? "我: " : ""}${conversation.lastMessage}`;
					return bot?.title || "待命";
				}
				if (conversation.lastMessage) return `${conversation.lastFrom === "user" ? "我: " : ""}${conversation.lastMessage}`;
				return `${conversation.memberBotIds.length} 位成员`;
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-sidebar",
				ref: rootRef,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-sidebar__top",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "grokbot-brand",
								onClick: closeTarget,
								"aria-label": "DeepSeekBot 首页",
								children: "DeepSeekBot"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-iconbtn",
								title: "新建：召唤专家 / 拉群聊 / 与 Bot 单聊",
								onClick: () => setMenuOpen((v) => !v),
								children: "＋"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-iconbtn",
								title: nativeVisible ? "隐藏原始列表" : "显示原始工作区/会话列表",
								onClick: () => toggleNativeSidebar(),
								children: "⇆"
							})
						]
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
					(state?.approvals?.length ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "gk-approval-entry",
						"aria-label": `幕僚长审批：${state?.approvals.filter((a) => a.stage !== "chief").length ?? 0} 项需要你审批`,
						onClick: () => openBot("chief"),
						children: (state?.approvals.filter((a) => a.stage !== "chief").length ?? 0) > 0 ? `需要你审批 · ${state?.approvals.filter((a) => a.stage !== "chief").length}` : `幕僚长代审中 · ${state?.approvals.length}`
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-sidebar__list",
						children: [
							menuOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "grokbot-newmenu",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "grokbot-newmenu__item",
										disabled: creatingBot,
										onClick: () => createFromTemplate(),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "grokbot-newmenu__icon",
											children: "➕"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												display: "flex",
												flexDirection: "column",
												minWidth: 0
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: { fontWeight: 600 },
												children: creatingBot ? "正在创建…" : "创建新 Bot"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 12,
													opacity: .55
												},
												children: "立即开聊，在对话里选角色和名字"
											})]
										})]
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
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
												seed: bot.id,
												name: bot.name,
												glyph: bot.roleTemplate || bot.avatar,
												size: 22
											})
										}), bot.name]
									}, bot.id))
								]
							}) : null,
							grouping ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RoomForm, {
								bots: allBots.filter((bot) => !bot.hidden),
								onCancel: () => setGrouping(false),
								onSaved: (roomId) => {
									setGrouping(false);
									openRoom(roomId);
								}
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "grokbot-sidebar__section",
								children: [
									showArchived ? "已归档项目" : "会话",
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										style: {
											border: 0,
											background: "transparent",
											color: "inherit",
											font: "inherit",
											cursor: "pointer",
											marginLeft: 8
										},
										onClick: () => setShowArchived((v) => !v),
										children: showArchived ? "返回会话" : "查看归档"
									})
								]
							}),
							conversations.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									opacity: .5,
									padding: "4px 10px"
								},
								children: "暂无会话，点 ＋ 开始"
							}) : null,
							conversations.map((conversation) => {
								const isGroup = conversation.memberBotIds.length > 1;
								const bot = isGroup ? void 0 : botOf(conversation.memberBotIds[0]);
								const working = !isGroup && bot?.status === "working";
								const stack = isGroup ? conversation.memberBotIds.map((botId) => {
									const member = botOf(botId);
									return {
										seed: botId,
										name: member?.name,
										glyph: member?.roleTemplate || member?.avatar
									};
								}) : void 0;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SidebarRow, {
									seed: isGroup ? conversation.id : bot?.id ?? conversation.id,
									name: rowTitle(conversation),
									glyph: isGroup ? "group" : bot?.roleTemplate || bot?.avatar,
									stack: stack && stack.length > 1 ? stack : void 0,
									preview: rowPreview(conversation),
									time: timeLabel(conversation.lastAt),
									working,
									activity: bot ? characterActivity(bot, state) : void 0,
									specialty: bot?.title,
									level: !isGroup ? bot?.rating?.level : void 0,
									active: target?.id === conversation.id,
									onClick: () => openConversation(conversation.id)
								}, conversation.id);
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-sidebar__foot",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "grokbot-sidebar__computer",
								"aria-label": "本机工作区与任务成果",
								title: "本机工作区与任务成果",
								onClick: () => openComputer(),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "gk-ico",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NavigationIcon, { kind: "computer" })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "gk-lbl",
									children: "电脑"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-iconbtn gk-foot-ico",
								"aria-label": "例行任务",
								title: "例行任务",
								onClick: () => {
									openTarget = {
										kind: "routines",
										id: "routines"
									};
									notify();
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "gk-ico",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NavigationIcon, { kind: "clock" })
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-iconbtn gk-foot-ico",
								"aria-label": "团队默认模型",
								title: "团队默认模型",
								onClick: () => {
									openTarget = {
										kind: "settings",
										id: "settings"
									};
									notify();
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
									width: "20",
									height: "20",
									viewBox: "0 0 24 24",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: "1.7",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 7h16M4 17h16" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
											cx: "9",
											cy: "7",
											r: "3",
											fill: "var(--gk-bg-side)"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
											cx: "15",
											cy: "17",
											r: "3",
											fill: "var(--gk-bg-side)"
										})
									]
								})
							})
						]
					})
				]
			});
		}
		function NavigationIcon({ kind }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "20",
				height: "20",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.7",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: kind === "computer" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3",
					y: "4",
					width: "18",
					height: "13",
					rx: "2"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 21h8M12 17v4" })] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "12",
					cy: "12",
					r: "9"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 7v5l3 2" })] })
			});
		}
		function RoutinesView({ bots }) {
			const [items, setItems] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)("");
			const [revision, setRevision] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				let alive = true;
				setItems(null);
				setError("");
				api("/routines").then((r) => {
					if (alive) setItems(r.routines ?? []);
				}).catch((e) => {
					if (alive) setError(String(e?.message ?? e));
				});
				return () => {
					alive = false;
				};
			}, [revision]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					padding: "28px 32px",
					overflowY: "auto",
					height: "100%",
					boxSizing: "border-box"
				},
				"aria-label": "例行任务",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 12
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							style: {
								fontSize: 18,
								margin: 0
							},
							children: "例行任务"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: {
								border: "1px solid var(--gk-line)",
								background: "transparent",
								color: "inherit",
								borderRadius: 8,
								padding: "7px 14px",
								font: "inherit",
								fontSize: 14,
								cursor: "pointer"
							},
							onClick: () => setRevision((v) => v + 1),
							children: "刷新"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							color: "var(--gk-text-2)",
							fontSize: 14
						},
						children: "查看助手的定时安排。打开对应助手，在详情中管理例行任务。"
					}),
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "alert",
						children: [
							"加载失败：",
							error,
							"。请刷新重试。"
						]
					}) : items === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: "加载中…"
					}) : items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "还没有例行任务。在助手右上角打开详情，即可创建。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "grid",
							gap: 10
						},
						children: items.map((r) => {
							const bot = bots.find((b) => b.id === r.botId);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "grokbot-newmenu__item",
								disabled: !bot,
								onClick: () => openBot(r.botId),
								style: {
									border: "1px solid var(--gk-line)",
									borderRadius: 12,
									padding: 14,
									textAlign: "left"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
									seed: r.botId,
									name: bot?.name,
									glyph: bot?.roleTemplate || bot?.avatar,
									size: 32
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										minWidth: 0,
										overflowWrap: "anywhere"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: r.prompt || "例行任务" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: {
											display: "block",
											marginTop: 5,
											fontSize: 12,
											opacity: .65
										},
										children: [
											bot?.name ?? "助手已不可用",
											" · ",
											r.schedule.time ? `每天 ${r.schedule.time}` : `每 ${r.schedule.everyMinutes ?? "?"} 分钟`,
											" · ",
											r.enabled ? "已启用" : "已停用"
										]
									})]
								})]
							}, r.id);
						})
					})
				]
			});
		}
		function ComputerView() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArchiveComputer, {
				api,
				onConversation: (id) => openConversation(id)
			});
		}
		function SetupWizard(props) {
			const { bot } = props;
			const [templates, setTemplates] = (0, react.useState)([]);
			const [busy, setBusy] = (0, react.useState)(false);
			const [nameDraft, setNameDraft] = (0, react.useState)("");
			const [customRole, setCustomRole] = (0, react.useState)(false);
			const [customText, setCustomText] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				if (props.bot.setupStage !== "await-role" || templates.length > 0) return;
				api("/bot-templates").then((outcome) => setTemplates((outcome?.templates ?? []).filter((t) => !t.blank && t.id !== "chief"))).catch(() => void 0);
			}, [props.bot.setupStage, templates.length]);
			const send = (0, react.useCallback)(async (text) => {
				if (busy) return;
				setBusy(true);
				try {
					await api(`/conversations/${encodeURIComponent(bot.id)}/chat`, {
						method: "POST",
						body: JSON.stringify({ text })
					});
					props.onAdvance();
				} catch {} finally {
					setBusy(false);
				}
			}, [
				busy,
				bot.id,
				props
			]);
			const stage = bot.setupStage;
			const chosenTemplate = stage === "await-name" ? templates.find((template) => (template.title || "").startsWith(bot.title.split(" · ")[0])) : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-wizard",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-wizard__steps",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: stage === "await-role" ? "on" : stage === "await-name" ? "ok" : "ok",
								children: "① 角色"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: stage === "await-name" ? "on" : "",
								children: "② 姓名"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "③ 完成" })
						]
					}),
					stage === "await-role" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "grokbot-wizard__title",
							children: "给我一个角色"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-wizard__roles",
							children: [templates.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "grokbot-wizard__hint",
								children: "加载角色…"
							}) : null, templates.map((template) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "grokbot-role",
								disabled: busy,
								onClick: () => void send(template.title.split(" · ")[0]),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
										seed: template.id,
										glyph: template.id,
										size: 48
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "grokbot-role__name",
										children: template.title.split(" · ")[0]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "grokbot-role__desc",
										children: template.title.split(" · ")[1] || ""
									})
								]
							}, template.id))]
						}),
						customRole ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-wizard__custom",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: customText,
								onChange: (e) => setCustomText(e.target.value),
								placeholder: "描述角色，如：懂法律的合规顾问",
								"aria-label": "自定义角色"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-form__submit",
								disabled: busy || customText.trim().length < 2,
								onClick: () => void send(`我的角色：${customText.trim()}`),
								children: "就这个"
							})]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-wizard__skip",
							onClick: () => setCustomRole(true),
							children: "＋ 自定义角色"
						})
					] }) : null,
					stage === "await-name" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "grokbot-wizard__title",
							children: "叫我什么名字？"
						}),
						chosenTemplate ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "grokbot-wizard__names",
							children: [chosenTemplate.name, chosenTemplate.name.slice(0, 1) + "小" + chosenTemplate.name.slice(1)].map((suggestion) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-chips__item",
								disabled: busy,
								onClick: () => void send(suggestion),
								children: suggestion
							}, suggestion))
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-wizard__custom",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: nameDraft,
								onChange: (e) => setNameDraft(e.target.value),
								placeholder: "输入名字（2-12 字），回车确认",
								"aria-label": "名字",
								onKeyDown: (event) => {
									if (event.key === "Enter" && nameDraft.trim().length >= 2 && !busy) {
										event.preventDefault();
										send(`叫${nameDraft.trim()}`);
									}
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-form__submit",
								disabled: busy || nameDraft.trim().length < 2,
								onClick: () => void send(`叫${nameDraft.trim()}`),
								children: "就叫这个"
							})]
						})
					] }) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "grokbot-wizard__skip",
						disabled: busy,
						onClick: () => void send("跳过设置"),
						children: "跳过设置，直接聊"
					})
				]
			});
		}
		function MembersPanel(props) {
			const [adding, setAdding] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const { conversation, bots } = props;
			const members = conversation.memberBotIds.map((botId) => bots.find((bot) => bot.id === botId)).filter(Boolean);
			const candidates = bots.filter((bot) => !bot.hidden && !conversation.memberBotIds.includes(bot.id));
			const mutate = (0, react.useCallback)(async (botId, remove) => {
				if (busy) return;
				setBusy(true);
				try {
					await api(`/conversations/${encodeURIComponent(conversation.id)}/members`, {
						method: "POST",
						body: JSON.stringify(remove ? {
							botId,
							remove: true
						} : { botId })
					});
					props.onChanged();
				} catch {} finally {
					setBusy(false);
				}
			}, [
				busy,
				conversation.id,
				props
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "grokbot-details__title",
					children: "成员"
				}),
				members.map((member) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "grokbot-member",
					style: { justifyContent: "space-between" },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "mavatar",
							style: { display: "inline-flex" },
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
								seed: member.id,
								name: member.name,
								glyph: member.roleTemplate || member.avatar,
								size: 30
							})
						}), member.name]
					}), members.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "grokbot-iconbtn",
						title: "移出会话",
						disabled: busy,
						onClick: () => void mutate(member.id, true),
						children: "✕"
					}) : null]
				}, member.id)),
				adding ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "grokbot-form",
					style: { margin: "6px 0 0" },
					children: [
						candidates.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 12,
								opacity: .55
							},
							children: "没有可添加的 Bot（先创建更多专家）"
						}) : null,
						candidates.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "grokbot-newmenu__item",
							disabled: busy,
							onClick: () => {
								setAdding(false);
								mutate(candidate.id, false);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "grokbot-newmenu__icon",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
									seed: candidate.id,
									name: candidate.name,
									glyph: candidate.roleTemplate || candidate.avatar,
									size: 22
								})
							}), candidate.name]
						}, candidate.id)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-form__cancel",
							onClick: () => setAdding(false),
							children: "取消"
						})
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "grokbot-details__new",
					disabled: busy,
					onClick: () => setAdding(true),
					children: "＋ 添加成员（即成群聊）"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "grokbot-details__hint",
					children: "添加成员后本会话即成为群聊，历史自动保留。"
				})
			] });
		}
		function ApprovalCard(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ApprovalView, {
				approval: props.approval,
				onDecision: async (outcome, remember) => {
					await api(`/approvals/${encodeURIComponent(props.approval.id)}`, {
						method: "POST",
						body: JSON.stringify({
							outcome,
							remember
						})
					});
					refreshState?.();
				}
			});
		}
		function AccessSettings() {
			const [bots, setBots] = (0, react.useState)([]), [error, setError] = (0, react.useState)(""), [busy, setBusy] = (0, react.useState)("");
			const load = () => api("/access-control").then((r) => setBots(r.bots || [])).catch((e) => setError(e.message));
			(0, react.useEffect)(() => {
				load();
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "gk-access-settings",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "成员权限" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "插件完全访问已停用。操作仍需审核；相同操作可在审批卡中明确记住 24 小时，并在授权规则中撤销。" }),
					bots.map((b) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [b.name, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: b.mode === "full" ? "完全访问已开启" : "由幕僚长审核，必要时交给你" })] }), b.mode === "full" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						disabled: !!busy,
						onClick: () => {
							setBusy(b.id);
							setError("");
							api(`/bots/${encodeURIComponent(b.id)}/access`, {
								method: "POST",
								body: JSON.stringify({ mode: "review" })
							}).then(load).catch((e) => setError(e.message)).finally(() => setBusy(""));
						},
						children: "关闭完全访问"
					}) : null] }, b.id)),
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: error
					}) : null
				]
			});
		}
		function BotChatView(props) {
			const { bot, state } = props;
			const propsBots = state?.bots ?? [];
			const [draft, setDraft] = (0, react.useState)("");
			const [draftTask, setDraftTask] = (0, react.useState)(null);
			const [sending, setSending] = (0, react.useState)(false);
			const [cancelling, setCancelling] = (0, react.useState)(null);
			const [editing, setEditing] = (0, react.useState)(false);
			const [detailsOpen, setDetailsOpen] = (0, react.useState)(false);
			const [retryRequest, setRetryRequest] = (0, react.useState)(null);
			const botRef = (0, react.useRef)(bot.id);
			const botGenRef = (0, react.useRef)(0);
			const liveDraftRef = (0, react.useRef)({
				draft,
				draftTask
			});
			liveDraftRef.current = {
				draft,
				draftTask
			};
			(0, react.useEffect)(() => {
				if (botRef.current !== bot.id) {
					saveDraft(botRef.current, liveDraftRef.current);
					botRef.current = bot.id;
					botGenRef.current += 1;
				}
				const saved = loadDraft(bot.id);
				setDraft(saved.draft);
				setDraftTask(saved.draftTask);
				setRetryRequest(getPendingRetry(bot.id));
				setSending(false);
				setEditing(false);
			}, [bot.id]);
			(0, react.useEffect)(() => () => {
				saveDraft(botRef.current, liveDraftRef.current);
			}, []);
			const [newRoutine, setNewRoutine] = (0, react.useState)(false);
			const [catalog, setCatalog] = (0, react.useState)([]);
			const [historyRefresh, forceRefresh] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const subscribers = historyListeners.get(bot.id) ?? /* @__PURE__ */ new Set();
				historyListeners.set(bot.id, subscribers);
				const refresh = () => forceRefresh((n) => n + 1);
				subscribers.add(refresh);
				return () => {
					subscribers.delete(refresh);
					if (!subscribers.size) historyListeners.delete(bot.id);
				};
			}, [bot.id]);
			const messages = historyOf(bot.id);
			const { ref: logRef, paused: scrollPaused, jumpToLatest } = useChatScroll(`${bot.id}:${historyRefresh}:${sending}:${bot.status}:${bot.currentJob}:${bot.currentRunId}:${cancelling}:${messages.length}:${messages.at(-1)?.text ?? ""}:${JSON.stringify(state?.approvals ?? [])}`, bot.id);
			const pending = (state?.approvals ?? []).filter((approval) => bot.id === "chief" || approval.botId === bot.id);
			const refetchHistory = (0, react.useCallback)(async () => {
				try {
					const gen = (historyFetchGen.get(bot.id) ?? 0) + 1;
					historyFetchGen.set(bot.id, gen);
					const list = uniqueMessages((await api(`/conversations/${encodeURIComponent(bot.id)}`))?.messages ?? []);
					if (list.length === 0) return;
					if (historyFetchGen.get(bot.id) !== gen) return;
					const updated = list.map((message, index) => ({
						id: message.messageId || (message.requestId ? `chat-${message.requestId}-${message.role}` : `h${message.ts}-${index}`),
						requestId: message.requestId,
						role: message.role === "user" ? "user" : message.role === "system" ? "activity" : "bot",
						text: message.text,
						at: message.ts,
						artifact: message.artifact ?? null
					}));
					const pending = pendingMessages.get(bot.id);
					for (const message of list) if (message.role === "user" && message.requestId) pending?.delete(message.requestId);
					const merged = [...updated, ...[...pending?.values() ?? []]];
					if (JSON.stringify(histories.get(bot.id)) === JSON.stringify(merged)) return;
					histories.set(bot.id, merged);
					notifyHistory(bot.id);
				} catch {}
			}, [bot.id]);
			(0, react.useEffect)(() => {
				if (sending) return;
				const timer = setInterval(() => void refetchHistory(), 2e3);
				return () => clearInterval(timer);
			}, [
				bot.id,
				sending,
				refetchHistory
			]);
			(0, react.useEffect)(() => {
				loadedHistoryFor.add(bot.id);
				refetchHistory();
			}, [bot.id, refetchHistory]);
			(0, react.useEffect)(() => {
				if (catalog.length > 0) return;
				fetchCatalog().then(setCatalog).catch(() => void 0);
			}, [catalog.length]);
			(0, react.useEffect)(() => {
				if (cancelling && (!bot.currentRunId || bot.currentRunId !== cancelling)) setCancelling(null);
			}, [cancelling, bot.currentRunId]);
			const stop = (0, react.useCallback)(async () => {
				await api(`/bots/${encodeURIComponent(bot.id)}/stop`, { method: "POST" }).catch(() => void 0);
			}, [bot.id]);
			const send = (0, react.useCallback)(async (overrideText, overrideRequest, opts) => {
				const isRetry = Boolean(overrideRequest);
				if (isRetry && !retryMatches({
					...overrideRequest,
					createdAt: overrideRequest.createdAt ?? 0
				}, bot.id)) return;
				const text = (isRetry ? overrideRequest.text : overrideText ?? draft).trim();
				if (!text || sending) return;
				const requestId = isRetry ? overrideRequest.requestId : `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
				const taskForSend = isRetry ? overrideRequest.taskId : draftTask?.taskId ?? null;
				const sendBotId = bot.id;
				const sendGen = ++botGenRef.current;
				const sendSeq = allocateSeq();
				if (!isRetry) setDraft("");
				setRetryRequest(null);
				clearPendingRetry(bot.id);
				historyFetchGen.set(bot.id, (historyFetchGen.get(bot.id) ?? 0) + 1);
				const pending = pendingMessages.get(bot.id) ?? /* @__PURE__ */ new Map();
				pendingMessages.set(bot.id, pending);
				if (!pending.has(requestId) && !historyOf(bot.id).some((m) => m.requestId === requestId)) {
					const message = {
						id: `chat-${requestId}-user`,
						requestId,
						role: "user",
						text,
						at: Date.now()
					};
					pending.set(requestId, message);
					appendLocal(bot.id, message);
				}
				jumpToLatest();
				setSending(true);
				try {
					const outcome = await api(`/conversations/${encodeURIComponent(bot.id)}/chat`, {
						method: "POST",
						body: JSON.stringify({
							text,
							requestId,
							...taskForSend ? { taskId: taskForSend } : {},
							...opts?.retryMode ? { retryMode: opts.retryMode } : {}
						})
					});
					clearPendingRetry(sendBotId, sendSeq);
					if (sendGen !== botGenRef.current) return;
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
						id: `chat-${requestId}-bot`,
						requestId,
						role: "bot",
						text: String(outcome?.reply ?? ""),
						at: Date.now()
					});
					await refetchHistory();
					if (sendGen !== botGenRef.current) return;
					setDraftTask(null);
				} catch (error) {
					const pending = {
						conversationId: sendBotId,
						requestId,
						text,
						taskId: taskForSend,
						createdAt: isRetry && overrideRequest?.createdAt ? overrideRequest.createdAt : Date.now(),
						seq: sendSeq
					};
					setPendingRetry(pending);
					if (sendGen !== botGenRef.current) return;
					appendLocal(bot.id, {
						id: `${Date.now()}-e`,
						role: "error",
						text: String(error?.message ?? error),
						at: Date.now()
					});
					setRetryRequest(pending);
				} finally {
					if (sendGen === botGenRef.current) setSending(false);
				}
			}, [
				draft,
				sending,
				bot.id,
				refetchHistory,
				draftTask,
				jumpToLatest
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
						"data-working": bot.status === "working",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
								seed: bot.id,
								name: bot.name,
								glyph: bot.roleTemplate || bot.avatar,
								size: 48,
								level: bot.rating?.level,
								activity: characterActivity(bot, state),
								specialty: bot.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "grokbot-chat__title",
								onClick: () => setDetailsOpen((v) => !v),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-chat__name",
									children: bot.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-chat__meta",
									children: characterActivity(bot, state).state !== "idle" ? characterActivity(bot, state).label : bot.title || "常驻待命"
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
								"aria-label": "返回会话首页",
								title: "返回会话首页",
								children: "←"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotWorkPanel, {
						botId: bot.id,
						botName: bot.name
					}),
					editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "gk-profile-overlay",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotForm, {
							initial: bot,
							onCancel: () => setEditing(false),
							onSaved: () => setEditing(false)
						}, bot.id)
					}) : null,
					bot.accessMode === "full" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "gk-access-banner",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "此 Bot 完全访问已开启" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							onClick: () => {
								api(`/bots/${encodeURIComponent(bot.id)}/access`, {
									method: "POST",
									body: JSON.stringify({ mode: "review" })
								}).then(() => refreshState?.()).catch((e) => window.alert(e.message));
							},
							children: "关闭完全访问"
						})]
					}) : null,
					bot.setupStage ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "grokbot-body",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SetupWizard, {
							bot,
							onAdvance: () => refreshState?.()
						})
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-body",
							children: [
								scrollPaused ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "grokbot-jump-latest",
									onClick: jumpToLatest,
									children: "↓ 回到最新消息"
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "grokbot-log",
									ref: logRef,
									tabIndex: 0,
									"aria-label": "消息记录",
									children: [
										messages.length === 0 && pending.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "grokbot-empty",
											children: [
												"和 ",
												bot.name,
												" 对话，或投递任务给它。",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
												"它会真实使用工具、在本机工作区里干活。"
											]
										}) : null,
										messages.map((message) => {
											const botIdForFb = bot.id;
											if (message.role === "bot") {
												const { body, chips } = splitChips(message.text);
												return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(MessageView, {
													role: "bot",
													text: body,
													at: message.at,
													artifact: message.artifact,
													onContinueArtifact: (a) => {
														if (a.taskId) setDraftTask({
															taskId: a.taskId,
															name: a.name
														});
													},
													children: [chips.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "grokbot-chips",
														children: chips.map((chip) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: "grokbot-chips__item",
															disabled: sending,
															onClick: () => void send(chip),
															children: chip
														}, chip))
													}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "grokbot-fb",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															title: "干得好 +5",
															onClick: () => void sendFeedback(botIdForFb, message.id, true),
															children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
																src: "/api/plugins/grokbot/assets/rating/thumb-up",
																width: "12",
																height: "12",
																alt: "👍"
															})
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															title: "不满意 -3",
															onClick: () => void sendFeedback(botIdForFb, message.id, false),
															children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
																src: "/api/plugins/grokbot/assets/rating/thumb-down",
																width: "12",
																height: "12",
																alt: "👎"
															})
														})]
													})]
												}, message.id);
											}
											return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageView, {
												role: message.role === "user" ? "user" : message.role === "error" ? "error" : "activity",
												text: message.text,
												at: message.at,
												markdown: false
											}, message.id);
										}),
										bot.status === "working" || sending ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
											title: bot.currentJob ? `任务 ${bot.currentJob.slice(0, 24)}` : `${bot.name} 正在执行`,
											status: "running",
											members: [{
												name: bot.name,
												glyph: bot.roleTemplate || bot.avatar,
												desc: bot.title || "正在使用本机工具执行任务",
												state: "running"
											}],
											time: null,
											executor: "本机",
											actions: bot.currentRunId && bot.currentTaskId ? [{
												label: cancelling === bot.currentRunId ? "停止确认中…" : "取消本次",
												disabled: cancelling === bot.currentRunId,
												onClick: () => {
													const targetRun = bot.currentRunId;
													setCancelling(targetRun ?? null);
													api(`/tasks/${encodeURIComponent(bot.currentTaskId)}/runs/${encodeURIComponent(targetRun)}/cancel`, { method: "POST" }).then((r) => {
														if (!r?.ok || !r?.aborted) {
															window.alert(`取消未确认：${JSON.stringify(r)}`);
															setCancelling(null);
														}
													}).catch((e) => {
														window.alert(`取消失败：${String(e)}`);
														setCancelling(null);
													});
												}
											}] : sending ? [{
												label: "停止",
												onClick: () => void stop()
											}] : []
										}) : null,
										pending.map((approval) => bot.id === "chief" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ApprovalCard, { approval }, approval.id) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "grokbot-msg approval",
											children: ["授权已交给幕僚长处理。", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												onClick: () => openBot("chief"),
												children: "查看幕僚长审批"
											})]
										}, approval.id)),
										sending && pending.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "grokbot-empty",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
												src: "/api/plugins/grokbot/assets/states/thinking",
												width: 20,
												height: 20,
												alt: "",
												style: { verticalAlign: "-4px" }
											}), " 思考中…"]
										}) : null
									]
								}),
								detailsOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "grokbot-details",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "grokbot-details__title",
												children: "模型（高级设置）"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												className: "gk-modelbar__select",
												style: {
													width: "100%",
													marginTop: 6,
													boxSizing: "border-box"
												},
												value: bot.model ? `${bot.model.provider}/${bot.model.model}` : "",
												onChange: (e) => {
													const val = e.target.value;
													if (!val) {
														api(`/bots/${encodeURIComponent(bot.id)}`, {
															method: "PATCH",
															body: JSON.stringify({ model: null })
														}).then(() => refreshState?.()).catch(() => void 0);
														return;
													}
													const [provider, model] = val.split("/");
													api(`/bots/${encodeURIComponent(bot.id)}`, {
														method: "PATCH",
														body: JSON.stringify({ model: {
															provider,
															model
														} })
													}).then(() => refreshState?.()).catch(() => void 0);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: "跟随团队默认"
												}), catalog.map((p) => p.models.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
													value: `${p.id}/${m.id}`,
													children: [
														p.name,
														" / ",
														m.name
													]
												}, `${p.id}/${m.id}`)))]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "grokbot-details__hint",
												children: bot.model ? `自定义：${bot.model.provider}/${bot.model.model}` : "未覆盖时沿用宿主默认模型"
											})
										] }),
										bot.rating ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "grokbot-rating",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "grokbot-rating__head",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
															src: `/api/plugins/grokbot/assets/rating/badge-lv${bot.rating?.level ?? 1}`,
															width: 18,
															height: 18,
															alt: "Lv",
															className: "grokbot-rating__level"
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "grokbot-rating__title",
															children: bot.rating.title
														}),
														bot.rating.stars ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "grokbot-rating__stars",
															children: Array.from({ length: 5 }, (_, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
																src: `/api/plugins/grokbot/assets/rating/star-${i < (bot.rating?.stars ?? 0) ? "filled" : "empty"}`,
																width: 12,
																height: 12,
																alt: ""
															}, i))
														}) : null
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "grokbot-rating__bar",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "grokbot-rating__fill",
														style: { width: `${bot.rating.nextAt ? Math.min(100, Math.round(100 * bot.rating.exp / bot.rating.nextAt)) : 100}%` }
													})
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "grokbot-rating__nums",
													children: [
														bot.rating.nextAt ? `经验 ${bot.rating.exp}/${bot.rating.nextAt}` : "已满级",
														"　",
														"任务 ",
														bot.rating.tasksDone,
														"✓ ",
														bot.rating.tasksFailed,
														"✗",
														bot.rating.growth?.reviews ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
															"复盘 ",
															bot.rating.growth.reviews,
															" 次 · 最近 ",
															bot.rating.growth.latest?.score ?? "证据不足",
															bot.rating.growth.latest?.score != null ? "/100" : "",
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
															"改进验证 ",
															bot.rating.growth.verified,
															" 项 · 成长经验 +",
															bot.rating.growth.exp,
															bot.rating.growth.latestUrl ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
																href: bot.rating.growth.latestUrl,
																target: "_blank",
																rel: "noreferrer",
																style: {
																	display: "block",
																	marginTop: 6
																},
																children: "查看最近复盘 ↗"
															}) : null
														] }) : null,
														bot.rating.thumbsUp + bot.rating.thumbsDown > 0 ? `　👍${bot.rating.thumbsUp} 👎${bot.rating.thumbsDown}` : ""
													]
												})
											]
										}) : null,
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MembersPanel, {
											conversation: {
												id: bot.id,
												name: bot.name,
												memberBotIds: [bot.id]
											},
											bots: propsBots,
											onChanged: () => refreshState?.()
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
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
										] })
									]
								}) : null
							]
						}),
						retryRequest ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 8,
								padding: "4px 22px 0"
							},
							children: [(() => {
								const risk = retryRiskLevel(retryRequest);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 12,
											color: "rgba(176,48,48,.9)"
										},
										children: risk === "high" ? "上次发送结果未知（「查询原结果」大概率返回已执行的回复）" : risk === "medium" ? "上次发送结果未知（查询可能命中；记录过期/重启会返回不可恢复提示，不会重复执行）" : "结果未知已超保留期——查询将提示不可恢复；如需继续请「重新执行」"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											border: "1px solid rgba(176,48,48,.4)",
											background: "rgba(176,48,48,.06)",
											color: "rgba(176,48,48,.9)",
											borderRadius: 99,
											padding: "3px 12px",
											fontSize: 12,
											fontWeight: 600,
											cursor: "pointer"
										},
										disabled: sending,
										onClick: () => {
											send(void 0, retryRequest, { retryMode: "retry" });
										},
										children: "重试本次（查询原结果）"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											border: "1px solid rgba(29,29,31,.2)",
											background: "rgba(29,29,31,.04)",
											color: "var(--gk-text)",
											borderRadius: 99,
											padding: "3px 12px",
											fontSize: 12,
											fontWeight: 600,
											cursor: "pointer"
										},
										disabled: sending,
										onClick: () => {
											if (window.confirm("重新执行：生成新请求（原执行可能已发生，可能重复）。确认？")) send(retryRequest.text, {
												conversationId: retryRequest.conversationId,
												requestId: `ui-${Date.now().toString(36)}-re`,
												text: retryRequest.text,
												taskId: retryRequest.taskId,
												createdAt: Date.now()
											});
										},
										children: "重新执行"
									})
								] });
							})(), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									border: "none",
									background: "none",
									cursor: "pointer",
									color: "rgba(29,29,31,.4)",
									fontSize: 12
								},
								onClick: () => {
									setRetryRequest(null);
									clearPendingRetry(bot.id);
								},
								children: "放弃"
							})]
						}) : null,
						draftTask ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 6,
								padding: "4px 22px 0"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									fontSize: 12,
									background: "rgba(37,99,235,.10)",
									color: "#2563eb",
									borderRadius: 99,
									padding: "3px 10px",
									fontWeight: 600
								},
								children: ["继续修改：", draftTask.name]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									border: "none",
									background: "none",
									cursor: "pointer",
									color: "rgba(29,29,31,.4)",
									fontSize: 12
								},
								onClick: () => setDraftTask(null),
								children: "✕"
							})]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Composer, {
							conversationId: bot.id,
							draft,
							onDraft: setDraft,
							onSend: () => void send(),
							sending,
							placeholder: draftTask ? `继续修改 ${draftTask.name}（同一任务）…` : `发消息给 ${bot.name}`
						})
					] })
				]
			});
		}
		function GroupChatView(props) {
			const room = {
				id: props.conversation.id,
				name: props.conversation.name || props.conversation.memberBotIds.map((botId) => props.bots.find((bot) => bot.id === botId)?.name ?? botId).join("、"),
				memberBotIds: props.conversation.memberBotIds
			};
			const bots = props.bots;
			const [boardOpen, setBoardOpen] = (0, react.useState)(true);
			const loadBoard = (0, react.useCallback)((id) => api(`/conversations/${encodeURIComponent(id)}/board`), []);
			const [detailsOpen, setDetailsOpen] = (0, react.useState)(false);
			const [messages, setMessages] = (0, react.useState)([]);
			const [draft, setDraft] = (0, react.useState)("");
			const [draftTask, setDraftTask] = (0, react.useState)(null);
			const [sending, setSending] = (0, react.useState)(false);
			const [cancellingRuns, setCancellingRuns] = (0, react.useState)(/* @__PURE__ */ new Map());
			const [retryRequest, setRetryRequest] = (0, react.useState)(null);
			const roomRef = (0, react.useRef)(room.id);
			const roomGenRef = (0, react.useRef)(0);
			const roomHistoryGen = (0, react.useRef)(0);
			const liveDraftRef = (0, react.useRef)({
				draft,
				draftTask
			});
			liveDraftRef.current = {
				draft,
				draftTask
			};
			(0, react.useEffect)(() => {
				if (roomRef.current !== room.id) {
					saveDraft(roomRef.current, liveDraftRef.current);
					roomRef.current = room.id;
					roomGenRef.current += 1;
				}
				const saved = loadDraft(room.id);
				setDraft(saved.draft);
				setDraftTask(saved.draftTask);
				setRetryRequest(getPendingRetry(room.id));
				setSending(false);
				setCancellingRuns(/* @__PURE__ */ new Map());
			}, [room.id]);
			(0, react.useEffect)(() => () => {
				saveDraft(roomRef.current, liveDraftRef.current);
			}, []);
			const queued = props.queued ?? [];
			const { ref: logRef, paused: scrollPaused, jumpToLatest } = useChatScroll(`${room.id}:${sending}:${JSON.stringify(messages)}:${JSON.stringify(queued)}:${JSON.stringify(bots.filter((b) => b.currentConversationId === room.id).map((b) => [
				b.id,
				b.status,
				b.currentJob,
				b.currentRunId
			]))}:${JSON.stringify([...cancellingRuns])}`, room.id);
			(0, react.useEffect)(() => {
				let alive = true;
				const tick = () => {
					const gen = ++roomHistoryGen.current;
					api(`/conversations/${encodeURIComponent(room.id)}`).then((outcome) => {
						if (alive && gen === roomHistoryGen.current) setMessages(uniqueMessages(outcome?.messages ?? []));
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
				const liveRun = new Map(bots.filter((b) => b.status === "working" && b.currentRunId).map((b) => [b.id, b.currentRunId]));
				setCancellingRuns((prev) => {
					let changed = false;
					const next = new Map(prev);
					for (const [botId, runId] of prev) if (liveRun.get(botId) !== runId) {
						next.delete(botId);
						changed = true;
					}
					return changed ? next : prev;
				});
			}, [bots]);
			const botOf = (botId) => bots.find((bot) => bot.id === botId);
			const send = (0, react.useCallback)(async (overrideRequest, opts) => {
				const isRetry = Boolean(overrideRequest);
				if (isRetry && !retryMatches({
					...overrideRequest,
					createdAt: overrideRequest.createdAt ?? 0
				}, room.id)) return;
				const text = (isRetry ? overrideRequest.text : draft).trim();
				if (!text || sending) return;
				const requestId = isRetry ? overrideRequest.requestId : `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
				const taskForSend = isRetry ? overrideRequest.taskId : draftTask?.taskId ?? null;
				const sendRoomId = room.id;
				const sendGen = ++roomGenRef.current;
				const sendSeq = allocateSeq();
				if (!isRetry) setDraft("");
				setRetryRequest(null);
				clearPendingRetry(room.id);
				setSending(true);
				try {
					const outcome = await api(`/conversations/${encodeURIComponent(room.id)}/chat`, {
						method: "POST",
						body: JSON.stringify({
							text,
							requestId,
							...taskForSend ? { taskId: taskForSend } : {},
							...opts?.retryMode ? { retryMode: opts.retryMode } : {}
						})
					});
					clearPendingRetry(sendRoomId, sendSeq);
					if (sendGen !== roomGenRef.current) return;
					++roomHistoryGen.current;
					setMessages(uniqueMessages(outcome?.messages ?? []));
					setDraftTask(null);
				} catch (error) {
					const pending = {
						conversationId: sendRoomId,
						requestId,
						text,
						taskId: taskForSend,
						createdAt: isRetry && overrideRequest?.createdAt ? overrideRequest.createdAt : Date.now(),
						seq: sendSeq
					};
					setPendingRetry(pending);
					if (sendGen !== roomGenRef.current) return;
					setMessages((prev) => [...prev, {
						ts: Date.now(),
						role: "system",
						text: `发送失败：${String(error?.message ?? error)}（可重试本次，复用原请求）`
					}]);
					setRetryRequest(pending);
				} finally {
					if (sendGen === roomGenRef.current) setSending(false);
				}
			}, [
				draft,
				sending,
				room.id,
				draftTask
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "grokbot-group-shell",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "grokbot-chat",
					onKeyDown: (event) => {
						if (event.key === "Escape" && !detailsOpen) closeTarget();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-chat__head",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupAvatarView, {
									name: room.name,
									members: room.memberBotIds.map((id) => {
										const m = bots.find((b) => b.id === id);
										return {
											seed: id,
											name: m?.name,
											glyph: m?.roleTemplate || m?.avatar
										};
									}),
									size: 48
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "grokbot-chat__title",
									onClick: () => setDetailsOpen((v) => !v),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "grokbot-chat__name",
										children: room.name
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "grokbot-chat__meta",
										children: room.memberBotIds.map((botId) => {
											const m = botOf(botId);
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: {
													display: "inline-flex",
													alignItems: "center",
													gap: 4,
													marginRight: 10
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
													seed: botId,
													name: m?.name,
													glyph: m?.roleTemplate || m?.avatar,
													size: 17
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: m?.name ?? botId })]
											}, botId);
										})
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gk-board-toggle",
									"aria-expanded": boardOpen,
									onClick: () => setBoardOpen((v) => !v),
									children: boardOpen ? "隐藏任务进展" : "查看任务进展"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "grokbot-chat__close",
									onClick: closeTarget,
									"aria-label": "返回会话首页",
									title: "返回会话首页",
									children: "←"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-body",
							children: [scrollPaused ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grokbot-jump-latest",
								onClick: jumpToLatest,
								children: "↓ 回到最新消息"
							}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "grokbot-log",
								ref: logRef,
								tabIndex: 0,
								"aria-label": "消息记录",
								children: [
									messages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "grokbot-empty",
										children: "由幕僚长统一协调，右侧查看团队任务进展。@成员名仍可定向交流。"
									}) : messages.map((message, index) => {
										if (message.role === "user") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageView, {
											role: "user",
											text: message.text,
											at: message.ts,
											markdown: false
										}, message.messageId || `${message.ts}-${index}`);
										if (message.role === "handoff") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageView, {
											role: "activity",
											text: `↪ ${botOf(message.fromBotId)?.name ?? message.fromBotId} → ${botOf(message.toBotId)?.name ?? message.toBotId}：${message.text}`,
											markdown: false
										}, message.messageId || `${message.ts}-${index}`);
										if (message.role === "system") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageView, {
											role: "notice",
											text: message.text,
											markdown: false
										}, message.messageId || `${message.ts}-${index}`);
										const bot = botOf(message.botId);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageView, {
											role: "bot",
											text: splitChips(message.text).body,
											at: message.ts,
											senderName: bot?.name ?? message.botId,
											senderGlyph: bot?.roleTemplate || bot?.avatar,
											artifact: message.artifact,
											onContinueArtifact: (a) => {
												if (a.taskId) setDraftTask({
													taskId: a.taskId,
													name: a.name
												});
											}
										}, message.messageId || `${message.ts}-${index}`);
									}),
									sending ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "grokbot-empty",
										children: "成员思考中…"
									}) : null,
									queued.map((q) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
										title: `排队中：${String(q.text).slice(0, 30) || "任务"}`,
										status: "queued",
										members: [{
											name: bots.find((b) => b.id === q.botId)?.name ?? q.botId,
											glyph: bots.find((b) => b.id === q.botId)?.roleTemplate || bots.find((b) => b.id === q.botId)?.avatar,
											desc: "等待执行（当前有任务占用）",
											state: "idle"
										}],
										actions: [{
											label: "取消排队",
											onClick: () => {
												api(`/queue/${encodeURIComponent(q.jobId)}/cancel`, { method: "POST" }).catch((e) => window.alert(`取消排队失败：${String(e)}`));
											}
										}]
									}, q.jobId)),
									bots.filter((b) => b.status === "working" && b.currentConversationId === room.id && room.memberBotIds.includes(b.id)).map((b) => {
										const stopping = cancellingRuns.get(b.id) === b.currentRunId;
										const cancellable = b.currentRunId && b.currentTaskId;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
											title: stopping ? `${b.name} 停止确认中…` : `${b.name} 正在执行任务`,
											status: stopping ? "confirm-stop" : "running",
											members: [{
												name: b.name,
												glyph: b.roleTemplate || b.avatar,
												desc: b.title || "使用本机工具执行",
												state: "running"
											}],
											executor: "本机",
											actions: cancellable ? [{
												label: stopping ? "停止确认中…" : "取消本次",
												disabled: stopping,
												onClick: () => {
													const targetRun = b.currentRunId;
													setCancellingRuns((prev) => new Map(prev).set(b.id, targetRun));
													api(`/tasks/${encodeURIComponent(b.currentTaskId)}/runs/${encodeURIComponent(targetRun)}/cancel`, { method: "POST" }).then((r) => {
														if (!r?.ok || !r?.aborted) {
															window.alert(`取消未确认：${JSON.stringify(r)}`);
															setCancellingRuns((prev) => {
																const n = new Map(prev);
																n.delete(b.id);
																return n;
															});
														}
													}).catch((e) => {
														window.alert(`取消失败：${String(e)}`);
														setCancellingRuns((prev) => {
															const n = new Map(prev);
															n.delete(b.id);
															return n;
														});
													});
												}
											}] : [{
												label: "停止",
												onClick: () => {
													api(`/bots/${encodeURIComponent(b.id)}/stop`, { method: "POST" }).catch(() => void 0);
												}
											}]
										}, b.id);
									})
								]
							})]
						}),
						retryRequest ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 8,
								padding: "4px 22px 0"
							},
							children: [(() => {
								const risk = retryRiskLevel(retryRequest);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 12,
											color: "rgba(176,48,48,.9)"
										},
										children: risk === "high" ? "上次发送结果未知（「查询原结果」大概率返回已执行的回复）" : risk === "medium" ? "上次发送结果未知（查询可能命中；记录过期/重启会返回不可恢复提示，不会重复执行）" : "结果未知已超保留期——查询将提示不可恢复；如需继续请「重新执行」"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											border: "1px solid rgba(176,48,48,.4)",
											background: "rgba(176,48,48,.06)",
											color: "rgba(176,48,48,.9)",
											borderRadius: 99,
											padding: "3px 12px",
											fontSize: 12,
											fontWeight: 600,
											cursor: "pointer"
										},
										disabled: sending,
										onClick: () => {
											send(retryRequest, { retryMode: "retry" });
										},
										children: "重试本次（查询原结果）"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											border: "1px solid rgba(29,29,31,.2)",
											background: "rgba(29,29,31,.04)",
											color: "var(--gk-text)",
											borderRadius: 99,
											padding: "3px 12px",
											fontSize: 12,
											fontWeight: 600,
											cursor: "pointer"
										},
										disabled: sending,
										onClick: () => {
											if (window.confirm("重新执行：生成新请求（原执行可能已发生，可能重复）。确认？")) send({
												conversationId: retryRequest.conversationId,
												requestId: `ui-${Date.now().toString(36)}-re`,
												text: retryRequest.text,
												taskId: retryRequest.taskId,
												createdAt: Date.now()
											});
										},
										children: "重新执行"
									})
								] });
							})(), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									border: "none",
									background: "none",
									cursor: "pointer",
									color: "rgba(29,29,31,.4)",
									fontSize: 12
								},
								onClick: () => {
									setRetryRequest(null);
									clearPendingRetry(room.id);
								},
								children: "放弃"
							})]
						}) : null,
						draftTask ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 6,
								padding: "4px 22px 0"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									fontSize: 12,
									background: "rgba(37,99,235,.10)",
									color: "#2563eb",
									borderRadius: 99,
									padding: "3px 10px",
									fontWeight: 600
								},
								children: ["继续修改：", draftTask.name]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									border: "none",
									background: "none",
									cursor: "pointer",
									color: "rgba(29,29,31,.4)",
									fontSize: 12
								},
								onClick: () => setDraftTask(null),
								children: "✕"
							})]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Composer, {
							conversationId: room.id,
							draft,
							onDraft: setDraft,
							onSend: () => void send(),
							sending,
							placeholder: draftTask ? `继续修改 ${draftTask.name}（同一任务）…` : room.memberBotIds.includes("chief") ? "告诉幕僚长你的需求…" : `发到 ${room.name}…`
						}),
						detailsOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "grokbot-details",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MembersPanel, {
								conversation: {
									id: room.id,
									name: room.name,
									memberBotIds: room.memberBotIds
								},
								bots,
								onChanged: () => refreshState?.()
							})
						}) : null
					]
				}), boardOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectBoard, {
					conversationId: room.id,
					bots: bots.filter((b) => room.memberBotIds.includes(b.id)),
					load: loadBoard,
					onBot: (id) => {
						focusBotWork(id);
						openBot(id);
					},
					onApproval: () => openBot("chief")
				}) : null]
			});
		}
		let creatingBotBusy = false;
		function startCreatingBot() {
			if (creatingBotBusy) return;
			openTarget = null;
			setCreatingUi(true);
			creatingBotBusy = true;
			api("/bots", {
				method: "POST",
				body: JSON.stringify({})
			}).then((outcome) => {
				const id = String(outcome?.bot?.id || "");
				if (id) openBot(id);
			}).catch(() => void 0).finally(() => {
				creatingBotBusy = false;
				setCreatingUi(false);
			});
		}
		function HomeBlank({ bots: allBots, state }) {
			const bots = allBots.filter((b) => !b.hidden), chief = bots.find((b) => b.id === "chief"), members = bots.filter((b) => b.id !== "chief");
			const lead = chief?.status === "working" ? chief.id : members.find((b) => b.status === "working")?.id || chief?.id;
			const avatar = (bot, size) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
				seed: bot.id,
				name: bot.name,
				glyph: bot.roleTemplate || bot.avatar,
				size,
				level: bot.rating?.level,
				activity: characterActivity(bot, state),
				quiet: bot.id !== lead,
				specialty: bot.title
			});
			const description = (bot) => {
				const activity = characterActivity(bot, state);
				return activity.state === "idle" ? bot.title || "团队成员" : activity.label;
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "grokbot-home",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "grokbot-home__content",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "grokbot-home__eyebrow",
							children: "DEEPSEEKBOT / TEAM"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							className: "grokbot-home__title",
							children: "今天，一起做点什么。"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "grokbot-home__sub",
							children: state?.stale ? "正在重新同步团队状态。" : "你的团队已就位。"
						}),
						chief ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							className: "grokbot-home__chief",
							onClick: () => openConversation(chief.id),
							"aria-label": `与${chief.name}对话`,
							children: [
								avatar(chief, 64),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: chief.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: characterActivity(chief, state).state === "idle" ? "把想法交给我。" : description(chief) })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "grokbot-home__arrow",
									"aria-hidden": "true",
									children: "→"
								})
							]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "grokbot-home__textlink",
							onClick: () => startCreatingBot(),
							children: "添加第一位成员 →"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-home__section",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "团队" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "grokbot-home__textlink",
								onClick: () => startCreatingBot(),
								children: "添加成员 ↗"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "grokbot-home__grid",
							children: members.map((bot) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								className: "grokbot-home__member",
								onClick: () => openConversation(bot.id),
								children: [avatar(bot, 52), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: bot.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: description(bot) })] })]
							}, bot.id))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-home__utilities",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => {
									openTarget = {
										kind: "settings",
										id: "settings"
									};
									notify();
								},
								children: "团队设置"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => {
									openTarget = {
										kind: "permissions",
										id: "permissions"
									};
									notify();
								},
								children: "授权规则"
							})]
						})
					]
				})
			});
		}
		function GrokbotMainView() {
			const target = useOpenTarget();
			const state = useGrokbotState();
			const nativeVisible = useNativeSidebarVisible();
			const [, forceCreating] = (0, react.useState)(0);
			const restoredRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				const listener = () => forceCreating((n) => n + 1);
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}, []);
			(0, react.useEffect)(() => {
				if (restoredRef.current || openTarget || !state) return;
				const saved = state.lastTarget;
				if (!saved) {
					restoredRef.current = true;
					return;
				}
				const savedId = saved.id;
				if (state.conversations?.some((conversation) => conversation.id === savedId) || saved.kind === "bot" && state.bots.some((bot) => bot.id === savedId)) {
					restoredRef.current = true;
					openConversation(savedId);
				}
			}, [state]);
			const conversation = state?.conversations?.find((entry) => entry.id === target?.id) ?? null;
			const isGroup = Boolean(conversation && conversation.memberBotIds.length > 1);
			const bot = !isGroup && conversation ? state?.bots.find((entry) => entry.id === conversation.memberBotIds[0]) ?? null : null;
			const isComputer = target?.kind === "computer";
			const activeKey = nativeVisible ? null : target ? `conversation:${target.id}` : creatingUi ? "creating" : "home";
			const entering = Boolean(target) && !conversation;
			const [box, setBox] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (activeKey) document.body.classList.add("grokbot-takeover");
				else document.body.classList.remove("grokbot-takeover");
			}, [activeKey]);
			(0, react.useEffect)(() => {
				if (!activeKey) return;
				let center = document.querySelector("[class*=\"centerCol\"]");
				let resizeObserver = null;
				const takeover = () => {
					if (!center) return;
					const rect = center.getBoundingClientRect();
					setBox({
						left: rect.left,
						top: rect.top,
						width: rect.width,
						height: rect.height
					});
				};
				const attach = (el) => {
					center = el;
					resizeObserver?.disconnect();
					resizeObserver = new ResizeObserver(takeover);
					resizeObserver.observe(el);
					takeover();
				};
				const mo = new MutationObserver(() => {
					const el = document.querySelector("[class*=\"centerCol\"]");
					if (el) {
						mo.disconnect();
						attach(el);
					}
				});
				if (center) attach(center);
				else mo.observe(document.documentElement, {
					childList: true,
					subtree: true
				});
				window.addEventListener("resize", takeover);
				return () => {
					mo.disconnect();
					resizeObserver?.disconnect();
					window.removeEventListener("resize", takeover);
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
				children: (() => {
					if (target?.kind === "permissions") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PermissionRules, {
						api,
						bots: state?.bots || [],
						onBack: closeTarget
					});
					if (target?.kind === "settings") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelSettingsView, { accessSupported: state?.accessControl?.supported });
					if (target?.kind === "routines") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RoutinesView, { bots: state?.bots ?? [] });
					if (isComputer) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComputerView, {});
					if (bot) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotChatView, {
						bot,
						state
					});
					if (conversation && isGroup) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupChatView, {
						conversation,
						bots: state?.bots ?? [],
						queued: (state?.queued ?? []).filter((q) => q.conversationId === conversation.id)
					});
					if (creatingUi || entering) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-creating",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "grokbot-creating__spinner" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: entering ? "正在进入会话…" : "正在召唤专家…" })]
					});
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HomeBlank, {
						bots: state?.bots ?? [],
						state
					});
				})()
			});
		}
		const inject = ["slots", "sessions"];
		function apply(ctx) {
			ctx.sessions;
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.dshGrokbot = "";
				document.head.append(style);
				const update = () => {
					const css = GROKBOT_CSS + GKF_CSS + UX_CSS + CHARACTER_CSS + (nativeSidebarVisible ? "" : "\n.grokbot-takeover [class*=\"centerCol\"] > * { display: none !important; }\n.grokbot-takeover [class*=\"detailsCol\"] { display: none !important; }");
					if (style.textContent !== css) style.textContent = css;
				};
				update();
				listeners.add(update);
				return () => {
					listeners.delete(update);
					style.remove();
				};
			}, "grokbot: styles + takeover CSS");
			ctx.slots.inject("sidebar.workspaces", () => {
				try {
					ctx.slots.register({
						name: "sidebar.workspaces",
						id: "grokbot-crew",
						order: -100
					}, GrokbotSidebarCrew);
				} catch (error) {
					console.error("[grokbot] sidebar slot 注册失败", error);
				}
			});
			ctx.slots.inject("shell.overlay", () => {
				try {
					ctx.slots.register({
						name: "shell.overlay",
						id: "grokbot-main",
						order: 51
					}, GrokbotMainView);
				} catch (error) {
					console.error("[grokbot] overlay slot 注册失败", error);
				}
			});
		}
		//#endregion
		exports.API_ROOT = API_ROOT;
		exports.BotChatView = BotChatView;
		exports.BotForm = BotForm;
		exports.ComputerView = ComputerView;
		exports.GrokbotMainView = GrokbotMainView;
		exports.GrokbotSidebarCrew = GrokbotSidebarCrew;
		exports.GroupChatView = GroupChatView;
		exports.ModelSettingsView = ModelSettingsView;
		exports.RoutinesView = RoutinesView;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
