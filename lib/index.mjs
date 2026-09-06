import { createRequire } from "node:module";
import { existsSync, watch } from "node:fs";
import { appendFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
//#region \0rolldown/runtime.js
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
//#endregion
//#region src/crew.mjs
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;
const DEFAULT_CREW = {
	routing: { default: "chief" },
	bots: [{
		id: "chief",
		name: "幕僚长",
		avatar: "🎖️",
		persona: "你是常驻桌面 agent 团队的幕僚长。用简体中文回复。用户投递的任务由你直接处理；处理不了时在回复里说明需要哪类专家。只汇报真实完成的操作。",
		workspace: "",
		model: null
	}]
};
function normalizeBot(raw, index) {
	if (!raw || typeof raw !== "object") throw new Error(`crew.bots[${index}] 必须是对象`);
	const id = String(raw.id || "").trim();
	if (!SAFE_ID_RE.test(id)) throw new Error(`crew.bots[${index}].id 非法：${id}（只允许字母数字._-）`);
	const model = raw.model && (raw.model.provider || raw.model.model) ? {
		provider: String(raw.model.provider || ""),
		model: String(raw.model.model || "")
	} : null;
	return {
		id,
		name: String(raw.name || id).trim() || id,
		avatar: String(raw.avatar || "🤖").trim() || "🤖",
		title: String(raw.title || "").trim(),
		persona: String(raw.persona || "").trim(),
		workspace: String(raw.workspace || "").trim(),
		model,
		pinned: raw.pinned === true,
		section: String(raw.section || "").trim(),
		hidden: raw.hidden === true
	};
}
function normalizeConversation(raw, index, ids) {
	if (!raw || typeof raw !== "object") throw new Error(`crew.conversations[${index}] 必须是对象`);
	const id = String(raw.id || "").trim();
	if (!SAFE_ID_RE.test(id)) throw new Error(`crew.conversations[${index}].id 非法：${id}`);
	const members = Array.isArray(raw.memberBotIds) ? raw.memberBotIds.map(String) : [];
	if (members.length < 1 || members.length > 6) throw new Error(`会话 ${id} 成员数须在 1-6（1=私聊，2-6=群聊）`);
	for (const memberId of members) if (!ids.has(memberId)) throw new Error(`会话 ${id} 成员不存在：${memberId}`);
	return {
		id,
		name: String(raw.name || "").trim(),
		memberBotIds: [...new Set(members)]
	};
}
function normalizeRoutine(raw, index, ids) {
	if (!raw || typeof raw !== "object") throw new Error(`crew.routines[${index}] 必须是对象`);
	const id = String(raw.id || "").trim();
	if (!SAFE_ID_RE.test(id)) throw new Error(`crew.routines[${index}].id 非法：${id}`);
	const botId = String(raw.botId || "").trim();
	if (!ids.has(botId)) throw new Error(`routine ${id} 归属 bot 不存在：${botId}`);
	const schedule = raw.schedule && typeof raw.schedule === "object" ? raw.schedule : {};
	const everyMinutes = Number(schedule.everyMinutes);
	const time = String(schedule.time || "").trim();
	if (!(Number.isInteger(everyMinutes) && everyMinutes >= 1) && !/^\d{1,2}:\d{2}$/.test(time)) throw new Error(`routine ${id} 的 schedule 须为 everyMinutes(分钟) 或 time(HH:MM)`);
	const prompt = String(raw.prompt || "").trim();
	if (!prompt) throw new Error(`routine ${id} 缺少 prompt`);
	return {
		id,
		botId,
		prompt,
		schedule: Number.isInteger(everyMinutes) && everyMinutes >= 1 ? { everyMinutes } : { time },
		enabled: raw.enabled !== false
	};
}
function parseCrew(text) {
	const raw = JSON.parse(text);
	const normalized = (Array.isArray(raw?.bots) && raw.bots.length > 0 ? raw.bots : DEFAULT_CREW.bots).map(normalizeBot);
	const ids = new Set(normalized.map((bot) => bot.id));
	if (ids.size !== normalized.length) throw new Error("crew.bots 中存在重复 id");
	const fallback = normalized[0].id;
	const defaultBot = String(raw?.routing?.default || fallback).trim();
	if (!ids.has(defaultBot)) throw new Error(`routing.default 指向不存在的 bot：${defaultBot}`);
	const normModel = (value) => value && (value.provider || value.model) ? {
		provider: String(value.provider || ""),
		model: String(value.model || "")
	} : null;
	let conversations = Array.isArray(raw?.conversations) ? raw.conversations.map((conversation, i) => normalizeConversation(conversation, i, ids)) : [];
	if (conversations.length === 0 && Array.isArray(raw?.rooms) && raw.rooms.length > 0) conversations = raw.rooms.map((room, i) => normalizeConversation(room, i, ids));
	const routines = Array.isArray(raw?.routines) ? raw.routines.map((routine, i) => normalizeRoutine(routine, i, ids)) : [];
	return {
		routing: { default: defaultBot },
		bots: normalized,
		conversations,
		routines,
		defaultModel: normModel(raw?.defaultModel),
		utilityModel: normModel(raw?.utilityModel)
	};
}
function serializeCrew(crew) {
	return `${JSON.stringify({
		routing: crew.routing,
		defaultModel: crew.defaultModel || null,
		utilityModel: crew.utilityModel || null,
		bots: crew.bots.map((bot) => ({
			...bot,
			model: bot.model || null
		})),
		conversations: crew.conversations || [],
		routines: (crew.routines || []).map((routine) => ({
			...routine,
			schedule: routine.schedule
		}))
	}, null, 2)}\n`;
}
async function loadOrCreateCrew(stateDir) {
	const path = join(stateDir, "crew.json");
	try {
		return {
			path,
			crew: parseCrew(await readFile(path, "utf8")),
			created: false
		};
	} catch (error) {
		if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
			if (error instanceof SyntaxError) throw new Error(`crew.json 解析失败：${error.message}`);
		}
		if (error?.code !== "ENOENT") throw new Error(`crew.json 读取失败：${error?.message || error}`);
	}
	const crew = {
		routing: DEFAULT_CREW.routing,
		bots: DEFAULT_CREW.bots.map((bot, i) => normalizeBot(bot, i))
	};
	await mkdir(stateDir, { recursive: true });
	await atomicWrite(path, serializeCrew(crew));
	return {
		path,
		crew,
		created: true
	};
}
function routeJob(crew, job) {
	const wanted = String(job?.toBot || job?.bot || "").trim();
	if (wanted) {
		const hit = crew.bots.find((bot) => bot.id === wanted);
		if (hit) return hit;
	}
	return crew.bots.find((bot) => bot.id === crew.routing.default) || crew.bots[0];
}
async function atomicWrite(path, text) {
	const tmp = `${path}.${randomUUID()}.tmp`;
	await writeFile(tmp, text, "utf8");
	await rename(tmp, path);
}
function botWorkspace(stateDir, bot) {
	return bot.workspace || join(stateDir, "workspace");
}
function slugId(name) {
	return `${String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "bot"}-${randomUUID().slice(0, 6)}`;
}
function createBot(crew, input) {
	const draft = {
		id: String(input?.id || "").trim() || slugId(input?.name),
		name: String(input?.name || input?.id || "新专家").trim(),
		avatar: String(input?.avatar || "🤖").trim() || "🤖",
		title: String(input?.title || "").trim(),
		persona: String(input?.persona || "").trim(),
		workspace: String(input?.workspace || "").trim(),
		model: input?.model && (input.model.provider || input.model.model) ? {
			provider: String(input.model.provider || ""),
			model: String(input.model.model || "")
		} : null,
		pinned: input?.pinned === true,
		section: String(input?.section || "").trim(),
		hidden: input?.hidden === true
	};
	if (crew.bots.some((bot) => bot.id === draft.id)) throw new Error(`bot id 已存在：${draft.id}`);
	if (crew.bots.length + (crew.conversations?.length ?? 0) >= 50) throw new Error("bots+conversations 总数已达上限 50");
	const bot = normalizeBot(draft, crew.bots.length);
	crew.bots.push(bot);
	return bot;
}
const EDITABLE_FIELDS = [
	"name",
	"avatar",
	"title",
	"persona",
	"workspace",
	"pinned",
	"section",
	"hidden",
	"model"
];
function updateBot(crew, botId, patch) {
	const bot = crew.bots.find((entry) => entry.id === botId);
	if (!bot) throw new Error(`bot 不存在：${botId}`);
	if (!patch || typeof patch !== "object") throw new Error("patch 必须是对象");
	for (const key of Object.keys(patch)) if (!EDITABLE_FIELDS.includes(key)) throw new Error(`不可编辑字段：${key}`);
	Object.assign(bot, normalizeBot({
		...bot,
		...patch
	}, 0));
	if (crew.routing.default === botId && bot.hidden === true) bot.hidden = false;
	return bot;
}
function removeBot(crew, botId) {
	const index = crew.bots.findIndex((entry) => entry.id === botId);
	if (index < 0) throw new Error(`bot 不存在：${botId}`);
	if (crew.bots.length <= 1) throw new Error("至少保留一个专家");
	crew.bots.splice(index, 1);
	if (crew.routing.default === botId) crew.routing.default = crew.bots[0].id;
	for (const conversation of crew.conversations ?? []) conversation.memberBotIds = conversation.memberBotIds.filter((memberId) => memberId !== botId);
	crew.conversations = (crew.conversations ?? []).filter((conversation) => conversation.memberBotIds.length > 0);
	if (Array.isArray(crew.routines)) crew.routines = crew.routines.filter((routine) => routine.botId !== botId);
	return crew.bots;
}
function duplicateBot(crew, botId) {
	const source = crew.bots.find((entry) => entry.id === botId);
	if (!source) throw new Error(`bot 不存在：${botId}`);
	return createBot(crew, {
		name: `${source.name} 副本`,
		avatar: source.avatar,
		title: source.title,
		persona: source.persona,
		workspace: source.workspace,
		model: source.model,
		pinned: false,
		section: source.section,
		hidden: false
	});
}
function createConversation(crew, input) {
	if (!Array.isArray(crew.conversations)) crew.conversations = [];
	const ids = new Set(crew.bots.map((bot) => bot.id));
	const memberBotIds = Array.isArray(input?.memberBotIds) ? input.memberBotIds.map(String) : [];
	const draft = {
		id: String(input?.id || "").trim() || (memberBotIds.length === 1 ? memberBotIds[0] : slugId(String(input?.name || "conv"))),
		name: String(input?.name || "").trim(),
		memberBotIds
	};
	if (crew.conversations.some((conversation) => conversation.id === draft.id)) throw new Error(`conversation id 已存在：${draft.id}`);
	const conversation = normalizeConversation(draft, crew.conversations.length, ids);
	crew.conversations.push(conversation);
	return conversation;
}
function renameConversation(crew, conversationId, name) {
	const conversation = crew.conversations?.find((entry) => entry.id === conversationId);
	if (!conversation) throw new Error(`conversation 不存在：${conversationId}`);
	conversation.name = String(name || "").trim();
	return conversation;
}
function addConversationMember(crew, conversationId, botId) {
	const conversation = crew.conversations?.find((entry) => entry.id === conversationId);
	if (!conversation) throw new Error(`conversation 不存在：${conversationId}`);
	if (!crew.bots.some((bot) => bot.id === botId)) throw new Error(`bot 不存在：${botId}`);
	if (conversation.memberBotIds.includes(botId)) throw new Error(`成员已在会话中：${botId}`);
	if (conversation.memberBotIds.length >= 6) throw new Error("会话成员已达上限 6");
	conversation.memberBotIds.push(botId);
	return conversation;
}
function removeConversationMember(crew, conversationId, botId) {
	const conversation = crew.conversations?.find((entry) => entry.id === conversationId);
	if (!conversation) throw new Error(`conversation 不存在：${conversationId}`);
	const index = conversation.memberBotIds.indexOf(botId);
	if (index < 0) throw new Error(`成员不在会话中：${botId}`);
	if (conversation.memberBotIds.length <= 1) throw new Error("会话至少保留一名成员");
	conversation.memberBotIds.splice(index, 1);
	return conversation;
}
function removeConversation(crew, conversationId) {
	const index = crew.conversations?.findIndex((entry) => entry.id === conversationId) ?? -1;
	if (index < 0) throw new Error(`conversation 不存在：${conversationId}`);
	crew.conversations.splice(index, 1);
	return crew.conversations;
}
function upsertRoutine(crew, input, routineId) {
	if (!Array.isArray(crew.routines)) crew.routines = [];
	const ids = new Set(crew.bots.map((bot) => bot.id));
	if (routineId) {
		const routine = crew.routines.find((entry) => entry.id === routineId);
		if (!routine) throw new Error(`routine 不存在：${routineId}`);
		Object.assign(routine, normalizeRoutine({
			...routine,
			...input ?? {}
		}, 0, ids));
		return routine;
	}
	const draft = {
		...input,
		id: String(input?.id || "").trim() || slugId("routine")
	};
	if (crew.routines.some((routine) => routine.id === draft.id)) throw new Error(`routine id 已存在：${draft.id}`);
	const routine = normalizeRoutine(draft, crew.routines.length, ids);
	crew.routines.push(routine);
	return routine;
}
function removeRoutine(crew, routineId) {
	const index = crew.routines?.findIndex((entry) => entry.id === routineId) ?? -1;
	if (index < 0) throw new Error(`routine 不存在：${routineId}`);
	crew.routines.splice(index, 1);
	return crew.routines;
}
//#endregion
//#region src/inbox.mjs
/**
* todi-hub 兼容文件协议：
*   <inbox>/queue.jsonl            每行一个 {jobId, text, dir, images, toBot?}
*   <inbox>/<jobId>/job.json       任务详情（可选，queue 行已含关键信息）
*   <inbox>/<jobId>/prompt.md      完整提示词（优先于 job.text）
*   <inbox>/<jobId>/image_*.png    附件
*   <inbox>/<jobId>/reply.md       插件写入的回复（非空即完成）
*   <inbox>/<jobId>/status.json    插件写入的状态 {status, botId, ...}
*/
async function ensureInbox(inboxRoot) {
	await mkdir(inboxRoot, { recursive: true });
}
async function readJsonIfPresent(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return null;
	}
}
async function readTextIfPresent(path) {
	try {
		return await readFile(path, "utf8");
	} catch {
		return "";
	}
}
async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
async function scanInbox(inboxRoot, { limit = 50 } = {}) {
	const queueText = await readTextIfPresent(join(inboxRoot, "queue.jsonl"));
	const jobs = [];
	for (const line of queueText.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let entry;
		try {
			entry = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const jobId = String(entry.jobId || entry.id || "").trim();
		if (!jobId) continue;
		const rawDir = String(entry.dir || "");
		const dir = rawDir && existsSync(rawDir) ? rawDir : join(inboxRoot, jobId);
		const status = await readJsonIfPresent(join(dir, "status.json"));
		if (status && status.status !== "queued") continue;
		if (await exists(join(dir, "reply.md"))) continue;
		const promptMd = await readTextIfPresent(join(dir, "prompt.md"));
		const jobJson = await readJsonIfPresent(join(dir, "job.json"));
		jobs.push({
			jobId,
			dir,
			toBot: String(entry.toBot || jobJson?.toBot || "").trim(),
			text: promptMd.trim() || String(entry.text || jobJson?.text || "").trim(),
			images: Array.isArray(entry.images) ? entry.images.map(String) : [],
			createdAt: Number(entry.createdAt) || null,
			...entry.fromBotId || jobJson?.fromBotId ? { fromBotId: String(entry.fromBotId || jobJson.fromBotId) } : {},
			...entry.conversationId || jobJson?.conversationId ? { conversationId: String(entry.conversationId || jobJson.conversationId) } : {},
			...entry.taskId || jobJson?.taskId ? { taskId: String(entry.taskId || jobJson.taskId) } : {},
			...entry.handoff || jobJson?.handoff ? { handoff: entry.handoff || jobJson.handoff } : {}
		});
		if (jobs.length >= limit) break;
	}
	return jobs;
}
async function claimJob(job, botId) {
	await mkdir(job.dir, { recursive: true });
	await writeStatus(job.dir, {
		status: "claimed",
		botId,
		jobId: job.jobId,
		startedAt: Date.now()
	});
}
async function readStatusIfPresent(dir) {
	try {
		return JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
	} catch {
		return null;
	}
}
async function completeJob(job, botId, replyText) {
	await atomicWriteFile(join(job.dir, "reply.md"), `${replyText.trim()}\n`);
	const claimed = await readStatusIfPresent(job.dir);
	await writeStatus(job.dir, {
		status: "replied",
		botId,
		jobId: job.jobId,
		startedAt: claimed?.startedAt ?? null,
		endedAt: Date.now(),
		replyBytes: Buffer.byteLength(replyText, "utf8")
	});
}
async function failJob(job, botId, errorText) {
	await atomicWriteFile(join(job.dir, "reply.md"), `[任务失败] ${errorText}\n`);
	const claimed = await readStatusIfPresent(job.dir);
	await writeStatus(job.dir, {
		status: "failed",
		botId,
		jobId: job.jobId,
		startedAt: claimed?.startedAt ?? null,
		endedAt: Date.now(),
		error: String(errorText).slice(0, 2e3)
	});
}
async function cancelJob(job, botId, reasonText) {
	const claimed = await readStatusIfPresent(job.dir);
	await writeStatus(job.dir, {
		status: "cancelled",
		botId,
		jobId: job.jobId,
		startedAt: claimed?.startedAt ?? null,
		endedAt: Date.now(),
		reason: String(reasonText || "cancelled").slice(0, 500)
	});
}
async function writeStatus(dir, payload) {
	await atomicWriteFile(join(dir, "status.json"), `${JSON.stringify(payload, null, 2)}\n`);
}
async function atomicWriteFile(path, text) {
	const tmp = `${path}.${randomUUID()}.tmp`;
	await writeFile(tmp, text, "utf8");
	await rename(tmp, path);
}
async function enqueueJob(inboxRoot, { jobId, toBot, text, images = [], fromBotId, conversationId, handoff = null, taskId = null }) {
	const id = String(jobId || `job_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`);
	const dir = join(inboxRoot, id);
	await mkdir(dir, { recursive: true });
	const payload = {
		jobId: id,
		id,
		text,
		dir,
		toBot: String(toBot || ""),
		images,
		createdAt: Date.now(),
		...fromBotId ? { fromBotId: String(fromBotId) } : {},
		...conversationId ? { conversationId: String(conversationId) } : {},
		...taskId ? { taskId: String(taskId) } : {},
		...handoff ? { handoff } : {}
	};
	await atomicWriteFile(join(dir, "job.json"), `${JSON.stringify(payload, null, 2)}\n`);
	await atomicWriteFile(join(dir, "prompt.md"), `${String(text || "").trim()}\n`);
	const queueLine = `${JSON.stringify(payload)}\n`;
	await appendLine(join(inboxRoot, "queue.jsonl"), queueLine);
	return payload;
}
async function appendLine(path, line) {
	const { appendFile } = await import("node:fs/promises");
	let text = "";
	try {
		text = await readFile(path, "utf8");
	} catch {
		text = "";
	}
	if (!text.endsWith("\n") && text.length > 0) await appendFile(path, "\n");
	await appendFile(path, line);
}
//#endregion
//#region src/dispatch.mjs
/**
* 解析派发目标。
* @param bots 全体 crew bots（含 id/name）
* @param conversation 当前会话（群）或 null（DM/无会话上下文）
* @param ref { member_id?: string, member_name?: string }
* @returns { ok: boolean, bot?: object, error?: string, candidates?: string[] }
*   群上下文：目标必须是群成员（授权范围）；DM 上下文：全 crew 可选。
*   精确 member_id 优先；member_name 仅在授权范围内唯一命中时兼容，歧义拒绝。
*/
function resolveDispatchTarget(bots, conversation, ref) {
	const scope = conversation ? bots.filter((b) => conversation.memberBotIds.includes(b.id)) : bots;
	const scopeNames = scope.map((b) => b.name).join("、");
	if (ref?.member_id) {
		const hit = scope.find((b) => b.id === ref.member_id);
		if (hit) return {
			ok: true,
			bot: hit
		};
		return {
			ok: false,
			error: `目标 ${ref.member_id} 不在授权范围内${conversation ? `（本群成员：${scopeNames}）` : ""}，未派发。群外协作需要用户显式把成员拉入群。`
		};
	}
	const name = String(ref?.member_name || "").trim();
	if (!name) return {
		ok: false,
		error: "缺少 member_id 或 member_name"
	};
	const exact = scope.filter((b) => b.name === name);
	if (exact.length === 1) return {
		ok: true,
		bot: exact[0]
	};
	if (exact.length > 1) return {
		ok: false,
		error: `名字「${name}」在授权范围内匹配多位成员（${exact.map((b) => b.name).join("、")}），请用 member_id 精确指定。`,
		candidates: exact.map((b) => b.id)
	};
	const fuzzy = scope.filter((b) => b.name.includes(name) || name.includes(b.name));
	if (fuzzy.length === 1) return {
		ok: true,
		bot: fuzzy[0]
	};
	if (fuzzy.length > 1) return {
		ok: false,
		error: `「${name}」在授权范围内歧义（${fuzzy.map((b) => b.name).join("、")}），请用 member_id 或全名。`,
		candidates: fuzzy.map((b) => b.id)
	};
	return {
		ok: false,
		error: `未找到「${name}」${conversation ? `（本群成员：${scopeNames}）` : ""}，未派发。`
	};
}
/**
* 协调唤醒限频状态机（合并延后，不丢事件）。
* request(key) —— 窗口外立即触发；窗口内挂 pending 并确保窗口尾有且仅有一个消费定时器。
* onFired(key) —— 协调回合完成后回调：刷新 lastFiredAt；若仍有 pending，
*                  在窗口结束时再消费（与窗口尾定时器同一路径，幂等）。
* pending 的消费保证：request 挂起时必安排定时器；定时器/onFired 谁先到窗口尾谁消费，
* 消费时清除 pending 并触发 fire——不存在「挂起后无人消费」的路径。
* 全部时间经注入的 now()，虚拟时钟可测。
*/
var WakeScheduler = class {
	constructor({ intervalMs = 6e4, fire, delay, now = () => Date.now() }) {
		if (typeof fire !== "function") throw new Error("WakeScheduler 需要 fire 回调");
		this.intervalMs = intervalMs;
		this.fire = fire;
		this.delay = delay ?? ((ms, fn) => setTimeout(fn, ms));
		this.now = now;
		this.state = /* @__PURE__ */ new Map();
	}
	_armPending(key) {
		const st = this.state.get(key);
		if (!st || !st.pending || st.timer !== void 0) return;
		const wait = Math.max(0, this.intervalMs - (this.now() - st.lastFiredAt));
		st.timer = this.delay(wait, () => {
			const cur = this.state.get(key);
			if (!cur) return;
			cur.timer = void 0;
			cur.lastFiredAt = this.now();
			if (cur.pending) {
				cur.pending = false;
				this.fire(key);
			}
		});
	}
	request(key) {
		const st = this.state.get(key) ?? {
			lastFiredAt: -Infinity,
			pending: false
		};
		this.state.set(key, st);
		if (this.now() - st.lastFiredAt < this.intervalMs) {
			st.pending = true;
			this._armPending(key);
			return "pending";
		}
		st.pending = false;
		this.fire(key);
		return "fired";
	}
	onFired(key) {
		const st = this.state.get(key);
		if (!st) return;
		st.lastFiredAt = this.now();
		this._armPending(key);
	}
};
//#endregion
//#region src/delivery-core.mjs
/**
* targetReal 是否严格位于 rootReal 内（两者须为真实路径）。
* 注意：文件名以 .. 开头（如 `..notes.txt`）是合法相对段，不得误拒；
* 逃逸判定是 rel === '..' 或以 '..' + 分隔符 开头，或 rel 为绝对路径。
*/
function isInsideRoot(rootReal, targetReal) {
	if (!rootReal || !targetReal) return false;
	const rel = relative(rootReal, targetReal);
	if (rel === "") return false;
	if (rel === ".." || rel.startsWith(".." + sep)) return false;
	return !isAbsolute(rel);
}
/**
* 交付目标分类：
* - 'dm'：无会话上下文，或统一实体（conversationId === botId）
* - 'room'：crew 中存在的会话实体（含单成员群——v3 会话身份固定）
* - 'rejected'：conversationId 非本 bot DM 但实体不存在（群已被删除）→ 拒绝，绝不落私聊
*/
function classifyDeliveryTarget({ conversationId, botId, conversations }) {
	if (!conversationId || conversationId === botId) return "dm";
	return (conversations ?? []).find((c) => c.id === conversationId) ? "room" : "rejected";
}
const ARTIFACT_MIME = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".json": "application/json",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".pdf": "application/pdf",
	".zip": "application/zip",
	".bin": "application/octet-stream"
};
/**
* 创建成果快照：payload 固定 data/payload（与 meta.json 分离，原名可为 meta.json）；
* size 以快照字节为准。extra（taskId/runId 等）并入 meta。
* 前置条件：sourceReal 已通过 isInsideRoot 校验且为常规文件。
*/
async function createArtifactSnapshot({ artifactsRoot, sourceReal, workspaceRoot, extra = {} }) {
	const { mkdir, writeFile, copyFile, readFile } = await import("node:fs/promises");
	const { createHash, randomUUID } = await import("node:crypto");
	const id = `art-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
	const dir = join(artifactsRoot, id);
	await mkdir(join(dir, "data"), { recursive: true });
	const payloadPath = join(dir, "data", "payload");
	await copyFile(sourceReal, payloadPath);
	const buf = await readFile(payloadPath);
	const sha256 = createHash("sha256").update(buf).digest("hex");
	const name = basename(sourceReal);
	const meta = {
		id,
		name,
		size: buf.length,
		mime: ARTIFACT_MIME[extname(name).toLowerCase()] || "application/octet-stream",
		sha256,
		sourcePath: sourceReal,
		workspaceRoot,
		createdAt: Date.now(),
		...extra
	};
	await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 1));
	return {
		meta,
		payloadPath
	};
}
//#endregion
//#region src/tasks.mjs
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
function tasksDir(stateDir) {
	return join(stateDir, "tasks");
}
async function ensureTasks(stateDir) {
	await mkdir(tasksDir(stateDir), { recursive: true });
}
async function createTask(stateDir, { conversationId, ownerBotId, workspace, title }) {
	const task = {
		id: newId("task"),
		title: String(title || "").slice(0, 120) || "未命名任务",
		conversationId: conversationId || null,
		ownerBotId: ownerBotId || null,
		workspace: workspace || null,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		status: "open",
		runs: [],
		artifacts: []
	};
	await ensureTasks(stateDir);
	await atomicWriteJson(join(tasksDir(stateDir), `${task.id}.json`), task);
	return task;
}
async function getTask(stateDir, taskId) {
	if (!taskId || !/^[a-z0-9-]+$/i.test(taskId)) return null;
	try {
		return JSON.parse(await readFile(join(tasksDir(stateDir), `${taskId}.json`), "utf8"));
	} catch {
		return null;
	}
}
async function atomicWriteJson(path, data) {
	const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`;
	await writeFile(tmp, JSON.stringify(data, null, 1));
	await rename(tmp, path);
}
async function saveTask(stateDir, task) {
	task.updatedAt = Date.now();
	await atomicWriteJson(join(tasksDir(stateDir), `${task.id}.json`), task);
	return task;
}
const taskMutations = /* @__PURE__ */ new Map();
/** 同一 task 的存储变更串行（read-modify-write 不互踩）；与运行锁（withTaskLock）职责分离 */
async function withTaskMutation(taskId, fn) {
	const next = (taskMutations.get(taskId) ?? Promise.resolve()).then(fn, fn);
	taskMutations.set(taskId, next.catch(() => void 0));
	return next;
}
async function startRun(stateDir, taskId, { botId, origin, note }) {
	return withTaskMutation(taskId, async () => {
		const task = await getTask(stateDir, taskId);
		if (!task) return null;
		const run = {
			id: newId("run"),
			botId: botId || null,
			origin: [
				"user",
				"continue",
				"handoff"
			].includes(origin) ? origin : "user",
			note: String(note || "").slice(0, 200),
			startedAt: Date.now(),
			endedAt: null,
			status: "running"
		};
		task.runs.push(run);
		if (task.status === "done") task.status = "open";
		await saveTask(stateDir, task);
		return {
			task,
			run
		};
	});
}
async function endRun(stateDir, taskId, runId, status = "done") {
	return withTaskMutation(taskId, async () => {
		const task = await getTask(stateDir, taskId);
		if (!task) return null;
		const run = task.runs.find((r) => r.id === runId);
		if (!run) return null;
		run.endedAt = Date.now();
		run.status = [
			"done",
			"failed",
			"cancelled"
		].includes(status) ? status : "done";
		if (task.runs.every((r) => r.status !== "running")) task.status = run.status === "done" ? "done" : "open";
		await saveTask(stateDir, task);
		return {
			task,
			run
		};
	});
}
async function attachArtifact(stateDir, taskId, artifactId) {
	return withTaskMutation(taskId, async () => {
		const task = await getTask(stateDir, taskId);
		if (!task) return null;
		if (!task.artifacts.includes(artifactId)) task.artifacts.push(artifactId);
		await saveTask(stateDir, task);
		return task;
	});
}
/**
* 执行前任务校验（所有入口共用：续改/交付/后台接力）。
* 规则：taskId 合法且任务存在；归属=任务会话===当前会话；
* 无会话上下文（DM）时仅接受无会话任务或 owner 即该 bot 的任务。
* getTask 注入以便测试；conversations 为 crew 会话数组（校验 DM 规范化身份）。
*/
function validateTaskForContext(taskId, { conversationId, botId, getTask: loadTask }) {
	return (async () => {
		if (!taskId) return {
			ok: true,
			task: null
		};
		if (!/^[a-z0-9-]+$/i.test(String(taskId))) return {
			ok: false,
			error: "taskId 非法"
		};
		const task = await loadTask(String(taskId)).catch(() => null);
		if (!task) return {
			ok: false,
			error: `任务不存在：${taskId}`
		};
		if (conversationId) {
			if (task.conversationId !== conversationId) return {
				ok: false,
				error: `任务 ${taskId} 不属于当前会话（属 ${task.conversationId || "DM/无会话"}）`
			};
		} else if (!(!task.conversationId && task.ownerBotId === botId)) return {
			ok: false,
			error: `任务 ${taskId} 不能在当前私聊上下文执行（属 ${task.conversationId || "其他成员的 DM"}）`
		};
		return {
			ok: true,
			task
		};
	})();
}
//#endregion
//#region src/exec.mjs
const taskLocks = /* @__PURE__ */ new Map();
const botLocks = /* @__PURE__ */ new Map();
const wsLocks = /* @__PURE__ */ new Map();
function chain(map, key, fn) {
	const next = (map.get(key) ?? Promise.resolve()).then(fn, fn);
	map.set(key, next.catch(() => void 0));
	return next;
}
/** 任务锁（可单独用于不经过 bot/workspace 的存储级互斥） */
function withTaskLock(taskId, fn) {
	if (!taskId) return fn();
	return chain(taskLocks, taskId, fn);
}
/**
* 统一执行入口：chatTurn 与 runInboxJob 都必须经由它进入执行段。
* options.workspace 为本次执行根（真实路径）；为空则跳过 workspace 队列。
*/
function runExclusively({ taskId = null, botId, workspace = null }, fn) {
	return withTaskLock(taskId, () => chain(botLocks, botId, () => {
		if (!workspace) return fn();
		return chain(wsLocks, workspace, fn);
	}));
}
//#endregion
//#region src/templates.mjs
/**
* 预设专家模板库——借鉴社区优质 prompt 库风格自写的中文人设。
* 每个模板：创建即带完整人格/职责/边界，开场白结构化（Markdown + [[快捷选项]]）。
*/
const BOT_TEMPLATES = [
	{
		id: "blank",
		name: "空白 Bot",
		avatar: "🤖",
		title: "对话式初始化",
		persona: "",
		blank: true
	},
	{
		id: "chief",
		name: "沈经纶",
		avatar: "🎖️",
		title: "幕僚长 · 总协调",
		persona: [
			"你是沈经纶，团队的幕僚长：接到任务先判断该谁做——自己直接做、交给合适队友、还是拆解成多步。",
			"给用户的回复永远三段：结论 → 关键依据/动作 → 下一步建议（含选项）。",
			"只汇报真实完成的操作；没做的明确说没做。",
			"委派时在回复末行用 @队友名 交代内容（群聊内生效）。",
			"团队管理：用 team_setup_project 一键拉团队（群名+成员列表+各自任务，一次调用全完成）。当用户要拉团队做项目时，直接调用此工具。也可用 team_list_members 查看现有团队。"
		].join("\n"),
		greeting: "你好，我是**沈经纶**，团队的幕僚长（总协调）。我会判断任务归属：自己做、派队友、或拆解执行。\n\n常见入口：\n- 布置一个任务（我会路由）\n- 了解团队现状\n- 整理待办与优先级\n\n名字不合意？右上角 ⚙ 随时改我的名字和头衔；也可以直接对我说“你以后叫××”。\n\n[[布置任务|看看团队|整理待办]]"
	},
	{
		id: "coder",
		name: "顾远航",
		avatar: "🛠️",
		title: "工程师 · 编码与调试",
		persona: [
			"你是顾远航，团队的资深工程师：写代码、修 bug、重构、写测试与脚本。",
			"动手前先用一两句话说明方案；改完给出改动点清单（文件/函数/原因）。",
			"代码务必可直接运行，不写伪代码占位；风险点主动标注。",
			"回复用 Markdown：代码块标注语言，关键结论加粗。"
		].join("\n"),
		greeting: "你好，我是**顾远航** 🛠️，团队的工程师，负责编码、调试、重构和脚本。\n\n我可以：\n- 实现新功能 / 修 bug\n- 读代码定位问题\n- 写测试、重构、性能优化\n\n名字不合意？右上角 ⚙ 随时改我的名字和头衔；也可以直接对我说“你以后叫××”。\n\n[[给我一个需求|帮我修个bug|读代码讲架构]]"
	},
	{
		id: "researcher",
		name: "林知遥",
		avatar: "🔎",
		title: "调研员 · 检索与情报",
		persona: [
			"你是林知遥，团队的调研员：负责信息检索、情报整理、方案对比。",
			"所有结论必须带来源（链接/文件/数据），无法核实的明确标注\"未验证\"。",
			"输出结构：结论先行 → 依据列表 → 风险与信息缺口 → 建议下一步。"
		].join("\n"),
		greeting: "你好，我是**林知遥** 🔎，团队的调研员，负责检索与情报，所有结论带来源。\n\n我可以：\n- 调研一个主题并出摘要\n- 对比多个方案给建议\n- 监控信息源定期汇报\n\n名字不合意？右上角 ⚙ 随时改我的名字和头衔；也可以直接对我说“你以后叫××”。\n\n[[调研一个主题|对比方案|设个监控]]"
	},
	{
		id: "writer",
		name: "苏文汐",
		avatar: "✍️",
		title: "写作官 · 文案与报告",
		persona: [
			"你是苏文汐，团队的写作官：文案、报告、邮件、公众号、周报日报皆可。",
			"先问清读者是谁、发到哪、想要什么语气；产出给草稿而非终稿，等用户确认风格。",
			"默认简体中文，简洁有力，避免空话套话。"
		].join("\n"),
		greeting: "你好，我是**苏文汐** ✍️，团队的写作官。写之前我会先确认读者、渠道和语气。\n\n我可以：\n- 写文案/邮件/公告\n- 出周报日报\n- 润色改写任何文本\n\n名字不合意？右上角 ⚙ 随时改我的名字和头衔；也可以直接对我说“你以后叫××”。\n\n[[写一篇文案|出日报|帮我润色]]"
	},
	{
		id: "analyst",
		name: "陈思衡",
		avatar: "📊",
		title: "数据分析师 · 数据洞察",
		persona: [
			"你是陈思衡，团队的数据分析师：处理表格/CSV/日志，做统计、找趋势、出结论。",
			"先确认数据口径与业务问题，再动手；结论必须能被数据复现，附关键数字。",
			"输出：核心结论 → 支撑数据（表格）→ 异常与建议。"
		].join("\n"),
		greeting: "你好，我是**陈思衡** 📊，团队的数据分析师，让数据说话。\n\n我可以：\n- 分析表格/CSV 找趋势\n- 做统计与异常检测\n- 出分析报告\n\n名字不合意？右上角 ⚙ 随时改我的名字和头衔；也可以直接对我说“你以后叫××”。\n\n[[分析我的数据|设计指标|讲讲结论怎么写]]"
	},
	{
		id: "pm",
		name: "何一诺",
		avatar: "📋",
		title: "产品经理 · 需求与优先级",
		persona: [
			"你是何一诺，团队的产品经理：把模糊想法变成清晰需求，写 PRD、拆里程碑、排优先级。",
			"永远先问目标用户和要解决的问题；输出含验收标准。",
			"用 RICE/价值-成本给优先级建议，敢说\"这个不该做\"。"
		].join("\n"),
		greeting: "你好，我是**何一诺** 📋，团队的产品经理，把想法变成可执行的需求。\n\n我可以：\n- 梳理需求写 PRD\n- 拆里程碑排优先级\n- 评审一个功能设计\n\n名字不合意？右上角 ⚙ 随时改我的名字和头衔；也可以直接对我说“你以后叫××”。\n\n[[梳理一个需求|写PRD|排优先级]]"
	},
	{
		id: "ops",
		name: "郑北辰",
		avatar: "🖥️",
		title: "运维官 · 部署与排障",
		persona: [
			"你是郑北辰，团队的运维官：环境、部署、脚本自动化、故障排查。",
			"任何有影响的操作（重启/删除/改配置）先说明影响面并征求确认，再执行。",
			"排障输出：现象 → 定位过程 → 根因 → 修复与预防。"
		].join("\n"),
		greeting: "你好，我是**郑北辰** 🖥️，团队的运维官，管环境、部署和排障。\n\n我可以：\n- 部署/配置环境\n- 写自动化脚本\n- 排查故障给根因\n\n名字不合意？右上角 ⚙ 随时改我的名字和头衔；也可以直接对我说“你以后叫××”。\n\n[[部署个服务|写个脚本|帮我排障]]"
	},
	{
		id: "translator",
		name: "叶书语",
		avatar: "🌐",
		title: "翻译官 · 多语言本地化",
		persona: [
			"你是叶书语，团队的翻译官：中英日韩等多语言互译与本地化。",
			"先判断文本类型（技术/商务/营销/口语）再选语域；术语保持一致，不确定的术语列出备选。",
			"译文自然地道，不逐字硬译；保留原文格式（Markdown/代码块不动）。"
		].join("\n"),
		greeting: "你好，我是**叶书语** 🌐，团队的翻译官，多语言互译与本地化。\n\n我可以：\n- 翻译文档/消息/界面文案\n- 中英润色\n- 统一术语表\n\n名字不合意？右上角 ⚙ 随时改我的名字和头衔；也可以直接对我说“你以后叫××”。\n\n[[翻译一段文本|润色英文|建术语表]]"
	},
	{
		id: "secretary",
		name: "唐锦书",
		avatar: "🗂️",
		title: "秘书 · 记录与跟进",
		persona: [
			"你是唐锦书，团队的秘书：会议记录、待办跟进、日程提醒、文档归档。",
			"任何记录输出都带：负责人、截止时间、当前状态三要素。",
			"主动提醒风险（快到期/无人认领），但不替人做决定。"
		].join("\n"),
		greeting: "你好，我是**唐锦书** 🗂️，团队的秘书，管记录、待办和跟进。\n\n我可以：\n- 整理会议纪要\n- 维护待办清单并盯进度\n- 归档文档\n\n名字不合意？右上角 ⚙ 随时改我的名字和头衔；也可以直接对我说“你以后叫××”。\n\n[[记个会议|建待办清单|今天有什么要跟进]]"
	},
	{
		id: "reviewer",
		name: "秦明鉴",
		avatar: "🛡️",
		title: "审核官 · 质量与合规",
		persona: [
			"你是秦明鉴，团队的审核官：代码评审、文档把关、风险与合规检查。",
			"按严重程度分级（P0 阻断 / P1 应修 / P2 建议），每条给理由和改法。",
			"只对事不对人；放行要给出明确结论（通过/有条件通过/打回）。"
		].join("\n"),
		greeting: "你好，我是**秦明鉴** 🛡️，团队的审核官，负责质量与风险把关。\n\n我可以：\n- 评审代码/文档\n- 做安全与合规检查\n- 出审核结论（分级）\n\n名字不合意？右上角 ⚙ 随时改我的名字和头衔；也可以直接对我说“你以后叫××”。\n\n[[评审代码|把关文档|安全检查]]"
	}
];
function templateById(templateId) {
	return BOT_TEMPLATES.find((template) => template.id === templateId) || null;
}
//#endregion
//#region src/index.mjs
const API_ROOT = "/api/plugins/grokbot";
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"cache-control": "no-store"
};
const inject = [
	"agents",
	"webServer",
	"agentDefaultModel",
	"llm"
];
const nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
const safeError = (error) => error instanceof Error ? error.message : String(error);
function userMessage(text) {
	return Object.freeze({
		id: randomUUID(),
		role: "user",
		content: Object.freeze([Object.freeze({
			type: "text",
			text
		})]),
		source: Object.freeze({
			kind: "plugin",
			plugin: "grokbot"
		})
	});
}
function contentText(content) {
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const item of content) if (item?.type === "text" && typeof item.text === "string") parts.push(item.text);
	return parts.join("\n").trim();
}
function chunkText(chunk) {
	if (!chunk || typeof chunk !== "object") return "";
	const delta = (Array.isArray(chunk.choices) ? chunk.choices[0] : void 0)?.delta ?? chunk.delta;
	if (typeof delta?.content === "string") return delta.content;
	if (typeof delta?.text === "string") return delta.text;
	if (typeof chunk.text === "string") return chunk.text;
	if (typeof chunk.content === "string") return chunk.content;
	return "";
}
function summarizeTurn(events, firstSeq) {
	let stopReason = "completed";
	let error = "";
	const stepText = /* @__PURE__ */ new Map();
	const trace = [];
	for (const event of events) {
		if (event.seq < firstSeq) continue;
		trace.push(event.type);
		const step = String(event.data?.step ?? "");
		if (event.type === "assistant/chunk") stepText.set(step, (stepText.get(step) || "") + chunkText(event.data?.chunk));
		else if (event.type === "assistant/message") {
			const joined = contentText(event.data?.message?.content);
			if (joined) stepText.set(step, joined);
		} else if (event.type === "turn/end") {
			const reason = event.data?.reason && typeof event.data.reason === "object" ? event.data.reason : {};
			stopReason = String(reason.kind || event.data?.stopReason || stopReason);
			const errText = reason.error?.message || reason.failure?.message || (event.data?.error ? safeError(event.data.error) : "");
			if (errText) error = String(errText).slice(0, 500);
		}
	}
	let text = "";
	for (const [, value] of [...stepText.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), void 0, { numeric: true }))) {
		const joined = value.trim();
		if (joined) text = joined;
	}
	return {
		text,
		stopReason,
		error,
		trace
	};
}
function activityOf(events, firstSeq) {
	const calls = [];
	for (const event of events) {
		if (event.seq < firstSeq) continue;
		if (event.type === "tool/call") {
			const name = String(event.data?.name || "tool");
			if (name) calls.push(name);
		}
	}
	return calls;
}
function apply(ctx, config = {}) {
	const stateDir = resolve(String(config.stateDir || join(process.cwd(), ".dsh-grokbot")));
	const inboxRoot = resolve(String(config.inboxDir || join(stateDir, "inbox")));
	const maxConcurrentJobs = Math.max(1, Math.min(8, Number(config.maxConcurrentJobs) || 2));
	const jobTimeoutMs = Math.max(3e4, Number(config.jobTimeoutMs) || 18e5);
	const rescanIntervalMs = Math.max(1e3, Number(config.rescanIntervalMs) || 5e3);
	const crewState = {
		path: "",
		crew: {
			routing: { default: "" },
			bots: []
		}
	};
	const botStates = /* @__PURE__ */ new Map();
	const chatHandles = /* @__PURE__ */ new Map();
	const chatSessionIds = /* @__PURE__ */ new Map();
	const pendingJobs = [];
	const runningJobs = /* @__PURE__ */ new Map();
	const seenJobIds = /* @__PURE__ */ new Set();
	const recentJobs = [];
	let disposed = false;
	let scanning = false;
	const uiStatePath = join(stateDir, "ui-state.json");
	const uiState = { lastTarget: null };
	async function loadUiState() {
		try {
			const saved = JSON.parse(await readFile(uiStatePath, "utf8"));
			if (saved && (saved.kind === "bot" || saved.kind === "room" || saved.kind === "conversation") && typeof saved.id === "string") uiState.lastTarget = {
				kind: saved.kind,
				id: saved.id
			};
		} catch {}
	}
	async function persistUiState() {
		await atomicWrite(uiStatePath, `${JSON.stringify(uiState.lastTarget ?? {}, null, 2)}\n`);
	}
	const chatSessionsPath = join(stateDir, "chat-sessions.json");
	const memoryDirOf = (botId) => join(stateDir, "bots", botId, "memory");
	const profilePathOf = (botId) => join(memoryDirOf(botId), "PROFILE.md");
	const teamMemoryPath = join(stateDir, "memory", "TEAM.md");
	const skillsDir = join(stateDir, "skills");
	const roomsDir = join(stateDir, "rooms");
	const routinesStatePath = join(stateDir, "routines-state.json");
	const roomTranscriptPath = (roomId) => join(roomsDir, `${roomId}.transcript.jsonl`);
	function conversationOf(conversationId) {
		return crewState.crew.conversations?.find((entry) => entry.id === conversationId) ?? null;
	}
	async function appendConversationMsg(conversation, entry) {
		if (conversation.memberBotIds.length === 1) return;
		await appendRoomMsg(conversation.id, entry);
	}
	async function readConversationMsgs(conversation, limit = 200) {
		return conversation.memberBotIds.length === 1 ? readDm(conversation.memberBotIds[0], limit) : readRoomMsgs(conversation.id, limit);
	}
	async function ensureDmConversation(bot) {
		let conversation = crewState.crew.conversations?.find((entry) => entry.memberBotIds.length === 1 && entry.memberBotIds[0] === bot.id);
		if (!conversation) {
			conversation = createConversation(crewState.crew, { memberBotIds: [bot.id] });
			await persistCrew();
		}
		return conversation;
	}
	const routineHistoryPath = (routineId) => join(roomsDir, `routine-${routineId}.history.jsonl`);
	async function appendRoomMsg(roomId, entry) {
		await mkdir(roomsDir, { recursive: true });
		const path = roomTranscriptPath(roomId);
		let text = "";
		try {
			text = await readFile(path, "utf8");
		} catch {
			text = "";
		}
		if (!text.endsWith("\n") && text.length > 0) await appendFile(path, "\n");
		await appendFile(path, `${JSON.stringify({
			ts: Date.now(),
			...entry
		})}\n`);
	}
	async function readRoomMsgs(roomId, limit = 200) {
		try {
			return (await readFile(roomTranscriptPath(roomId), "utf8")).split("\n").filter((line) => line.trim()).slice(-limit).map((line) => {
				try {
					return JSON.parse(line);
				} catch {
					return null;
				}
			}).filter(Boolean);
		} catch {
			return [];
		}
	}
	async function appendRoutineHistory(routineId, line) {
		await mkdir(roomsDir, { recursive: true });
		const path = routineHistoryPath(routineId);
		let text = "";
		try {
			text = await readFile(path, "utf8");
		} catch {
			text = "";
		}
		let lines = text.split("\n").filter((entry) => entry.trim());
		lines.push(JSON.stringify({
			ts: Date.now(),
			...line
		}));
		lines = lines.slice(-20);
		await atomicWrite(path, `${lines.join("\n")}\n`);
	}
	async function loadRoutinesState() {
		try {
			return JSON.parse(await readFile(routinesStatePath, "utf8")) || {};
		} catch {
			return {};
		}
	}
	async function loadChatSessions() {
		try {
			const map = JSON.parse(await readFile(chatSessionsPath, "utf8"));
			for (const [key, sessionId] of Object.entries(map || {})) {
				if (typeof sessionId !== "string" || !sessionId) continue;
				chatSessionIds.set(key.includes(":") ? key : `${key}:${key}`, sessionId);
			}
		} catch {}
	}
	async function persistChatSessions() {
		await atomicWrite(chatSessionsPath, `${JSON.stringify(Object.fromEntries(chatSessionIds), null, 2)}\n`);
	}
	const statsPathOf = (botId) => join(stateDir, "bots", botId, "stats.json");
	const LEVELS = [
		{
			at: 0,
			title: "见习"
		},
		{
			at: 50,
			title: "熟练"
		},
		{
			at: 150,
			title: "资深"
		},
		{
			at: 400,
			title: "专家"
		},
		{
			at: 1e3,
			title: "大师"
		}
	];
	async function loadStats(botId) {
		try {
			const saved = JSON.parse(await readFile(statsPathOf(botId), "utf8"));
			return {
				exp: Number(saved.exp) || 0,
				tasksDone: Number(saved.tasksDone) || 0,
				tasksFailed: Number(saved.tasksFailed) || 0,
				thumbsUp: Number(saved.thumbsUp) || 0,
				thumbsDown: Number(saved.thumbsDown) || 0,
				backfilled: saved.backfilled === true
			};
		} catch {
			return {
				exp: 0,
				tasksDone: 0,
				tasksFailed: 0,
				thumbsUp: 0,
				thumbsDown: 0,
				backfilled: false
			};
		}
	}
	async function saveStats(botId, stats) {
		await atomicWrite(statsPathOf(botId), `${JSON.stringify(stats, null, 2)}\n`);
	}
	async function awardBot(botId, patch) {
		if (!botId) return null;
		const stats = await loadStats(botId);
		const next = {
			exp: Math.max(0, stats.exp + (patch.expDelta || 0)),
			tasksDone: Math.max(0, stats.tasksDone + (patch.tasksDoneDelta || 0)),
			tasksFailed: Math.max(0, stats.tasksFailed + (patch.tasksFailedDelta || 0)),
			thumbsUp: Math.max(0, stats.thumbsUp + (patch.thumbsUpDelta || 0)),
			thumbsDown: Math.max(0, stats.thumbsDown + (patch.thumbsDownDelta || 0)),
			backfilled: stats.backfilled,
			updatedAt: Date.now()
		};
		await saveStats(botId, next);
		return next;
	}
	function ratingOf(stats) {
		let level = 1;
		for (let i = 0; i < LEVELS.length; i++) if (stats.exp >= LEVELS[i].at) level = i + 1;
		const nextAt = level < LEVELS.length ? LEVELS[level].at : null;
		const total = stats.tasksDone + stats.tasksFailed;
		const thumbs = stats.thumbsUp + stats.thumbsDown;
		const successRate = total >= 1 ? stats.tasksDone / total : null;
		const thumbRate = thumbs >= 1 ? stats.thumbsUp / thumbs : null;
		let stars = null;
		if (successRate !== null || thumbRate !== null) {
			const parts = [];
			let weight = 0;
			if (successRate !== null) {
				parts.push(successRate * .6);
				weight += .6;
			}
			if (thumbRate !== null) {
				parts.push(thumbRate * .4);
				weight += .4;
			}
			stars = Math.max(1, Math.min(5, Math.round(5 * (parts.reduce((a, b) => a + b, 0) / weight))));
		}
		return {
			level,
			title: LEVELS[level - 1].title,
			exp: stats.exp,
			nextAt,
			stars,
			tasksDone: stats.tasksDone,
			tasksFailed: stats.tasksFailed,
			thumbsUp: stats.thumbsUp,
			thumbsDown: stats.thumbsDown
		};
	}
	async function seedBotMemory(bot) {
		await mkdir(memoryDirOf(bot.id), { recursive: true });
		try {
			await readFile(profilePathOf(bot.id), "utf8");
		} catch {
			await atomicWrite(profilePathOf(bot.id), `# ${bot.name} 的长期记忆\n\n（由 ${bot.name} 自己维护：稳定偏好、重要事实、工作摘要。一条一行：日期 + 内容。）\n`);
		}
	}
	function botState(botId) {
		let state = botStates.get(botId);
		if (!state) {
			state = {
				status: "idle",
				currentJob: null,
				lastActivity: null
			};
			botStates.set(botId, state);
		}
		return state;
	}
	function recordRecent(entry) {
		recentJobs.unshift(entry);
		if (recentJobs.length > 50) recentJobs.length = 50;
	}
	const computerConfigPath = join(stateDir, "computer.json");
	async function loadComputerConfig() {
		try {
			return JSON.parse(await readFile(computerConfigPath, "utf8"));
		} catch {
			return null;
		}
	}
	function localExec(config, command, timeoutMs) {
		return new Promise((resolve) => {
			const { spawn } = __require("node:child_process");
			const child = spawn("/bin/bash", ["-c", command], {
				stdio: [
					"ignore",
					"pipe",
					"pipe"
				],
				cwd: config?.workspace || void 0
			});
			let out = "", err = "";
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				resolve({
					ok: false,
					text: "exec timeout"
				});
			}, timeoutMs || 3e4);
			child.stdout.on("data", (d) => {
				out += d;
			});
			child.stderr.on("data", (d) => {
				err += d;
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				if (code === 0) resolve({
					ok: true,
					text: out.trim()
				});
				else resolve({
					ok: false,
					text: (err || out || "exit " + code).trim().slice(0, 2e3)
				});
			});
		});
	}
	function sshExec(config, command, timeoutMs = 3e4) {
		if (config?.local) return localExec(config, command, timeoutMs);
		return new Promise((resolve) => {
			const { spawn } = __require("node:child_process");
			const args = [
				"-i",
				config.sshKey.replace(/^~/, process.env.HOME || ""),
				"-o",
				"ConnectTimeout=10",
				"-o",
				"StrictHostKeyChecking=accept-new"
			];
			if (config.sshJump) args.push("-J", config.sshJump);
			args.push(config.sshUser + "@" + config.sshHost);
			const child = spawn("ssh", args, { stdio: [
				"pipe",
				"pipe",
				"pipe"
			] });
			let out = "", err = "";
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				resolve({
					ok: false,
					text: "SSH timeout"
				});
			}, timeoutMs);
			child.stdout.on("data", (d) => {
				out += d;
			});
			child.stderr.on("data", (d) => {
				err += d;
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				if (code === 0) resolve({
					ok: true,
					text: out.trim()
				});
				else resolve({
					ok: false,
					text: (err || out || "exit " + code).trim().slice(0, 2e3)
				});
			});
			child.stdin.end(command);
		});
	}
	const PREVIEW_PORT = 8e3;
	const NOVNC_PORT = 6080;
	let tunnelProc = null;
	let lastVmHttpCheck = 0;
	let lastMirrorSync = 0;
	function tunnelAlive() {
		return tunnelProc !== null && tunnelProc.exitCode === null && !tunnelProc.killed;
	}
	function ensureTunnels(config) {
		if (tunnelAlive()) return;
		try {
			const { spawn } = __require("node:child_process");
			const args = [
				"-i",
				config.sshKey.replace(/^~/, process.env.HOME || ""),
				"-N",
				"-o",
				"ExitOnForwardFailure=yes",
				"-o",
				"ServerAliveInterval=15",
				"-o",
				"ServerAliveCountMax=3",
				"-o",
				"ConnectTimeout=10",
				"-o",
				"StrictHostKeyChecking=accept-new"
			];
			if (config.sshJump) args.push("-J", config.sshJump);
			args.push("-L", `${NOVNC_PORT}:127.0.0.1:${NOVNC_PORT}`, "-L", `${PREVIEW_PORT}:127.0.0.1:${PREVIEW_PORT}`);
			args.push(config.sshUser + "@" + config.sshHost);
			tunnelProc = spawn("ssh", args, { stdio: "ignore" });
			tunnelProc.on("exit", () => {
				tunnelProc = null;
			});
			ctx.logger?.info?.("grokbot 共享电脑隧道已建立（noVNC 6080 + 预览 8000）");
		} catch {}
	}
	async function ensureVmHttpServer(config) {
		const probe = await sshExec(config, "curl -s -o /dev/null -w \"%{http_code}\" http://127.0.0.1:8000/ 2>/dev/null", 2e4);
		if (probe.ok && probe.text.includes("200")) return;
		await sshExec(config, `nohup python3 -m http.server ${PREVIEW_PORT} -d ${config.workspace || "/home/bot/workspace"} >/tmp/ws-http.log 2>&1 & sleep 1`, 2e4);
		ctx.logger?.info?.("grokbot 共享电脑 HTTP 预览服务已启动 :8000");
	}
	async function mirrorWorkspace(config) {
		try {
			const { spawn } = __require("node:child_process");
			const keyPath = config.sshKey.replace(/^~/, process.env.HOME || "");
			const macWorkspace = join(stateDir, "workspace");
			const sshOpts = `ssh -i ${JSON.stringify(keyPath)} -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new${config.sshJump ? " -J " + config.sshJump : ""}`;
			await new Promise((resolve) => {
				const child = spawn("rsync", [
					"-az",
					"-e",
					sshOpts,
					`${config.sshUser}@${config.sshHost}:${config.workspace || "/home/bot/workspace"}/`,
					macWorkspace + "/"
				], { stdio: "ignore" });
				const timer = setTimeout(() => child.kill("SIGKILL"), 6e4);
				child.on("close", () => {
					clearTimeout(timer);
					resolve();
				});
			});
		} catch (error) {
			ctx.logger?.warn?.(`grokbot 工作区镜像同步失败：${safeError(error)}`);
		}
	}
	async function ensureComputerServices() {
		const config = await loadComputerConfig();
		if (!config?.enabled) return;
		if (config.local) {
			const now0 = Date.now();
			if (now0 - lastVmHttpCheck > 3e5) {
				lastVmHttpCheck = now0;
				const probe = await localExec(`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${PREVIEW_PORT}/ 2>/dev/null`, 15e3).catch(() => ({ ok: false }));
				if (!(probe.ok && probe.text.includes("200"))) await localExec(`nohup python3 -m http.server ${PREVIEW_PORT} -d ${config.workspace || "/home/bot/workspace"} >/tmp/ws-http.log 2>&1 & sleep 1`, 15e3).catch(() => void 0);
			}
			return;
		}
		ensureTunnels(config);
		const now = Date.now();
		if (now - lastVmHttpCheck > 3e5) {
			lastVmHttpCheck = now;
			await ensureVmHttpServer(config).catch(() => void 0);
		}
		if (now - lastMirrorSync > 12e4) {
			lastMirrorSync = now;
			await mirrorWorkspace(config);
		}
	}
	async function launchVmBrowser(config, url) {
		const r = await sshExec(config, [
			"BROWSER=\"$(command -v chromium-browser || command -v chromium || true)\"",
			"if [ -z \"$BROWSER\" ]; then echo NO_BROWSER; exit 3; fi",
			`DISPLAY=:99 "$BROWSER" --no-sandbox --start-maximized "${url}" >/dev/null 2>&1 &`,
			"sleep 3",
			"if pgrep -u \"$USER\" -f \"chromium|chrome\" >/dev/null 2>&1; then echo LAUNCHED; else echo LAUNCH_FAILED; fi"
		].join("\n"), 25e3);
		if (!r.ok) return {
			ok: false,
			error: `ssh/启动失败: ${r.text.slice(0, 200)}`
		};
		if (r.text.includes("LAUNCHED")) return { ok: true };
		if (r.text.includes("NO_BROWSER")) return {
			ok: false,
			error: "团队电脑上未找到 chromium 可执行文件"
		};
		return {
			ok: false,
			error: "启动命令已执行但未检测到浏览器进程"
		};
	}
	function taskTools(bot, { conversationId = null } = {}) {
		conversationId && crewState.crew.conversations?.find((c) => c.id === conversationId);
		return [{
			name: "task_begin",
			description: "为一项需要持续迭代/多步交付的工作建立任务（返回稳定 taskId）。后续同任务的续改与交接都引用它。简单一次性问答不要建任务。",
			parameters: {
				type: "object",
				properties: { title: {
					type: "string",
					description: "任务标题（用户可读）"
				} },
				required: ["title"]
			},
			output: {
				schema: { type: "string" },
				render: (_args, value) => [{
					type: "text",
					text: String(value)
				}]
			},
			async execute(params) {
				const taskConvKey = `${conversationId || bot.id}:${bot.id}`;
				const task = await createTask(stateDir, {
					conversationId: conversationId || null,
					ownerBotId: bot.id,
					workspace: botWorkspace(stateDir, bot),
					title: params?.title
				});
				const started = await startRun(stateDir, task.id, {
					botId: bot.id,
					origin: "user",
					note: String(params?.title || "")
				}).catch(() => null);
				setTurnCtx(taskConvKey, {
					...activeTurnCtx.get(taskConvKey) || { conversationId },
					taskId: task.id,
					runId: started?.run?.id ?? null,
					conversationId: conversationId || null,
					taskWorkspace: task.workspace
				});
				return JSON.stringify({
					ok: true,
					taskId: task.id,
					note: "本回合及后续 deliver_file 会自动关联此任务；续改入口在成果卡片「继续修改」"
				});
			}
		}, {
			name: "handoff",
			description: "把当前任务（或指定成果版本）定向交给另一位成员继续：对方只获得摘要与指定版本文件，不继承你的私聊历史。目标必须是当前会话成员（精确 member_id）。",
			parameters: {
				type: "object",
				properties: {
					member_id: {
						type: "string",
						description: "目标成员精确 bot id（必填）"
					},
					task_id: {
						type: "string",
						description: "要交接的任务 id（通常是你当前任务）"
					},
					artifact_id: {
						type: "string",
						description: "指定交接的成果版本（固定快照）；不填则交接任务最新成果"
					},
					brief: {
						type: "string",
						description: "给接手成员的必要摘要：已完成什么、要求做什么"
					}
				},
				required: ["member_id", "brief"]
			},
			output: {
				schema: { type: "string" },
				render: (_args, value) => [{
					type: "text",
					text: String(value)
				}]
			},
			async execute(params) {
				const conversationNow = conversationId ? crewState.crew.conversations?.find((c) => c.id === conversationId) ?? null : null;
				if (conversationId && !conversationNow) return JSON.stringify({
					ok: false,
					error: `当前会话 ${conversationId} 已不存在`
				});
				const resolved = resolveDispatchTarget(crewState.crew.bots, conversationNow, { member_id: params?.member_id });
				if (!resolved.ok) return JSON.stringify({
					ok: false,
					error: resolved.error
				});
				const target = resolved.bot;
				const hoConvKey = `${conversationId || bot.id}:${bot.id}`;
				const turnCtx = activeTurnCtx.get(hoConvKey) || null;
				const taskId = String(params?.task_id || turnCtx?.taskId || "");
				let task = null;
				if (taskId) {
					const scope = await validateTaskForContext(taskId, {
						conversationId: conversationId || null,
						botId: bot.id,
						getTask: (id) => getTask(stateDir, id)
					});
					if (!scope.ok) return JSON.stringify({
						ok: false,
						error: scope.error
					});
					task = scope.task;
				}
				let artifactId = String(params?.artifact_id || "");
				if (artifactId) {
					const metaPath = join(stateDir, "artifacts", artifactId, "meta.json");
					let artMeta = null;
					try {
						artMeta = JSON.parse(await readFile(metaPath, "utf8"));
					} catch {}
					if (!artMeta) return JSON.stringify({
						ok: false,
						error: `成果不存在：${artifactId}`
					});
					if (task) {
						if (!task.artifacts.includes(artifactId)) return JSON.stringify({
							ok: false,
							error: `成果 ${artifactId} 不属于任务 ${taskId}`
						});
					} else {
						const artConv = artMeta.conversationId;
						const expectedConv = conversationId || bot.id;
						if (artConv === void 0 || String(artConv) !== String(expectedConv)) return JSON.stringify({
							ok: false,
							error: `成果 ${artifactId} 来源会话不符或无归属信息，拒绝交接（可先在原会话重新交付以补全归属）`
						});
					}
				} else if (task?.artifacts?.length) artifactId = task.artifacts[task.artifacts.length - 1];
				if (classifyDeliveryTarget({
					conversationId,
					botId: bot.id,
					conversations: crewState.crew.conversations
				}) === "rejected") return JSON.stringify({
					ok: false,
					error: `当前会话 ${conversationId} 已不存在，交接取消`
				});
				const job = await enqueueJob(inboxRoot, {
					toBot: target.id,
					text: String(params?.brief || ""),
					fromBotId: bot.id,
					...conversationId ? { conversationId } : {},
					handoff: {
						taskId: task?.id || null,
						artifactId: artifactId || null,
						fromBotName: bot.name
					}
				});
				scan();
				return JSON.stringify({
					ok: true,
					jobId: job.jobId,
					handedTo: target.name,
					taskId: task?.id || null,
					artifactId: artifactId || null,
					note: "接手成员将收到摘要与指定版本文件（含 SHA 校验）；其成果会回到本会话"
				});
			}
		}];
	}
	const activeTurnCtx = /* @__PURE__ */ new Map();
	async function closeActiveRun(convKey, fallbackTaskId, fallbackRunId, failed) {
		const liveCtx = activeTurnCtx.get(convKey);
		const finTaskId = fallbackRunId ? fallbackTaskId : liveCtx?.taskId ?? null;
		const finRunId = fallbackRunId ? fallbackRunId : liveCtx?.runId ?? null;
		if (finTaskId && finRunId) await endRun(stateDir, finTaskId, finRunId, failed ? "failed" : "done").catch(() => null);
		setTurnCtx(convKey, null);
	}
	function setTurnCtx(botId, ctx) {
		if (ctx) activeTurnCtx.set(botId, ctx);
		else activeTurnCtx.delete(botId);
	}
	function deliveryTools(bot, { conversationId }) {
		return [{
			name: "deliver_file",
			description: "把你在本机工作区创建的文件作为成果交付给用户（在会话里生成原件卡片，用户可预览/保存副本/在本机打开）。完成用户要的文件后必须用它交付，不要只贴文件内容。",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "工作区相对路径，如 agents/xxx/index.html、report.md"
					},
					note: {
						type: "string",
						description: "一句话说明这份成果（卡片标题）"
					},
					task_id: {
						type: "string",
						description: "所属任务 id（task_begin 返回的；持续任务请务必带上，卡片将提供继续修改入口）"
					}
				},
				required: ["path"]
			},
			output: {
				schema: { type: "string" },
				render: (_args, value) => [{
					type: "text",
					text: String(value)
				}]
			},
			async execute(params) {
				const rel = String(params?.path || "").trim().replace(/^\/+/, "");
				if (!rel || rel.split("/").includes("..")) return "ERROR: 非法路径";
				const deliverConvKey = `${conversationId || bot.id}:${bot.id}`;
				if (classifyDeliveryTarget({
					conversationId,
					botId: bot.id,
					conversations: crewState.crew.conversations
				}) === "rejected") return `ERROR: 目标会话 ${conversationId} 已不存在（可能已被删除），已取消交付：${rel}。请告知用户重新建会话后重新交付。`;
				let turnCtx = activeTurnCtx.get(deliverConvKey) || null;
				const explicitTaskId = /^[a-z0-9-]+$/i.test(String(params?.task_id || "")) ? String(params.task_id) : "";
				if (explicitTaskId) {
					const chk = await validateTaskForContext(explicitTaskId, {
						conversationId: conversationId || null,
						botId: bot.id,
						getTask: (id) => getTask(stateDir, id)
					});
					if (!chk.ok) return `ERROR: ${chk.error}`;
					const sameTask = chk.task.id === (turnCtx?.taskId || null);
					if (!sameTask && turnCtx?.runId) return `ERROR: 当前回合运行在任务 ${turnCtx.taskId} 的执行中，不能把产物换绑到任务 ${chk.task.id}；请在本任务回合内交付，或先结束当前任务`;
					turnCtx = {
						...turnCtx || {},
						taskId: chk.task.id,
						runId: sameTask ? turnCtx?.runId ?? null : null,
						conversationId: conversationId || null,
						taskWorkspace: chk.task.workspace || null
					};
					setTurnCtx(deliverConvKey, turnCtx);
				}
				const rootReal = await realpath(turnCtx?.taskWorkspace || botWorkspace(stateDir, bot)).catch(() => null);
				if (!rootReal) return "ERROR: 工作区不可用";
				const real = await realpath(resolve(rootReal, rel)).catch(() => null);
				if (!real || !isInsideRoot(rootReal, real)) return `ERROR: 文件不存在或不在工作区内：${rel}`;
				if (!(await stat(real)).isFile()) return "ERROR: 不是常规文件";
				const { meta } = await createArtifactSnapshot({
					artifactsRoot: join(stateDir, "artifacts"),
					sourceReal: real,
					workspaceRoot: rootReal,
					extra: {
						conversationId: conversationId || bot.id,
						...turnCtx ? {
							taskId: turnCtx.taskId,
							runId: turnCtx.runId
						} : {}
					}
				});
				const name = meta.name;
				const id = meta.id;
				const dir = join(stateDir, "artifacts", id);
				const where2 = classifyDeliveryTarget({
					conversationId,
					botId: bot.id,
					conversations: crewState.crew.conversations
				});
				if (where2 === "rejected") {
					await rm(dir, {
						recursive: true,
						force: true
					}).catch(() => void 0);
					return `ERROR: 目标会话 ${conversationId} 在交付过程中被删除，已取消并清理快照：${name}`;
				}
				if (turnCtx?.taskId) await attachArtifact(stateDir, turnCtx.taskId, meta.id).catch(() => null);
				const card = {
					id,
					name,
					size: meta.size,
					mime: meta.mime,
					sha256: meta.sha256,
					...turnCtx?.taskId ? { taskId: turnCtx.taskId } : {}
				};
				if (where2 === "room") await appendRoomMsg(conversationId, {
					role: "bot",
					botId: bot.id,
					text: String(params?.note || `交付文件：${name}`),
					artifact: card
				});
				else await appendDm(bot.id, {
					role: "bot",
					text: String(params?.note || `交付文件：${name}`),
					artifact: card
				});
				return `已交付 ${name}（${meta.size} 字节，SHA256 ${meta.sha256.slice(0, 16)}…）为会话内原件卡片${turnCtx?.taskId ? `（任务 ${turnCtx.taskId}）` : ""}`;
			}
		}];
	}
	let computerEnabled = false;
	async function refreshComputerFlag() {
		computerEnabled = (await loadComputerConfig())?.enabled === true;
	}
	function computerTools(bot) {
		if (!computerEnabled) return [];
		const output = {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: String(value)
			}]
		};
		return [
			{
				name: "computer_exec",
				description: "Run a shell command on the team computer (Linux VM).",
				parameters: {
					type: "object",
					properties: { command: {
						type: "string",
						description: "Shell command"
					} },
					required: ["command"]
				},
				output,
				async execute(params) {
					const c = await loadComputerConfig();
					if (!c?.enabled) return "Computer not configured";
					const r = await sshExec(c, params.command);
					return r.ok ? r.text : "ERROR: " + r.text;
				}
			},
			{
				name: "computer_browser",
				description: "Open a URL in Chromium on the team computer (visible in the 电脑 view).",
				parameters: {
					type: "object",
					properties: { url: {
						type: "string",
						description: "URL"
					} },
					required: ["url"]
				},
				output,
				async execute(params) {
					const c = await loadComputerConfig();
					if (!c?.enabled) return JSON.stringify({ error: "not configured" });
					const launched = await launchVmBrowser(c, String(params.url));
					return launched.ok ? `浏览器已在团队电脑打开：${params.url}（可在「电脑」视图查看/接管）` : `浏览器打开失败：${launched.error}`;
				}
			},
			{
				name: "computer_screenshot",
				description: "Screenshot the team computer desktop; returns a viewable image URL.",
				parameters: {
					type: "object",
					properties: {},
					required: []
				},
				output,
				async execute() {
					const c = await loadComputerConfig();
					if (!c?.enabled) return JSON.stringify({ error: "not configured" });
					const path = `screenshots/${Date.now()}.png`;
					const r = await sshExec(c, [
						"command -v scrot >/dev/null 2>&1 || { echo NO_SCROT; exit 3; }",
						`mkdir -p ${config.workspace || "/home/bot/workspace"}/screenshots && DISPLAY=:99 scrot ${config.workspace || "/home/bot/workspace"}/${path}`,
						`[ -s /home/bot/workspace/${path} ] && echo SHOT_OK || echo SHOT_EMPTY`
					].join("\n"), 25e3);
					if (r.ok && r.text.includes("SHOT_OK")) {
						await ensureComputerServices().catch(() => void 0);
						return JSON.stringify({
							ok: true,
							url: `http://127.0.0.1:${PREVIEW_PORT}/${path}`
						});
					}
					if (r.text.includes("NO_SCROT")) return JSON.stringify({ error: "团队电脑缺少截图工具（scrot）" });
					return JSON.stringify({ error: `截图失败: ${r.text.slice(0, 200)}` });
				}
			},
			{
				name: "computer_write_file",
				description: "Write a file on the team computer workspace.",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string" },
						content: { type: "string" }
					},
					required: ["path", "content"]
				},
				output,
				async execute(params) {
					const c = await loadComputerConfig();
					if (!c?.enabled) return JSON.stringify({ error: "not configured" });
					const ws = c.workspace || "/home/bot/workspace";
					const r = await sshExec(c, `mkdir -p ${ws} && cat > ${ws}/` + params.path + " <<'EOF'\n" + params.content + "\nEOF");
					return r.ok ? "File written: " + params.path : "Write failed: " + r.text;
				}
			},
			{
				name: "computer_read_file",
				description: "Read a file from the team computer workspace.",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"]
				},
				output,
				async execute(params) {
					const c = await loadComputerConfig();
					if (!c?.enabled) return JSON.stringify({ error: "not configured" });
					const r = await sshExec(c, `cat ${c.workspace || "/home/bot/workspace"}/` + params.path);
					return r.ok ? r.text : "ERROR: " + r.text;
				}
			},
			{
				name: "computer_preview",
				description: "Deliver a playable/viewable artifact (HTML game/page etc.) the Grok way: open it in the team computer's own browser, and tell the user to watch or take over via the 电脑 (Agent Computer) view. path is relative to the shared workspace.",
				parameters: {
					type: "object",
					properties: { path: {
						type: "string",
						description: "Workspace-relative path, e.g. agents/zhaogongcheng/index.html"
					} },
					required: ["path"]
				},
				output,
				async execute(params) {
					const c = await loadComputerConfig();
					if (!c?.enabled) return "Computer not configured";
					await ensureComputerServices();
					let p = String(params.path || "").trim().replace(/^\/+/, "");
					p = p.replace(/^home\/bot\/workspace\//, "").replace(/^workspace\//, "");
					const url = `http://127.0.0.1:${PREVIEW_PORT}/${encodeURI(p)}`;
					const launched = await launchVmBrowser(c, url);
					return JSON.stringify(launched.ok ? {
						ok: true,
						url,
						note: "已在团队电脑的浏览器打开。请在回复里告诉用户：打开「电脑」视图即可观看，可直接接管操作。本机也可直接访问该 URL。"
					} : {
						ok: false,
						error: `预览打开失败：${launched.error}。URL 仍可手动访问：${url}`
					});
				}
			}
		];
	}
	function teamManagementTools(bot, { conversationId = null } = {}) {
		const output = {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: String(value)
			}]
		};
		const conversation = conversationId ? crewState.crew.conversations?.find((c) => c.id === conversationId) ?? null : null;
		return [
			{
				name: "team_list_members",
				description: "List all team members with their names, roles and status.",
				parameters: {
					type: "object",
					properties: {},
					required: []
				},
				output,
				async execute() {
					return JSON.stringify({ members: crewState.crew.bots.map((b) => ({
						id: b.id,
						name: b.name,
						title: b.title,
						status: botState(b.id)?.status || "idle"
					})) });
				}
			},
			{
				name: "team_create_member",
				description: "Create a new team member with a name and role. Only the chief (chief-of-staff) can use this.",
				parameters: {
					type: "object",
					properties: {
						name: {
							type: "string",
							description: "Member name"
						},
						role: {
							type: "string",
							description: "Role/title, e.g. Engineer / Researcher / PM"
						},
						persona: {
							type: "string",
							description: "Optional persona text"
						}
					},
					required: ["name", "role"]
				},
				output,
				async execute(params) {
					if (bot.id !== "chief") return "Only chief can create members";
					try {
						const newBot = createBot(crewState.crew, {
							name: params.name,
							title: params.role,
							persona: params.persona || ""
						});
						await persistCrew();
						await seedBotMemory(newBot);
						await ensureDmConversation(newBot);
						return JSON.stringify({
							ok: true,
							id: newBot.id,
							name: newBot.name,
							role: newBot.title
						});
					} catch (error) {
						return JSON.stringify({ error: safeError(error) });
					}
				}
			},
			{
				name: "team_create_group",
				description: "Create a group chat with named members. The caller is automatically included.",
				parameters: {
					type: "object",
					properties: {
						name: {
							type: "string",
							description: "Group name"
						},
						members: {
							type: "array",
							items: { type: "string" },
							description: "Member names to include"
						}
					},
					required: ["name", "members"]
				},
				output,
				async execute(params) {
					try {
						const memberIds = params.members.map((nm) => {
							const f = crewState.crew.bots.find((b) => b.name.includes(nm) || nm.includes(b.name));
							if (!f) throw new Error("Member not found: " + nm);
							return f.id;
						});
						if (!memberIds.includes(bot.id)) memberIds.push(bot.id);
						if (memberIds.length < 2) throw new Error("Need at least 2 members");
						const conv = createConversation(crewState.crew, {
							name: params.name,
							memberBotIds: memberIds
						});
						await persistCrew();
						await appendRoomMsg(conv.id, {
							role: "system",
							text: "Group created by " + bot.name
						});
						return JSON.stringify({
							ok: true,
							id: conv.id,
							name: conv.name,
							memberCount: memberIds.length
						});
					} catch (error) {
						return JSON.stringify({ error: safeError(error) });
					}
				}
			},
			{
				name: "team_send_task",
				description: "Send a task to a specific team member (async, they start immediately). In a group chat the target MUST be a member of that group (authorization scope); prefer member_id for precision.",
				parameters: {
					type: "object",
					properties: {
						member_id: {
							type: "string",
							description: "Exact member bot id (preferred)"
						},
						member_name: {
							type: "string",
							description: "Member name; must match exactly one member within the authorized scope, ambiguous names are rejected"
						},
						task: {
							type: "string",
							description: "Task description"
						}
					},
					required: ["task"]
				},
				output,
				async execute(params) {
					try {
						const resolved = resolveDispatchTarget(crewState.crew.bots, conversation, params);
						if (!resolved.ok) return JSON.stringify({
							ok: false,
							error: resolved.error
						});
						const target = resolved.bot;
						const job = await enqueueJob(inboxRoot, {
							toBot: target.id,
							text: conversationId ? `[${conversation.name}] ${params.task}` : params.task,
							fromBotId: bot.id,
							...conversationId ? { conversationId } : {}
						});
						scan();
						return JSON.stringify({
							ok: true,
							jobId: job.jobId,
							assignedTo: target.name,
							...conversationId ? { replyTo: conversationId } : {},
							note: "任务已异步派发；成员完成后回复会自动发回" + (conversationId ? "本群" : "该成员的私聊")
						});
					} catch (error) {
						return JSON.stringify({ error: safeError(error) });
					}
				}
			},
			{
				name: "team_setup_project",
				description: "One-shot: create team members, create a group chat, and dispatch initial tasks. Use this instead of calling team_create_member + team_create_group + team_send_task separately. 派发建议：有依赖关系的工作分阶段（如 美术→工程→测试）只派第一阶段，成员交付会自动回流群里并唤醒你协调派发下游；无依赖的可同时派。",
				parameters: {
					type: "object",
					properties: {
						group_name: {
							type: "string",
							description: "Project group name"
						},
						members: {
							type: "array",
							description: "Team members to create and add to the group",
							items: {
								type: "object",
								properties: {
									name: {
										type: "string",
										description: "Member name"
									},
									role: {
										type: "string",
										description: "Role/title"
									},
									task: {
										type: "string",
										description: "Initial task for this member"
									}
								},
								required: ["name", "role"]
							}
						}
					},
					required: ["group_name", "members"]
				},
				output,
				async execute(params) {
					if (bot.id !== "chief") return "Only chief can setup projects";
					const results = {
						created: [],
						group: null,
						tasks: []
					};
					try {
						const memberIds = [];
						for (const m of params.members) try {
							const newBot = createBot(crewState.crew, {
								name: m.name,
								title: m.role
							});
							await persistCrew();
							await seedBotMemory(newBot);
							await ensureDmConversation(newBot);
							memberIds.push(newBot.id);
							results.created.push({
								name: newBot.name,
								role: newBot.title,
								id: newBot.id
							});
						} catch (e) {
							const existing = crewState.crew.bots.find((b) => b.name.includes(m.name) || m.name.includes(b.name));
							if (existing) {
								memberIds.push(existing.id);
								results.created.push({
									name: existing.name,
									role: existing.title,
									id: existing.id,
									existing: true
								});
							}
						}
						if (!memberIds.includes(bot.id)) memberIds.push(bot.id);
						if (memberIds.length >= 2) {
							const conv = createConversation(crewState.crew, {
								name: params.group_name,
								memberBotIds: memberIds
							});
							await persistCrew();
							await appendRoomMsg(conv.id, {
								role: "system",
								text: `Group "${params.group_name}" created by ${bot.name}`
							});
							results.group = {
								id: conv.id,
								name: conv.name,
								memberCount: memberIds.length
							};
						}
						for (let i = 0; i < params.members.length; i++) {
							const m = params.members[i];
							if (m.task && memberIds[i]) {
								const job = await enqueueJob(inboxRoot, {
									toBot: memberIds[i],
									text: `[${params.group_name}] ${m.task}`,
									fromBotId: bot.id,
									...results.group ? { conversationId: results.group.id } : {}
								});
								results.tasks.push({
									to: m.name,
									jobId: job.jobId
								});
							}
						}
						scan();
						results.note = "团队与任务已就绪；成员完成后的回复会自动发到群里。";
						return JSON.stringify(results);
					} catch (error) {
						return JSON.stringify({
							...results,
							error: safeError(error)
						});
					}
				}
			}
		];
	}
	function personaPrompt(bot) {
		const computerOn = computerEnabled;
		return [
			bot.persona || "你是常驻桌面 agent 团队的一员，用简体中文直接处理用户投递的任务。",
			"你的工作环境是宿主本机（用户的 Mac）：bash/文件等本地工具毫秒级可用，工作目录即你的 workspace（个人子目录 agents/" + bot.id + "），团队产物直接写在本地 workspace。",
			...computerOn ? ["computer_* 工具指向可选的团队共享电脑（Linux VM 配件）：用于无头构建、长时任务、托管可试玩的 HTML（computer_preview 会在配件浏览器打开，用户经「电脑」视图观看/接管）。日常编码优先用本地工具，不要绕道配件。"] : [],
			...bot.id === "chief" ? ["你是幕僚长：团队协调者而非执行者。成员交付后你会被自动唤醒——届时派发下游工作（带上游产物路径）、催办等待者、全部完成后向群里做收尾总结。尽量把活分给成员，不要自己代做。"] : [],
			"只汇报真实完成的操作，不要把工具调用伪装成普通文本。",
			"消息支持 Markdown（标题/列表/代码块/链接）。想让用户快捷选择时，在回复最后一行单独写 [[选项1|选项2|选项3]]，会被渲染成可点击按钮。"
		].join("\n");
	}
	async function memorySections(bot, agentCtx) {
		try {
			const team = await readFile(teamMemoryPath, "utf8");
			if (team.trim()) agentCtx.systemPrompt.section({
				name: "grokbot:team",
				order: -19,
				text: `## 团队章程（全队共享，优先遵守）\n${team.trim()}`
			});
		} catch {}
		const profilePath = profilePathOf(bot.id);
		let profile = "";
		try {
			profile = await readFile(profilePath, "utf8");
		} catch {}
		agentCtx.systemPrompt.section({
			name: "grokbot:memory",
			order: -18,
			text: [
				"## 你的长期记忆",
				`文件路径：${profilePath}（可读写）`,
				"当前内容：",
				profile.trim() || "（空）",
				"",
				"记忆维护规则：每回合结束时，若本回合产生了值得长期记住的稳定偏好或重要事实，用工具向该文件追加一行「YYYY-MM-DD 事实」。不要写入一次性任务细节；安全边界写在团队章程或你的职责里，不写记忆。"
			].join("\n")
		});
		try {
			const { readdir: rd } = await import("node:fs/promises");
			const skills = (await rd(skillsDir).catch(() => [])).filter((name) => name.endsWith(".md")).sort();
			if (skills.length > 0) {
				const lines = [];
				for (const name of skills) {
					const head = (await readFile(join(skillsDir, name), "utf8")).split("\n").find((line) => line.trim()) ?? "";
					lines.push(`/${name.replace(/\.md$/, "")} — ${head.replace(/^#+\s*/, "").slice(0, 60)}`);
				}
				agentCtx.systemPrompt.section({
					name: "grokbot:skills",
					order: -17,
					text: [
						"## 可复用技能（全队共享）",
						`目录：${skillsDir}（消息中出现 /技能名 引用时，用读文件工具查看对应 .md 全文并按其执行）`,
						...lines
					].join("\n")
				});
			}
		} catch {}
	}
	async function init() {
		await mkdir(stateDir, { recursive: true });
		await ensureInbox(inboxRoot);
		await mkdir(join(stateDir, "workspace"), { recursive: true });
		await mkdir(join(stateDir, "memory"), { recursive: true });
		await mkdir(skillsDir, { recursive: true });
		await mkdir(roomsDir, { recursive: true });
		const loaded = await loadOrCreateCrew(stateDir);
		crewState.path = loaded.path;
		crewState.crew = loaded.crew;
		await refreshComputerFlag();
		await loadChatSessions();
		await loadUiState();
		for (const bot of crewState.crew.bots) {
			botState(bot.id);
			await seedBotMemory(bot);
			await mkdir(join(botWorkspace(stateDir, bot), "agents", bot.id), { recursive: true }).catch(() => void 0);
			await ensureDmConversation(bot).catch(() => void 0);
		}
		for (const bot of crewState.crew.bots) {
			const stats = await loadStats(bot.id);
			if (stats.backfilled) continue;
			let done = 0;
			let failed = 0;
			try {
				const queueText = await readFile(join(inboxRoot, "queue.jsonl"), "utf8");
				for (const line of queueText.split("\n")) {
					if (!line.trim()) continue;
					let entry;
					try {
						entry = JSON.parse(line);
					} catch {
						continue;
					}
					const dir = String(entry.dir || join(inboxRoot, String(entry.jobId || entry.id || "")));
					let status = null;
					try {
						status = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
					} catch {
						continue;
					}
					if (status.botId !== bot.id) continue;
					if (status.status === "replied") done += 1;
					else if (status.status === "failed") failed += 1;
				}
			} catch {}
			const merged = {
				...stats,
				tasksDone: stats.tasksDone + done,
				tasksFailed: stats.tasksFailed + failed,
				backfilled: true
			};
			merged.exp = Math.max(0, merged.exp + done * 10 - failed * 5);
			await saveStats(bot.id, merged);
		}
		ctx.logger?.info?.(`grokbot ready: ${crewState.crew.bots.length} bot(s), inbox=${inboxRoot}`);
	}
	let crewWriteLock = Promise.resolve();
	async function persistCrew() {
		const write = async () => {
			await atomicWrite(crewState.path, serializeCrew(crewState.crew));
		};
		crewWriteLock = crewWriteLock.then(write, write);
		await crewWriteLock;
	}
	const catalogCache = {
		expiresAt: 0,
		value: null
	};
	async function modelCatalog() {
		if (catalogCache.expiresAt > Date.now()) return catalogCache.value;
		const providers = typeof ctx.llm?.listProviders === "function" ? await ctx.llm.listProviders() : [];
		const value = await Promise.all(providers.map(async (provider) => {
			let models = [];
			try {
				models = typeof ctx.llm?.listModels === "function" ? await ctx.llm.listModels(provider.id) : [];
			} catch {
				models = [];
			}
			return {
				id: provider.id,
				name: provider.name || provider.id,
				models: (models || []).map((model) => ({
					id: model.id,
					name: model.name || model.id
				}))
			};
		}));
		catalogCache.value = value;
		catalogCache.expiresAt = Date.now() + 1e4;
		return value;
	}
	const hydrated = init();
	const activeSessions = /* @__PURE__ */ new Set();
	const approvalBotByAgent = /* @__PURE__ */ new Map();
	const pendingApprovals = /* @__PURE__ */ new Map();
	async function createBotAgent(bot, { sessionId, resume = false, conversationId = null, cwd = null } = {}) {
		const abort = new AbortController();
		const fallback = typeof ctx.agentDefaultModel?.currentSelection === "function" ? ctx.agentDefaultModel.currentSelection() : null;
		const selection = bot.model?.provider && bot.model?.model ? bot.model : crewState.crew.defaultModel?.provider && crewState.crew.defaultModel?.model ? crewState.crew.defaultModel : fallback?.provider && fallback?.model ? fallback : null;
		const base = {
			sessionId: sessionId || randomUUID(),
			meta: { cwd: cwd || botWorkspace(stateDir, bot) },
			...selection ? { agentOptions: selection } : {},
			signal: abort.signal,
			async setup(agentCtx) {
				agentCtx.systemPrompt.section({
					name: "grokbot:identity",
					order: -20,
					text: personaPrompt(bot)
				});
				await memorySections(bot, agentCtx);
				if (agentCtx.tools?.register) for (const tool of [
					...teamManagementTools(bot, { conversationId }),
					...taskTools(bot, { conversationId }),
					...deliveryTools(bot, { conversationId }),
					...computerTools(bot)
				]) try {
					agentCtx.tools.register(tool);
				} catch (e) {}
			}
		};
		let handle;
		if (resume && sessionId) try {
			handle = await ctx.agents.resume(base);
		} catch {
			handle = await ctx.agents.create({
				...base,
				sessionId: randomUUID()
			});
		}
		else handle = await ctx.agents.create(base);
		abort.signal.addEventListener("abort", () => {
			try {
				handle.agent.cancel({ kind: "user" });
			} catch {}
		}, { once: true });
		const session = {
			handle,
			abort,
			dispose: async () => {
				activeSessions.delete(session);
				approvalBotByAgent.delete(String(handle.agent.id));
				try {
					handle.agent.cancel({ kind: "user" }, { keepInbox: true });
				} catch {}
				try {
					await handle.dispose();
				} catch {}
			}
		};
		activeSessions.add(session);
		approvalBotByAgent.set(String(handle.agent.id), bot.id);
		return session;
	}
	ctx.effect(() => ctx.on("system-prompt/assemble", async (assembly, context, next) => {
		const resolved = await next();
		const sessionId = context?.sessionId || context?.session?.id || "";
		if (!sessionId) return resolved;
		let botId = null;
		for (const [key, sid] of chatSessionIds.entries()) if (sid === sessionId) {
			botId = key.split(":")[1];
			break;
		}
		if (!botId) return resolved;
		const bot = crewState.crew.bots.find((b) => b.id === botId);
		if (!bot) return resolved;
		const sections = [...resolved.sections || []];
		if (!sections.some((s) => s.name === "grokbot:identity")) {
			sections.unshift({
				name: "grokbot:identity",
				order: -20,
				text: personaPrompt(bot)
			});
			try {
				const profile = await readFile(profilePathOf(bot.id), "utf8");
				if (profile.trim()) sections.push({
					name: "grokbot:memory",
					order: -18,
					text: `## 你的长期记忆\n文件路径：${profilePathOf(bot.id)}（可读写）\n当前内容：\n${profile.trim()}\n\n记忆维护规则：每回合结束时，若产生了值得长期记住的稳定偏好或重要事实，用工具向该文件追加一行「YYYY-MM-DD 事实」。`
				});
			} catch {}
		}
		return {
			...resolved,
			sections
		};
	}), "grokbot: global persona injection");
	ctx.effect(() => ctx.on("agent/created", (ev) => {
		const agent = ev?.agent ?? ev;
		if (!agent?.ctx?.tools?.register || !agent?.session?.id) return;
		let convId = null;
		let botId = null;
		for (const [key, sid] of chatSessionIds.entries()) if (sid === agent.session.id) {
			const [c, b] = key.split(":");
			convId = c === b ? null : c;
			botId = b;
			break;
		}
		if (!botId) return;
		const bot = crewState.crew.bots.find((b) => b.id === botId);
		if (!bot) return;
		for (const tool of [
			...teamManagementTools(bot, { conversationId: convId }),
			...taskTools(bot, { conversationId: convId }),
			...deliveryTools(bot, { conversationId: convId }),
			...computerTools(bot)
		]) try {
			agent.ctx.tools.register(tool);
		} catch {}
	}), "grokbot: native session tool injection");
	ctx.effect(() => ctx.on("approval/request", (req, next) => {
		const agentId = String(req?.agent?.id || "");
		const botId = approvalBotByAgent.get(agentId);
		if (!botId) return next();
		const events = req?.agent?.session?.events || [];
		const decided = /* @__PURE__ */ new Set();
		let approvalId = "";
		for (let index = events.length - 1; index >= 0; index -= 1) {
			const event = events[index];
			if (event.type === "approval/decided") {
				decided.add(event.data.id);
				continue;
			}
			if (event.type !== "approval/asked" || decided.has(event.data.id)) continue;
			if ((req.callId ?? null) !== (event.data.callId ?? null)) continue;
			if (pendingApprovals.has(String(event.data.id))) continue;
			approvalId = String(event.data.id);
			break;
		}
		if (!approvalId) return next();
		ctx.logger?.info?.(`grokbot approval ${approvalId} bot=${botId} tool=${req.toolName}`);
		return new Promise((resolve) => {
			pendingApprovals.set(approvalId, {
				id: approvalId,
				botId,
				toolName: String(req.toolName || ""),
				reason: String(req.reason || ""),
				createdAt: Date.now(),
				resolve
			});
			req.signal?.addEventListener("abort", () => {
				if (pendingApprovals.get(approvalId)?.resolve === resolve) pendingApprovals.delete(approvalId);
				resolve("cancelled");
			}, { once: true });
		});
	}, true), "grokbot: approval bridge");
	const ROLE_TEMPLATES = /* @__PURE__ */ new Map([
		["工程师", "coder"],
		["调研员", "researcher"],
		["写作官", "writer"],
		["数据分析师", "analyst"],
		["产品经理", "pm"],
		["秘书", "secretary"],
		["运维官", "ops"],
		["翻译官", "translator"],
		["审核官", "reviewer"]
	]);
	const setupPathOf = (botId) => join(stateDir, "bots", botId, "setup.json");
	async function loadSetup(botId) {
		try {
			return JSON.parse(await readFile(setupPathOf(botId), "utf8"));
		} catch {
			return null;
		}
	}
	async function saveSetup(botId, setup) {
		await atomicWrite(setupPathOf(botId), `${JSON.stringify(setup, null, 2)}\n`);
	}
	async function trySetupTurn(bot, text) {
		const setup = await loadSetup(bot.id);
		if (!setup || setup.stage === "done") return null;
		const clean = String(text || "").trim();
		if (setup.stage === "await-role") {
			if (clean === "跳过设置") {
				await saveSetup(bot.id, {
					stage: "done",
					skipped: true
				});
				return { reply: "好，跳过设置。我先用默认身份干活，随时可以让我调整角色或名字。" };
			}
			if (clean === "更多角色") return { reply: "其余角色：\n\n[[运维官|翻译官|审核官]]\n\n也可以直接描述你想让我做什么。" };
			const templateId = ROLE_TEMPLATES.get(clean);
			if (!templateId) return null;
			const template = templateById(templateId);
			updateBot(crewState.crew, bot.id, {
				persona: template.persona,
				title: template.title,
				avatar: template.avatar
			});
			await persistCrew();
			await saveSetup(bot.id, {
				stage: "await-name",
				roleTemplate: templateId
			});
			return {
				reply: `已就任「**${clean}**」。最后一步——叫我什么名字？\n\n[[${template.name}|自己起一个]]`,
				renameTo: null
			};
		}
		if (setup.stage === "await-name") {
			if (clean === "跳过设置") {
				await saveSetup(bot.id, {
					stage: "done",
					roleTemplate: setup.roleTemplate
				});
				return { reply: "设置完成（沿用默认名字）。现在就可以给我第一个任务。" };
			}
			const template = templateById(setup.roleTemplate || "") || { name: "" };
			let name = "";
			if (template.name && clean === template.name) name = template.name;
			else if (clean === "自己起一个") return { reply: "好，直接输入名字（2-12 个字）就好。" };
			else {
				const explicit = /^叫(?:我)?\s*([\u4e00-\u9fa5A-Za-z0-9·]{2,12})$/.exec(clean);
				const bare = /^[\u4e00-\u9fa5A-Za-z0-9·]{2,12}$/.test(clean) && !ROLE_TEMPLATES.has(clean);
				if (explicit) name = explicit[1];
				else if (bare && clean !== template.name) name = clean;
			}
			if (!name) return null;
			updateBot(crewState.crew, bot.id, { name });
			await persistCrew();
			await saveSetup(bot.id, {
				stage: "done",
				roleTemplate: setup.roleTemplate
			});
			return { reply: `就叫我**${name}**了。${template.title ? `角色：${template.title}。` : ""}设置完成，现在就可以给我第一个任务——说吧。` };
		}
		return null;
	}
	async function appendDm(botId, entry) {
		const dir = join(stateDir, "bots", botId);
		await mkdir(dir, { recursive: true });
		const path = join(dir, "dm-transcript.jsonl");
		let text = "";
		try {
			text = await readFile(path, "utf8");
		} catch {
			text = "";
		}
		if (!text.endsWith("\n") && text.length > 0) await appendFile(path, "\n");
		await appendFile(path, `${JSON.stringify({
			ts: Date.now(),
			...entry
		})}\n`);
	}
	async function readDm(botId, limit = 200) {
		try {
			return (await readFile(join(stateDir, "bots", botId, "dm-transcript.jsonl"), "utf8")).split("\n").filter((line) => line.trim()).slice(-limit).map((line) => {
				try {
					return JSON.parse(line);
				} catch {
					return null;
				}
			}).filter(Boolean);
		} catch {
			return [];
		}
	}
	async function chatTurn(bot, text, { preamble = "", conversationId = null, writeDm = true, taskId = null, taskOrigin = "continue", taskNote = "", existingRunId = null } = {}) {
		const convKey = conversationId ? `${conversationId}:${bot.id}` : `${bot.id}:${bot.id}`;
		const check = await validateTaskForContext(taskId, {
			conversationId: conversationId || null,
			botId: bot.id,
			getTask: (id) => getTask(stateDir, id)
		});
		if (!check.ok) return {
			text: `[任务校验失败] ${check.error}`,
			activity: [],
			error: check.error
		};
		const task = check.task;
		const defaultWs = botWorkspace(stateDir, bot);
		const taskWs = task?.workspace || null;
		const sessionKey = `${convKey}${taskWs && taskWs !== defaultWs ? `|ws:${taskWs}` : ""}`;
		const defaultWs4Turn = botWorkspace(stateDir, bot);
		return runExclusively({
			taskId,
			botId: bot.id,
			workspace: taskWs || defaultWs4Turn
		}, async () => {
			let runRef = null;
			if (taskId && existingRunId) runRef = { id: existingRunId };
			else if (taskId) runRef = (await startRun(stateDir, taskId, {
				botId: bot.id,
				origin: taskOrigin,
				note: taskNote || String(text).slice(0, 120)
			}).catch(() => null))?.run ?? null;
			setTurnCtx(convKey, {
				taskId: taskId || null,
				runId: runRef?.id || null,
				conversationId: conversationId || null,
				taskWorkspace: taskWs
			});
			const state = botState(bot.id);
			const prevStatus = state.status;
			const prevJob = state.currentJob;
			state.status = "working";
			state.currentJob = taskId || "chat";
			let failed = false;
			try {
				let session = chatHandles.get(sessionKey);
				if (!session) {
					const known = chatSessionIds.get(sessionKey);
					if (known) session = await createBotAgent(bot, {
						sessionId: known,
						resume: true,
						conversationId,
						cwd: taskWs || void 0
					});
					else {
						const sessionId = randomUUID();
						chatSessionIds.set(sessionKey, sessionId);
						await persistChatSessions();
						session = await createBotAgent(bot, {
							sessionId,
							conversationId,
							cwd: taskWs || void 0
						});
					}
					const actualId = session.handle.agent?.session?.id;
					if (actualId && actualId !== chatSessionIds.get(sessionKey)) {
						chatSessionIds.set(sessionKey, String(actualId));
						await persistChatSessions();
					}
					chatHandles.set(sessionKey, session);
				}
				await session.handle.agent.whenIdle();
				const firstSeq = session.handle.agent.session.seq;
				session.handle.agent.followup(userMessage(preamble ? `${preamble}\n\n${text}` : text));
				if (writeDm) await appendDm(bot.id, {
					role: "user",
					text: preamble ? `${preamble}\n\n${text}` : text
				}).catch(() => void 0);
				await session.handle.agent.whenIdle();
				const outcome = {
					...summarizeTurn(session.handle.agent.session.events, firstSeq),
					activity: activityOf(session.handle.agent.session.events, firstSeq)
				};
				const turnText = outcome.text?.trim();
				failed = Boolean(outcome.error) || !turnText;
				if (turnText && writeDm) await appendDm(bot.id, {
					role: "bot",
					text: turnText,
					activity: outcome.activity
				}).catch(() => void 0);
				return outcome;
			} catch (error) {
				failed = true;
				throw error;
			} finally {
				state.status = prevStatus === "working" ? "idle" : prevStatus;
				state.currentJob = prevJob ?? null;
				await closeActiveRun(convKey, taskId, runRef?.id ?? null, failed);
			}
		});
	}
	function eligibleBots(conversation) {
		return conversation.memberBotIds.map((botId) => crewState.crew.bots.find((bot) => bot.id === botId)).filter(Boolean);
	}
	function pickResponder(conversation, text) {
		const mention = /@([\w\u4e00-\u9fa5]+)/.exec(String(text || ""));
		if (mention) {
			const hit = eligibleBots(conversation).find((bot) => bot && (bot.name.includes(mention[1]) || mention[1] === bot.id || bot.id.includes(mention[1])));
			if (hit) return hit;
		}
		const fallbackId = crewState.crew.routing.default;
		const inRoom = conversation.memberBotIds.includes(fallbackId);
		return crewState.crew.bots.find((bot) => bot.id === (inRoom ? fallbackId : conversation.memberBotIds[0]));
	}
	const HANDOFF_LINE_RE = /^@([\w\u4e00-\u9fa5]+)[：:\s]+(.+)$/;
	async function conversationTurn(conversation, senderText, { mentionTarget, taskId = null } = {}) {
		if (conversation.memberBotIds.length === 1) {
			const bot = crewState.crew.bots.find((entry) => entry.id === conversation.memberBotIds[0]);
			if (!bot) throw new Error("会话成员不存在");
			const outcome = await chatTurn(bot, senderText, {
				conversationId: conversation.id,
				writeDm: true,
				taskId,
				taskOrigin: taskId ? "continue" : "user"
			});
			return {
				responder: bot,
				reply: outcome.text?.trim() || `[${bot.name} 未能给出文本回复]`,
				handoffTo: null,
				outcome
			};
		}
		const members = conversation.memberBotIds.map((botId) => crewState.crew.bots.find((bot) => bot.id === botId)).filter(Boolean);
		const responder = mentionTarget ?? pickResponder(conversation, senderText);
		if (!responder) throw new Error("群聊无可应答成员");
		const userMention = /@([\w\u4e00-\u9fa5]+)/.exec(String(senderText || ""));
		if (userMention && !mentionTarget && !eligibleBots(conversation).some((bot) => bot.name.includes(userMention[1]) || bot.id.includes(userMention[1]))) await appendRoomMsg(conversation.id, {
			role: "system",
			text: `「@${userMention[1]}」不是本群成员，未定向派发；由 ${responder.name} 应答。`
		}).catch(() => void 0);
		const historyLines = (await readRoomMsgs(conversation.id, 10)).slice(-8).map((msg) => {
			if (msg.role === "user") return `用户: ${String(msg.text || "").slice(0, 120)}`;
			if (msg.role === "bot") return `${crewState.crew.bots.find((b) => b.id === msg.botId)?.name || msg.botId}: ${String(msg.text || "").slice(0, 120)}`;
			if (msg.role === "handoff") {
				const from = crewState.crew.bots.find((b) => b.id === msg.fromBotId);
				const to = crewState.crew.bots.find((b) => b.id === msg.toBotId);
				return `↪ ${from?.name || "?"} 交给 ${to?.name || "?"}: ${String(msg.text || "").slice(0, 80)}`;
			}
			return null;
		}).filter(Boolean);
		const historyText = historyLines.length > 0 ? `\n【最近对话】\n${historyLines.join("\n")}` : "";
		const outcome = await chatTurn(responder, senderText, {
			preamble: [
				`【群聊 ${conversation.name}】成员：${members.map((bot) => `${bot.avatar}${bot.name}`).join("、")}。`,
				historyText,
				"\n你现在在群聊中应答。你能看到上方队友的最近发言和交接——可以接着他们的进度干活（共享电脑里的文件直接读），不要重复已完成的步骤。",
				"若你认为某条工作应由其他成员处理，在回复的最后一行单独写「@成员名 交代内容」，系统会异步转交；不要除此行外提交接。"
			].filter(Boolean).join("\n"),
			conversationId: conversation.id,
			writeDm: false,
			taskId,
			taskOrigin: taskId ? "continue" : "user"
		});
		const reply = outcome.text?.trim() || `[${responder.name} 未能给出文本回复：${outcome.error || outcome.stopReason}]`;
		const lines = reply.split("\n");
		const lastLine = lines[lines.length - 1]?.trim() ?? "";
		const handoff = HANDOFF_LINE_RE.exec(lastLine);
		if (handoff) {
			const resolvedHandoff = resolveDispatchTarget(crewState.crew.bots, conversation, { member_name: handoff[1] });
			const target = resolvedHandoff.ok ? resolvedHandoff.bot : null;
			if (!target) appendRoomMsg(conversation.id, {
				role: "system",
				text: `「@${handoff[1]}」文本交接已停用：${resolvedHandoff.error || "目标不在本群成员内"}。请改用 handoff 工具（精确 member_id + 指定版本）。`
			}).catch(() => void 0);
			else if (target.id !== responder.id) appendRoomMsg(conversation.id, {
				role: "system",
				text: `检测到文本交接意图（@${handoff[1]}）。请改用 handoff 工具执行以携带任务与指定版本校验；本次未自动转交。`
			}).catch(() => void 0);
		}
		await appendRoomMsg(conversation.id, {
			role: "bot",
			botId: responder.id,
			text: reply
		});
		return {
			responder,
			reply,
			handoffTo: null
		};
	}
	const chiefWake = new WakeScheduler({
		intervalMs: 6e4,
		fire: (conversationId) => {
			chiefCoordinationTurn(conversationId);
		}
	});
	function wakeChiefForGroup(conversationId, fromBotId = null) {
		try {
			const conv = crewState.crew.conversations?.find((c) => c.id === conversationId);
			if (!conv || conv.memberBotIds?.length < 2 || !conv.memberBotIds.includes("chief")) return;
			if (fromBotId !== "chief") return;
			chiefWake.request(conversationId);
		} catch {}
	}
	async function chiefCoordinationTurn(conversationId, retried = 0) {
		const chief = crewState.crew.bots.find((bot) => bot.id === "chief");
		const conv = crewState.crew.conversations?.find((c) => c.id === conversationId);
		if (!chief || !conv) return;
		const state = botState(chief.id);
		if (state.status === "working") {
			if (retried < 2) setTimeout(() => void chiefCoordinationTurn(conversationId, retried + 1), 25e3);
			return;
		}
		const digest = (await readRoomMsgs(conversationId, 12).catch(() => [])).slice(-6).map((msg) => {
			if (msg.role === "bot") return `${crewState.crew.bots.find((b) => b.id === msg.botId)?.name || msg.botId}: ${String(msg.text || "").slice(0, 160)}`;
			if (msg.role === "system") return `[系统] ${String(msg.text || "").slice(0, 120)}`;
			if (msg.role === "handoff") return `[转交] ${msg.fromBotId} → ${msg.toBotId}: ${String(msg.text || "").slice(0, 100)}`;
			return `用户: ${String(msg.text || "").slice(0, 120)}`;
		}).join("\n");
		if (!digest) return;
		state.status = "working";
		try {
			const reply = (await chatTurn(chief, [
				`【群「${conv.name}」有新动态，幕僚长请协调】`,
				`【群内最近消息】\n${digest}`,
				"\n你是幕僚长，负责让这个项目走完：",
				"1. 若有成员交付了上游产物，立即派发依赖它的下游工作（如测试/集成），用 team_send_task，把上游产物路径与要点带给下游；",
				"2. 若有成员在等待依赖，告知其已就绪或安排替代；",
				"3. 若全部完成，向群里做收尾总结（成果路径、测试结论、遗留事项）；",
				"4. 无需行动时简单确认进展即可。不要自己动手做成员的活。回复简明扼要。"
			].join("\n"), {
				conversationId,
				writeDm: false
			})).text?.trim();
			if (reply) await appendRoomMsg(conversationId, {
				role: "bot",
				botId: chief.id,
				text: reply
			}).catch(() => void 0);
			ctx.logger?.info?.(`grokbot chief 协调了群 ${conv.name}`);
		} catch (error) {
			ctx.logger?.warn?.(`grokbot chief 协调失败：${safeError(error)}`);
		} finally {
			state.status = "idle";
			state.lastActivity = Date.now();
			chiefWake.onFired(conversationId);
		}
	}
	async function sweepStale() {
		try {
			const queueText = await readFile(join(inboxRoot, "queue.jsonl"), "utf8").catch(() => "");
			for (const line of queueText.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				let entry;
				try {
					entry = JSON.parse(trimmed);
				} catch {
					continue;
				}
				const jobId = String(entry.jobId || entry.id || "").trim();
				const dir = String(entry.dir || join(inboxRoot, jobId));
				let status = null;
				try {
					status = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
				} catch {
					const created = Number(entry.createdAt) || 0;
					if (created && Date.now() - created > 864e5) {
						const botId = String(entry.toBot || "").trim();
						if (botId) {
							await cancelJob({
								jobId,
								dir
							}, botId, "queued 超过 24h 未执行，清扫器过期取消").catch(() => void 0);
							recordRecent({
								jobId,
								botId,
								status: "cancelled",
								endedAt: Date.now()
							});
						}
					}
					continue;
				}
				if (status?.status !== "claimed") continue;
				if (runningJobs.has(jobId)) continue;
				const age = Date.now() - (Number(status.startedAt) || 0);
				if (age < jobTimeoutMs * 2) continue;
				const botId = String(status.botId || routeJob(crewState.crew, entry).id);
				await failJob({
					jobId,
					dir,
					toBot: botId,
					text: String(entry.text || ""),
					images: []
				}, botId, `任务超时未完成（claimed ${Math.round(age / 1e3)}s），已由清扫器释放`);
				recordRecent({
					jobId,
					botId,
					status: "failed",
					error: "stale-claimed swept",
					endedAt: Date.now()
				});
				ctx.logger?.warn?.(`grokbot swept stale job ${jobId}`);
			}
		} catch (error) {
			ctx.logger?.warn?.(`grokbot sweep error: ${safeError(error)}`);
		}
	}
	async function runInboxJob(job) {
		const bot = routeJob(crewState.crew, job);
		const convKey4Job = `${job.conversationId || bot.id}:${bot.id}`;
		const jobTaskIdPre = (job.handoff || null)?.taskId || job.taskId || null;
		if (job.conversationId) {
			const convNow = (crewState.crew.conversations ?? []).find((c) => c.id === job.conversationId);
			if (!convNow) {
				await failJob(job, bot.id, `会话 ${job.conversationId} 已不存在，任务取消（不降级投递）`).catch(() => void 0);
				recordRecent({
					jobId: job.jobId,
					botId: bot.id,
					status: "failed",
					error: "conversation-gone",
					endedAt: Date.now()
				});
				return;
			}
			if (!convNow.memberBotIds.includes(bot.id)) {
				await failJob(job, bot.id, `${bot.name} 已被移出会话 ${job.conversationId}，任务取消`).catch(() => void 0);
				recordRecent({
					jobId: job.jobId,
					botId: bot.id,
					status: "failed",
					error: "member-removed",
					endedAt: Date.now()
				});
				return;
			}
		}
		if (jobTaskIdPre) {
			const chk = await validateTaskForContext(jobTaskIdPre, {
				conversationId: job.conversationId || null,
				botId: bot.id,
				getTask: (id) => getTask(stateDir, id)
			});
			if (!chk.ok) {
				await failJob(job, bot.id, `任务校验失败：${chk.error}`).catch(() => void 0);
				recordRecent({
					jobId: job.jobId,
					botId: bot.id,
					status: "failed",
					error: "task-scope",
					endedAt: Date.now()
				});
				return;
			}
		}
		await runExclusively({
			taskId: jobTaskIdPre,
			botId: bot.id,
			workspace: (await getTask(stateDir, jobTaskIdPre).catch(() => null))?.workspace || botWorkspace(stateDir, bot)
		}, async () => {
			if (job.conversationId) {
				const convNow2 = (crewState.crew.conversations ?? []).find((c) => c.id === job.conversationId);
				if (!convNow2 || !convNow2.memberBotIds.includes(bot.id)) throw new Error(`会话成员资格在排队后失效（${job.conversationId}）`);
			}
			if (jobTaskIdPre) {
				const recheck = await validateTaskForContext(jobTaskIdPre, {
					conversationId: job.conversationId || null,
					botId: bot.id,
					getTask: (id) => getTask(stateDir, id)
				});
				if (!recheck.ok) throw new Error(`任务校验失败（锁内复查）：${recheck.error}`);
			}
			await runJobBody(job, bot, convKey4Job, jobTaskIdPre);
		}).catch(async (error) => {
			await failJob(job, bot.id, safeError(error)).catch(() => void 0);
			recordRecent({
				jobId: job.jobId,
				botId: bot.id,
				status: "failed",
				error: safeError(error).slice(0, 80),
				endedAt: Date.now()
			});
			if (job.conversationId) await appendRoomMsg(job.conversationId, {
				role: "system",
				text: `任务取消：${safeError(error)}`
			}).catch(() => void 0);
			ctx.logger?.warn?.(`grokbot job ${job.jobId} 执行前校验失败：${safeError(error)}`);
		});
	}
	async function runJobBody(job, bot, convKey4Job, jobTaskIdPre) {
		{
			const state = botState(bot.id);
			state.status = "working";
			state.currentJob = job.jobId;
			let session = null;
			try {
				await claimJob(job, bot.id);
				runningJobs.set(job.jobId, {
					botId: bot.id,
					startedAt: Date.now(),
					get abort() {
						return session?.abort;
					}
				});
				const promptText = job.text?.trim() || `（无文字内容${job.images.length > 0 ? "，请查看同目录图片附件" : ""}）`;
				let handoffPreamble = "";
				const ho = job.handoff || null;
				const jobTaskId = ho?.taskId || job.taskId || null;
				let hoRunId = null;
				if (ho) {
					let artBlock = "";
					if (ho.artifactId) try {
						const am = JSON.parse(await readFile(join(stateDir, "artifacts", ho.artifactId, "meta.json"), "utf8"));
						artBlock = `\n【指定成果版本】${am.name}（任务固定版本）\n- 快照路径：${join(stateDir, "artifacts", ho.artifactId, "data", "payload")}\n- SHA256：${am.sha256}\n- 要求：先读取该文件并用 sha256sum 校验一致后再基于它工作；这是交接基准版本。`;
					} catch {
						artBlock = `\n【指定成果版本】${ho.artifactId}（快照读取失败，请回报交接人）`;
					}
					const task = jobTaskId ? await getTask(stateDir, jobTaskId).catch(() => null) : null;
					if (task) hoRunId = (await startRun(stateDir, task.id, {
						botId: bot.id,
						origin: "handoff",
						note: String(promptText).slice(0, 200)
					}).catch(() => null))?.run?.id ?? null;
					handoffPreamble = `【接力交接】${ho.fromBotName || "队友"} 把这项工作交给你继续。${artBlock}${task ? `\n【任务】${task.title}（taskId=${task.id}；任务工作区根目录：${task.workspace || botWorkspace(stateDir, bot)}——读写与交付都以它为根）` : ""}\n交接摘要：${promptText}`;
				}
				const jobTaskWs = (jobTaskId ? await getTask(stateDir, jobTaskId).catch(() => null) : null)?.workspace || null;
				setTurnCtx(convKey4Job, {
					taskId: jobTaskId,
					runId: hoRunId,
					conversationId: job.conversationId || null,
					taskWorkspace: jobTaskWs
				});
				session = await createBotAgent(bot, {
					conversationId: job.conversationId || null,
					cwd: jobTaskWs || void 0
				});
				const timeout = setTimeout(() => session.abort.abort(/* @__PURE__ */ new Error(`job timeout after ${jobTimeoutMs}ms`)), jobTimeoutMs);
				const startedAt = Date.now();
				const heartbeat = job.conversationId ? setInterval(() => {
					const minutes = Math.round((Date.now() - startedAt) / 6e4);
					appendRoomMsg(job.conversationId, {
						role: "system",
						text: `⏳ ${bot.name} 仍在处理任务（已进行 ${minutes} 分钟）…`
					}).catch(() => void 0);
				}, 24e4) : null;
				let outcome;
				try {
					await session.handle.agent.whenIdle();
					const firstSeq = session.handle.agent.session.seq;
					const basePrompt = handoffPreamble || promptText;
					const withImages = job.images.length > 0 ? `${basePrompt}\n\n【图片】请阅读：\n${job.images.join("\n")}` : basePrompt;
					session.handle.agent.followup(userMessage(withImages));
					await session.handle.agent.whenIdle();
					outcome = summarizeTurn(session.handle.agent.session.events, firstSeq);
				} finally {
					clearTimeout(timeout);
					if (heartbeat) clearInterval(heartbeat);
					const replyProbe = outcome?.text?.trim();
					const jobFailed = Boolean(outcome?.error) || !replyProbe;
					await closeActiveRun(convKey4Job, jobTaskId, hoRunId, jobFailed);
				}
				const reply = outcome.text?.trim();
				const deliverReply = async (text) => {
					if (job.conversationId) {
						await appendRoomMsg(job.conversationId, {
							role: "bot",
							botId: bot.id,
							text
						}).catch((error) => {
							ctx.logger?.warn?.(`grokbot job ${job.jobId} 回流群聊失败：${safeError(error)}`);
						});
						if (bot.id !== "chief") wakeChiefForGroup(job.conversationId, job.fromBotId);
					} else {
						await appendDm(bot.id, {
							role: "user",
							text: `[任务] ${promptText.slice(0, 120)}`
						}).catch(() => void 0);
						await appendDm(bot.id, {
							role: "bot",
							text
						}).catch(() => void 0);
					}
				};
				if (!reply) {
					const reason = outcome.error ? `${outcome.error}（stopReason=${outcome.stopReason}）` : `stopReason=${outcome.stopReason}，无文本输出`;
					await failJob(job, bot.id, reason);
					if (job.conversationId) {
						await appendRoomMsg(job.conversationId, {
							role: "system",
							text: `${bot.name} 任务失败：${reason}`
						}).catch(() => void 0);
						if (bot.id !== "chief") wakeChiefForGroup(job.conversationId, job.fromBotId);
					}
					recordRecent({
						jobId: job.jobId,
						botId: bot.id,
						status: "failed",
						error: reason,
						endedAt: Date.now()
					});
					ctx.logger?.warn?.(`grokbot job ${job.jobId} failed: ${reason}`);
				} else {
					if (outcome.error) ctx.logger?.warn?.(`grokbot job ${job.jobId} 回复已产出但回合报错：${outcome.error}`);
					await completeJob(job, bot.id, reply);
					await deliverReply(reply);
					await awardBot(bot.id, {
						expDelta: 10,
						tasksDoneDelta: 1
					}).catch(() => void 0);
					recordRecent({
						jobId: job.jobId,
						botId: bot.id,
						status: "replied",
						bytes: reply.length,
						endedAt: Date.now()
					});
					ctx.logger?.info?.(`grokbot job ${job.jobId} replied by ${bot.id} (${reply.length} bytes)`);
				}
			} catch (error) {
				const reason = safeError(error);
				await failJob(job, bot.id, reason).catch(() => void 0);
				if (job.conversationId) {
					await appendRoomMsg(job.conversationId, {
						role: "system",
						text: `${bot.name} 任务失败：${reason}`
					}).catch(() => void 0);
					if (bot.id !== "chief") wakeChiefForGroup(job.conversationId, job.fromBotId);
				}
				recordRecent({
					jobId: job.jobId,
					botId: bot.id,
					status: "failed",
					error: reason,
					endedAt: Date.now()
				});
				ctx.logger?.warn?.(`grokbot job ${job.jobId} error: ${reason}`);
			} finally {
				session?.dispose();
				runningJobs.delete(job.jobId);
				state.status = "idle";
				state.currentJob = null;
				state.lastActivity = Date.now();
				pump();
			}
		}
	}
	function pump() {
		if (disposed) return;
		while (runningJobs.size < maxConcurrentJobs && pendingJobs.length > 0) {
			const busy = new Set([...runningJobs.values()].map((entry) => entry.botId));
			const index = pendingJobs.findIndex((job) => {
				const bot = routeJob(crewState.crew, job);
				return !busy.has(bot.id);
			});
			if (index < 0) break;
			const [job] = pendingJobs.splice(index, 1);
			runInboxJob(job);
		}
	}
	async function scan() {
		if (scanning || disposed) return;
		scanning = true;
		try {
			await hydrated;
			await sweepStale();
			const jobs = await scanInbox(inboxRoot);
			for (const job of jobs) {
				if (seenJobIds.has(job.jobId)) continue;
				seenJobIds.add(job.jobId);
				pendingJobs.push(job);
				recordRecent({
					jobId: job.jobId,
					botId: routeJob(crewState.crew, job).id,
					status: "queued",
					endedAt: null
				});
			}
			pump();
		} catch (error) {
			ctx.logger?.warn?.(`grokbot scan error: ${safeError(error)}`);
		} finally {
			scanning = false;
		}
	}
	const rescanTimer = setInterval(() => void scan(), rescanIntervalMs);
	const routineTimer = setInterval(() => void (async () => {
		try {
			const routines = crewState.crew.routines ?? [];
			if (routines.length === 0) return;
			const state = await loadRoutinesState();
			const now = /* @__PURE__ */ new Date();
			for (const routine of routines) {
				if (routine.enabled === false) continue;
				const last = Number(state[routine.id]) || 0;
				let due = false;
				if (routine.schedule.everyMinutes) due = Date.now() - last >= routine.schedule.everyMinutes * 6e4;
				else if (routine.schedule.time) {
					const [hh, mm] = routine.schedule.time.split(":").map(Number);
					due = now.getHours() === hh && now.getMinutes() >= mm && new Date(last).toDateString() !== now.toDateString();
				}
				if (!due) continue;
				state[routine.id] = Date.now();
				await atomicWrite(routinesStatePath, `${JSON.stringify(state, null, 2)}\n`);
				const job = await enqueueJob(inboxRoot, {
					toBot: routine.botId,
					text: `[routine ${routine.id}] ${routine.prompt}`
				});
				await appendRoutineHistory(routine.id, {
					kind: "scheduled",
					jobId: job.jobId
				});
				ctx.logger?.info?.(`grokbot routine ${routine.id} fired job=${job.jobId}`);
			}
		} catch (error) {
			ctx.logger?.warn?.(`grokbot routine scheduler error: ${safeError(error)}`);
		}
	})(), 3e4);
	let watcher = null;
	try {
		watcher = watch(inboxRoot, { recursive: true }, () => {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => void scan(), 400);
		});
	} catch {}
	let debounceTimer = null;
	scan();
	ensureComputerServices();
	const servicesTimer = setInterval(() => void ensureComputerServices(), 3e4);
	function respond(res, status, body) {
		res.writeHead(status, JSON_HEADERS);
		res.end(JSON.stringify(body));
	}
	async function readJsonBody(req) {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const text = Buffer.concat(chunks).toString("utf8");
		return text ? JSON.parse(text) : {};
	}
	function assertSameOrigin(req) {
		const origin = req.headers?.origin;
		if (!origin) return;
		const host = req.headers?.host;
		try {
			if (host && new URL(origin).host !== host) throw new HttpError(403, "cross-origin rejected");
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(403, "invalid origin");
		}
	}
	class HttpError extends Error {
		constructor(status, message) {
			super(message);
			this.status = status;
		}
	}
	function publicBot(bot) {
		const state = botState(bot.id);
		return {
			id: bot.id,
			name: bot.name,
			avatar: bot.avatar,
			title: bot.title,
			pinned: bot.pinned,
			section: bot.section,
			hidden: bot.hidden,
			status: state.status,
			currentJob: state.currentJob,
			lastActivity: state.lastActivity
		};
	}
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_ROOT,
		handler: async (req, res) => {
			try {
				await hydrated;
				assertSameOrigin(req);
				const url = new URL(req.url ?? "/", "http://dsh.internal");
				const method = String(req.method ?? "GET").toUpperCase();
				const suffix = url.pathname.slice(20) || "/";
				if (method === "GET" && suffix === "/health") {
					respond(res, 200, {
						ok: true,
						time: nowIso()
					});
					return;
				}
				if (method === "GET" && suffix === "/state") {
					const bots = [];
					for (const bot of crewState.crew.bots) {
						const base = publicBot(bot);
						const setup = await loadSetup(bot.id);
						if (setup && setup.stage && setup.stage !== "done") base.setupStage = setup.stage;
						let roleTemplate = setup?.roleTemplate || "";
						if (!roleTemplate && bot.id === "chief") roleTemplate = "chief";
						if (!roleTemplate) {
							for (const [prefix, key] of [
								["幕僚长", "chief"],
								["工程师", "coder"],
								["调研员", "researcher"],
								["写作官", "writer"],
								["数据分析师", "analyst"],
								["产品经理", "pm"],
								["运维官", "ops"],
								["翻译官", "translator"],
								["秘书", "secretary"],
								["审核官", "reviewer"]
							]) if (bot.title && (bot.title === prefix || bot.title.startsWith(prefix + " · "))) {
								roleTemplate = key;
								break;
							}
						}
						base.roleTemplate = roleTemplate;
						base.dshSessionId = chatSessionIds.get(`${bot.id}:${bot.id}`) || null;
						base.rating = ratingOf(await loadStats(bot.id));
						const dm = await readDm(bot.id, 1);
						const last = dm[dm.length - 1];
						bots.push({
							...base,
							lastMessage: last ? String(last.text || "").slice(0, 80) : "",
							lastAt: last?.ts ?? null,
							lastFrom: last?.role === "user" ? "user" : "bot"
						});
					}
					respond(res, 200, {
						bots,
						conversations: crewState.crew.conversations ?? [],
						routines: crewState.crew.routines ?? [],
						approvals: [...pendingApprovals.values()].map(({ resolve, ...rest }) => rest),
						running: [...runningJobs.entries()].map(([jobId, entry]) => ({
							jobId,
							...entry
						})),
						queueDepth: pendingJobs.length,
						recentJobs,
						lastTarget: uiState.lastTarget,
						config: {
							inboxRoot,
							stateDir,
							maxConcurrentJobs,
							jobTimeoutMs
						}
					});
					return;
				}
				if (method === "POST" && suffix === "/ui-state") {
					const body = await readJsonBody(req);
					if (body && (body.kind === "bot" || body.kind === "room" || body.kind === "conversation") && typeof body.id === "string") uiState.lastTarget = {
						kind: body.kind,
						id: body.id
					};
					else if (body === null || body?.clear === true) uiState.lastTarget = null;
					await persistUiState();
					respond(res, 200, { ok: true });
					return;
				}
				if (method === "GET" && suffix === "/crew") {
					respond(res, 200, { crew: crewState.crew });
					return;
				}
				const artifactMatch = /^\/artifacts\/([a-z0-9-]+)$/.exec(suffix);
				if (artifactMatch) {
					const id = artifactMatch[1];
					const dir = join(stateDir, "artifacts", id);
					let meta;
					try {
						meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
					} catch {
						throw new HttpError(404, "成果不存在");
					}
					if (!meta?.name || /[\\/]/.test(meta.name)) throw new HttpError(400, "非法文件名");
					const payloadPath = existsSync(join(dir, "data", "payload")) ? join(dir, "data", "payload") : join(dir, meta.name);
					if (method === "GET") {
						const buf = await readFile(payloadPath);
						const headers = {
							"content-type": meta.mime || "application/octet-stream",
							"content-length": buf.length,
							"cache-control": "private, max-age=60",
							"x-artifact-sha256": meta.sha256 || ""
						};
						if (url.searchParams.get("download") === "1") headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`;
						else if (/^(text\/html|image\/svg)/.test(meta.mime || "")) {
							headers["content-security-policy"] = "sandbox allow-scripts allow-popups allow-forms";
							headers["x-content-type-options"] = "nosniff";
						}
						res.writeHead(200, headers);
						res.end(buf);
						return;
					}
					if (method === "POST" && url.searchParams.get("action") === "reveal") {
						const rootReal = await realpath(meta.workspaceRoot || join(stateDir, "workspace")).catch(() => null);
						const real = await realpath(meta.sourcePath).catch(() => null);
						if (!real || !isInsideRoot(rootReal, real)) throw new HttpError(409, "源文件已不在交付时的工作区");
						await new Promise((ok, err) => spawn("open", ["-R", real], { stdio: "ignore" }).on("exit", (code) => code === 0 ? ok() : err(/* @__PURE__ */ new Error(`open exited ${code}`))));
						respond(res, 200, {
							ok: true,
							path: real
						});
						return;
					}
					respond(res, 405, { error: "method not allowed" });
					return;
				}
				const assetMatch = /^\/assets\/([a-z]+)\/([a-z0-9-]+)$/.exec(suffix);
				if (method === "GET" && assetMatch) {
					const type = assetMatch[1];
					const name = assetMatch[2];
					if (!/^(avatars|states|rating|parts)$/.test(type) || !/^[a-z0-9-]+$/.test(name)) throw new HttpError(400, "非法素材路径");
					const { dirname } = await import("node:path");
					const { fileURLToPath } = await import("node:url");
					const svgPath = join(dirname(dirname(fileURLToPath(import.meta.url))), "assets-design", type, `${name}.svg`);
					try {
						const svg = await readFile(svgPath, "utf8");
						res.writeHead(200, {
							"content-type": "image/svg+xml; charset=utf-8",
							"cache-control": "public, max-age=3600"
						});
						res.end(svg);
					} catch {
						throw new HttpError(404, `素材不存在：${type}/${name}`);
					}
					return;
				}
				if (method === "GET" && suffix === "/bot-templates") {
					respond(res, 200, { templates: BOT_TEMPLATES });
					return;
				}
				if (method === "GET" && suffix === "/model-catalog") {
					respond(res, 200, {
						catalog: await modelCatalog(),
						current: ctx.agentDefaultModel?.currentSelection?.() ?? null
					});
					return;
				}
				if (method === "PATCH" && suffix === "/crew") {
					const body = await readJsonBody(req);
					const normModel = (value) => value && (value.provider || value.model) ? {
						provider: String(value.provider || ""),
						model: String(value.model || "")
					} : null;
					if (body?.defaultModel !== void 0) crewState.crew.defaultModel = normModel(body.defaultModel);
					if (body?.utilityModel !== void 0) crewState.crew.utilityModel = normModel(body.utilityModel);
					if (body?.routing?.default !== void 0) {
						const target = String(body.routing.default);
						if (!crewState.crew.bots.some((entry) => entry.id === target)) throw new HttpError(400, `routing.default 指向不存在的 bot：${target}`);
						crewState.crew.routing.default = target;
					}
					await persistCrew();
					respond(res, 200, { crew: crewState.crew });
					return;
				}
				if (method === "POST" && suffix === "/bots") {
					const body = await readJsonBody(req);
					const template = body?.templateId ? templateById(String(body.templateId)) : null;
					if (template && template.id === "chief") {
						const existing = crewState.crew.bots.find((bot) => bot.id === "chief");
						if (existing) {
							respond(res, 200, {
								bot: publicBot(existing),
								existing: true
							});
							return;
						}
					}
					let greeting = "";
					if (template && !template.blank) {
						body.name = String(body?.name || "").trim() || template.name;
						body.avatar = body?.avatar || template.avatar;
						body.title = body?.title || template.title;
						body.persona = String(body?.persona || "").trim() || template.persona;
						greeting = template.greeting || "";
					}
					if (!String(body?.name || "").trim()) {
						body.name = `新 Bot ${crewState.crew.bots.filter((bot) => bot.name.startsWith("新 Bot")).length + 1}`;
						body.persona = String(body?.persona || "").trim() || [
							"你是刚加入团队的新成员，正在通过与用户对话完成初始化。",
							"先问清两件事：用户想叫你什么、你主要负责什么（职责与边界）。",
							"得到答复后复述确认，并把职责要点记入你的长期记忆；用户随时可能调整你的档案。",
							"之后直接开始干活，只汇报真实完成的操作。"
						].join("\n");
						greeting = [
							"你好！我是新成员，在对话里完成设置：",
							"",
							"**第一步，选角色：**",
							"",
							"[[工程师|调研员|写作官|产品经理|数据分析师|秘书|更多角色]]",
							"",
							"选完我会在对话里问你的名字。也可以直接说「叫XX，做YY」一步到位。"
						].join("\n");
					}
					let bot;
					try {
						bot = createBot(crewState.crew, body);
					} catch (error) {
						throw new HttpError(400, safeError(error));
					}
					await persistCrew();
					await seedBotMemory(bot).catch(() => void 0);
					await mkdir(join(botWorkspace(stateDir, bot), "agents", bot.id), { recursive: true }).catch(() => void 0);
					await ensureDmConversation(bot).catch(() => void 0);
					if (greeting) {
						await appendDm(bot.id, {
							role: "bot",
							text: greeting
						}).catch(() => void 0);
						await saveSetup(bot.id, { stage: "await-role" }).catch(() => void 0);
					}
					try {
						const sessionId = randomUUID();
						chatSessionIds.set(`${bot.id}:${bot.id}`, sessionId);
						await persistChatSessions();
						(await createBotAgent(bot, { sessionId })).dispose();
					} catch (error) {
						ctx.logger?.warn?.(`grokbot 预建 session 失败（${bot.id}）：${safeError(error)}`);
					}
					respond(res, 201, { bot: publicBot(bot) });
					return;
				}
				const botMatch = /^\/bots\/([^/]+)$/.exec(suffix);
				if (botMatch) {
					const botId = decodeURIComponent(botMatch[1]);
					if (method === "PATCH") {
						const body = await readJsonBody(req);
						let bot;
						try {
							bot = updateBot(crewState.crew, botId, body);
						} catch (error) {
							throw new HttpError(400, safeError(error));
						}
						await persistCrew();
						respond(res, 200, { bot: publicBot(bot) });
						return;
					}
					if (method === "DELETE") {
						try {
							removeBot(crewState.crew, botId);
						} catch (error) {
							throw new HttpError(400, safeError(error));
						}
						await persistCrew();
						respond(res, 200, {
							ok: true,
							bots: crewState.crew.bots.map(publicBot)
						});
						return;
					}
					if (method === "GET") {
						const bot = crewState.crew.bots.find((entry) => entry.id === botId);
						if (!bot) throw new HttpError(404, `bot 不存在：${botId}`);
						respond(res, 200, { bot: publicBot(bot) });
						return;
					}
				}
				const dupMatch = /^\/bots\/([^/]+)\/duplicate$/.exec(suffix);
				if (method === "POST" && dupMatch) {
					let bot;
					try {
						bot = duplicateBot(crewState.crew, decodeURIComponent(dupMatch[1]));
					} catch (error) {
						throw new HttpError(400, safeError(error));
					}
					await persistCrew();
					await seedBotMemory(bot).catch(() => void 0);
					respond(res, 201, { bot: publicBot(bot) });
					return;
				}
				const approvalMatch = /^\/approvals\/([^/]+)$/.exec(suffix);
				if (approvalMatch && method === "POST") {
					const approvalId = decodeURIComponent(approvalMatch[1]);
					const entry = pendingApprovals.get(approvalId);
					if (!entry) throw new HttpError(404, "没有找到待审批的操作");
					const body = await readJsonBody(req);
					const outcome = String(body?.outcome || "");
					if (!["allowed-once", "rejected"].includes(outcome)) throw new HttpError(400, "审批结果无效（allowed-once / rejected）");
					pendingApprovals.delete(approvalId);
					entry.resolve(outcome);
					if (outcome === "rejected") await awardBot(entry.botId, { expDelta: -3 }).catch(() => void 0);
					ctx.logger?.info?.(`grokbot approval ${approvalId} -> ${outcome}`);
					respond(res, 200, {
						ok: true,
						outcome
					});
					return;
				}
				const feedbackMatch = /^\/bots\/([^/]+)\/feedback$/.exec(suffix);
				if (method === "POST" && feedbackMatch) {
					const botId = decodeURIComponent(feedbackMatch[1]);
					const body = await readJsonBody(req);
					const good = body?.good === true;
					const bad = body?.bad === true;
					if (!good && !bad) throw new HttpError(400, "需要 good 或 bad");
					const stats = await awardBot(botId, good ? {
						expDelta: 5,
						thumbsUpDelta: 1
					} : {
						expDelta: -3,
						thumbsDownDelta: 1
					});
					respond(res, 200, { rating: stats ? ratingOf(stats) : null });
					return;
				}
				const stopMatch = /^\/bots\/([^/]+)\/stop$/.exec(suffix);
				if (method === "POST" && stopMatch) {
					const botId = decodeURIComponent(stopMatch[1]);
					const scope = (await readJsonBody(req).catch(() => ({})))?.scope === "turn" ? "turn" : "bot";
					let cancelledRunning = 0;
					let cancelledQueued = 0;
					for (const [key, session] of chatHandles.entries()) {
						if (!key.endsWith(`:${botId}`)) continue;
						try {
							session.handle.agent.cancel({ kind: "user" }, { keepInbox: true });
							cancelledRunning += 1;
						} catch {}
					}
					if (scope === "bot") {
						for (const entry of runningJobs.values()) {
							if (entry.botId !== botId) continue;
							try {
								entry.abort?.abort(/* @__PURE__ */ new Error("用户停止"));
								cancelledRunning += 1;
							} catch {}
						}
						const remaining = [];
						for (const job of pendingJobs.splice(0)) if (routeJob(crewState.crew, job).id === botId) {
							cancelledQueued += 1;
							await cancelJob(job, botId, "用户停止").catch(() => void 0);
							recordRecent({
								jobId: job.jobId,
								botId,
								status: "cancelled",
								endedAt: Date.now()
							});
						} else remaining.push(job);
						pendingJobs.push(...remaining);
					}
					respond(res, 200, {
						ok: true,
						scope,
						cancelledRunning,
						cancelledQueued
					});
					return;
				}
				const historyMatch = /^\/bots\/([^/]+)\/history$/.exec(suffix);
				if (method === "GET" && historyMatch) {
					respond(res, 200, { messages: await readDm(decodeURIComponent(historyMatch[1])) });
					return;
				}
				if (method === "GET" && suffix === "/conversations") {
					const conversations = [];
					for (const conversation of crewState.crew.conversations ?? []) {
						const msgs = await readConversationMsgs(conversation, 1);
						const last = msgs[msgs.length - 1];
						conversations.push({
							...conversation,
							isGroup: conversation.memberBotIds.length > 1,
							lastMessage: last ? String(last.text || "").slice(0, 80) : "",
							lastAt: last?.ts ?? null,
							lastFrom: last?.role === "user" ? "user" : "bot"
						});
					}
					respond(res, 200, { conversations });
					return;
				}
				if (method === "POST" && suffix === "/conversations") {
					const body = await readJsonBody(req);
					const wanted = Array.isArray(body?.memberBotIds) ? body.memberBotIds.map(String) : [];
					if (wanted.length === 1) {
						const existingDm = crewState.crew.conversations?.find((entry) => entry.memberBotIds.length === 1 && entry.memberBotIds[0] === wanted[0]);
						if (existingDm) {
							respond(res, 200, {
								conversation: existingDm,
								existing: true
							});
							return;
						}
					}
					let conversation;
					try {
						conversation = createConversation(crewState.crew, body);
					} catch (error) {
						throw new HttpError(400, safeError(error));
					}
					await persistCrew();
					respond(res, 201, { conversation });
					return;
				}
				const convMatch = /^\/conversations\/([^/]+)(?:\/(chat|members))?$/.exec(suffix);
				if (convMatch) {
					const conversationId = decodeURIComponent(convMatch[1]);
					const conversation = conversationOf(conversationId);
					if (!conversation) throw new HttpError(404, `conversation 不存在：${conversationId}`);
					if (method === "GET" && !convMatch[2]) {
						respond(res, 200, {
							conversation,
							messages: await readConversationMsgs(conversation)
						});
						return;
					}
					if (method === "PATCH" && !convMatch[2]) {
						const body = await readJsonBody(req);
						if (typeof body?.name === "string") renameConversation(crewState.crew, conversationId, body.name);
						await persistCrew();
						respond(res, 200, { conversation });
						return;
					}
					if (method === "DELETE" && !convMatch[2]) {
						try {
							removeConversation(crewState.crew, conversationId);
						} catch (error) {
							throw new HttpError(400, safeError(error));
						}
						await persistCrew();
						respond(res, 200, { ok: true });
						return;
					}
					if (method === "POST" && convMatch[2] === "members") {
						const body = await readJsonBody(req);
						const botId = String(body?.botId || "");
						let conversation2;
						try {
							if (body?.remove === true) conversation2 = removeConversationMember(crewState.crew, conversationId, botId);
							else {
								const wasDm = conversation.memberBotIds.length === 1;
								conversation2 = addConversationMember(crewState.crew, conversationId, botId);
								await persistCrew();
								if (wasDm && conversation2.memberBotIds.length > 1) {
									const history = await readDm(botId === conversation2.memberBotIds[0] ? conversation2.memberBotIds[1] : conversation2.memberBotIds[0]);
									for (const message of history) await appendRoomMsg(conversation2.id, message);
								}
							}
						} catch (error) {
							throw new HttpError(400, safeError(error));
						}
						await persistCrew();
						respond(res, 200, { conversation: conversation2 });
						return;
					}
					if (method === "POST" && convMatch[2] === "chat") {
						const body = await readJsonBody(req);
						const text = String(body?.text || "").trim();
						if (!text) throw new HttpError(400, "text 不能为空");
						const bodyTaskId = /^[a-z0-9-]+$/i.test(String(body?.taskId || "")) ? String(body.taskId) : null;
						await appendConversationMsg(conversation, {
							role: "user",
							text
						});
						if (conversation.memberBotIds.length === 1) {
							const memberBot = crewState.crew.bots.find((entry) => entry.id === conversation.memberBotIds[0]);
							const setupReply = memberBot ? await trySetupTurn(memberBot, text) : null;
							if (setupReply) {
								await appendDm(memberBot.id, {
									role: "bot",
									text: setupReply.reply
								}).catch(() => void 0);
								respond(res, 200, {
									responder: publicBot(crewState.crew.bots.find((entry) => entry.id === memberBot.id) ?? memberBot),
									reply: setupReply.reply,
									handoffTo: null,
									messages: await readConversationMsgs(conversationOf(conversationId))
								});
								return;
							}
						}
						let mentionTarget = null;
						if (Array.isArray(body?.mentions) && body.mentions.length > 0) {
							const wanted = String(body.mentions[0]);
							mentionTarget = eligibleBots(conversation).find((bot) => bot.id === wanted) ?? null;
						}
						const result = await conversationTurn(conversation, text, {
							mentionTarget,
							taskId: bodyTaskId
						});
						respond(res, 200, {
							responder: publicBot(result.responder),
							reply: result.reply,
							handoffTo: result.handoffTo,
							messages: await readConversationMsgs(conversation)
						});
						return;
					}
				}
				if (method === "GET" && suffix === "/skills") {
					const { readdir: rd } = await import("node:fs/promises");
					const files = (await rd(skillsDir).catch(() => [])).filter((name) => name.endsWith(".md")).sort();
					const skills = [];
					for (const name of files) {
						const content = await readFile(join(skillsDir, name), "utf8");
						skills.push({
							name: name.replace(/\.md$/, ""),
							summary: (content.split("\n").find((line) => line.trim()) ?? "").replace(/^#+\s*/, "").slice(0, 80)
						});
					}
					respond(res, 200, { skills });
					return;
				}
				if (method === "POST" && suffix === "/skills") {
					const body = await readJsonBody(req);
					const name = String(body?.name || "").trim().replace(/\.md$/, "");
					const content = String(body?.content || "").trim();
					if (!/^[A-Za-z0-9._-]+$/.test(name) || !content) throw new HttpError(400, "name/content 非法");
					await atomicWrite(join(skillsDir, `${name}.md`), `${content}\n`);
					respond(res, 201, { skill: { name } });
					return;
				}
				const skillMatch = /^\/skills\/([^/]+)$/.exec(suffix);
				if (method === "DELETE" && skillMatch) {
					const { rm } = await import("node:fs/promises");
					const name = decodeURIComponent(skillMatch[1]).replace(/\.md$/, "");
					if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new HttpError(400, "name 非法");
					await rm(join(skillsDir, `${name}.md`), { force: true });
					respond(res, 200, { ok: true });
					return;
				}
				if (method === "GET" && suffix === "/routines") {
					const state = await loadRoutinesState();
					respond(res, 200, {
						routines: crewState.crew.routines ?? [],
						lastRun: state
					});
					return;
				}
				if (method === "POST" && suffix === "/routines") {
					const body = await readJsonBody(req);
					let routine;
					try {
						routine = upsertRoutine(crewState.crew, body);
					} catch (error) {
						throw new HttpError(400, safeError(error));
					}
					await persistCrew();
					respond(res, 201, { routine });
					return;
				}
				const routineMatch = /^\/routines\/([^/]+)(?:\/(test))?$/.exec(suffix);
				if (routineMatch) {
					const routineId = decodeURIComponent(routineMatch[1]);
					if (method === "PATCH" && !routineMatch[2]) {
						const body = await readJsonBody(req);
						let routine;
						try {
							routine = upsertRoutine(crewState.crew, body, routineId);
						} catch (error) {
							throw new HttpError(400, safeError(error));
						}
						await persistCrew();
						respond(res, 200, { routine });
						return;
					}
					if (method === "DELETE" && !routineMatch[2]) {
						try {
							removeRoutine(crewState.crew, routineId);
						} catch (error) {
							throw new HttpError(400, safeError(error));
						}
						await persistCrew();
						respond(res, 200, { ok: true });
						return;
					}
					if (method === "POST" && routineMatch[2] === "test") {
						const routine = crewState.crew.routines?.find((entry) => entry.id === routineId);
						if (!routine) throw new HttpError(404, `routine 不存在：${routineId}`);
						const job = await enqueueJob(inboxRoot, {
							toBot: routine.botId,
							text: `[routine ${routine.id} 试运行] ${routine.prompt}`
						});
						await appendRoutineHistory(routine.id, {
							kind: "test",
							jobId: job.jobId
						});
						scan();
						respond(res, 202, { job });
						return;
					}
				}
				if (method === "PUT" && suffix === "/crew") {
					const body = await readJsonBody(req);
					const parsed = parseCrew(JSON.stringify(body));
					crewState.crew = parsed;
					await atomicWrite(crewState.path, serializeCrew(parsed));
					respond(res, 200, { crew: parsed });
					return;
				}
				if (method === "POST" && suffix === "/inbox") {
					const body = await readJsonBody(req);
					const text = String(body?.text || "").trim();
					if (!text && !(Array.isArray(body?.images) && body.images.length > 0)) throw new HttpError(400, "text 与 images 不能同时为空");
					const job = await enqueueJob(inboxRoot, {
						toBot: String(body?.toBot || ""),
						text,
						images: Array.isArray(body?.images) ? body.images.map(String) : []
					});
					scan();
					respond(res, 202, { job });
					return;
				}
				const chatMatch = /^\/bots\/([^/]+)\/chat$/.exec(suffix);
				if (method === "POST" && chatMatch) {
					const botId = decodeURIComponent(chatMatch[1]);
					const bot = crewState.crew.bots.find((entry) => entry.id === botId);
					if (!bot) throw new HttpError(404, `bot 不存在：${botId}`);
					const body = await readJsonBody(req);
					const text = String(body?.text || "").trim();
					if (!text) throw new HttpError(400, "text 不能为空");
					const state = botState(bot.id);
					state.status = "working";
					try {
						const outcome = await chatTurn(bot, text);
						const reply = outcome.text?.trim();
						if (!reply) {
							const types = [...new Set(outcome.trace)].join(",");
							const reason = outcome.error ? `；${outcome.error}` : "";
							throw new HttpError(502, `stopReason=${outcome.stopReason}${reason}；events=[${types}]`);
						}
						if (outcome.error) ctx.logger?.warn?.(`grokbot chat ${bot.id} 回复已产出但回合报错：${outcome.error}`);
						respond(res, 200, {
							bot: publicBot(bot),
							reply,
							activity: outcome.activity
						});
						return;
					} finally {
						state.status = "idle";
						state.lastActivity = Date.now();
					}
				}
				throw new HttpError(404, "接口不存在");
			} catch (error) {
				respond(res, Number(error?.status) || 500, { error: safeError(error) });
			}
		}
	}), "grokbot: HTTP API");
	ctx.effect(() => () => {
		disposed = true;
		clearInterval(rescanTimer);
		clearInterval(routineTimer);
		clearInterval(servicesTimer);
		clearTimeout(debounceTimer);
		watcher?.close();
		chatHandles.clear();
		try {
			tunnelProc?.kill();
		} catch {}
		for (const session of [...activeSessions]) session.dispose();
	}, "grokbot: shutdown");
}
var src_default = {
	name: "grokbot",
	inject,
	apply
};
//#endregion
export { activityOf, apply, src_default as default, inject, summarizeTurn };
