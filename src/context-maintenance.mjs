import {createHash} from 'node:crypto'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function eventId(value){return value===null||value===undefined||value===''?null:String(value)}

function resultCallIds(event) {
  return [...new Set([
    eventId(event?.data?.message?.source?.callId),
    ...(event?.data?.message?.content||[]).filter(item=>item?.type==='tool-result').map(item=>eventId(item?.toolCallId)),
    eventId(event?.data?.callId),
  ].filter(id=>id!==null))]
}

/** Refuse maintenance while the append-only event stream has ambiguous tools. */
export function contextEventIntegrity(events = []) {
  const calls = new Map(), results = new Map()
  const malformedCalls=[],malformedResults=[],conflictingResults=[]
  for (const [index,event] of events.entries()) {
    if (event?.type === 'tool/call') {
      const id=eventId(event.data?.callId)
      if(id===null)malformedCalls.push(index)
      else calls.set(id, (calls.get(id) || 0) + 1)
    }
    if (event?.type === 'tool/result') {
      const ids=resultCallIds(event)
      if(ids.length===0)malformedResults.push(index)
      else if(ids.length>1)conflictingResults.push({index,ids})
      else results.set(ids[0], (results.get(ids[0]) || 0) + 1)
    }
  }
  const duplicateCalls = [...calls].filter(([, count]) => count !== 1).map(([id]) => id)
  const duplicateResults = [...results].filter(([, count]) => count !== 1).map(([id]) => id)
  const unmatchedCalls = [...calls].filter(([id]) => !results.has(id)).map(([id]) => id)
  const orphanResults = [...results].filter(([id]) => !calls.has(id)).map(([id]) => id)
  return {
    ok: !duplicateCalls.length && !duplicateResults.length && !unmatchedCalls.length && !orphanResults.length&&!malformedCalls.length&&!malformedResults.length&&!conflictingResults.length,
    calls: calls.size,
    results: results.size,
    duplicateCalls,
    duplicateResults,
    unmatchedCalls,
    orphanResults,
    malformedCalls,
    malformedResults,
    conflictingResults,
  }
}

/** Only decision-bearing state participates in the before/after guard. */
export function contextDecisionManifest(brief) {
  if(!brief||typeof brief!=='object')throw Error('CONTEXT_AUTHORITY_INCOMPLETE：权威简报不可用')
  const failures=[...(brief.projects||[]),...(brief.projectIndex||[])].filter(project=>project?.error)
  if(failures.length)throw Error(`CONTEXT_AUTHORITY_INCOMPLETE：${failures.map(project=>project.id||'unknown').join(',')} 读取失败`)
  const projects = (brief?.projects || []).map(project => ({
    id: project.id,
    lifecycle: project.lifecycle,
    planRevision: project.planRevision,
    tasks: project.tasks,
    userInstructions: project.userInstructions,
    handoff: project.handoff,
  }))
  const authority={
    sessionScope:brief.sessionScope||null,
    currentModel:brief.currentModel||null,
    recentChiefConversation:brief.recentChiefConversation||[],
    chiefInstructionHistory:brief.chiefInstructionHistory||null,
    roleDirectives:brief.roleDirectives||null,
    archivedProjects:brief.archivedProjects||[],
    archivedProjectCount:brief.archivedProjectCount??(brief.archivedProjects||[]).length,
  }
  return {
    version: 2,
    hash: digest({projectIndex:brief?.projectIndex || [], projects,authority}),
    projectCount: projects.length,
    projectIds: projects.map(project => project.id),
    sessionScope:authority.sessionScope,
  }
}

export async function compactWithDecisionGuard({agent, compaction, signal, sourceCommandId, readBrief, events}) {
  if (!agent || typeof agent.whenIdle !== 'function') throw Error('上下文会话不可用')
  if (!compaction || typeof compaction.compactNow !== 'function') throw Error('DSH 原生压缩服务不可用')
  await agent.whenIdle()
  const integrity = contextEventIntegrity(events())
  if (!integrity.ok) throw Error(`CONTEXT_EVENT_INTEGRITY：工具事件不完整，拒绝压缩（${JSON.stringify(integrity)}）`)
  const before = contextDecisionManifest(await readBrief())
  const result = await compaction.compactNow(agent, signal, sourceCommandId)
  const after = contextDecisionManifest(await readBrief())
  if (after.hash !== before.hash) {
    const error=Error('CONTEXT_DECISIONS_CHANGED：压缩已提交，但期间权威状态发生变化；下轮必须重新注入并核对')
    error.code='CONTEXT_DECISIONS_CHANGED'
    error.committed=result!==null
    error.compactionResult=result
    error.beforeManifest=before
    error.afterManifest=after
    throw error
  }
  return {
    compacted: result !== null,
    shadowedItems: result?.shadowedSeqs?.length || 0,
    shadowedTokens: result?.shadowedTokenCount ?? null,
    summarySeq: result?.summarySeq ?? null,
    integrity,
    decisionManifest: after,
    authorityStable:true,
    semanticProbe:'not_run',
  }
}
