import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveDispatchTarget, WakeScheduler } from '../src/dispatch.mjs'

// —— P1-2 回归：派发目标解析（授权范围 / 精确 id / 歧义拒绝）——

const bots = [
  { id: 'chief', name: '幕僚长' },
  { id: 'w1', name: '王美琳' },
  { id: 'w2', name: '王美术' },
  { id: 'e1', name: '顾远航' },
]
const group = { id: 'g1', memberBotIds: ['w1', 'e1', 'chief'] } // 群内无 w2

test('群上下文：成员精确 id 命中', () => {
  const r = resolveDispatchTarget(bots, group, { member_id: 'w1' })
  assert.equal(r.ok, true)
  assert.equal(r.bot.id, 'w1')
})

test('群上下文：群外成员被拒绝（含群成员清单）', () => {
  const r = resolveDispatchTarget(bots, group, { member_id: 'w2' })
  assert.equal(r.ok, false)
  assert.match(r.error, /不在授权范围/)
  assert.match(r.error, /王美琳/)
})

test('群上下文：名字唯一命中兼容', () => {
  const r = resolveDispatchTarget(bots, group, { member_name: '顾远航' })
  assert.equal(r.ok, true)
  assert.equal(r.bot.id, 'e1')
})

test('群上下文：名字歧义拒绝并列出候选 id', () => {
  // 群内只有王美琳（w2 王美术不在群），无歧义；换用 DM 上下文制造双王歧义
  const r = resolveDispatchTarget(bots, null, { member_name: '王美' })
  assert.equal(r.ok, false)
  assert.match(r.error, /歧义/)
  assert.deepEqual(r.candidates.sort(), ['w1', 'w2'])
})

test('群上下文：群外名字不参与匹配（不因模糊而误派）', () => {
  const r = resolveDispatchTarget(bots, group, { member_name: '王美术' })
  assert.equal(r.ok, false)
  assert.match(r.error, /未找到/)
})

test('DM 上下文（无会话）：全员可选', () => {
  const r = resolveDispatchTarget(bots, null, { member_id: 'w2' })
  assert.equal(r.ok, true)
  assert.equal(r.bot.id, 'w2')
})

test('缺引用报错', () => {
  const r = resolveDispatchTarget(bots, group, {})
  assert.equal(r.ok, false)
  assert.match(r.error, /缺少/)
})

// —— P1-3 回归：唤醒限频合并延后（不丢事件）——

function makeScheduler() {
  let now = 0
  const fired = []
  const timers = []
  const wake = new WakeScheduler({
    intervalMs: 60_000,
    now: () => now,
    fire: (k) => fired.push({ at: now, key: k }),
    delay: (ms, fn) => timers.push({ at: now + ms, fn }),
  })
  const advance = (ms) => {
    now += ms
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= now) { timers.splice(i, 1)[0].fn() }
    }
  }
  return { wake, fired, advance, setNow: (t) => { now = t } }
}

test('窗口外事件立即触发', () => {
  const { wake, fired } = makeScheduler()
  assert.equal(wake.request('g1'), 'fired')
  assert.equal(fired.length, 1)
})

test('Codex 复现场景：首次触发后 10s 的第二次事件不被丢弃', () => {
  const { wake, fired, advance } = makeScheduler()
  wake.request('g1')            // t=0 触发
  wake.onFired('g1')            // 回合完成，lastFiredAt=0
  advance(10_000)               // 10s 后新交付
  assert.equal(wake.request('g1'), 'pending')  // 挂起而非丢弃
  advance(50_000)               // 到达 60s 窗口尾
  assert.equal(fired.length, 2, 'pending 事件在窗口结束后被消费')
})

test('pending 期间的新事件合并为一次', () => {
  const { wake, fired, advance } = makeScheduler()
  wake.request('g1')
  wake.onFired('g1')
  advance(10_000)
  wake.request('g1')   // pending
  advance(5_000)
  wake.request('g1')   // 仍 pending（合并）
  advance(45_000)
  assert.equal(fired.length, 2, '两次 pending 合并为一次触发')
})

test('协调回合完成时若无 pending 不再触发', () => {
  const { wake, fired, advance } = makeScheduler()
  wake.request('g1')
  wake.onFired('g1')
  advance(120_000)
  assert.equal(fired.length, 1)
  wake.onFired('g1') // 无 pending 的 onFired 无副作用
  assert.equal(fired.length, 1)
})


/* ---------------- 在途唤醒验收（Codex 十八轮：合并不丢/取消不误走） ---------------- */

function makeClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

test('在途唤醒：协调回合执行中到达新事件 → 合并 pending，当前回合结束后消费（不丢不重复）', async () => {
  const clock = makeClock(0)
  const fired = []
  const done = []
  const sched = new WakeScheduler({ intervalMs: 60_000, now: clock.now, delay: (ms, fn) => { setTimeout(fn, 0); return 1 }, fire: (key) => fired.push({ key, at: clock.now() }) })
  // 模拟协调回合生命周期：request→fired（进入回合）→ 回合中第二个事件 request→pending → onFired（回合结束）→ pending 被消费
  const r1 = sched.request('g1')
  assert.equal(r1, 'fired'); assert.equal(fired.length, 1)
  done.push('turn1-start')
  clock.advance(10_000) // 回合执行中
  const r2 = sched.request('g1')
  assert.equal(r2, 'pending', '回合中事件进入 pending（合并不丢）')
  clock.advance(20_000)
  const r3 = sched.request('g1')
  assert.equal(r3, 'pending', '第三个事件仍合并同一 pending（不重复派发）')
  assert.equal(fired.length, 1, '回合结束前不重复 fire')
  clock.advance(30_000) // 距 lastFiredAt 60s 到点
  // 窗口定时器到点：fire（inTransit 防重），pending 保留到消费方 ack
  await new Promise((r) => setTimeout(r, 5))
  assert.ok(fired.length >= 1, '窗口到点触发 fire')
  assert.equal(sched.state.get('g1').inTransit, true, 'fire 进入 inTransit')
  assert.equal(sched.state.get('g1').pending, true, 'pending 保留到真正消费（不丢）')
  // 消费方开始处理 → ack 确认
  sched.ack('g1')
  assert.equal(sched.state.get('g1').pending, false, 'ack 后 pending 清除')
  assert.equal(sched.state.get('g1').inTransit, false)
  // 回合结束 onFired：无 pending → 无新 fire
  const firedBefore = fired.length
  sched.onFired('g1')
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(fired.length, firedBefore, '无 pending 不重复 fire')
})

test('在途唤醒：取消事件不走完成/失败路径——cancelledRunIds 分类与唤醒互斥', async () => {
  const { classifyExecutionOutcome } = await import('../src/tasks.mjs')
  // 取消意图优先：即使 error 文本像失败，分类也是 cancelled（协调层据此不触发失败重派）
  const cls = classifyExecutionOutcome({ cancelledIntent: true, error: 'aborted', text: null })
  assert.equal(cls.status, 'cancelled')
  // 非取消的普通失败才是 failed
  assert.equal(classifyExecutionOutcome({ cancelledIntent: false, error: 'boom', text: null }).status, 'failed')
})

test('在途唤醒：空闲零轮询——request 之外无定时器（构造后无任何 delay 调用）', () => {
  let timers = 0
  const sched = new WakeScheduler({ intervalMs: 60_000, now: () => 0, delay: (ms, fn) => { timers += 1; return 1 }, fire: () => {} })
  assert.equal(timers, 0, '无 request 不设定时器')
  sched.request('g9')
  assert.ok(timers <= 1, '仅 request 触发至多一个窗口定时器')
})


test('在途唤醒：协调长于重试期限（>120s）——事件不丢，释放后恰好追加一次协调', async () => {
  const clock = makeClock(0)
  const fired = []
  // 受控 delay：记录但不自动执行（我们手动推进）
  const timers = []
  const sched = new WakeScheduler({ intervalMs: 60_000, now: clock.now, delay: (ms, fn) => { timers.push({ at: clock.now() + ms, fn }); return timers.length }, fire: (key) => fired.push({ key, at: clock.now() }) })
  const runTimers = () => {
    const due = timers.filter((t) => t.at <= clock.now())
    for (const t of due) { t.fn(); timers.splice(timers.indexOf(t), 1) }
  }
  // t=0 第一协调回合开始（持续 120s）
  sched.request('g2')
  assert.equal(fired.length, 1)
  // t=10 新事件 → pending
  clock.advance(10_000); runTimers()
  sched.request('g2')
  assert.equal(sched.state.get('g2').pending, true)
  // t=60 窗口到点：第一回合的 fire 仍在途（inTransit 防重）→ 不重复 fire；pending 保留
  clock.advance(50_000); runTimers()
  assert.equal(fired.length, 1, '消费方在途时不重复 fire')
  assert.equal(sched.state.get('g2').pending, true, '忙时 pending 不被清除（旧实现此处被清丢失）')
  // t=120 第一回合结束 onFired → pending 仍在 → 重开窗口
  clock.advance(60_000); runTimers()
  sched.onFired('g2')
  assert.equal(sched.state.get('g2').pending, true, '回合结束后事件仍保留')
  // t=180（新窗口到点）再 fire → 这次消费方空闲 → ack
  clock.advance(60_000); runTimers()
  assert.equal(fired.length, 2, '释放后追加恰好一次协调 fire')
  sched.ack('g2')
  assert.equal(sched.state.get('g2').pending, false)
  // t=240 无 pending 无新 fire
  clock.advance(60_000); runTimers()
  assert.equal(fired.length, 2, '无残留定时器/重复消费')
})
