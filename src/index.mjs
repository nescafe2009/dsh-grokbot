import { watch } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadOrCreateCrew, routeJob, botWorkspace, serializeCrew, atomicWrite, parseCrew, createBot, updateBot, removeBot, duplicateBot, createConversation, renameConversation, addConversationMember, removeConversationMember, removeConversation, upsertRoutine, removeRoutine } from './crew.mjs'
import { ensureInbox, scanInbox, claimJob, completeJob, failJob, enqueueJob } from './inbox.mjs'
import { BOT_TEMPLATES, templateById } from './templates.mjs'

const API_ROOT = '/api/plugins/grokbot'
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

export const inject = ['agents', 'webServer', 'agentDefaultModel', 'llm']

const nowIso = () => new Date().toISOString()
const safeError = (error) => (error instanceof Error ? error.message : String(error))

function userMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'plugin', plugin: 'grokbot' }),
  })
}

function contentText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const item of content) {
    if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text)
  }
  return parts.join('\n').trim()
}

function chunkText(chunk) {
  if (!chunk || typeof chunk !== 'object') return ''
  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
  const delta = choice?.delta ?? chunk.delta
  if (typeof delta?.content === 'string') return delta.content
  if (typeof delta?.text === 'string') return delta.text
  if (typeof chunk.text === 'string') return chunk.text
  if (typeof chunk.content === 'string') return chunk.content
  return ''
}

export function summarizeTurn(events, firstSeq) {
  let stopReason = 'completed'
  let error = ''
  const stepText = new Map()
  const trace = []
  for (const event of events) {
    if (event.seq < firstSeq) continue
    trace.push(event.type)
    const step = String(event.data?.step ?? '')
    if (event.type === 'assistant/chunk') {
      stepText.set(step, (stepText.get(step) || '') + chunkText(event.data?.chunk))
    } else if (event.type === 'assistant/message') {
      const joined = contentText(event.data?.message?.content)
      if (joined) stepText.set(step, joined)
    } else if (event.type === 'turn/end') {
      const reason = event.data?.reason && typeof event.data.reason === 'object' ? event.data.reason : {}
      stopReason = String(reason.kind || event.data?.stopReason || stopReason)
      const errText = reason.error?.message || reason.failure?.message
        || (event.data?.error ? safeError(event.data.error) : '')
      if (errText) error = String(errText).slice(0, 500)
    }
  }
  let text = ''
  for (const [, value] of [...stepText.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))) {
    const joined = value.trim()
    if (joined) text = joined
  }
  return { text, stopReason, error, trace }
}

export function activityOf(events, firstSeq) {
  const calls = []
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'tool/call') {
      const name = String(event.data?.name || 'tool')
      if (name) calls.push(name)
    }
  }
  return calls
}

export function apply(ctx, config = {}) {
  const stateDir = resolve(String(config.stateDir || join(process.cwd(), '.dsh-grokbot')))
  const inboxRoot = resolve(String(config.inboxDir || join(stateDir, 'inbox')))
  const maxConcurrentJobs = Math.max(1, Math.min(8, Number(config.maxConcurrentJobs) || 2))
  const jobTimeoutMs = Math.max(30_000, Number(config.jobTimeoutMs) || 600_000)
  const rescanIntervalMs = Math.max(1_000, Number(config.rescanIntervalMs) || 5_000)

  const crewState = { path: '', crew: { routing: { default: '' }, bots: [] } }
  const botStates = new Map()
  const chatHandles = new Map()
  const chatSessionIds = new Map()
  const pendingJobs = []
  const runningJobs = new Map()
  const seenJobIds = new Set()
  const recentJobs = []
  let disposed = false
  let scanning = false

  const uiStatePath = join(stateDir, 'ui-state.json')
  const uiState = { lastTarget: null }
  async function loadUiState() {
    try {
      const saved = JSON.parse(await readFile(uiStatePath, 'utf8'))
      if (saved && (saved.kind === 'bot' || saved.kind === 'room' || saved.kind === 'conversation') && typeof saved.id === 'string') {
        uiState.lastTarget = { kind: saved.kind, id: saved.id }
      }
    } catch { /* 首次无文件 */ }
  }
  async function persistUiState() {
    await atomicWrite(uiStatePath, `${JSON.stringify(uiState.lastTarget ?? {}, null, 2)}\n`)
  }

  const chatSessionsPath = join(stateDir, 'chat-sessions.json')
  const memoryDirOf = (botId) => join(stateDir, 'bots', botId, 'memory')
  const profilePathOf = (botId) => join(memoryDirOf(botId), 'PROFILE.md')
  const teamMemoryPath = join(stateDir, 'memory', 'TEAM.md')
  const skillsDir = join(stateDir, 'skills')
  const roomsDir = join(stateDir, 'rooms')
  const routinesStatePath = join(stateDir, 'routines-state.json')

  const roomTranscriptPath = (roomId) => join(roomsDir, `${roomId}.transcript.jsonl`)

  // 统一会话实体：1 成员=私聊（转录在 bots/<id>/dm-transcript.jsonl），2-6=群（rooms/<id>.transcript.jsonl）
  function conversationOf(conversationId) {
    return crewState.crew.conversations?.find((entry) => entry.id === conversationId) ?? null
  }

  function conversationTranscriptPath(conversation) {
    return conversation.memberBotIds.length === 1
      ? join(stateDir, 'bots', conversation.memberBotIds[0], 'dm-transcript.jsonl')
      : roomTranscriptPath(conversation.id)
  }

  async function appendConversationMsg(conversation, entry) {
    if (conversation.memberBotIds.length === 1) {
      // 私聊：chatTurn 已负责 dm 转录；此函数在 dm 场景仅透传
      return
    }
    await appendRoomMsg(conversation.id, entry)
  }

  async function readConversationMsgs(conversation, limit = 200) {
    return conversation.memberBotIds.length === 1
      ? readDm(conversation.memberBotIds[0], limit)
      : readRoomMsgs(conversation.id, limit)
  }

  async function ensureDmConversation(bot) {
    let conversation = crewState.crew.conversations?.find((entry) => entry.memberBotIds.length === 1 && entry.memberBotIds[0] === bot.id)
    if (!conversation) {
      conversation = createConversation(crewState.crew, { memberBotIds: [bot.id] })
      await persistCrew()
    }
    return conversation
  }
  const routineHistoryPath = (routineId) => join(roomsDir, `routine-${routineId}.history.jsonl`)

  async function appendRoomMsg(roomId, entry) {
    await mkdir(roomsDir, { recursive: true })
    const path = roomTranscriptPath(roomId)
    let text = ''
    try {
      text = await readFile(path, 'utf8')
    } catch { text = '' }
    if (!text.endsWith('\n') && text.length > 0) await appendFile(path, '\n')
    await appendFile(path, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`)
  }

  async function readRoomMsgs(roomId, limit = 200) {
    try {
      const lines = (await readFile(roomTranscriptPath(roomId), 'utf8')).split('\n').filter((line) => line.trim())
      return lines.slice(-limit).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
    } catch {
      return []
    }
  }

  async function appendRoutineHistory(routineId, line) {
    await mkdir(roomsDir, { recursive: true })
    const path = routineHistoryPath(routineId)
    let text = ''
    try {
      text = await readFile(path, 'utf8')
    } catch { text = '' }
    let lines = text.split('\n').filter((entry) => entry.trim())
    lines.push(JSON.stringify({ ts: Date.now(), ...line }))
    lines = lines.slice(-20)
    await atomicWrite(path, `${lines.join('\n')}\n`)
  }

  async function loadRoutinesState() {
    try {
      return JSON.parse(await readFile(routinesStatePath, 'utf8')) || {}
    } catch {
      return {}
    }
  }

  async function loadChatSessions() {
    try {
      const map = JSON.parse(await readFile(chatSessionsPath, 'utf8'))
      for (const [botId, sessionId] of Object.entries(map || {})) {
        if (typeof sessionId === 'string' && sessionId) chatSessionIds.set(botId, sessionId)
      }
    } catch { /* 首次启动无文件 */ }
  }

  async function persistChatSessions() {
    await atomicWrite(chatSessionsPath, `${JSON.stringify(Object.fromEntries(chatSessionIds), null, 2)}\n`)
  }

  const statsPathOf = (botId) => join(stateDir, 'bots', botId, 'stats.json')
  const LEVELS = [
    { at: 0, title: '见习' },
    { at: 50, title: '熟练' },
    { at: 150, title: '资深' },
    { at: 400, title: '专家' },
    { at: 1000, title: '大师' },
  ]

  async function loadStats(botId) {
    try {
      const saved = JSON.parse(await readFile(statsPathOf(botId), 'utf8'))
      return {
        exp: Number(saved.exp) || 0,
        tasksDone: Number(saved.tasksDone) || 0,
        tasksFailed: Number(saved.tasksFailed) || 0,
        thumbsUp: Number(saved.thumbsUp) || 0,
        thumbsDown: Number(saved.thumbsDown) || 0,
        backfilled: saved.backfilled === true,
      }
    } catch {
      return { exp: 0, tasksDone: 0, tasksFailed: 0, thumbsUp: 0, thumbsDown: 0, backfilled: false }
    }
  }

  async function saveStats(botId, stats) {
    await atomicWrite(statsPathOf(botId), `${JSON.stringify(stats, null, 2)}\n`)
  }

  async function awardBot(botId, patch) {
    if (!botId) return null
    const stats = await loadStats(botId)
    const next = {
      exp: Math.max(0, stats.exp + (patch.expDelta || 0)),
      tasksDone: Math.max(0, stats.tasksDone + (patch.tasksDoneDelta || 0)),
      tasksFailed: Math.max(0, stats.tasksFailed + (patch.tasksFailedDelta || 0)),
      thumbsUp: Math.max(0, stats.thumbsUp + (patch.thumbsUpDelta || 0)),
      thumbsDown: Math.max(0, stats.thumbsDown + (patch.thumbsDownDelta || 0)),
      backfilled: stats.backfilled,
      updatedAt: Date.now(),
    }
    await saveStats(botId, next)
    return next
  }

  function ratingOf(stats) {
    let level = 1
    for (let i = 0; i < LEVELS.length; i++) {
      if (stats.exp >= LEVELS[i].at) level = i + 1
    }
    const nextAt = level < LEVELS.length ? LEVELS[level].at : null
    const total = stats.tasksDone + stats.tasksFailed
    const thumbs = stats.thumbsUp + stats.thumbsDown
    const successRate = total >= 1 ? stats.tasksDone / total : null
    const thumbRate = thumbs >= 1 ? stats.thumbsUp / thumbs : null
    let stars = null
    if (successRate !== null || thumbRate !== null) {
      const parts = []
      let weight = 0
      if (successRate !== null) { parts.push(successRate * 0.6); weight += 0.6 }
      if (thumbRate !== null) { parts.push(thumbRate * 0.4); weight += 0.4 }
      stars = Math.max(1, Math.min(5, Math.round(5 * (parts.reduce((a, b) => a + b, 0) / weight))))
    }
    return {
      level, title: LEVELS[level - 1].title, exp: stats.exp, nextAt, stars,
      tasksDone: stats.tasksDone, tasksFailed: stats.tasksFailed,
      thumbsUp: stats.thumbsUp, thumbsDown: stats.thumbsDown,
    }
  }

  async function seedBotMemory(bot) {
    await mkdir(memoryDirOf(bot.id), { recursive: true })
    try {
      await readFile(profilePathOf(bot.id), 'utf8')
    } catch {
      await atomicWrite(profilePathOf(bot.id), `# ${bot.name} 的长期记忆\n\n（由 ${bot.name} 自己维护：稳定偏好、重要事实、工作摘要。一条一行：日期 + 内容。）\n`)
    }
  }

  function botState(botId) {
    let state = botStates.get(botId)
    if (!state) {
      state = { status: 'idle', currentJob: null, lastActivity: null }
      botStates.set(botId, state)
    }
    return state
  }

  function recordRecent(entry) {
    recentJobs.unshift(entry)
    if (recentJobs.length > 50) recentJobs.length = 50
  }

  function personaPrompt(bot) {
    return [
      bot.persona || '你是常驻桌面 agent 团队的一员，用简体中文直接处理用户投递的任务。',
      `团队共享电脑：${botWorkspace(stateDir, bot)}（全队共享）；你的个人目录：${join(botWorkspace(stateDir, bot), 'agents', bot.id)}（自己的笔记与工作产物放这里）。`,
      '只汇报真实完成的操作，不要把工具调用伪装成普通文本。',
      '消息支持 Markdown（标题/列表/代码块/链接）。想让用户快捷选择时，在回复最后一行单独写 [[选项1|选项2|选项3]]，会被渲染成可点击按钮。',
    ].join('\n')
  }

  async function memorySections(bot, agentCtx) {
    // 团队章程（可选，人写）
    try {
      const team = await readFile(teamMemoryPath, 'utf8')
      if (team.trim()) {
        agentCtx.systemPrompt.section({
          name: 'grokbot:team',
          order: -19,
          text: `## 团队章程（全队共享，优先遵守）\n${team.trim()}`,
        })
      }
    } catch { /* 无章程 */ }
    // 专家长期记忆（bot 自维护）
    const profilePath = profilePathOf(bot.id)
    let profile = ''
    try {
      profile = await readFile(profilePath, 'utf8')
    } catch { /* 未初始化 */ }
    agentCtx.systemPrompt.section({
      name: 'grokbot:memory',
      order: -18,
      text: [
        '## 你的长期记忆',
        `文件路径：${profilePath}（可读写）`,
        '当前内容：',
        profile.trim() || '（空）',
        '',
        '记忆维护规则：每回合结束时，若本回合产生了值得长期记住的稳定偏好或重要事实，用工具向该文件追加一行「YYYY-MM-DD 事实」。不要写入一次性任务细节；安全边界写在团队章程或你的职责里，不写记忆。',
      ].join('\n'),
    })
    // 技能（跨 bot 复用，文件即技能）
    try {
      const { readdir: rd } = await import('node:fs/promises')
      const files = await rd(skillsDir).catch(() => [])
      const skills = files.filter((name) => name.endsWith('.md')).sort()
      if (skills.length > 0) {
        const lines = []
        for (const name of skills) {
          const head = (await readFile(join(skillsDir, name), 'utf8')).split('\n').find((line) => line.trim()) ?? ''
          lines.push(`/${name.replace(/\.md$/, '')} — ${head.replace(/^#+\s*/, '').slice(0, 60)}`)
        }
        agentCtx.systemPrompt.section({
          name: 'grokbot:skills',
          order: -17,
          text: [
            '## 可复用技能（全队共享）',
            `目录：${skillsDir}（消息中出现 /技能名 引用时，用读文件工具查看对应 .md 全文并按其执行）`,
            ...lines,
          ].join('\n'),
        })
      }
    } catch { /* 无技能 */ }
  }

  async function init() {
    await mkdir(stateDir, { recursive: true })
    await ensureInbox(inboxRoot)
    // 共享电脑：全队一个 workspace（Grok Bot 语义）
    await mkdir(join(stateDir, 'workspace'), { recursive: true })
    await mkdir(join(stateDir, 'memory'), { recursive: true })
    await mkdir(skillsDir, { recursive: true })
    await mkdir(roomsDir, { recursive: true })
    const loaded = await loadOrCreateCrew(stateDir)
    crewState.path = loaded.path
    crewState.crew = loaded.crew
    await loadChatSessions()
    await loadUiState()
    for (const bot of crewState.crew.bots) {
      botState(bot.id)
      await seedBotMemory(bot)
      await mkdir(join(botWorkspace(stateDir, bot), 'agents', bot.id), { recursive: true }).catch(() => undefined)
      await ensureDmConversation(bot).catch(() => undefined)
    }
    // 历史回填：首次为每个 bot 建 stats（扫描 inbox 的 status.json），幂等
    for (const bot of crewState.crew.bots) {
      const stats = await loadStats(bot.id)
      if (stats.backfilled) continue
      let done = 0
      let failed = 0
      try {
        const queueText = await readFile(join(inboxRoot, 'queue.jsonl'), 'utf8')
        for (const line of queueText.split('\n')) {
          if (!line.trim()) continue
          let entry
          try { entry = JSON.parse(line) } catch { continue }
          const dir = String(entry.dir || join(inboxRoot, String(entry.jobId || entry.id || '')))
          let status = null
          try { status = JSON.parse(await readFile(join(dir, 'status.json'), 'utf8')) } catch { continue }
          if (status.botId !== bot.id) continue
          if (status.status === 'replied') done += 1
          else if (status.status === 'failed') failed += 1
        }
      } catch { /* 无 queue */ }
      const merged = { ...stats, tasksDone: stats.tasksDone + done, tasksFailed: stats.tasksFailed + failed, backfilled: true }
      merged.exp = Math.max(0, merged.exp + done * 10 - failed * 5)
      await saveStats(bot.id, merged)
    }
    ctx.logger?.info?.(`grokbot ready: ${crewState.crew.bots.length} bot(s), inbox=${inboxRoot}`)
  }

  let crewWriteLock = Promise.resolve()
  async function persistCrew() {
    // 串行化写盘：防止 routine 调度器 / API / inbox 扫描并发写 crew.json 丢失变更
    const write = async () => {
      await atomicWrite(crewState.path, serializeCrew(crewState.crew))
    }
    crewWriteLock = crewWriteLock.then(write, write)
    await crewWriteLock
  }

  const catalogCache = { expiresAt: 0, value: null }
  async function modelCatalog() {
    if (catalogCache.expiresAt > Date.now()) return catalogCache.value
    const providers = typeof ctx.llm?.listProviders === 'function' ? await ctx.llm.listProviders() : []
    const value = await Promise.all(providers.map(async (provider) => {
      let models = []
      try {
        models = typeof ctx.llm?.listModels === 'function' ? await ctx.llm.listModels(provider.id) : []
      } catch { models = [] }
      return {
        id: provider.id,
        name: provider.name || provider.id,
        models: (models || []).map((model) => ({ id: model.id, name: model.name || model.id })),
      }
    }))
    catalogCache.value = value
    catalogCache.expiresAt = Date.now() + 10_000
    return value
  }

  const hydrated = init()

  // ---------- agent 会话 ----------

  const activeSessions = new Set()
  const approvalBotByAgent = new Map()
  const pendingApprovals = new Map()

  async function createBotAgent(bot, { sessionId, resume = false } = {}) {
    const abort = new AbortController()
    const fallback = typeof ctx.agentDefaultModel?.currentSelection === 'function'
      ? ctx.agentDefaultModel.currentSelection()
      : null
    const selection = bot.model?.provider && bot.model?.model
      ? bot.model
      : (crewState.crew.defaultModel?.provider && crewState.crew.defaultModel?.model
          ? crewState.crew.defaultModel
          : (fallback?.provider && fallback?.model ? fallback : null))
    const base = {
      sessionId: sessionId || randomUUID(),
      meta: { cwd: botWorkspace(stateDir, bot) },
      ...(selection ? { agentOptions: selection } : {}),
      signal: abort.signal,
      async setup(agentCtx) {
        agentCtx.systemPrompt.section({
          name: 'grokbot:identity',
          order: -20,
          text: personaPrompt(bot),
        })
        await memorySections(bot, agentCtx)
      },
    }
    let handle
    if (resume && sessionId) {
      // 持久对话：重启后接续同一会话（对话存在电脑之外，与 Grok Bot 语义一致）
      try {
        handle = await ctx.agents.resume(base)
      } catch {
        handle = await ctx.agents.create({ ...base, sessionId: randomUUID() })
      }
    } else {
      handle = await ctx.agents.create(base)
    }
    abort.signal.addEventListener('abort', () => {
      try { handle.agent.cancel({ kind: 'user' }) } catch { /* already settled */ }
    }, { once: true })
    const session = {
      handle,
      abort,
      dispose: async () => {
        activeSessions.delete(session)
        approvalBotByAgent.delete(String(handle.agent.id))
        try { handle.agent.cancel({ kind: 'user' }, { keepInbox: true }) } catch { /* best effort */ }
        try { await handle.dispose() } catch { /* best effort */ }
      },
    }
    activeSessions.add(session)
    approvalBotByAgent.set(String(handle.agent.id), bot.id)
    return session
  }

  // 审批桥：我们创建的 agent 的工具审批交给会话内【同意/取消】卡，其余放行
  ctx.effect(() => ctx.on('approval/request', (req, next) => {
    const agentId = String(req?.agent?.id || '')
    const botId = approvalBotByAgent.get(agentId)
    if (!botId) return next()
    const events = req?.agent?.session?.events || []
    const decided = new Set()
    let approvalId = ''
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event.type === 'approval/decided') { decided.add(event.data.id); continue }
      if (event.type !== 'approval/asked' || decided.has(event.data.id)) continue
      if ((req.callId ?? null) !== (event.data.callId ?? null)) continue
      if (pendingApprovals.has(String(event.data.id))) continue
      approvalId = String(event.data.id)
      break
    }
    if (!approvalId) return next()
    ctx.logger?.info?.(`grokbot approval ${approvalId} bot=${botId} tool=${req.toolName}`)
    return new Promise((resolve) => {
      pendingApprovals.set(approvalId, {
        id: approvalId,
        botId,
        toolName: String(req.toolName || ''),
        reason: String(req.reason || ''),
        createdAt: Date.now(),
        resolve,
      })
      req.signal?.addEventListener('abort', () => {
        if (pendingApprovals.get(approvalId)?.resolve === resolve) pendingApprovals.delete(approvalId)
        resolve('cancelled')
      }, { once: true })
    })
  }, true), 'grokbot: approval bridge')

  const ROLE_TEMPLATES = new Map([
    ['工程师', 'coder'], ['调研员', 'researcher'], ['写作官', 'writer'], ['数据分析师', 'analyst'],
    ['产品经理', 'pm'], ['秘书', 'secretary'], ['运维官', 'ops'], ['翻译官', 'translator'], ['审核官', 'reviewer'],
  ])

  const setupPathOf = (botId) => join(stateDir, 'bots', botId, 'setup.json')

  async function loadSetup(botId) {
    try {
      return JSON.parse(await readFile(setupPathOf(botId), 'utf8'))
    } catch {
      return null
    }
  }

  async function saveSetup(botId, setup) {
    await atomicWrite(setupPathOf(botId), `${JSON.stringify(setup, null, 2)}\n`)
  }

  // 对话式设置协议：角色芯片 → 姓名芯片/输入 → 完成（确定性，不依赖模型）
  async function trySetupTurn(bot, text) {
    const setup = await loadSetup(bot.id)
    if (!setup || setup.stage === 'done') return null
    const clean = String(text || '').trim()
    if (setup.stage === 'await-role') {
      if (clean === '跳过设置') {
        await saveSetup(bot.id, { stage: 'done', skipped: true })
        return { reply: '好，跳过设置。我先用默认身份干活，随时可以让我调整角色或名字。' }
      }
      if (clean === '更多角色') {
        return { reply: '其余角色：\n\n[[运维官|翻译官|审核官]]\n\n也可以直接描述你想让我做什么。' }
      }
      const templateId = ROLE_TEMPLATES.get(clean)
      if (!templateId) return null // 非角色文本走模型自由对话
      const template = templateById(templateId)
      updateBot(crewState.crew, bot.id, { persona: template.persona, title: template.title, avatar: template.avatar })
      await persistCrew()
      await saveSetup(bot.id, { stage: 'await-name', roleTemplate: templateId })
      return { reply: `已就任「**${clean}**」。最后一步——叫我什么名字？\n\n[[${template.name}|自己起一个]]`, renameTo: null }
    }
    if (setup.stage === 'await-name') {
      if (clean === '跳过设置') {
        await saveSetup(bot.id, { stage: 'done', roleTemplate: setup.roleTemplate })
        return { reply: '设置完成（沿用默认名字）。现在就可以给我第一个任务。' }
      }
      const template = templateById(setup.roleTemplate || '') || { name: '' }
      let name = ''
      if (template.name && clean === template.name) {
        name = template.name
      } else if (clean === '自己起一个') {
        return { reply: '好，直接输入名字（2-12 个字）就好。' }
      } else {
        const explicit = /^叫(?:我)?\s*([\u4e00-\u9fa5A-Za-z0-9·]{2,12})$/.exec(clean)
        const bare = /^[\u4e00-\u9fa5A-Za-z0-9·]{2,12}$/.test(clean) && !ROLE_TEMPLATES.has(clean)
        if (explicit) name = explicit[1]
        else if (bare && clean !== template.name) name = clean
      }
      if (!name) return null
      updateBot(crewState.crew, bot.id, { name })
      await persistCrew()
      await saveSetup(bot.id, { stage: 'done', roleTemplate: setup.roleTemplate })
      return { reply: `就叫我**${name}**了。${template.title ? `角色：${template.title}。` : ''}设置完成，现在就可以给我第一个任务——说吧。` }
    }
    return null
  }

  async function appendDm(botId, entry) {
    const dir = join(stateDir, 'bots', botId)
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'dm-transcript.jsonl')
    let text = ''
    try {
      text = await readFile(path, 'utf8')
    } catch { text = '' }
    if (!text.endsWith('\n') && text.length > 0) await appendFile(path, '\n')
    await appendFile(path, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`)
  }

  async function readDm(botId, limit = 200) {
    try {
      const lines = (await readFile(join(stateDir, 'bots', botId, 'dm-transcript.jsonl'), 'utf8')).split('\n').filter((line) => line.trim())
      return lines.slice(-limit).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
    } catch {
      return []
    }
  }

  async function chatTurn(bot, text, { preamble = '' } = {}) {
    let session = chatHandles.get(bot.id)
    if (!session) {
      const known = chatSessionIds.get(bot.id)
      if (known) {
        session = await createBotAgent(bot, { sessionId: known, resume: true })
      } else {
        const sessionId = randomUUID()
        chatSessionIds.set(bot.id, sessionId)
        await persistChatSessions()
        session = await createBotAgent(bot, { sessionId })
      }
      const actualId = session.handle.agent?.session?.id
      if (actualId && actualId !== chatSessionIds.get(bot.id)) {
        chatSessionIds.set(bot.id, String(actualId))
        await persistChatSessions()
      }
      chatHandles.set(bot.id, session)
    }
    await session.handle.agent.whenIdle()
    const firstSeq = session.handle.agent.session.seq
    session.handle.agent.followup(userMessage(preamble ? `${preamble}\n\n${text}` : text))
    await appendDm(bot.id, { role: 'user', text: preamble ? `${preamble}\n\n${text}` : text }).catch(() => undefined)
    await session.handle.agent.whenIdle()
    const outcome = {
      ...summarizeTurn(session.handle.agent.session.events, firstSeq),
      activity: activityOf(session.handle.agent.session.events, firstSeq),
    }
    const dmText = outcome.text?.trim()
    if (dmText) {
      await appendDm(bot.id, { role: 'bot', text: dmText, activity: outcome.activity }).catch(() => undefined)
    }
    return outcome
  }

  function eligibleBots(conversation) {
    // 幕僚长拥有全域参与权：任何群聊中可被 @ 或交接，即使不是成员
    const members = conversation.memberBotIds
      .map((botId) => crewState.crew.bots.find((bot) => bot.id === botId))
      .filter(Boolean)
    const chief = crewState.crew.bots.find((bot) => bot.id === 'chief')
    if (chief && !conversation.memberBotIds.includes('chief')) return [...members, chief]
    return members
  }

  function pickResponder(conversation, text) {
    // @提及定向（Grok Bot 语义）；未提及时由默认收件人（若在群内）应答，否则首位成员
    const mention = /@([\w\u4e00-\u9fa5]+)/.exec(String(text || ''))
    if (mention) {
      const hit = eligibleBots(conversation)
        .find((bot) => bot && (bot.name.includes(mention[1]) || mention[1] === bot.id || bot.id.includes(mention[1])))
      if (hit) return hit
    }
    const fallbackId = crewState.crew.routing.default
    const inRoom = conversation.memberBotIds.includes(fallbackId)
    return crewState.crew.bots.find((bot) => bot.id === (inRoom ? fallbackId : conversation.memberBotIds[0]))
  }

  const HANDOFF_LINE_RE = /^@([\w\u4e00-\u9fa5]+)[：:\s]+(.+)$/

  async function conversationTurn(conversation, senderText, { mentionTarget } = {}) {
    if (conversation.memberBotIds.length === 1) {
      const bot = crewState.crew.bots.find((entry) => entry.id === conversation.memberBotIds[0])
      if (!bot) throw new Error('会话成员不存在')
      const outcome = await chatTurn(bot, senderText)
      return { responder: bot, reply: outcome.text?.trim() || `[${bot.name} 未能给出文本回复]`, handoffTo: null, outcome }
    }
    const members = conversation.memberBotIds
      .map((botId) => crewState.crew.bots.find((bot) => bot.id === botId))
      .filter(Boolean)
    const responder = mentionTarget ?? pickResponder(conversation, senderText)
    if (!responder) throw new Error('群聊无可应答成员')
    const preamble = [
      `【群聊 ${conversation.name}】成员：${members.map((bot) => `${bot.avatar}${bot.name}`).join('、')}。`,
      '你现在在群聊中应答用户消息。若你认为某条工作应由其他成员处理，在回复的最后一行单独写「@成员名 交代内容」，系统会异步转交；不要除此行外提交接。',
    ].join('\n')
    const outcome = await chatTurn(responder, senderText, { preamble })
    const reply = outcome.text?.trim() || `[${responder.name} 未能给出文本回复：${outcome.error || outcome.stopReason}]`
    // 解析末尾交接行 → bot↔bot 异步交接
    const lines = reply.split('\n')
    const lastLine = lines[lines.length - 1]?.trim() ?? ''
    const handoff = HANDOFF_LINE_RE.exec(lastLine)
    if (handoff) {
      const target = eligibleBots(conversation).find((bot) => bot.name.includes(handoff[1]) || bot.id.includes(handoff[1]))
      if (target && target.id !== responder.id) {
        lines.pop()
        const cleanReply = lines.join('\n').trim() || '（已转交）'
        await appendRoomMsg(conversation.id, { role: 'bot', botId: responder.id, text: cleanReply })
        await appendRoomMsg(conversation.id, { role: 'handoff', fromBotId: responder.id, toBotId: target.id, text: handoff[2] })
        void (async () => {
          try {
            const relay = await chatTurn(target, `【群聊转交，来自 ${responder.name}】${handoff[2]}`, { preamble: `【群聊 ${conversation.name}】你收到队友 ${responder.name} 的转交任务。` })
            await appendRoomMsg(conversation.id, { role: 'bot', botId: target.id, text: relay.text?.trim() || '[转交处理失败]' })
          } catch (error) {
            await appendRoomMsg(conversation.id, { role: 'system', text: `转交失败：${safeError(error)}` })
          }
        })()
        return { responder, reply: cleanReply, handoffTo: target.id }
      }
    }
    await appendRoomMsg(conversation.id, { role: 'bot', botId: responder.id, text: reply })
    return { responder, reply, handoffTo: null }
  }

  // 陈旧任务清扫：claimed 超过 2×jobTimeout 仍未出结果的，判失败释放队列
  async function sweepStale() {
    try {
      const queueText = await readFile(join(inboxRoot, 'queue.jsonl'), 'utf8').catch(() => '')
      for (const line of queueText.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let entry
        try { entry = JSON.parse(trimmed) } catch { continue }
        const jobId = String(entry.jobId || entry.id || '').trim()
        const dir = String(entry.dir || join(inboxRoot, jobId))
        let status = null
        try { status = JSON.parse(await readFile(join(dir, 'status.json'), 'utf8')) } catch { continue }
        if (status?.status !== 'claimed') continue
        // 跳过正在运行的任务（runInboxJob 可能即将完成）
        if (runningJobs.has(jobId)) continue
        const age = Date.now() - (Number(status.startedAt) || 0)
        if (age < jobTimeoutMs * 2) continue
        const botId = String(status.botId || routeJob(crewState.crew, entry).id)
        const job = { jobId, dir, toBot: botId, text: String(entry.text || ''), images: [] }
        await failJob(job, botId, `任务超时未完成（claimed ${Math.round(age / 1000)}s），已由清扫器释放`)
        recordRecent({ jobId, botId, status: 'failed', error: 'stale-claimed swept', endedAt: Date.now() })
        ctx.logger?.warn?.(`grokbot swept stale job ${jobId}`)
      }
    } catch (error) {
      ctx.logger?.warn?.(`grokbot sweep error: ${safeError(error)}`)
    }
  }

  async function runInboxJob(job) {
    const bot = routeJob(crewState.crew, job)
    const state = botState(bot.id)
    state.status = 'working'
    state.currentJob = job.jobId
    runningJobs.set(job.jobId, { botId: bot.id, startedAt: Date.now() })
    let session = null
    try {
      await claimJob(job, bot.id)
      const promptText = job.text?.trim()
        || `（无文字内容${job.images.length > 0 ? '，请查看同目录图片附件' : ''}）`
      session = await createBotAgent(bot)
      const timeout = setTimeout(() => session.abort.abort(new Error(`job timeout after ${jobTimeoutMs}ms`)), jobTimeoutMs)
      let outcome
      try {
        await session.handle.agent.whenIdle()
        const firstSeq = session.handle.agent.session.seq
        const withImages = job.images.length > 0
          ? `${promptText}\n\n【图片】请阅读：\n${job.images.join('\n')}`
          : promptText
        session.handle.agent.followup(userMessage(withImages))
        await session.handle.agent.whenIdle()
        outcome = summarizeTurn(session.handle.agent.session.events, firstSeq)
      } finally {
        clearTimeout(timeout)
      }
      const reply = outcome.text?.trim()
      if (!reply) {
        const reason = outcome.error
          ? `${outcome.error}（stopReason=${outcome.stopReason}）`
          : `stopReason=${outcome.stopReason}，无文本输出`
        await failJob(job, bot.id, reason)
        recordRecent({ jobId: job.jobId, botId: bot.id, status: 'failed', error: reason, endedAt: Date.now() })
        ctx.logger?.warn?.(`grokbot job ${job.jobId} failed: ${reason}`)
      } else {
        if (outcome.error) {
          ctx.logger?.warn?.(`grokbot job ${job.jobId} 回复已产出但回合报错：${outcome.error}`)
        }
        await completeJob(job, bot.id, reply)
        await awardBot(bot.id, { expDelta: 10, tasksDoneDelta: 1 }).catch(() => undefined)
        recordRecent({ jobId: job.jobId, botId: bot.id, status: 'replied', bytes: reply.length, endedAt: Date.now() })
        ctx.logger?.info?.(`grokbot job ${job.jobId} replied by ${bot.id} (${reply.length} bytes)`)
      }
    } catch (error) {
      const reason = safeError(error)
      await failJob(job, bot.id, reason).catch(() => undefined)
      recordRecent({ jobId: job.jobId, botId: bot.id, status: 'failed', error: reason, endedAt: Date.now() })
      ctx.logger?.warn?.(`grokbot job ${job.jobId} error: ${reason}`)
    } finally {
      void session?.dispose()
      runningJobs.delete(job.jobId)
      state.status = 'idle'
      state.currentJob = null
      state.lastActivity = Date.now()
      pump()
    }
  }

  // ---------- 调度 ----------

  function pump() {
    if (disposed) return
    while (runningJobs.size < maxConcurrentJobs && pendingJobs.length > 0) {
      const busy = new Set([...runningJobs.values()].map((entry) => entry.botId))
      const index = pendingJobs.findIndex((job) => {
        const bot = routeJob(crewState.crew, job)
        return !busy.has(bot.id)
      })
      if (index < 0) break
      const [job] = pendingJobs.splice(index, 1)
      void runInboxJob(job)
    }
  }

  async function scan() {
    if (scanning || disposed) return
    scanning = true
    try {
      await hydrated
      await sweepStale()
      const jobs = await scanInbox(inboxRoot)
      for (const job of jobs) {
        if (seenJobIds.has(job.jobId)) continue
        seenJobIds.add(job.jobId)
        pendingJobs.push(job)
        recordRecent({ jobId: job.jobId, botId: routeJob(crewState.crew, job).id, status: 'queued', endedAt: null })
      }
      pump()
    } catch (error) {
      ctx.logger?.warn?.(`grokbot scan error: ${safeError(error)}`)
    } finally {
      scanning = false
    }
  }

  const rescanTimer = setInterval(() => void scan(), rescanIntervalMs)
  // routines 调度器：到期触发 → 投递 inbox（试运行/历史同源）
  const routineTimer = setInterval(() => void (async () => {
    try {
      const routines = crewState.crew.routines ?? []
      if (routines.length === 0) return
      const state = await loadRoutinesState()
      const now = new Date()
      for (const routine of routines) {
        if (routine.enabled === false) continue
        const last = Number(state[routine.id]) || 0
        let due = false
        if (routine.schedule.everyMinutes) {
          due = Date.now() - last >= routine.schedule.everyMinutes * 60_000
        } else if (routine.schedule.time) {
          const [hh, mm] = routine.schedule.time.split(':').map(Number)
          due = now.getHours() === hh && now.getMinutes() >= mm
            && new Date(last).toDateString() !== now.toDateString()
        }
        if (!due) continue
        state[routine.id] = Date.now()
        await atomicWrite(routinesStatePath, `${JSON.stringify(state, null, 2)}\n`)
        const job = await enqueueJob(inboxRoot, { toBot: routine.botId, text: `[routine ${routine.id}] ${routine.prompt}` })
        await appendRoutineHistory(routine.id, { kind: 'scheduled', jobId: job.jobId })
        ctx.logger?.info?.(`grokbot routine ${routine.id} fired job=${job.jobId}`)
      }
    } catch (error) {
      ctx.logger?.warn?.(`grokbot routine scheduler error: ${safeError(error)}`)
    }
  })(), 30_000)
  let watcher = null
  try {
    watcher = watch(inboxRoot, { recursive: true }, () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void scan(), 400)
    })
  } catch {
    // 目录监听不可用时退化为纯轮询
  }
  let debounceTimer = null
  void scan()

  // ---------- HTTP API ----------

  function respond(res, status, body) {
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(body))
  }

  async function readJsonBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    return text ? JSON.parse(text) : {}
  }

  function assertSameOrigin(req) {
    const origin = req.headers?.origin
    if (!origin) return
    const host = req.headers?.host
    try {
      if (host && new URL(origin).host !== host) {
        throw new HttpError(403, 'cross-origin rejected')
      }
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(403, 'invalid origin')
    }
  }

  class HttpError extends Error {
    constructor(status, message) {
      super(message)
      this.status = status
    }
  }

  function publicBot(bot) {
    const state = botState(bot.id)
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
      lastActivity: state.lastActivity,
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_ROOT,
    handler: async (req, res) => {
      try {
        await hydrated
        assertSameOrigin(req)
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const method = String(req.method ?? 'GET').toUpperCase()
        const suffix = url.pathname.slice(API_ROOT.length) || '/'

        if (method === 'GET' && suffix === '/health') {
          respond(res, 200, { ok: true, time: nowIso() }); return
        }
        if (method === 'GET' && suffix === '/state') {
          const bots = []
          for (const bot of crewState.crew.bots) {
            const base = publicBot(bot)
            const setup = await loadSetup(bot.id)
            if (setup && setup.stage && setup.stage !== 'done') base.setupStage = setup.stage
            // roleTemplate：setup.json 优先，title 关键词匹配兜底，chief 固有
            let roleTemplate = setup?.roleTemplate || ''
            if (!roleTemplate && bot.id === 'chief') roleTemplate = 'chief'
            if (!roleTemplate) {
              const titleMatch = [
                ['幕僚长', 'chief'], ['工程师', 'coder'], ['调研员', 'researcher'], ['写作官', 'writer'],
                ['数据分析师', 'analyst'], ['产品经理', 'pm'], ['运维官', 'ops'],
                ['翻译官', 'translator'], ['秘书', 'secretary'], ['审核官', 'reviewer'],
              ]
              for (const [prefix, key] of titleMatch) {
                if (bot.title && (bot.title === prefix || bot.title.startsWith(prefix + ' · '))) { roleTemplate = key; break }
              }
            }
            base.roleTemplate = roleTemplate
            base.rating = ratingOf(await loadStats(bot.id))
            const dm = await readDm(bot.id, 1)
            const last = dm[dm.length - 1]
            bots.push({
              ...base,
              lastMessage: last ? String(last.text || '').slice(0, 80) : '',
              lastAt: last?.ts ?? null,
              lastFrom: last?.role === 'user' ? 'user' : 'bot',
            })
          }
          respond(res, 200, {
            bots,
            conversations: crewState.crew.conversations ?? [],
            routines: crewState.crew.routines ?? [],
            approvals: [...pendingApprovals.values()].map(({ resolve, ...rest }) => rest),
            running: [...runningJobs.entries()].map(([jobId, entry]) => ({ jobId, ...entry })),
            queueDepth: pendingJobs.length,
            recentJobs,
            lastTarget: uiState.lastTarget,
            config: { inboxRoot, stateDir, maxConcurrentJobs, jobTimeoutMs },
          }); return
        }
        if (method === 'POST' && suffix === '/ui-state') {
          const body = await readJsonBody(req)
          if (body && (body.kind === 'bot' || body.kind === 'room' || body.kind === 'conversation') && typeof body.id === 'string') {
            uiState.lastTarget = { kind: body.kind, id: body.id }
          } else if (body === null || body?.clear === true) {
            uiState.lastTarget = null
          }
          await persistUiState()
          respond(res, 200, { ok: true }); return
        }
        if (method === 'GET' && suffix === '/crew') {
          respond(res, 200, { crew: crewState.crew }); return
        }
        // 静态素材：/assets/avatars/chief → assets-design/avatars/chief.svg
        const assetMatch = /^\/assets\/([a-z]+)\/([a-z0-9-]+)$/.exec(suffix)
        if (method === 'GET' && assetMatch) {
          const type = assetMatch[1]
          const name = assetMatch[2]
          if (!/^(avatars|states|rating|parts)$/.test(type) || !/^[a-z0-9-]+$/.test(name)) {
            throw new HttpError(400, '非法素材路径')
          }
          const { dirname } = await import('node:path')
          const { fileURLToPath } = await import('node:url')
          const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
          const svgPath = join(pluginRoot, 'assets-design', type, `${name}.svg`)
          try {
            const svg = await readFile(svgPath, 'utf8')
            res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=3600' })
            res.end(svg)
          } catch {
            throw new HttpError(404, `素材不存在：${type}/${name}`)
          }
          return
        }
        if (method === 'GET' && suffix === '/bot-templates') {
          respond(res, 200, { templates: BOT_TEMPLATES }); return
        }
        if (method === 'GET' && suffix === '/model-catalog') {
          respond(res, 200, { catalog: await modelCatalog(), current: ctx.agentDefaultModel?.currentSelection?.() ?? null }); return
        }
        if (method === 'PATCH' && suffix === '/crew') {
          const body = await readJsonBody(req)
          const normModel = (value) => value && (value.provider || value.model)
            ? { provider: String(value.provider || ''), model: String(value.model || '') }
            : null
          if (body?.defaultModel !== undefined) crewState.crew.defaultModel = normModel(body.defaultModel)
          if (body?.utilityModel !== undefined) crewState.crew.utilityModel = normModel(body.utilityModel)
          if (body?.routing?.default !== undefined) {
            const target = String(body.routing.default)
            if (!crewState.crew.bots.some((entry) => entry.id === target)) {
              throw new HttpError(400, `routing.default 指向不存在的 bot：${target}`)
            }
            crewState.crew.routing.default = target
          }
          await persistCrew()
          respond(res, 200, { crew: crewState.crew }); return
        }
        if (method === 'POST' && suffix === '/bots') {
          const body = await readJsonBody(req)
          const template = body?.templateId ? templateById(String(body.templateId)) : null
          // 幕僚长全局唯一：重复召唤返回既有实例（幂等）
          if (template && template.id === 'chief') {
            const existing = crewState.crew.bots.find((bot) => bot.id === 'chief')
            if (existing) {
              respond(res, 200, { bot: publicBot(existing), existing: true }); return
            }
          }
          let greeting = ''
          if (template && !template.blank) {
            body.name = String(body?.name || '').trim() || template.name
            body.avatar = body?.avatar || template.avatar
            body.title = body?.title || template.title
            body.persona = String(body?.persona || '').trim() || template.persona
            greeting = template.greeting || ''
          }
          if (!String(body?.name || '').trim()) {
            // 空白 Bot：对话式初始化（Grok Bot 语义），开场白结构化（Markdown + 快捷选项）
            body.name = `新 Bot ${crewState.crew.bots.filter((bot) => bot.name.startsWith('新 Bot')).length + 1}`
            body.persona = String(body?.persona || '').trim() || [
              '你是刚加入团队的新成员，正在通过与用户对话完成初始化。',
              '先问清两件事：用户想叫你什么、你主要负责什么（职责与边界）。',
              '得到答复后复述确认，并把职责要点记入你的长期记忆；用户随时可能调整你的档案。',
              '之后直接开始干活，只汇报真实完成的操作。',
            ].join('\n')
            greeting = [
              '你好！我是新成员，在对话里完成设置：',
              '',
              '**第一步，选角色：**',
              '',
              '[[工程师|调研员|写作官|产品经理|数据分析师|秘书|更多角色]]',
              '',
              '选完我会在对话里问你的名字。也可以直接说「叫XX，做YY」一步到位。',
            ].join('\n')
          }
          let bot
          try {
            bot = createBot(crewState.crew, body)
          } catch (error) {
            throw new HttpError(400, safeError(error))
          }
          await persistCrew()
          await seedBotMemory(bot).catch(() => undefined)
          await mkdir(join(botWorkspace(stateDir, bot), 'agents', bot.id), { recursive: true }).catch(() => undefined)
          await ensureDmConversation(bot).catch(() => undefined)
          if (greeting) {
            await appendDm(bot.id, { role: 'bot', text: greeting }).catch(() => undefined)
            await saveSetup(bot.id, { stage: 'await-role' }).catch(() => undefined)
          }
          respond(res, 201, { bot: publicBot(bot) }); return
        }
        const botMatch = /^\/bots\/([^/]+)$/.exec(suffix)
        if (botMatch) {
          const botId = decodeURIComponent(botMatch[1])
          if (method === 'PATCH') {
            const body = await readJsonBody(req)
            let bot
            try {
              bot = updateBot(crewState.crew, botId, body)
            } catch (error) {
              throw new HttpError(400, safeError(error))
            }
            await persistCrew()
            respond(res, 200, { bot: publicBot(bot) }); return
          }
          if (method === 'DELETE') {
            try {
              removeBot(crewState.crew, botId)
            } catch (error) {
              throw new HttpError(400, safeError(error))
            }
            await persistCrew()
            respond(res, 200, { ok: true, bots: crewState.crew.bots.map(publicBot) }); return
          }
          if (method === 'GET') {
            const bot = crewState.crew.bots.find((entry) => entry.id === botId)
            if (!bot) throw new HttpError(404, `bot 不存在：${botId}`)
            respond(res, 200, { bot: publicBot(bot) }); return
          }
        }
        const dupMatch = /^\/bots\/([^/]+)\/duplicate$/.exec(suffix)
        if (method === 'POST' && dupMatch) {
          let bot
          try {
            bot = duplicateBot(crewState.crew, decodeURIComponent(dupMatch[1]))
          } catch (error) {
            throw new HttpError(400, safeError(error))
          }
          await persistCrew()
          await seedBotMemory(bot).catch(() => undefined)
          respond(res, 201, { bot: publicBot(bot) }); return
        }
        const approvalMatch = /^\/approvals\/([^/]+)$/.exec(suffix)
        if (approvalMatch && method === 'POST') {
          const approvalId = decodeURIComponent(approvalMatch[1])
          const entry = pendingApprovals.get(approvalId)
          if (!entry) throw new HttpError(404, '没有找到待审批的操作')
          const body = await readJsonBody(req)
          const outcome = String(body?.outcome || '')
          if (!['allowed-once', 'rejected'].includes(outcome)) {
            throw new HttpError(400, '审批结果无效（allowed-once / rejected）')
          }
          pendingApprovals.delete(approvalId)
          entry.resolve(outcome)
          if (outcome === 'rejected') {
            await awardBot(entry.botId, { expDelta: -3 }).catch(() => undefined)
          }
          ctx.logger?.info?.(`grokbot approval ${approvalId} -> ${outcome}`)
          respond(res, 200, { ok: true, outcome }); return
        }
        const feedbackMatch = /^\/bots\/([^/]+)\/feedback$/.exec(suffix)
        if (method === 'POST' && feedbackMatch) {
          const botId = decodeURIComponent(feedbackMatch[1])
          const body = await readJsonBody(req)
          const good = body?.good === true
          const bad = body?.bad === true
          if (!good && !bad) throw new HttpError(400, '需要 good 或 bad')
          const stats = await awardBot(botId, good ? { expDelta: 5, thumbsUpDelta: 1 } : { expDelta: -3, thumbsDownDelta: 1 })
          respond(res, 200, { rating: stats ? ratingOf(stats) : null }); return
        }
        const stopMatch = /^\/bots\/([^/]+)\/stop$/.exec(suffix)
        if (method === 'POST' && stopMatch) {
          const botId = decodeURIComponent(stopMatch[1])
          const session = chatHandles.get(botId)
          if (session) {
            try { session.handle.agent.cancel({ kind: 'user' }, { keepInbox: true }) } catch { /* best effort */ }
          }
          respond(res, 200, { ok: true }); return
        }
        const historyMatch = /^\/bots\/([^/]+)\/history$/.exec(suffix)
        if (method === 'GET' && historyMatch) {
          respond(res, 200, { messages: await readDm(decodeURIComponent(historyMatch[1])) }); return
        }
        if (method === 'GET' && suffix === '/conversations') {
          const conversations = []
          for (const conversation of crewState.crew.conversations ?? []) {
            const msgs = await readConversationMsgs(conversation, 1)
            const last = msgs[msgs.length - 1]
            conversations.push({
              ...conversation,
              isGroup: conversation.memberBotIds.length > 1,
              lastMessage: last ? String(last.text || '').slice(0, 80) : '',
              lastAt: last?.ts ?? null,
              lastFrom: last?.role === 'user' ? 'user' : 'bot',
            })
          }
          respond(res, 200, { conversations }); return
        }
        if (method === 'POST' && suffix === '/conversations') {
          const body = await readJsonBody(req)
          // 单成员=私聊：已有 dm 则直接复用，不重复建
          const wanted = Array.isArray(body?.memberBotIds) ? body.memberBotIds.map(String) : []
          if (wanted.length === 1) {
            const existingDm = crewState.crew.conversations?.find((entry) => entry.memberBotIds.length === 1 && entry.memberBotIds[0] === wanted[0])
            if (existingDm) {
              respond(res, 200, { conversation: existingDm, existing: true }); return
            }
          }
          let conversation
          try {
            conversation = createConversation(crewState.crew, body)
          } catch (error) {
            throw new HttpError(400, safeError(error))
          }
          await persistCrew()
          respond(res, 201, { conversation }); return
        }
        const convMatch = /^\/conversations\/([^/]+)(?:\/(chat|members))?$/.exec(suffix)
        if (convMatch) {
          const conversationId = decodeURIComponent(convMatch[1])
          const conversation = conversationOf(conversationId)
          if (!conversation) throw new HttpError(404, `conversation 不存在：${conversationId}`)
          if (method === 'GET' && !convMatch[2]) {
            respond(res, 200, { conversation, messages: await readConversationMsgs(conversation) }); return
          }
          if (method === 'PATCH' && !convMatch[2]) {
            const body = await readJsonBody(req)
            if (typeof body?.name === 'string') renameConversation(crewState.crew, conversationId, body.name)
            await persistCrew()
            respond(res, 200, { conversation }); return
          }
          if (method === 'DELETE' && !convMatch[2]) {
            try {
              removeConversation(crewState.crew, conversationId)
            } catch (error) {
              throw new HttpError(400, safeError(error))
            }
            await persistCrew()
            respond(res, 200, { ok: true }); return
          }
          if (method === 'POST' && convMatch[2] === 'members') {
            const body = await readJsonBody(req)
            const botId = String(body?.botId || '')
            let conversation2
            try {
              if (body?.remove === true) conversation2 = removeConversationMember(crewState.crew, conversationId, botId)
              else {
                const wasDm = conversation.memberBotIds.length === 1
                conversation2 = addConversationMember(crewState.crew, conversationId, botId)
                await persistCrew()
                // 私聊升级为群：把 dm 历史并入群转录，保证上下文连续
                if (wasDm && conversation2.memberBotIds.length > 1) {
                  const history = await readDm(botId === conversation2.memberBotIds[0] ? conversation2.memberBotIds[1] : conversation2.memberBotIds[0])
                  for (const message of history) {
                    await appendRoomMsg(conversation2.id, message)
                  }
                }
              }
            } catch (error) {
              throw new HttpError(400, safeError(error))
            }
            await persistCrew()
            respond(res, 200, { conversation: conversation2 }); return
          }
          if (method === 'POST' && convMatch[2] === 'chat') {
            const body = await readJsonBody(req)
            const text = String(body?.text || '').trim()
            if (!text) throw new HttpError(400, 'text 不能为空')
            await appendConversationMsg(conversation, { role: 'user', text })
            if (conversation.memberBotIds.length === 1) {
              const memberBot = crewState.crew.bots.find((entry) => entry.id === conversation.memberBotIds[0])
              const setupReply = memberBot ? await trySetupTurn(memberBot, text) : null
              if (setupReply) {
                await appendDm(memberBot.id, { role: 'bot', text: setupReply.reply }).catch(() => undefined)
                respond(res, 200, {
                  responder: publicBot(crewState.crew.bots.find((entry) => entry.id === memberBot.id) ?? memberBot),
                  reply: setupReply.reply,
                  handoffTo: null,
                  messages: await readConversationMsgs(conversationOf(conversationId)),
                }); return
              }
            }
            const result = await conversationTurn(conversation, text)
            respond(res, 200, {
              responder: publicBot(result.responder),
              reply: result.reply,
              handoffTo: result.handoffTo,
              messages: await readConversationMsgs(conversation),
            }); return
          }
        }
        if (method === 'GET' && suffix === '/skills') {
          const { readdir: rd } = await import('node:fs/promises')
          const files = (await rd(skillsDir).catch(() => [])).filter((name) => name.endsWith('.md')).sort()
          const skills = []
          for (const name of files) {
            const content = await readFile(join(skillsDir, name), 'utf8')
            skills.push({ name: name.replace(/\.md$/, ''), summary: (content.split('\n').find((line) => line.trim()) ?? '').replace(/^#+\s*/, '').slice(0, 80) })
          }
          respond(res, 200, { skills }); return
        }
        if (method === 'POST' && suffix === '/skills') {
          const body = await readJsonBody(req)
          const name = String(body?.name || '').trim().replace(/\.md$/, '')
          const content = String(body?.content || '').trim()
          if (!/^[A-Za-z0-9._-]+$/.test(name) || !content) throw new HttpError(400, 'name/content 非法')
          await atomicWrite(join(skillsDir, `${name}.md`), `${content}\n`)
          respond(res, 201, { skill: { name } }); return
        }
        const skillMatch = /^\/skills\/([^/]+)$/.exec(suffix)
        if (method === 'DELETE' && skillMatch) {
          const { rm } = await import('node:fs/promises')
          const name = decodeURIComponent(skillMatch[1]).replace(/\.md$/, '')
          if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new HttpError(400, 'name 非法')
          await rm(join(skillsDir, `${name}.md`), { force: true })
          respond(res, 200, { ok: true }); return
        }
        if (method === 'GET' && suffix === '/routines') {
          const state = await loadRoutinesState()
          respond(res, 200, {
            routines: crewState.crew.routines ?? [],
            lastRun: state,
          }); return
        }
        if (method === 'POST' && suffix === '/routines') {
          const body = await readJsonBody(req)
          let routine
          try {
            routine = upsertRoutine(crewState.crew, body)
          } catch (error) {
            throw new HttpError(400, safeError(error))
          }
          await persistCrew()
          respond(res, 201, { routine }); return
        }
        const routineMatch = /^\/routines\/([^/]+)(?:\/(test))?$/.exec(suffix)
        if (routineMatch) {
          const routineId = decodeURIComponent(routineMatch[1])
          if (method === 'PATCH' && !routineMatch[2]) {
            const body = await readJsonBody(req)
            let routine
            try {
              routine = upsertRoutine(crewState.crew, body, routineId)
            } catch (error) {
              throw new HttpError(400, safeError(error))
            }
            await persistCrew()
            respond(res, 200, { routine }); return
          }
          if (method === 'DELETE' && !routineMatch[2]) {
            try {
              removeRoutine(crewState.crew, routineId)
            } catch (error) {
              throw new HttpError(400, safeError(error))
            }
            await persistCrew()
            respond(res, 200, { ok: true }); return
          }
          if (method === 'POST' && routineMatch[2] === 'test') {
            const routine = crewState.crew.routines?.find((entry) => entry.id === routineId)
            if (!routine) throw new HttpError(404, `routine 不存在：${routineId}`)
            const job = await enqueueJob(inboxRoot, { toBot: routine.botId, text: `[routine ${routine.id} 试运行] ${routine.prompt}` })
            await appendRoutineHistory(routine.id, { kind: 'test', jobId: job.jobId })
            void scan()
            respond(res, 202, { job }); return
          }
        }
        if (method === 'PUT' && suffix === '/crew') {
          const body = await readJsonBody(req)
          const parsed = parseCrew(JSON.stringify(body))
          crewState.crew = parsed
          await atomicWrite(crewState.path, serializeCrew(parsed))
          respond(res, 200, { crew: parsed }); return
        }
        if (method === 'POST' && suffix === '/inbox') {
          const body = await readJsonBody(req)
          const text = String(body?.text || '').trim()
          if (!text && !(Array.isArray(body?.images) && body.images.length > 0)) {
            throw new HttpError(400, 'text 与 images 不能同时为空')
          }
          const job = await enqueueJob(inboxRoot, {
            toBot: String(body?.toBot || ''),
            text,
            images: Array.isArray(body?.images) ? body.images.map(String) : [],
          })
          void scan()
          respond(res, 202, { job }); return
        }
        const chatMatch = /^\/bots\/([^/]+)\/chat$/.exec(suffix)
        if (method === 'POST' && chatMatch) {
          const botId = decodeURIComponent(chatMatch[1])
          const bot = crewState.crew.bots.find((entry) => entry.id === botId)
          if (!bot) throw new HttpError(404, `bot 不存在：${botId}`)
          const body = await readJsonBody(req)
          const text = String(body?.text || '').trim()
          if (!text) throw new HttpError(400, 'text 不能为空')
          const state = botState(bot.id)
          state.status = 'working'
          try {
            const outcome = await chatTurn(bot, text)
            const reply = outcome.text?.trim()
            if (!reply) {
              const types = [...new Set(outcome.trace)].join(',')
              const reason = outcome.error ? `；${outcome.error}` : ''
              throw new HttpError(502, `stopReason=${outcome.stopReason}${reason}；events=[${types}]`)
            }
            if (outcome.error) {
              ctx.logger?.warn?.(`grokbot chat ${bot.id} 回复已产出但回合报错：${outcome.error}`)
            }
            respond(res, 200, { bot: publicBot(bot), reply, activity: outcome.activity }); return
          } finally {
            state.status = 'idle'
            state.lastActivity = Date.now()
          }
        }
        throw new HttpError(404, '接口不存在')
      } catch (error) {
        respond(res, Number(error?.status) || 500, { error: safeError(error) })
      }
    },
  }), 'grokbot: HTTP API')

  ctx.effect(() => () => {
    disposed = true
    clearInterval(rescanTimer)
    clearInterval(routineTimer)
    clearTimeout(debounceTimer)
    watcher?.close()
    chatHandles.clear()
    for (const session of [...activeSessions]) {
      void session.dispose()
    }
  }, 'grokbot: shutdown')
}

export default { name: 'grokbot', inject, apply }
