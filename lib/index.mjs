import { watch } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
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
		persona: String(raw.persona || "").trim(),
		workspace: String(raw.workspace || "").trim(),
		model
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
	return {
		routing: { default: defaultBot },
		bots: normalized
	};
}
function serializeCrew(crew) {
	return `${JSON.stringify({
		routing: crew.routing,
		bots: crew.bots.map((bot) => ({
			...bot,
			model: bot.model || null
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
	return bot.workspace || join(stateDir, "workspaces", bot.id);
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
		const dir = String(entry.dir || join(inboxRoot, jobId));
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
			createdAt: Number(entry.createdAt) || null
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
async function writeStatus(dir, payload) {
	await atomicWriteFile(join(dir, "status.json"), `${JSON.stringify(payload, null, 2)}\n`);
}
async function atomicWriteFile(path, text) {
	const tmp = `${path}.${randomUUID()}.tmp`;
	await writeFile(tmp, text, "utf8");
	await rename(tmp, path);
}
async function enqueueJob(inboxRoot, { jobId, toBot, text, images = [] }) {
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
		createdAt: Date.now()
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
//#region src/index.mjs
const API_ROOT = "/api/plugins/grokbot";
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"cache-control": "no-store"
};
const inject = [
	"agents",
	"webServer",
	"agentDefaultModel"
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
function summarizeTurn(events, firstSeq) {
	let text = "";
	let stopReason = "completed";
	let error = "";
	const trace = [];
	for (const event of events) {
		if (event.seq < firstSeq) continue;
		trace.push(event.type);
		if (event.type === "assistant/message") {
			const joined = contentText(event.data?.message?.content);
			if (joined) text = joined;
		} else if (event.type === "turn/end") {
			stopReason = String(event.data?.stopReason || stopReason);
			if (event.data?.error) error = safeError(event.data.error);
		}
	}
	return {
		text,
		stopReason,
		error,
		trace
	};
}
function apply(ctx, config = {}) {
	const stateDir = resolve(String(config.stateDir || join(process.cwd(), ".dsh-grokbot")));
	const inboxRoot = resolve(String(config.inboxDir || join(stateDir, "inbox")));
	const maxConcurrentJobs = Math.max(1, Math.min(8, Number(config.maxConcurrentJobs) || 2));
	const jobTimeoutMs = Math.max(3e4, Number(config.jobTimeoutMs) || 6e5);
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
	const pendingJobs = [];
	const runningJobs = /* @__PURE__ */ new Map();
	const seenJobIds = /* @__PURE__ */ new Set();
	const recentJobs = [];
	let disposed = false;
	let scanning = false;
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
	function personaPrompt(bot) {
		return [
			bot.persona || "你是常驻桌面 agent 团队的一员，用简体中文直接处理用户投递的任务。",
			`你的专属工作区目录：${botWorkspace(stateDir, bot)}（文件读写优先在这里进行）。`,
			"只汇报真实完成的操作，不要把工具调用伪装成普通文本。"
		].join("\n");
	}
	async function init() {
		await mkdir(stateDir, { recursive: true });
		await ensureInbox(inboxRoot);
		const loaded = await loadOrCreateCrew(stateDir);
		crewState.path = loaded.path;
		crewState.crew = loaded.crew;
		for (const bot of crewState.crew.bots) {
			botState(bot.id);
			await mkdir(botWorkspace(stateDir, bot), { recursive: true });
		}
		ctx.logger?.info?.(`grokbot ready: ${crewState.crew.bots.length} bot(s), inbox=${inboxRoot}`);
	}
	const hydrated = init();
	const activeSessions = /* @__PURE__ */ new Set();
	async function createBotAgent(bot) {
		const abort = new AbortController();
		const fallback = typeof ctx.agentDefaultModel?.currentSelection === "function" ? ctx.agentDefaultModel.currentSelection() : null;
		const selection = bot.model?.provider && bot.model?.model ? bot.model : fallback?.provider && fallback?.model ? fallback : null;
		const handle = await ctx.agents.create({
			sessionId: randomUUID(),
			meta: { cwd: botWorkspace(stateDir, bot) },
			...selection ? { agentOptions: selection } : {},
			signal: abort.signal,
			async setup(agentCtx) {
				agentCtx.systemPrompt.section({
					name: "grokbot:identity",
					order: -20,
					text: personaPrompt(bot)
				});
			}
		});
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
				try {
					handle.agent.cancel({ kind: "user" }, { keepInbox: true });
				} catch {}
				try {
					await handle.dispose();
				} catch {}
			}
		};
		activeSessions.add(session);
		return session;
	}
	async function chatTurn(bot, text) {
		let session = chatHandles.get(bot.id);
		if (!session) {
			session = await createBotAgent(bot);
			chatHandles.set(bot.id, session);
		}
		await session.handle.agent.whenIdle();
		const firstSeq = session.handle.agent.session.seq;
		session.handle.agent.followup(userMessage(text));
		await session.handle.agent.whenIdle();
		return summarizeTurn(session.handle.agent.session.events, firstSeq);
	}
	async function runInboxJob(job) {
		const bot = routeJob(crewState.crew, job);
		const state = botState(bot.id);
		state.status = "working";
		state.currentJob = job.jobId;
		runningJobs.set(job.jobId, {
			botId: bot.id,
			startedAt: Date.now()
		});
		let session = null;
		try {
			await claimJob(job, bot.id);
			const promptText = job.text?.trim() || `（无文字内容${job.images.length > 0 ? "，请查看同目录图片附件" : ""}）`;
			session = await createBotAgent(bot);
			const timeout = setTimeout(() => session.abort.abort(/* @__PURE__ */ new Error(`job timeout after ${jobTimeoutMs}ms`)), jobTimeoutMs);
			let outcome;
			try {
				await session.handle.agent.whenIdle();
				const firstSeq = session.handle.agent.session.seq;
				const withImages = job.images.length > 0 ? `${promptText}\n\n【图片】请阅读：\n${job.images.join("\n")}` : promptText;
				session.handle.agent.followup(userMessage(withImages));
				await session.handle.agent.whenIdle();
				outcome = summarizeTurn(session.handle.agent.session.events, firstSeq);
			} finally {
				clearTimeout(timeout);
			}
			const reply = outcome.text?.trim();
			if (!reply) {
				const reason = outcome.error || `stopReason=${outcome.stopReason}，无文本输出`;
				await failJob(job, bot.id, reason);
				recordRecent({
					jobId: job.jobId,
					botId: bot.id,
					status: "failed",
					error: reason,
					endedAt: Date.now()
				});
				ctx.logger?.warn?.(`grokbot job ${job.jobId} failed: ${reason}`);
			} else {
				await completeJob(job, bot.id, reply);
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
	let watcher = null;
	try {
		watcher = watch(inboxRoot, { recursive: true }, () => {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => void scan(), 400);
		});
	} catch {}
	let debounceTimer = null;
	scan();
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
					respond(res, 200, {
						bots: crewState.crew.bots.map(publicBot),
						running: [...runningJobs.entries()].map(([jobId, entry]) => ({
							jobId,
							...entry
						})),
						queueDepth: pendingJobs.length,
						recentJobs,
						config: {
							inboxRoot,
							stateDir,
							maxConcurrentJobs,
							jobTimeoutMs
						}
					});
					return;
				}
				if (method === "GET" && suffix === "/crew") {
					respond(res, 200, { crew: crewState.crew });
					return;
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
						if (!reply) throw new HttpError(502, outcome.error || `stopReason=${outcome.stopReason}，无文本输出；events=[${outcome.trace.join(",")}]`);
						respond(res, 200, {
							bot: publicBot(bot),
							reply
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
		clearTimeout(debounceTimer);
		watcher?.close();
		chatHandles.clear();
		for (const session of [...activeSessions]) session.dispose();
	}, "grokbot: shutdown");
}
var src_default = {
	name: "grokbot",
	inject,
	apply
};
//#endregion
export { apply, src_default as default, inject, summarizeTurn };
