import { watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadOrCreateCrew, routeJob, botWorkspace, serializeCrew, atomicWrite, parseCrew, createBot, updateBot, removeBot, duplicateBot } from './crew.mjs'
import { ensureInbox, scanInbox, claimJob, completeJob, failJob, enqueueJob } from './inbox.mjs'

const API_ROOT = '/api/plugins/grokbot'
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

export const inject = ['agents', 'webServer', 'agentDefaultModel']

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

export function apply(ctx, config = {}) {
  const stateDir = resolve(String(config.stateDir || join(process.cwd(), '.dsh-grokbot')))
  const inboxRoot = resolve(String(config.inboxDir || join(stateDir, 'inbox')))
  const maxConcurrentJobs = Math.max(1, Math.min(8, Number(config.maxConcurrentJobs) || 2))
  const jobTimeoutMs = Math.max(30_000, Number(config.jobTimeoutMs) || 600_000)
  const rescanIntervalMs = Math.max(1_000, Number(config.rescanIntervalMs) || 5_000)

  const crewState = { path: '', crew: { routing: { default: '' }, bots: [] } }
  const botStates = new Map()
  const chatHandles = new Map()
  const pendingJobs = []
  const runningJobs = new Map()
  const seenJobIds = new Set()
  const recentJobs = []
  let disposed = false
  let scanning = false

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
      `你的专属工作区目录：${botWorkspace(stateDir, bot)}（文件读写优先在这里进行）。`,
      '只汇报真实完成的操作，不要把工具调用伪装成普通文本。',
    ].join('\n')
  }

  async function init() {
    await mkdir(stateDir, { recursive: true })
    await ensureInbox(inboxRoot)
    // 共享电脑：全队一个 workspace（Grok Bot 语义）
    await mkdir(join(stateDir, 'workspace'), { recursive: true })
    const loaded = await loadOrCreateCrew(stateDir)
    crewState.path = loaded.path
    crewState.crew = loaded.crew
    for (const bot of crewState.crew.bots) {
      botState(bot.id)
    }
    ctx.logger?.info?.(`grokbot ready: ${crewState.crew.bots.length} bot(s), inbox=${inboxRoot}`)
  }

  async function persistCrew() {
    await atomicWrite(crewState.path, serializeCrew(crewState.crew))
  }

  const hydrated = init()

  // ---------- agent 会话 ----------

  const activeSessions = new Set()

  async function createBotAgent(bot) {
    const abort = new AbortController()
    const fallback = typeof ctx.agentDefaultModel?.currentSelection === 'function'
      ? ctx.agentDefaultModel.currentSelection()
      : null
    const selection = bot.model?.provider && bot.model?.model
      ? bot.model
      : (fallback?.provider && fallback?.model ? fallback : null)
    const handle = await ctx.agents.create({
      sessionId: randomUUID(),
      meta: { cwd: botWorkspace(stateDir, bot) },
      ...(selection ? { agentOptions: selection } : {}),
      signal: abort.signal,
      async setup(agentCtx) {
        agentCtx.systemPrompt.section({
          name: 'grokbot:identity',
          order: -20,
          text: personaPrompt(bot),
        })
      },
    })
    abort.signal.addEventListener('abort', () => {
      try { handle.agent.cancel({ kind: 'user' }) } catch { /* already settled */ }
    }, { once: true })
    const session = {
      handle,
      abort,
      dispose: async () => {
        activeSessions.delete(session)
        try { handle.agent.cancel({ kind: 'user' }, { keepInbox: true }) } catch { /* best effort */ }
        try { await handle.dispose() } catch { /* best effort */ }
      },
    }
    activeSessions.add(session)
    return session
  }

  async function chatTurn(bot, text) {
    let session = chatHandles.get(bot.id)
    if (!session) {
      session = await createBotAgent(bot)
      chatHandles.set(bot.id, session)
    }
    await session.handle.agent.whenIdle()
    const firstSeq = session.handle.agent.session.seq
    session.handle.agent.followup(userMessage(text))
    await session.handle.agent.whenIdle()
    return summarizeTurn(session.handle.agent.session.events, firstSeq)
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
          respond(res, 200, {
            bots: crewState.crew.bots.map(publicBot),
            running: [...runningJobs.entries()].map(([jobId, entry]) => ({ jobId, ...entry })),
            queueDepth: pendingJobs.length,
            recentJobs,
            config: { inboxRoot, stateDir, maxConcurrentJobs, jobTimeoutMs },
          }); return
        }
        if (method === 'GET' && suffix === '/crew') {
          respond(res, 200, { crew: crewState.crew }); return
        }
        if (method === 'POST' && suffix === '/bots') {
          const body = await readJsonBody(req)
          let bot
          try {
            bot = createBot(crewState.crew, body)
          } catch (error) {
            throw new HttpError(400, safeError(error))
          }
          await persistCrew()
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
          respond(res, 201, { bot: publicBot(bot) }); return
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
            respond(res, 200, { bot: publicBot(bot), reply }); return
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
    clearTimeout(debounceTimer)
    watcher?.close()
    chatHandles.clear()
    for (const session of [...activeSessions]) {
      void session.dispose()
    }
  }, 'grokbot: shutdown')
}

export default { name: 'grokbot', inject, apply }
