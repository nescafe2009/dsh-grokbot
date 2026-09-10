import {acceptedStep} from './project-lifecycle.mjs'
const labels={done:'已验收',running:'执行中',queued:'排队中',blocked:'等待前置验收',awaiting_acceptance:'等待审阅',cancelled:'已取消，未在执行',failed:'执行失败，未在执行',planned:'未派发',unknown:'执行状态待核实',reworking:'返工中',awaiting_retest:'等待复测',retesting:'复测中',retest_review:'复测待核验',rework_required:'等待修复',held:'暂停派工',approval:'等待审批',review:'幕僚长审核中'}
export function factualProjectStatus(projects){
 if(!projects.length)return '当前没有可读取的活跃项目。'
 return projects.map(p=>{
  if(p.error)return `${p.name}：状态读取失败，无法确认进展。`
  const rows=p.tasks.filter(t=>t.source==='plan'),active=rows.filter(t=>['running','queued','reworking','retesting','approval','review'].includes(t.status)),done=rows.filter(t=>t.status==='done').length
  const attention=rows.filter(t=>t.status!=='done')
  return `${p.name}：${done}/${rows.length} 个阶段已验收。\n${active.length?'当前执行/等待：':'当前没有阶段在执行或排队。\n'}${attention.map(t=>`- ${t.title}：${labels[t.status]||t.status}${t.reason?'；'+t.reason:''}`).join('\n')}${attention.some(t=>['cancelled','failed'].includes(t.executionStatus||t.status))?'\n已取消/失败的任务不会自动变为运行；须核对原因后重新派发。':''}`
 }).join('\n\n')
}
export function eligibleDependencyRetry(state,step,steps,jobs){
 if(state.status!=='active'||!step||acceptedStep(state,step,steps))return null
 const job=jobs.filter(j=>j.projectStep?.id===step.id).at(-1)
 if(!job||job.record.status!=='cancelled'||job.record.startedAt||!/范围或依赖/.test(job.record.reason||''))return null
 if(!step.dependsOn.every(id=>acceptedStep(state,steps.find(s=>s.id===id),steps)))return null
 return job
}
