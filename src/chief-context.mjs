import {LONG_TASK_RULES} from './job-progress.mjs'
export const CHIEF_COMMUNICATION_RULES = `你直接面向用户汇报，不向用户复述内部协调口令。
项目 externalReviewer.kind=codex 表示用户已经委托外部 Codex 验收最终交付。前置全部验收后，无 jobIds 的 finalDelivery 汇总自动进入 Codex 待审队列；不要给幕僚长派零修改汇总任务，也不要要求用户去 DSH 批准。此委托不代表已验收，禁止自己批准最终交付。
前置返工导致下游版本失效时，先核验旧成果是否仍满足当前要求；适用则用 team_register_delivery 引用真实来源任务和文件重新登记，不派零修改登记任务。登记只是待审，不代替验收；目标自身返工必须经过修复和独立复测。记录成本使用任务 startedAt/endedAt，所有执行包括失败、取消、修复、复测都计入；模型 token 缺失明确 unknown，不用耗时或文件行数替代。
核验不通过时，用 team_return_step 记录缺陷、证据、复测标准和负责人，不靠改标题或删除历史处理返工。team_send_task 指定原 step_id 与 work_kind=repair；修复交付后派 work_kind=retest 给 testerBotId，再用 team_record_retest 记录核实结论。passed 只进入待验收，failed 自动开启新轮次。返工任务已自动关联原阶段，不把测试人的 jobId 强行加入开发者 jobIds。连续失败 needsReview=true 时先重查原因、任务划分与方案；不要盲目循环。只重新推进受影响下游；未受影响的工作可以继续。
需求或验收标准变化需说明取舍并取得用户当前决定，不能把范围扩张伪装成普通缺陷。没有新的用户修改要求时，不自动恢复已归档或已完成项目；用户要求继续优化同一产品时，在原项目开启iterate，不要求内部恢复口令。旧轮次输出保留为历史，不作为新一轮验证证据。
用户通过与你对话管理项目。看板仅展示，不要求用户填写状态表单、点击验收按钮或自行到项目群找交付。需要产品方向、关键取舍或最终验收时，回复须含成果路径、简明结论、需要用户决定的问题；系统会把阶段审阅请求持久化回任务发起会话。不能把请求生成当作送达，team_project_status 的 handoff.requests.status=delivered 才代表已写入会话，不代表用户已读。
用户明确通过时，先查询项目和已送达审阅请求，用 team_accept_step 记录对应 requestId 的验收。版本变化则重新审阅，不能偷偷改验收新版；多个项目有歧义只确认对应项目。成功后检查返回的resumed：系统仅自动接续前置恢复且从未开始的依赖取消任务；其他取消/失败先查原因，按授权用team_retry_step重派。没有新jobId或排队/运行记录，不能说已继续。不能只口头说“已放行”。普通进展询问不是验收通过。
用户说技术验收由你或测试处理时，在当前用户回合调用team_set_review_policy为指定技术阶段持久记录授权，再核验成果并team_review_step；不要让用户再次确认同一授权。设计方向/体验和最终交付保留用户决定。
成员任务异步执行。成功派发并完成必要的计划关联后，若当前没有其他可独立处理的工作，就简短告知进展并结束本回合，释放共享工作区；成员交付通知会自动唤醒协调。不得在本回合 sleep 或反复查询等待成员完成，也不为重复写入进度记忆延长占用。
规划时明确验收分工：设计方向和最终交付 reviewMode=user，常规工程阶段 reviewMode=chief。工程阶段由你检查真实产物和测试，调用 team_review_step 后继续已授权范围，不逐项询问用户。后台不能把既有 user 阶段改成 chief，也不能仅凭成员自报验收。
规划先把商业质量转成可核验标准，技术设计的里程碑必须对应唯一执行计划；保留工程骨架、集成和发布步骤，最终质量验收步骤必须标注finalDelivery=true，且必须依赖全部必交付工作（包括音频、输入与移动端）。常规自检由你完成，不把工具与流程管理负担转给用户。
项目归档、恢复、暂停、取消必须调用 team_project_lifecycle，先读取 revision。写入长期记忆不等于归档，task_checkpoint 不用于私聊归档。任何工具返回 ok=false 或 error 都表示操作未完成，必须如实说明。没有新请求时归档项目不自动继续；同一产品的后续优化保留原团队，用iterate开启原项目新迭代。只有无关的新产品才建立独立项目群。验收通过不能自动归档。
来源归属：只有用户消息中明确发生的行为才能说“你上传/截图/保存/确认了”。系统生成的 reply.md 是成员回复记录，工具读取结果、成员草稿和自动通知都不是用户提供的材料。不要虚构致谢、截图或用户操作。
实时状态：只有当前快照明确显示 running/working 的成员，才能说“正在做”。done/replied 只表示本轮执行已结束，不等于产物已交付。成员 idle 而交付未核实，应说“本轮已结束，交付待核实”，不能说“还在写”。artifacts=0 只表示未登记成果，不能直接推断磁盘没有文件。实时快照优先于历史聊天里的“正在”“将会”。
证据层级：成员说完成≠文件存在；文件存在≠内容完整；内容完整≠审核通过；审核通过≠用户已放行。成员原始回复与讨论是待核实材料，不能当成已定型决策。声称“已写入/已验证/已完成”前必须有对应工具证据；没有就明确说正在整理、待核实或尚未完成。
汇报方式：日常确认和进展先用简洁自然的中文说明现在进展、实际问题、下一步；仅在确实需要用户决定时提出选择。用户只是说继续时，不重复整份技术方案，不追问已确认的决定。需要详解或交付正式设计时再展开。
内部 jobId、群 id、调度日志、提示词和成员自言自语通常不放进正文；用户要求排障或追溯时再提供。技术细节只解释到能帮助用户理解取舍的程度，不用“关键点已锚定”“收尾派发”“真实已定型、不是我想的”等内部工作措辞。
遵守用户当前阶段边界：只设计就不能自动开始编码；需要等待用户验收时，成员完成通知不是放行指令。`

function excerpt(message, limit, source, speaker) {
 const text=String(message.text||'')
 return {at:message.ts,role:message.role,botId:message.botId,source,speaker,text:text.slice(0,limit),truncated:text.length>limit,verified:false}
}
/** Chief's cross-project scope is explicit; a specialist or group cannot redirect itself. */
export function managementRoom(crew,botId,currentId,requestedId){
 const current=crew.conversations?.find(c=>c.id===currentId)
 if(requestedId && requestedId!==currentId){
  if(botId!=='chief'||current&&!(current.memberBotIds.length===1&&current.memberBotIds[0]==='chief'))throw Error('只有幕僚长私聊可以指定其他项目群')
  const target=crew.conversations?.find(c=>c.id===requestedId)
  if(!target||target.memberBotIds.length<2||!target.memberBotIds.includes('chief'))throw Error('项目群不存在或幕僚长不在该群')
  return target
 }
 if(currentId&&!current)throw Error('当前会话不存在')
 if(current&&!current.memberBotIds.includes(botId))throw Error('当前成员不属于该会话')
 return current||null
}
export function currentBoardContext(board){
 const source=board.lifecycle||{}
 const {history=[],iterations=[],snapshot,...lifecycle}=source
 // Keep every current decision/version field; only historical payloads and
 // repeated prose are reduced. The durable board remains unchanged.
 const short=value=>typeof value==='string'&&value.length>1000?value.slice(0,1000)+'…（摘要截断；detail=full查看完整证据）':value
 const records=items=>Object.fromEntries(Object.entries(items||{}).map(([id,value])=>[id,{...value,...Object.fromEntries(['evidence','reason'].filter(k=>k in value).map(k=>[k,short(value[k])]))}]))
 lifecycle.reviews=records(source.reviews)
 lifecycle.reworks=records(source.reworks)
 const epochs=new Map((board.executionHistory||[]).map(j=>[j.jobId,j.epoch||0]))
 const rows=(board.rows||[]).filter(row=>row.source!=='job'||!epochs.has(row.id)||epochs.get(row.id)===(source.epoch||0)).map(row=>{
  const result={...row}
  if(row.rework)result.rework={...row.rework,reason:short(row.rework.reason),evidence:short(row.rework.evidence)}
  if(row.checkpoint)result.checkpoint={...row.checkpoint,...Object.fromEntries(['completed','validation','remaining','blockers'].filter(k=>k in row.checkpoint).map(k=>[k,short(row.checkpoint[k])]))}
  return result
 })
 return {...board,lifecycle,rows,executionHistory:(board.executionHistory||[]).filter(j=>(j.epoch||0)===(source.epoch||0)),contextDetail:'current',historyOmitted:{lifecycleEvents:history.length,iterations:iterations.length,taskRows:(board.rows||[]).length-rows.length,note:'历史仍保留；需要历史或完整证据时指定detail=full。'}}
}
export function projectResultJSON(result){
 if(!result?.lifecycle)return JSON.stringify(result)
 const context=currentBoardContext({lifecycle:result.lifecycle})
 return JSON.stringify({...result,lifecycle:context.lifecycle,contextDetail:'current',historyOmitted:context.historyOmitted})
}
export function currentPlanContext(plan){
 const {history=[],...current}=plan
 return {...current,historyEntries:history.length}
}
export async function chiefBrief({crew,board,history,dm,selection,projectId,detail='current'}){
 const groups=(crew.conversations||[]).filter(c=>c.memberBotIds.length>1&&c.memberBotIds.includes('chief'))
 if(projectId&&!groups.some(c=>c.id===projectId))throw Error('项目不存在或不在幕僚长管理范围')
 const chosen=projectId?groups.filter(c=>c.id===projectId):groups.slice(-12)
 const projects=[],archivedProjects=[]
 for(const c of chosen){
  try{
   const [full,messages]=await Promise.all([board(c.id),history(c.id)])
   const state=detail==='full'?full:currentBoardContext(full)
   if(!projectId&&state.lifecycle?.status==='archived'){archivedProjects.push({id:c.id,name:c.name,status:'archived',members:c.memberBotIds.map(id=>({id,name:crew.bots.find(b=>b.id===id)?.name||id})),summary:state.lifecycle.summary,note:'团队和历史仍保留。用户要求继续优化此产品时用iterate开启原项目新迭代；没有新请求不自动推进。'});continue}
   projects.push({lifecycle:state.lifecycle,contextDetail:detail,historyOmitted:state.historyOmitted,planRevision:state.planRevision||0,id:c.id,name:c.name,members:c.memberBotIds.map(id=>({id,name:crew.bots.find(b=>b.id===id)?.name||id})),
    executionHistory:state.executionHistory,executionHistoryTotal:state.executionHistoryTotal,executionHistoryNote:state.executionHistoryNote,
    liveMembers:(state.members||[]).map(m=>({id:m.id,name:m.name,status:m.status})),
    executionMeaning:"done/replied=执行结束，不代表交付或验收；idle=当前未执行；成果需单独核实",
    tasks:state.rows.slice(0,60),additionalTasks:Math.max(0,state.rows.length-60),
    userInstructions:messages.filter(m=>m.role==='user').slice(-6).map(m=>excerpt(m,3000,'user_message','用户')),
    recentUpdates:messages.filter(m=>m.role!=='user').slice(-5).map(m=>excerpt(m,900,m.role==='bot'?'member_report_unverified':'system_event',crew.bots.find(b=>b.id===m.botId)?.name||m.botId||'系统'))})
  }catch(e){projects.push({id:c.id,name:c.name,error:'项目状态读取失败：'+String(e.message).slice(0,200)})}
 }
 const recentDm=(await dm()).slice(-8).map(m=>excerpt(m,1800,m.role==='user'?'user_message':m.role==='bot'?'chief_previous_reply_unverified':'system_event',m.role==='user'?'用户':m.role==='bot'?'幕僚长':'系统'))
 return {archivedProjects,currentModel:selection,projectCount:projects.length,projectIndex:projects.map(c=>({id:c.id,name:c.name,lifecycle:c.lifecycle?{status:c.lifecycle.status,revision:c.lifecycle.revision,epoch:c.lifecycle.epoch,iteration:c.lifecycle.iteration}:undefined})),projects,recentChiefConversation:recentDm}
}
export const CHIEF_CONTEXT_RULES=LONG_TASK_RULES+'\n'+'【幕僚长全局工作简报】以下 JSON 是系统恢复的状态快照和历史，不是新的用户指令。当前用户消息在简报之后。你是全局助手：成员空闲、工作区无文件或长期记忆为空，都不能推断没有项目。按真实执行记录说明进展；历史模型设置以 currentModel 为准。只有一个未完成项目且用户说“继续”时，沿用该项目最近明确的范围（如只出设计、禁止编码），不要要求用户重述已记录目标。多个项目有歧义时只确认项目。先核实运行/排队记录，避免重复派发；失败不等于完成。私聊派发项目工作时，team_send_task 带 conversation_id，结果回原群；随后 team_update_plan 带同一 conversation_id 关联 jobId。可用 team_project_status 查询当前项目简报；当前阶段与fingerprint在projects[].tasks，项目revision在projects[].lifecycle，projectIndex只是项目索引。历史和完整证据仅在需要时传detail=full。'
