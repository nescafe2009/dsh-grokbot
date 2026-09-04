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
	if (normalized.length + conversations.length > 50) throw new Error("bots+conversations 总数已达上限 50");
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
			"委派时在回复末行用 @队友名 交代内容（群聊内生效）。"
		].join("\n"),
		greeting: "你好，我是**沈经纶**，团队的幕僚长（总协调）。我会判断任务归属：自己做、派队友、或拆解执行。\n\n常见入口：\n- 布置一个任务（我会路由）\n- 了解团队现状\n- 整理待办与优先级\n\n[[布置任务|看看团队|整理待办]]"
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
		greeting: "你好，我是**顾远航** 🛠️，团队的工程师，负责编码、调试、重构和脚本。\n\n我可以：\n- 实现新功能 / 修 bug\n- 读代码定位问题\n- 写测试、重构、性能优化\n\n[[给我一个需求|帮我修个bug|读代码讲架构]]"
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
		greeting: "你好，我是**林知遥** 🔎，团队的调研员，负责检索与情报，所有结论带来源。\n\n我可以：\n- 调研一个主题并出摘要\n- 对比多个方案给建议\n- 监控信息源定期汇报\n\n[[调研一个主题|对比方案|设个监控]]"
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
		greeting: "你好，我是**苏文汐** ✍️，团队的写作官。写之前我会先确认读者、渠道和语气。\n\n我可以：\n- 写文案/邮件/公告\n- 出周报日报\n- 润色改写任何文本\n\n[[写一篇文案|出日报|帮我润色]]"
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
		greeting: "你好，我是**陈思衡** 📊，团队的数据分析师，让数据说话。\n\n我可以：\n- 分析表格/CSV 找趋势\n- 做统计与异常检测\n- 出分析报告\n\n[[分析我的数据|设计指标|讲讲结论怎么写]]"
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
		greeting: "你好，我是**何一诺** 📋，团队的产品经理，把想法变成可执行的需求。\n\n我可以：\n- 梳理需求写 PRD\n- 拆里程碑排优先级\n- 评审一个功能设计\n\n[[梳理一个需求|写PRD|排优先级]]"
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
		greeting: "你好，我是**郑北辰** 🖥️，团队的运维官，管环境、部署和排障。\n\n我可以：\n- 部署/配置环境\n- 写自动化脚本\n- 排查故障给根因\n\n[[部署个服务|写个脚本|帮我排障]]"
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
		greeting: "你好，我是**叶书语** 🌐，团队的翻译官，多语言互译与本地化。\n\n我可以：\n- 翻译文档/消息/界面文案\n- 中英润色\n- 统一术语表\n\n[[翻译一段文本|润色英文|建术语表]]"
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
		greeting: "你好，我是**唐锦书** 🗂️，团队的秘书，管记录、待办和跟进。\n\n我可以：\n- 整理会议纪要\n- 维护待办清单并盯进度\n- 归档文档\n\n[[记个会议|建待办清单|今天有什么要跟进]]"
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
		greeting: "你好，我是**秦明鉴** 🛡️，团队的审核官，负责质量与风险把关。\n\n我可以：\n- 评审代码/文档\n- 做安全与合规检查\n- 出审核结论（分级）\n\n[[评审代码|把关文档|安全检查]]"
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
		const { appendFile } = await import("node:fs/promises");
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
		const { appendFile } = await import("node:fs/promises");
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
			for (const [botId, sessionId] of Object.entries(map || {})) if (typeof sessionId === "string" && sessionId) chatSessionIds.set(botId, sessionId);
		} catch {}
	}
	async function persistChatSessions() {
		await atomicWrite(chatSessionsPath, `${JSON.stringify(Object.fromEntries(chatSessionIds), null, 2)}\n`);
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
	function personaPrompt(bot) {
		return [
			bot.persona || "你是常驻桌面 agent 团队的一员，用简体中文直接处理用户投递的任务。",
			`团队共享电脑：${botWorkspace(stateDir, bot)}（全队共享）；你的个人目录：${join(botWorkspace(stateDir, bot), "agents", bot.id)}（自己的笔记与工作产物放这里）。`,
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
		await loadChatSessions();
		await loadUiState();
		for (const bot of crewState.crew.bots) {
			botState(bot.id);
			await seedBotMemory(bot);
			await mkdir(join(botWorkspace(stateDir, bot), "agents", bot.id), { recursive: true }).catch(() => void 0);
			await ensureDmConversation(bot).catch(() => void 0);
		}
		ctx.logger?.info?.(`grokbot ready: ${crewState.crew.bots.length} bot(s), inbox=${inboxRoot}`);
	}
	async function persistCrew() {
		await atomicWrite(crewState.path, serializeCrew(crewState.crew));
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
	async function createBotAgent(bot, { sessionId, resume = false } = {}) {
		const abort = new AbortController();
		const fallback = typeof ctx.agentDefaultModel?.currentSelection === "function" ? ctx.agentDefaultModel.currentSelection() : null;
		const selection = bot.model?.provider && bot.model?.model ? bot.model : crewState.crew.defaultModel?.provider && crewState.crew.defaultModel?.model ? crewState.crew.defaultModel : fallback?.provider && fallback?.model ? fallback : null;
		const base = {
			sessionId: sessionId || randomUUID(),
			meta: { cwd: botWorkspace(stateDir, bot) },
			...selection ? { agentOptions: selection } : {},
			signal: abort.signal,
			async setup(agentCtx) {
				agentCtx.systemPrompt.section({
					name: "grokbot:identity",
					order: -20,
					text: personaPrompt(bot)
				});
				await memorySections(bot, agentCtx);
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
	async function appendDm(botId, entry) {
		const dir = join(stateDir, "bots", botId);
		await mkdir(dir, { recursive: true });
		const path = join(dir, "dm-transcript.jsonl");
		const { appendFile } = await import("node:fs/promises");
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
	async function chatTurn(bot, text, { preamble = "" } = {}) {
		let session = chatHandles.get(bot.id);
		if (!session) {
			const known = chatSessionIds.get(bot.id);
			if (known) session = await createBotAgent(bot, {
				sessionId: known,
				resume: true
			});
			else {
				const sessionId = randomUUID();
				chatSessionIds.set(bot.id, sessionId);
				await persistChatSessions();
				session = await createBotAgent(bot, { sessionId });
			}
			const actualId = session.handle.agent?.session?.id;
			if (actualId && actualId !== chatSessionIds.get(bot.id)) {
				chatSessionIds.set(bot.id, String(actualId));
				await persistChatSessions();
			}
			chatHandles.set(bot.id, session);
		}
		await session.handle.agent.whenIdle();
		const firstSeq = session.handle.agent.session.seq;
		session.handle.agent.followup(userMessage(preamble ? `${preamble}\n\n${text}` : text));
		await appendDm(bot.id, {
			role: "user",
			text: preamble ? `${preamble}\n\n${text}` : text
		}).catch(() => void 0);
		await session.handle.agent.whenIdle();
		const outcome = {
			...summarizeTurn(session.handle.agent.session.events, firstSeq),
			activity: activityOf(session.handle.agent.session.events, firstSeq)
		};
		const dmText = outcome.text?.trim();
		if (dmText) await appendDm(bot.id, {
			role: "bot",
			text: dmText,
			activity: outcome.activity
		}).catch(() => void 0);
		return outcome;
	}
	function pickResponder(room, text) {
		const mention = /@([\w\u4e00-\u9fa5]+)/.exec(String(text || ""));
		if (mention) {
			const hit = room.memberBotIds.map((botId) => crewState.crew.bots.find((bot) => bot.id === botId)).find((bot) => bot && (bot.name.includes(mention[1]) || mention[1] === bot.id || bot.id.includes(mention[1])));
			if (hit) return hit;
		}
		const fallbackId = crewState.crew.routing.default;
		const inRoom = room.memberBotIds.includes(fallbackId);
		return crewState.crew.bots.find((bot) => bot.id === (inRoom ? fallbackId : room.memberBotIds[0]));
	}
	const HANDOFF_LINE_RE = /^@([\w\u4e00-\u9fa5]+)[：:\s]+(.+)$/;
	async function conversationTurn(conversation, senderText, { mentionTarget } = {}) {
		if (conversation.memberBotIds.length === 1) {
			const bot = crewState.crew.bots.find((entry) => entry.id === conversation.memberBotIds[0]);
			if (!bot) throw new Error("会话成员不存在");
			const outcome = await chatTurn(bot, senderText);
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
		const outcome = await chatTurn(responder, senderText, { preamble: [`【群聊 ${room.name}】成员：${members.map((bot) => `${bot.avatar}${bot.name}`).join("、")}。`, "你现在在群聊中应答用户消息。若你认为某条工作应由其他成员处理，在回复的最后一行单独写「@成员名 交代内容」，系统会异步转交；不要除此行外提交接。"].join("\n") });
		const reply = outcome.text?.trim() || `[${responder.name} 未能给出文本回复：${outcome.error || outcome.stopReason}]`;
		const lines = reply.split("\n");
		const lastLine = lines[lines.length - 1]?.trim() ?? "";
		const handoff = HANDOFF_LINE_RE.exec(lastLine);
		if (handoff) {
			const target = members.find((bot) => bot.name.includes(handoff[1]) || bot.id.includes(handoff[1]));
			if (target && target.id !== responder.id) {
				lines.pop();
				const cleanReply = lines.join("\n").trim() || "（已转交）";
				await appendRoomMsg(room.id, {
					role: "bot",
					botId: responder.id,
					text: cleanReply
				});
				await appendRoomMsg(room.id, {
					role: "handoff",
					fromBotId: responder.id,
					toBotId: target.id,
					text: handoff[2]
				});
				(async () => {
					try {
						const relay = await chatTurn(target, `【群聊转交，来自 ${responder.name}】${handoff[2]}`, { preamble: `【群聊 ${room.name}】你收到队友 ${responder.name} 的转交任务。` });
						await appendRoomMsg(room.id, {
							role: "bot",
							botId: target.id,
							text: relay.text?.trim() || "[转交处理失败]"
						});
					} catch (error) {
						await appendRoomMsg(room.id, {
							role: "system",
							text: `转交失败：${safeError(error)}`
						});
					}
				})();
				return {
					responder,
					reply: cleanReply,
					handoffTo: target.id
				};
			}
		}
		await appendRoomMsg(room.id, {
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
					continue;
				}
				if (status?.status !== "claimed") continue;
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
				const reason = outcome.error ? `${outcome.error}（stopReason=${outcome.stopReason}）` : `stopReason=${outcome.stopReason}，无文本输出`;
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
				if (outcome.error) ctx.logger?.warn?.(`grokbot job ${job.jobId} 回复已产出但回合报错：${outcome.error}`);
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
							"你好！我是团队的新成员，先把我设置好：",
							"",
							"1. **叫我什么名字？**（建议人类名字+头衔，如「陈默 · 数据分析师」，方便群里 @ 我）",
							"2. **我主要负责什么**（职责与边界）？",
							"",
							"也可以直接选一个方向开始：",
							"",
							"[[叫我工程师|叫我调研员|叫我写作官|先随便聊聊]]"
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
					if (greeting) await appendDm(bot.id, {
						role: "bot",
						text: greeting
					}).catch(() => void 0);
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
					ctx.logger?.info?.(`grokbot approval ${approvalId} -> ${outcome}`);
					respond(res, 200, {
						ok: true,
						outcome
					});
					return;
				}
				const stopMatch = /^\/bots\/([^/]+)\/stop$/.exec(suffix);
				if (method === "POST" && stopMatch) {
					const botId = decodeURIComponent(stopMatch[1]);
					const session = chatHandles.get(botId);
					if (session) try {
						session.handle.agent.cancel({ kind: "user" }, { keepInbox: true });
					} catch {}
					respond(res, 200, { ok: true });
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
						await appendConversationMsg(conversation, {
							role: "user",
							text
						});
						const result = await conversationTurn(conversation, text);
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
export { activityOf, apply, src_default as default, inject, summarizeTurn };
