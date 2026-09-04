window.__ModuleLoader__.load({
	id: "dsh-grokbot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/avatars.ts
		/**
		* 参数化果冻豆头像引擎——基于 Codex 交付的 parts-library 坐标体系。
		* 组合：豆身(12色板) + 大眼高光 + 腮红 + 嘴(4) + 头顶(4) + 内景(3) + 角色配件
		*/
		const PALETTES = [
			[
				"#8fb0ff",
				"#4c5fd7",
				"#24304d"
			],
			[
				"#6fe0b4",
				"#1f9d72",
				"#12291f"
			],
			[
				"#ffd98a",
				"#f08c1d",
				"#3d2a05"
			],
			[
				"#dcb4ff",
				"#8b46eb",
				"#241238"
			],
			[
				"#a3e8ff",
				"#2f9dc4",
				"#0b3346"
			],
			[
				"#ffb3b3",
				"#e85660",
				"#4d1218"
			],
			[
				"#ccd9ef",
				"#5f7cad",
				"#1c2a4d"
			],
			[
				"#bdf2cf",
				"#3aa866",
				"#0c3a20"
			],
			[
				"#ffd6e4",
				"#e8739c",
				"#4d1230"
			],
			[
				"#dcd6ff",
				"#7a68d4",
				"#2d2450"
			],
			[
				"#ffe3ae",
				"#c9a34e",
				"#4d3a10"
			],
			[
				"#fff3d6",
				"#e8c88a",
				"#5c4a20"
			]
		];
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
		function hashName(name) {
			let h = 0;
			for (let i = 0; i < name.length; i++) h = h * 31 + name.charCodeAt(i) | 0;
			const h2 = h >>> 16 ^ h;
			const h3 = h2 >>> 8 ^ h;
			const h4 = h3 >>> 24 ^ h2;
			return [
				Math.abs(h) % 12,
				Math.abs(h2) % 4,
				Math.abs(h3) % 3,
				Math.abs(h4) % 4
			];
		}
		function bodyPath(top, bot) {
			return `<defs><linearGradient id="gk-av" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bot}"/></linearGradient></defs>
<path d="M11 37C10 25 20 17 33 17c14 0 23 8 22 19-1 12-11 16-23 16S13 49 11 37z" fill="url(#gk-av)"/>
<ellipse cx="26" cy="22" rx="6" ry="2.8" fill="#fff" opacity=".45"/>`;
		}
		function eyes(inset) {
			return `<ellipse cx="24" cy="32" rx="5.5" ry="6.5" fill="#fff"/><ellipse cx="40" cy="32" rx="5.5" ry="6.5" fill="#fff"/>
<circle cx="25.2" cy="33.4" rx="3.2" ry="3.2" fill="${inset}"/><circle cx="41.2" cy="33.4" rx="3.2" ry="3.2" fill="${inset}"/>
<circle cx="24" cy="31.8" r="1.2" fill="#fff"/><circle cx="40" cy="31.8" r="1.2" fill="#fff"/>
<circle cx="26.4" cy="35" r=".6" fill="#fff" opacity=".3"/><circle cx="42.4" cy="35" r=".6" fill="#fff" opacity=".3"/>`;
		}
		function blush() {
			return `<ellipse cx="15.5" cy="37" rx="3.2" ry="2" fill="#f58fa9" opacity=".55"/><ellipse cx="48.5" cy="37" rx="3.2" ry="2" fill="#f58fa9" opacity=".55"/>`;
		}
		function mouth(type, inset) {
			const s = `stroke="${inset}" stroke-width="3" stroke-linecap="round" fill="none"`;
			switch (type) {
				case "o": return `<ellipse cx="32" cy="42" rx="3.2" ry="2.2" fill="${inset}"/>`;
				case "w": return `<path d="M27 42l2.5 2.5 2.5-2.5 2.5 2.5 2.5-2.5" ${s}/>`;
				case "wave": return `<path d="M27 42q2.5 3 5 0t5 0" ${s}/>`;
				default: return `<path d="M27 42q5 4 10 0" ${s}/>`;
			}
		}
		function topType(type, color, dark) {
			switch (type) {
				case "tuft": return `<path d="M32 12c-2.5 5-1 9 .5 11.5 1.5-2.5 3-6.5.5-11.5z" fill="${dark}"/><path d="M31.2 13.5c-1 3-.3 5.5.8 7.6l1.6-1.6c-.7-1.6-1.6-3.6-2.4-6z" fill="#ffc5d7"/>`;
				case "round": return `<circle cx="15" cy="15" r="7" fill="${color}"/><circle cx="49" cy="15" r="7" fill="${color}"/><circle cx="15" cy="15" r="3.5" fill="#ffc5d7"/><circle cx="49" cy="15" r="3.5" fill="#ffc5d7"/>`;
				case "point": return `<path d="M20 18C16 9 18 4 22 4c4 0 6 5 5.6 13z" fill="${color}"/><path d="M44 18C48 9 46 4 42 4c-4 0-6 5-5.6 13z" fill="${color}"/><path d="M21.8 16C19.6 10 20.4 7 22.4 7c2 0 3 3 3.2 8z" fill="#ffc5d7"/><path d="M42.2 16C44.4 10 43.6 7 41.6 7c-2 0-3 3-3.2 8z" fill="#ffc5d7"/>`;
				default: return "";
			}
		}
		function internal(type) {
			if (type === "bubbles") return `<circle cx="20" cy="24" r="3" fill="#fff" opacity=".5"/><circle cx="45" cy="21" r="2" fill="#fff" opacity=".4"/><circle cx="46" cy="45" r="2.6" fill="#fff" opacity=".4"/>`;
			if (type === "sparkles") return `<path d="M40 44l1.2 2.4 2.4 1.2-2.4 1.2L40 51l-1.2-2.4-2.4-1.2 2.4-1.2z" fill="#fff" opacity=".7"/><circle cx="20" cy="22" r="1.6" fill="#fff" opacity=".5"/>`;
			return "";
		}
		function accessory(type, inset) {
			switch (type) {
				case "crown+star": return `<path d="M25 8l2 4 4.4-2.2-.8 4.6 3.2 2.6-4.4.8-1.6 4-2.6-3.2-4.4.8 2.4-4-1.6-4 4 1z" fill="#ffd84d" stroke="#fff" stroke-width="1.4"/><path d="M24 26l1.4 3 3 1.4-3 1.4-1.4 3-1.4-3-3-1.4 3-1.4z" fill="#fff"/><path d="M40 26l1.4 3 3 1.4-3 1.4-1.4 3-1.4-3-3-1.4 3-1.4z" fill="#fff"/>`;
				case "glasses": return `<circle cx="24" cy="32" r="7" fill="none" stroke="${inset}" stroke-width="2.6"/><circle cx="42" cy="32" r="7" fill="none" stroke="${inset}" stroke-width="2.6"/><path d="M31 32h4" stroke="${inset}" stroke-width="2.6"/>`;
				case "magnifier": return `<circle cx="49" cy="27" r="6.5" fill="none" stroke="#3d2a05" stroke-width="2.8"/><path d="M54 32l4 4" stroke="#3d2a05" stroke-width="3.2" stroke-linecap="round"/>`;
				case "pen": return `<path d="M43 38l6 11" stroke="#3d2a05" stroke-width="3" stroke-linecap="round"/><path d="M41.4 37.4l3.4-2.8 3.8 4.4-3.4 2z" fill="#ffd84d" stroke="#3d2a05" stroke-width="1.4"/>`;
				case "cross-eye": return `<path d="M20.4 32h7.2M24 28.4v7.2M36.4 32h7.2M40 28.4v7.2" stroke="${inset}" stroke-width="2.8" stroke-linecap="round"/>`;
				case "kanban": return `<rect x="17" y="28" width="12" height="10" rx="3" fill="none" stroke="${inset}" stroke-width="2.4"/><rect x="35" y="28" width="12" height="10" rx="3" fill="none" stroke="${inset}" stroke-width="2.4"/><path d="M29 33h6" stroke="${inset}" stroke-width="2.4"/>`;
				case "antenna": return `<path d="M32 8v8" stroke="${inset}" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="7" r="2.8" fill="#ffd84d"/><rect x="16" y="30" width="32" height="7" rx="3.4" fill="none" stroke="${inset}" stroke-width="2.4"/><circle cx="22" cy="33.5" r="1.8" fill="${inset}"/><path d="M30 33.5h12" stroke="${inset}" stroke-width="2.2" stroke-linecap="round"/>`;
				case "globe": return `<circle cx="24" cy="32" r="7" fill="none" stroke="${inset}" stroke-width="2.4"/><path d="M24 25v14M17.5 32h13M19 27.5c3.4 3 3.4 6.5 0 9.4M29 27.5c-3.4 3-3.4 6.5 0 9.4" stroke="${inset}" stroke-width="1.6" fill="none"/>`;
				case "sparkle": return `<path d="M15 28l1.6 3.2 3.2 1.6-3.2 1.6L15 38l-1.6-3.2-3.2-1.6 3.2-1.6z" fill="#fff" opacity=".7"/>`;
				case "star-eye": return `<path d="M23 28l1.8 3.8 3.8 1.8-3.8 1.8-1.8 3.8-1.8-3.8-3.8-1.8 3.8-1.8z" fill="#fff"/><path d="M41 28l1.8 3.8 3.8 1.8-3.8 1.8-1.8 3.8-1.8-3.8-3.8-1.8 3.8-1.8z" fill="#fff"/>`;
				case "cloud": return `<path d="M6 30c0-8 7-13 14-12 2-6 12-7 15-1 7-2 13 3 12 9 6 1 9 8 4 12 3 6-2 12-9 11-5 4-12 4-16-1-6 3-14 0-16-6-6-1-9-7-4-12z" fill="#8ba3bd"/><circle cx="20" cy="28" r="3" fill="#fff"/><circle cx="34" cy="26" r="3" fill="#fff"/><circle cx="46" cy="31" r="3" fill="#fff"/><path d="M24 36q4 3.4 8 0M40 36q4 3.4 8 0" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
				default: return "";
			}
		}
		function renderAvatarSVG(opts) {
			const { role, name, keywordHit, size = 64 } = opts;
			let def;
			if (role && ROLE_DEFS[role]) def = ROLE_DEFS[role];
			else if (keywordHit && ROLE_DEFS[keywordHit]) def = ROLE_DEFS[keywordHit];
			else if (role === "group") def = ROLE_DEFS.group;
			if (!def && name) {
				const [p, m, i, t] = hashName(name);
				def = {
					palette: p,
					mouth: [
						"smile",
						"o",
						"w",
						"wave"
					][m],
					top: [
						"none",
						"tuft",
						"round",
						"point"
					][t],
					internal: [
						"none",
						"bubbles",
						"sparkles"
					][i]
				};
			}
			if (!def) def = ROLE_DEFS.blank;
			const [topColor, botColor, inset] = PALETTES[def.palette % PALETTES.length];
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${[
				topType(def.top, botColor, botColor),
				bodyPath(topColor, botColor),
				internal(def.internal || "none"),
				eyes(inset),
				blush(),
				mouth(def.mouth, inset),
				accessory(def.accessory || "", inset)
			].filter(Boolean).join("\n")}</svg>`;
		}
		function renderLevelRing(level) {
			if (level < 4) return "";
			if (level >= 5) return `<circle cx="32" cy="32" r="30" fill="none" stroke="url(#gold)" stroke-width="2.5"/><defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffd700"/><stop offset="1" stop-color="#b8860b"/></linearGradient></defs><path d="M50 8l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z" fill="#ffd700" stroke="#fff" stroke-width="1"/>`;
			return `<circle cx="32" cy="32" r="30" fill="none" stroke="#daa520" stroke-width="2" opacity=".8"/>`;
		}
		//#endregion
		//#region src/client/index.tsx
		const API_ROOT = "/api/plugins/grokbot";
		const POLL_MS = 2e3;
		const GROKBOT_CSS = `
:root {
  --gk-bg-side: #f5f5f7;
  --gk-bg: #ffffff;
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
.grokbot-iconbtn { border:none; background:none; cursor:pointer; color:var(--gk-text-2); font-size:15px; width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; transition:all .16s cubic-bezier(.4,0,.2,1); }
.grokbot-iconbtn:hover { color:var(--gk-text); background:rgba(29,29,31,.07); }
.grokbot-sidebar__search { margin:4px 12px 10px; }
.grokbot-sidebar__search input { width:100%; box-sizing:border-box; border:none; border-radius:9px; background:rgba(29,29,31,.06); padding:7px 12px; font:inherit; font-size:13px; color:var(--gk-text); outline:none; transition:all .16s; }
.grokbot-sidebar__search input:focus { background:#fff; box-shadow:0 0 0 3px var(--gk-accent-soft); }
.grokbot-sidebar__search input::placeholder { color:var(--gk-text-3); }
.grokbot-sidebar__list { flex:1; overflow-y:auto; padding:0 8px 8px; scrollbar-width:thin; }
.grokbot-sidebar__list::-webkit-scrollbar { width:4px; }
.grokbot-sidebar__list::-webkit-scrollbar-thumb { background:rgba(29,29,31,.15); border-radius:4px; }
.grokbot-sidebar__section { font-size:11px; font-weight:600; color:var(--gk-text-3); margin:12px 8px 4px; letter-spacing:.06em; text-transform:uppercase; }
.grokbot-chatrow { display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; border:none; border-radius:11px; background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit; position:relative; transition:background .14s; }
.grokbot-chatrow:hover { background:rgba(29,29,31,.05); }
.grokbot-chatrow.active { background:var(--gk-accent-soft); }
.grokbot-chatrow.active::before { content:""; position:absolute; left:-2px; top:22%; bottom:22%; width:3px; border-radius:3px; background:linear-gradient(180deg,var(--gk-accent-2),var(--gk-accent)); }
.grokbot-avatar { position:relative; flex:none; }
.grokbot-avatar__circle { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px; color:#fff; box-shadow:inset 0 -1px 2px rgba(0,0,0,.12), var(--gk-shadow-sm); }
.grokbot-avatar__dot { position:absolute; right:-1px; bottom:-1px; width:11px; height:11px; border-radius:50%; background:var(--gk-green); border:2.5px solid var(--gk-bg-side); box-sizing:content-box; }
.grokbot-avatar__dot.working { background:var(--gk-amber); animation:grokbot-pulse 1.3s ease-in-out infinite; }
.grokbot-chatrow__main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.grokbot-chatrow__line1 { display:flex; align-items:baseline; gap:6px; }
.grokbot-chatrow__name { font-size:13.5px; font-weight:600; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chatrow__time { margin-left:auto; font-size:10.5px; color:var(--gk-text-3); flex:none; font-variant-numeric:tabular-nums; }
.grokbot-chatrow__preview { font-size:12px; color:var(--gk-text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-sidebar__foot { border-top:1px solid var(--gk-line); padding:10px 14px; display:flex; align-items:center; gap:8px; }
.grokbot-sidebar__user { display:flex; align-items:center; gap:8px; flex:1; min-width:0; font-size:12.5px; font-weight:600; color:var(--gk-text-2); }
.grokbot-sidebar__user .uavatar { width:26px; height:26px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
@keyframes grokbot-pulse { 0%,100% { opacity:1; transform:scale(1) } 50% { opacity:.4; transform:scale(.85) } }
.grokbot-newmenu { display:flex; flex-direction:column; gap:2px; margin:0 10px 10px; padding:6px; border:1px solid var(--gk-line); border-radius:13px; background:#fff; box-shadow:var(--gk-shadow-md); }
.grokbot-newmenu__item { display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; border:none; border-radius:9px; background:transparent; cursor:pointer; font:inherit; font-size:13px; color:var(--gk-text); text-align:left; transition:background .12s; }
.grokbot-newmenu__item:hover { background:var(--gk-bg-soft); }
.grokbot-newmenu__item:disabled { opacity:.5; }
.grokbot-newmenu__icon { width:24px; height:24px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; font-size:14px; flex:none; background:var(--gk-bg-soft); }
.grokbot-newmenu__divider { height:1px; background:var(--gk-line); margin:4px 6px; }
.grokbot-form { display:flex; flex-direction:column; gap:8px; padding:12px; margin:0 10px 8px; border:1px solid var(--gk-line); border-radius:13px; background:#fff; box-shadow:var(--gk-shadow-sm); }
.grokbot-form__row { display:flex; gap:6px; }
.grokbot-form input, .grokbot-form textarea, .grokbot-form select { flex:1; min-width:0; border:1px solid var(--gk-line); border-radius:9px; padding:7px 10px; font:inherit; font-size:13px; background:var(--gk-bg); color:var(--gk-text); transition:border-color .14s, box-shadow .14s; }
.grokbot-form input:focus, .grokbot-form textarea:focus, .grokbot-form select:focus { outline:none; border-color:var(--gk-accent-2); box-shadow:0 0 0 3px var(--gk-accent-soft); }
.grokbot-form textarea { resize:vertical; min-height:52px; }
.grokbot-form__actions { display:flex; gap:8px; justify-content:flex-end; }
.grokbot-form__actions button { border:none; border-radius:9px; padding:6px 16px; font-size:12.5px; cursor:pointer; font-weight:600; transition:all .14s; }
.grokbot-form__submit { background:linear-gradient(135deg,var(--gk-accent-2),var(--gk-accent)); color:#fff; box-shadow:0 2px 8px rgba(37,99,235,.28); }
.grokbot-form__submit:hover { filter:brightness(1.06); box-shadow:0 4px 12px rgba(37,99,235,.36); }
.grokbot-form__submit:disabled { opacity:.5; box-shadow:none; }
.grokbot-form__cancel { background:var(--gk-bg-soft); color:var(--gk-text); }
.grokbot-form__cancel:hover { background:rgba(29,29,31,.10); }
.grokbot-chat { width:100%; height:100%; display:flex; flex-direction:column; background:var(--gk-bg); }
.grokbot-chat__head { display:flex; align-items:center; gap:11px; padding:13px 20px; border-bottom:1px solid var(--gk-line); background:rgba(255,255,255,.85); backdrop-filter:blur(12px); }
.grokbot-chat__avatar { width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px; color:#fff; box-shadow:inset 0 -1px 2px rgba(0,0,0,.12), var(--gk-shadow-sm); }
.grokbot-chat__title { flex:1; display:flex; flex-direction:column; min-width:0; cursor:pointer; }
.grokbot-chat__name { font-weight:650; font-size:15px; letter-spacing:-.015em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chat__meta { font-size:12px; color:var(--gk-text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px; }
.grokbot-chat__stop { border:1px solid rgba(239,68,68,.35); background:rgba(239,68,68,.08); color:var(--gk-red); border-radius:9px; padding:5px 14px; font-size:12px; cursor:pointer; font-weight:600; transition:all .14s; }
.grokbot-chat__stop:hover { background:rgba(239,68,68,.16); }
.grokbot-chat__close { border:none; background:none; cursor:pointer; color:var(--gk-text-2); font-size:15px; width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; transition:all .14s; }
.grokbot-chat__close:hover { color:var(--gk-text); background:rgba(29,29,31,.07); }
.grokbot-body { flex:1; display:flex; min-height:0; }
.grokbot-log { flex:1; overflow-y:auto; padding:26px 30px; display:flex; flex-direction:column; gap:13px; scrollbar-width:thin; }
.grokbot-log::-webkit-scrollbar { width:5px; }
.grokbot-log::-webkit-scrollbar-thumb { background:rgba(29,29,31,.15); border-radius:5px; }
.grokbot-msg { max-width:72%; border-radius:16px; padding:10px 15px; font-size:14px; line-height:1.6; white-space:pre-wrap; word-break:break-word; letter-spacing:-.005em; }
.grokbot-msg.user { align-self:flex-end; background:var(--gk-bg-soft); color:var(--gk-text); border-bottom-right-radius:6px; }
.grokbot-msg.bot { align-self:flex-start; background:linear-gradient(180deg,#ffffff,#fcfdff); border:1px solid var(--gk-line); border-bottom-left-radius:6px; box-shadow:var(--gk-shadow-sm); }
.grokbot-msg.error { align-self:center; background:rgba(239,68,68,.08); color:var(--gk-red); font-size:12.5px; border:1px solid rgba(239,68,68,.2); }
.grokbot-msg.activity { align-self:center; background:transparent; font-size:11px; color:var(--gk-text-3); padding:2px 12px; font-variant-numeric:tabular-nums; }
.grokbot-msg.approval { align-self:flex-start; border:1px solid rgba(245,158,11,.4); background:linear-gradient(180deg,#fffbeb,#fff8e6); border-radius:14px; padding:11px 15px; box-shadow:var(--gk-shadow-sm); }
.grokbot-approval__title { font-size:13px; font-weight:650; margin-bottom:4px; }
.grokbot-approval__reason { font-size:12.5px; color:var(--gk-text-2); margin-bottom:10px; white-space:pre-wrap; }
.grokbot-approval__actions { display:flex; gap:8px; }
.grokbot-approval__actions button { border:none; border-radius:9px; padding:6px 18px; font-size:12.5px; font-weight:600; cursor:pointer; transition:all .14s; }
.grokbot-approval__ok { background:linear-gradient(135deg,#34d399,#22c55e); color:#fff; box-shadow:0 2px 8px rgba(34,197,94,.3); }
.grokbot-approval__ok:hover { filter:brightness(1.05); }
.grokbot-approval__no { background:var(--gk-bg-soft); color:var(--gk-text); }
.grokbot-msg .grokbot-msg__time { display:block; font-size:10px; color:var(--gk-text-3); margin-top:5px; text-align:inherit; font-variant-numeric:tabular-nums; }
.grokbot-empty { margin:auto; text-align:center; color:var(--gk-text-3); font-size:13px; line-height:1.7; }
.grokbot-details { width:272px; flex:none; border-left:1px solid var(--gk-line); overflow-y:auto; padding:16px 16px 24px; display:flex; flex-direction:column; gap:18px; background:#fafafc; }
.grokbot-rating { border:1px solid var(--gk-line); border-radius:12px; padding:11px 13px; background:#fff; }
.grokbot-rating__head { display:flex; align-items:center; gap:8px; }
.grokbot-rating__level { background:linear-gradient(135deg,var(--gk-accent-2),var(--gk-accent)); color:#fff; font-size:11px; font-weight:700; border-radius:7px; padding:2px 8px; }
.grokbot-rating__title { font-size:13px; font-weight:650; }
.grokbot-rating__stars { margin-left:auto; color:#f5a623; font-size:12px; letter-spacing:1px; }
.grokbot-rating__bar { height:6px; border-radius:3px; background:var(--gk-bg-soft); margin:9px 0 6px; overflow:hidden; }
.grokbot-rating__fill { height:100%; border-radius:3px; background:linear-gradient(90deg,var(--gk-accent-2),var(--gk-accent)); transition:width .3s; }
.grokbot-rating__nums { font-size:11px; color:var(--gk-text-3); font-variant-numeric:tabular-nums; }
.grokbot-fb { margin-left:8px; white-space:nowrap; }
.grokbot-fb button { border:none; background:none; cursor:pointer; font-size:11px; opacity:.4; padding:0 2px; transition:opacity .12s, transform .12s; }
.grokbot-fb button:hover { opacity:1; transform:scale(1.2); }
.grokbot-details__title { font-size:11px; font-weight:700; color:var(--gk-text-3); letter-spacing:.07em; text-transform:uppercase; }
.grokbot-member { display:flex; align-items:center; gap:10px; padding:7px 6px; font-size:13px; font-weight:500; border-radius:9px; }
.grokbot-member:hover { background:rgba(29,29,31,.04); }
.grokbot-member .mavatar { width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; color:#fff; box-shadow:var(--gk-shadow-sm); }
.grokbot-details__hint { font-size:11.5px; color:var(--gk-text-3); padding:4px 6px 0; line-height:1.5; }
.grokbot-routine { border:1px solid var(--gk-line); border-radius:11px; padding:9px 11px; font-size:12px; background:#fff; }
.grokbot-routine__prompt { color:var(--gk-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-routine__sched { font-size:11px; color:var(--gk-text-3); margin-top:3px; }
.grokbot-details__new { border:1px dashed rgba(37,99,235,.4); border-radius:11px; background:rgba(37,99,235,.04); color:var(--gk-accent); padding:8px; font-size:12.5px; font-weight:600; cursor:pointer; width:100%; transition:all .14s; }
.grokbot-details__new:hover { background:var(--gk-accent-soft); border-color:var(--gk-accent-2); }
.grokbot-inputbar { display:flex; align-items:flex-end; gap:4px; padding:12px 18px 18px; }
.grokbot-inputbar textarea { flex:1; resize:none; border:1px solid var(--gk-line); border-radius:14px; padding:11px 15px; font:inherit; font-size:13.5px; line-height:1.55; min-height:46px; max-height:150px; background:var(--gk-bg); color:var(--gk-text); transition:border-color .16s, box-shadow .16s; }
.grokbot-inputbar textarea:focus { outline:none; border-color:var(--gk-accent-2); box-shadow:0 0 0 4px var(--gk-accent-soft); }
.grokbot-inputbar textarea::placeholder { color:var(--gk-text-3); }
.grokbot-inputbar .side { border:none; background:none; cursor:pointer; color:var(--gk-text-2); font-size:17px; width:36px; height:38px; display:inline-flex; align-items:center; justify-content:center; border-radius:11px; transition:all .14s; }
.grokbot-inputbar .side:hover { color:var(--gk-accent); background:var(--gk-accent-soft); }
.grokbot-inputbar .side:disabled { opacity:.3; cursor:default; }
.grokbot-md__p { white-space:pre-wrap; }
.grokbot-md__h1, .grokbot-md__h2, .grokbot-md__h3, .grokbot-md__h4 { font-weight:700; margin:8px 0 3px; letter-spacing:-.01em; }
.grokbot-md__h1 { font-size:17px; } .grokbot-md__h2 { font-size:15.5px; } .grokbot-md__h3 { font-size:14.5px; } .grokbot-md__h4 { font-size:13.5px; }
.grokbot-md__ul { margin:3px 0; padding-left:19px; }
.grokbot-md__ul li { margin:2px 0; }
.grokbot-md__quote { border-left:3px solid var(--gk-line); margin:5px 0; padding:2px 11px; color:var(--gk-text-2); }
.grokbot-md__hr { border:none; border-top:1px solid var(--gk-line); margin:9px 0; }
.grokbot-md__spacer { height:6px; }
.grokbot-md__icode { background:rgba(29,29,31,.07); border-radius:6px; padding:1.5px 6px; font-size:12.5px; font-family:ui-monospace,"SF Mono",Menlo,monospace; }
.grokbot-md__link { color:var(--gk-accent); text-decoration:none; font-weight:500; }
.grokbot-md__link:hover { text-decoration:underline; }
.grokbot-code { align-self:stretch; max-width:100%; border:1px solid var(--gk-line); border-radius:13px; overflow:hidden; margin:5px 0; background:#fafafc; box-shadow:var(--gk-shadow-sm); }
.grokbot-code__bar { display:flex; align-items:center; justify-content:space-between; padding:5px 12px; border-bottom:1px solid var(--gk-line); font-size:10.5px; }
.grokbot-code__lang { color:var(--gk-text-3); text-transform:uppercase; letter-spacing:.07em; font-weight:700; font-family:ui-monospace,Menlo,monospace; }
.grokbot-code__actions { display:flex; gap:8px; }
.grokbot-code__actions button { border:none; background:none; cursor:pointer; font-size:11px; color:var(--gk-accent); font-weight:600; padding:2px 4px; }
.grokbot-code__actions button:hover { text-decoration:underline; }
.grokbot-code__pre { margin:0; padding:11px 14px; overflow-x:auto; font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:12.5px; line-height:1.55; white-space:pre; color:var(--gk-text); }
.grokbot-code__pre.collapsed { display:none; }
.grokbot-code__peek { border:none; background:none; cursor:pointer; text-align:left; padding:9px 14px; font-family:ui-monospace,Menlo,monospace; font-size:11.5px; color:var(--gk-text-3); width:100%; }
.grokbot-chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:9px; }
.grokbot-chips__item { border:1px solid rgba(37,99,235,.35); background:var(--gk-accent-soft); color:var(--gk-accent); border-radius:16px; padding:5px 16px; font-size:12.5px; cursor:pointer; font-weight:600; transition:all .14s; }
.grokbot-chips__item:hover { background:rgba(37,99,235,.18); transform:translateY(-1px); }
.grokbot-chips__item:disabled { opacity:.45; cursor:default; transform:none; }
.grokbot-blank { flex:1; background:radial-gradient(1200px 500px at 50% 30%, #f8f9fc 0%, var(--gk-bg) 60%); }
.grokbot-creating { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; font-size:13.5px; color:var(--gk-text-2); font-weight:500; }
.grokbot-creating__spinner { width:28px; height:28px; border-radius:50%; border:3px solid var(--gk-accent-soft); border-top-color:var(--gk-accent); animation:grokbot-spin .75s linear infinite; }
@keyframes grokbot-spin { to { transform:rotate(360deg) } }
.grokbot-wizard { flex:1; overflow-y:auto; display:flex; flex-direction:column; align-items:center; gap:22px; padding:52px 32px; font-family:var(--gk-font); color:var(--gk-text); background:radial-gradient(900px 380px at 50% 12%, #f6f8ff 0%, #fff 55%); }
.grokbot-wizard__steps { display:flex; gap:16px; font-size:12px; color:var(--gk-text-3); font-weight:600; letter-spacing:.02em; }
.grokbot-wizard__steps .on { color:var(--gk-accent); font-weight:700; }
.grokbot-wizard__steps .ok { color:var(--gk-text-2); }
.grokbot-wizard__steps .ok::after { content:" ✓"; color:var(--gk-green); font-weight:700; }
.grokbot-wizard__title { font-size:22px; font-weight:750; letter-spacing:-.02em; }
.grokbot-wizard__roles { display:flex; flex-wrap:wrap; gap:13px; justify-content:center; max-width:660px; }
.grokbot-role { width:152px; display:flex; flex-direction:column; align-items:center; gap:7px; padding:20px 10px 15px; border:1px solid var(--gk-line); border-radius:16px; background:#fff; cursor:pointer; font:inherit; color:inherit; transition:all .18s cubic-bezier(.4,0,.2,1); box-shadow:var(--gk-shadow-sm); }
.grokbot-role:hover { border-color:var(--gk-accent-2); transform:translateY(-3px); box-shadow:0 10px 28px rgba(37,99,235,.16); }
.grokbot-role:disabled { opacity:.5; cursor:default; transform:none; }
.grokbot-role__avatar { width:48px; height:48px; border-radius:16px; display:flex; align-items:center; justify-content:center; box-shadow:var(--gk-shadow-sm); }
.grokbot-role__avatar svg { width:58%; height:58%; }
.grokbot-role__name { font-size:14.5px; font-weight:700; letter-spacing:-.01em; }
.grokbot-role__desc { font-size:11.5px; color:var(--gk-text-3); }
.grokbot-wizard__names { display:flex; gap:9px; flex-wrap:wrap; justify-content:center; }
.grokbot-wizard__custom { display:flex; gap:8px; width:min(380px,90%); }
.grokbot-wizard__custom input { flex:1; min-width:0; border:1px solid var(--gk-line); border-radius:11px; padding:10px 14px; font:inherit; font-size:13.5px; background:#fff; color:var(--gk-text); outline:none; transition:all .16s; }
.grokbot-wizard__custom input:focus { border-color:var(--gk-accent-2); box-shadow:0 0 0 4px var(--gk-accent-soft); }
.grokbot-wizard__skip { border:none; background:none; color:var(--gk-text-3); font-size:12.5px; cursor:pointer; padding:4px 10px; transition:color .14s; }
.grokbot-wizard__skip:hover { color:var(--gk-accent); }
.grokbot-wizard__hint { font-size:12.5px; color:var(--gk-text-3); }
`;
		/** Grok 风头像：专家=名字首字白字；群/角色=单线条矢量图标；底=专属渐变 */
		function AvatarView(props) {
			const roleKey = props.glyph;
			const size = props.size;
			const isKnown = roleKey && ROLE_DEFS[roleKey] !== void 0;
			const ring = props.level !== void 0 && props.level >= 4 ? renderLevelRing(props.level) : "";
			if (isKnown) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: {
					width: size,
					height: size,
					position: "relative",
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					flex: "none"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: `/api/plugins/grokbot/assets/avatars/${roleKey}`,
					width: size,
					height: size,
					style: {
						borderRadius: "50%",
						display: "block",
						objectFit: "contain"
					},
					alt: props.name || roleKey
				}), ring ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						position: "absolute",
						inset: -2,
						pointerEvents: "none"
					},
					dangerouslySetInnerHTML: { __html: ring.replace("<svg ", `<svg width="${size + 4}" height="${size + 4}" `) }
				}) : null]
			});
			const svgHtml = renderAvatarSVG({
				name: props.name,
				size
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: {
					width: size,
					height: size,
					position: "relative",
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					flex: "none"
				},
				dangerouslySetInnerHTML: { __html: svgHtml }
			});
		}
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
			const [grouping, setGrouping] = (0, react.useState)(false);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [creatingBot, setCreatingBot] = (0, react.useState)(false);
			const [filter, setFilter] = (0, react.useState)("");
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
			const routines = state?.routines ?? [];
			const conversations = (state?.conversations ?? []).filter((conversation) => conversation.memberBotIds.every((botId) => botOf(botId) && !botOf(botId).hidden)).filter((conversation) => {
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
					if (bot?.status === "working") return `工作中${bot.currentJob ? ` · ${bot.currentJob}` : ""}`;
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
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grokbot-iconbtn",
							title: "新建：召唤专家 / 拉群聊 / 与 Bot 单聊",
							onClick: () => setMenuOpen((v) => !v),
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
													fontSize: 11,
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
											children: bot.avatar
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "grokbot-sidebar__section",
								children: "会话"
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
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: `grokbot-chatrow${target?.id === conversation.id ? " active" : ""}`,
									onClick: () => openConversation(conversation.id),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "grokbot-avatar",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
											seed: isGroup ? conversation.id : bot?.id ?? conversation.id,
											name: bot?.name,
											glyph: isGroup ? "group" : bot?.roleTemplate || void 0,
											size: 36,
											level: !isGroup ? bot?.rating?.level : void 0
										}), !isGroup ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `grokbot-avatar__dot${working ? " working" : ""}` }) : null]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "grokbot-chatrow__main",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "grokbot-chatrow__line1",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "grokbot-chatrow__name",
												children: rowTitle(conversation)
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "grokbot-chatrow__time",
												children: timeLabel(conversation.lastAt)
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "grokbot-chatrow__preview",
											children: rowPreview(conversation)
										})]
									})]
								}, conversation.id);
							})
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
		let mdKeySeed = 0;
		function renderInline(text) {
			const parts = [];
			const re = /(\*\*[^*]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)]+)/g;
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
					const link = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(token);
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
		function MarkdownView(props) {
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
		}
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
								glyph: member.roleTemplate || void 0,
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
								children: candidate.avatar
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
			const propsBots = state?.bots ?? [];
			const [draft, setDraft] = (0, react.useState)("");
			const [sending, setSending] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(false);
			const [detailsOpen, setDetailsOpen] = (0, react.useState)(false);
			const [newRoutine, setNewRoutine] = (0, react.useState)(false);
			const [historyRefresh, forceRefresh] = (0, react.useState)(0);
			const logRef = (0, react.useRef)(null);
			const messages = (0, react.useMemo)(() => historyOf(bot.id), [
				bot.id,
				sending,
				historyRefresh
			]);
			const pending = (state?.approvals ?? []).filter((approval) => approval.botId === bot.id);
			(0, react.useEffect)(() => {
				if (loadedHistoryFor.has(bot.id) || histories.get(bot.id)?.length) return;
				loadedHistoryFor.add(bot.id);
				api(`/conversations/${encodeURIComponent(bot.id)}`).then((outcome) => {
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
			const send = (0, react.useCallback)(async (overrideText) => {
				const text = (overrideText ?? draft).trim();
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
					const outcome = await api(`/conversations/${encodeURIComponent(bot.id)}/chat`, {
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
								seed: bot.id,
								name: bot.name,
								glyph: bot.roleTemplate || void 0,
								size: 38,
								level: bot.rating?.level
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
					bot.setupStage ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "grokbot-body",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SetupWizard, {
							bot,
							onAdvance: () => refreshState?.()
						})
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								messages.map((message) => {
									const botIdForFb = bot.id;
									if (message.role === "bot") {
										const { body, chips } = splitChips(message.text);
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
													children: [
														bot.avatar,
														" ",
														bot.name
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownView, { text: body }),
												chips.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "grokbot-chips",
													children: chips.map((chip) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "grokbot-chips__item",
														disabled: sending,
														onClick: () => void send(chip),
														children: chip
													}, chip))
												}) : null,
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "grokbot-msg__time",
													children: [new Date(message.at).toLocaleTimeString(), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
												})
											]
										}, message.id);
									}
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: `grokbot-msg ${message.role}`,
										children: [message.text, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "grokbot-msg__time",
											children: new Date(message.at).toLocaleTimeString()
										})]
									}, message.id);
								}),
								pending.map((approval) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ApprovalCard, { approval }, approval.id)),
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
						}), detailsOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "grokbot-details",
							children: [
								bot.rating ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "grokbot-rating",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "grokbot-rating__head",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
													src: `/api/plugins/grokbot/assets/rating/badge-lv${bot.rating.level}`,
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
														src: `/api/plugins/grokbot/assets/rating/star-${i < bot.rating.stars ? "filled" : "empty"}`,
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
						}) : null]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					})] })
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
			const [detailsOpen, setDetailsOpen] = (0, react.useState)(false);
			const [messages, setMessages] = (0, react.useState)([]);
			const [draft, setDraft] = (0, react.useState)("");
			const [sending, setSending] = (0, react.useState)(false);
			const logRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				let alive = true;
				const tick = () => {
					api(`/conversations/${encodeURIComponent(room.id)}`).then((outcome) => {
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
					const outcome = await api(`/conversations/${encodeURIComponent(room.id)}/chat`, {
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
					if (event.key === "Escape" && !detailsOpen) closeTarget();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-chat__head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarView, {
								seed: room.id,
								glyph: "group",
								size: 38
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "grokbot-chat__title",
								onClick: () => setDetailsOpen((v) => !v),
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
						className: "grokbot-body",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownView, { text: splitChips(message.text).body }),
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
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
						})]
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
			const activeKey = nativeVisible ? null : target ? `conversation:${target.id}` : creatingUi ? "creating" : "home";
			const entering = Boolean(target) && !conversation;
			const [box, setBox] = (0, react.useState)(null);
			(0, react.useRef)([]);
			(0, react.useEffect)(() => {
				if (!activeKey) return;
				const center = document.querySelector("[class*=\"centerCol\"]") ?? null;
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
				takeover();
				const observer = new ResizeObserver(takeover);
				observer.observe(center);
				window.addEventListener("resize", takeover);
				return () => {
					observer.disconnect();
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
					if (bot) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BotChatView, {
						bot,
						state
					});
					if (conversation && isGroup) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupChatView, {
						conversation,
						bots: state?.bots ?? []
					});
					if (creatingUi || entering) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "grokbot-creating",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "grokbot-creating__spinner" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: entering ? "正在进入会话…" : "正在召唤专家…" })]
					});
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "grokbot-blank" });
				})()
			});
		}
		const inject = ["slots"];
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.dshGrokbot = "";
				document.head.append(style);
				const update = () => {
					style.textContent = GROKBOT_CSS + (nativeSidebarVisible ? "" : "\n.grokbot-takeover [class*=\"centerCol\"] > * { display: none !important; }\n.grokbot-takeover [class*=\"detailsCol\"] { display: none !important; }");
				};
				update();
				listeners.add(update);
				return () => {
					listeners.delete(update);
					style.remove();
				};
			}, "grokbot: styles + takeover CSS");
			ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
				name: "sidebar.workspaces",
				id: "grokbot-crew",
				order: -100
			}, GrokbotSidebarCrew));
			if (typeof document !== "undefined" && !nativeSidebarVisible) document.body.classList.add("grokbot-takeover");
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
