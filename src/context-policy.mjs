import {createHash} from 'node:crypto'

// A projection, never a rewrite of durable project state. Decision-bearing
// fields remain verbatim; only evidence payloads become verifiable references.
export const CONTEXT_POLICY_VERSION = 1
const hash = value => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex')
const active = new Set(['running','queued','pending','claimed','approval','review','reworking','retesting','interrupted','failed'])
export function evidenceReference(projectId, revision, section, key, value) {
 return {tool:'team_context_read',conversation_id:projectId,expected_revision:revision,section,key,content_hash:hash(value),available:value!==undefined}
}
export function workingBoardContext(board, projectId) {
 const source=board.lifecycle||{}, revision=source.revision
 const ref=(section,key,value)=>evidenceReference(projectId,revision,section,key,value)
 const {history,iterations,snapshot,deliveryEvidence,reviews={},reworks={},...lifecycle}=source
 lifecycle.reviews=Object.fromEntries(Object.entries(reviews).map(([id,value])=>{
  const {evidence,...decision}=value
  return [id,{...decision,...(evidence!==undefined?{evidenceRef:ref('review',id,value)}:{})}]
 }))
 // Reasons and criteria are essential even when long: never summarize them.
 lifecycle.reworks=Object.fromEntries(Object.entries(reworks).map(([id,value])=>{
  const {evidence,...decision}=value
  return [id,{...decision,...(evidence!==undefined?{evidenceRef:ref('rework',id,value)}:{})}]
 }))
 const rows=board.rows||[], requiredJobs=new Set()
 for(const row of rows.filter(r=>r.source!=='job'))for(const key of ['latestJobId','repairJobId','testJobId'])if(row[key])requiredJobs.add(row[key])
 for(const rework of Object.values(reworks))for(const key of ['repairJobId','testJobId'])if(rework[key])requiredJobs.add(rework[key])
 const selected=rows.filter(r=>r.source!=='job'||active.has(r.status)||requiredJobs.has(r.id))
 const compactRows=selected.map(row=>{
  const {checkpoint,rework,...current}=row
  if(rework)current.reworkRef=ref('rework',row.id,reworks[row.id]??rework)
  if(checkpoint)current.checkpoint={blockers:checkpoint.blockers??null,remaining:checkpoint.remaining??null,evidenceRef:ref('checkpoint',row.id,checkpoint)}
  current.evidenceRef=ref('task',row.id,row)
  return current
 })
 return {...board,lifecycle,rows:compactRows,executionHistory:undefined,
  contextDetail:'working',contextPolicyVersion:CONTEXT_POLICY_VERSION,
  evidenceIndex:{lifecycle:ref('lifecycle','',source),delivery:ref('delivery','',deliveryEvidence),history:ref('executionHistory','',board.executionHistory||[])},
  historyOmitted:{taskRows:rows.length-selected.length,lifecycleEvents:history?.length||0,iterations:iterations?.length||0,note:'仅省略证据正文与已结束执行历史；原记录未改动。缺失不代表不存在，核验前按引用分页读取。'}}
}

export function selectContextEvidence(board, section, key='') {
 const lifecycle=board.lifecycle||{}
 switch(section){
  case 'lifecycle':return lifecycle
  case 'delivery':return lifecycle.deliveryEvidence
  case 'executionHistory':return board.executionHistory||[]
  case 'review':return Object.hasOwn(lifecycle.reviews||{},key)?lifecycle.reviews[key]:undefined
  case 'rework':return Object.hasOwn(lifecycle.reworks||{},key)?lifecycle.reworks[key]:undefined
  case 'task':return board.rows?.find(r=>r.id===key)
  case 'checkpoint':return board.rows?.find(r=>r.id===key)?.checkpoint
  default:throw Error('未知上下文证据类型')
 }
}
export function contextEvidencePage(board, params) {
 if(!Number.isSafeInteger(params.expected_revision)||params.expected_revision!==board.lifecycle?.revision)throw Error('CONTEXT_REVISION_CHANGED：重新读取当前项目状态，不得沿用旧版本证据')
 const value=selectContextEvidence(board,params.section,params.key)
 if(value===undefined)throw Error('CONTEXT_EVIDENCE_MISSING：证据不存在，不能推定核验通过')
 const contentHash=hash(value)
 if(typeof params.content_hash!=='string'||params.content_hash!==contentHash)throw Error('CONTEXT_CONTENT_CHANGED：证据已变化，重新获取引用')
 const text=JSON.stringify(value),offset=params.offset??0,limit=params.limit??8000
 if(!Number.isSafeInteger(offset)||offset<0||offset>text.length||!Number.isSafeInteger(limit)||limit<1||limit>12000)throw Error('上下文分页参数无效')
 const end=Math.min(text.length,offset+limit)
 return {revision:params.expected_revision,contentHash,offset,totalChars:text.length,content:text.slice(offset,end),complete:end===text.length,nextOffset:end<text.length?end:null,note:'content 是原始 JSON 的分页文本；读取全部页后解析，不把部分证据当作完整结论。'}
}

export function workingContextSize(brief) {
 const chars=JSON.stringify(brief).length
 return {policyVersion:CONTEXT_POLICY_VERSION,chars,tokenEstimate:null,overTarget:chars>32000,note:chars>32000?'必要信息超过简报目标，已完整保留；不得按长度丢弃授权、范围或阻塞。':'字符数不是 token 数；未以长度截断必要信息。'}
}
