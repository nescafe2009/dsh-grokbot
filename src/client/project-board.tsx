import {useEffect,useState} from 'react'
import type {ReactNode} from 'react'
export interface BoardRow {reviewMode?:'chief'|'user';rework?:{cycle:number;reason:string;criteria:string;ownerBotId?:string;testerBotId:string;repairJobId?:string;testJobId?:string;needsReview?:boolean}|null;id:string;title:string;botId:string;status:string;reason?:string;progress?:{observation:string;elapsedMs:number;silenceMs:number;reviewNeeded:boolean}|null;checkpoint?:{completed:string;files:string[];validation:string;remaining:string;blockers:string;verified:boolean}|null;dependsOn:string[];artifacts:number;source:string;taskId?:string}
interface Member {id:string;name:string;avatar?:string;roleTemplate?:string|null;status?:string}
export interface BoardData {conversationId:string;updatedAt:number;hasPlan:boolean;lifecycle?:{status:string;revision:number;summary:string};rows:BoardRow[]}
const labels:Record<string,string>={rework_required:'待返工',reworking:'返工中',rework_failed:'返工执行失败',awaiting_retest:'待复测',retesting:'复测中',retest_review:'复测待核验',retest_failed:'复测执行失败',held:'已停止派工',awaiting_acceptance:'交付待验收',planned:'待开始',blocked:'等待前置任务',queued:'排队中',running:'进行中',review:'幕僚长审核中',approval:'需要你审批',failed:'执行失败',cancelled:'已取消',done:'已验收',unknown:'待核实'}
export function ProjectBoard({conversationId,bots,load,onApproval}:{conversationId:string;bots:Member[];load:(id:string)=>Promise<BoardData>;onApproval:()=>void}):ReactNode {
 const [data,setData]=useState<BoardData|null>(null),[error,setError]=useState(''),[historyOpen,setHistoryOpen]=useState(false),[collapsed,setCollapsed]=useState(false)
 const storeData=(value:BoardData)=>setData(previous=>previous?.conversationId===value.conversationId&&(previous.lifecycle?.revision??0)>(value.lifecycle?.revision??0)?previous:value)
 useEffect(()=>{let alive=true,busy=false;setData(null);setError('');setHistoryOpen(false);setCollapsed(false)
  const tick=async()=>{if(busy)return;busy=true;try{const value=await load(conversationId);if(!value||value.conversationId!==conversationId||!Array.isArray(value.rows))throw Error('进度数据尚未就绪');if(alive){storeData(value);setError('')}}catch(e){if(alive)setError(String((e as Error).message))}finally{busy=false}}
  void tick();const timer=setInterval(()=>void tick(),3000);return()=>{alive=false;clearInterval(timer)}
 },[conversationId,load])
 const current=data?.conversationId===conversationId?data:null,rows=current?.rows??[]
 const tasks=current?.hasPlan?rows.filter(r=>r.source==='plan'):rows.filter(r=>r.source!=='live')
 const history=current?.hasPlan?rows.filter(r=>r.source!=='plan'):[]
 const done=tasks.filter(r=>r.source==='plan'&&r.status==='done').length
 const renderRow=(row:BoardRow,index:number)=>{
  const owner=bots.find(b=>b.id===row.botId)?.name||'未指定负责人'
  const deps=row.dependsOn.map(id=>tasks.findIndex(r=>r.id===id)+1).filter(n=>n>0)
  return <li key={`${row.source}:${row.id}`} data-status={row.status}>
   <span className="gk-board__number" aria-hidden="true">{row.status==='done'?'✓':['running','review'].includes(row.status)?'→':['failed','approval'].includes(row.status)?'!':'○'}</span>
   <div className="gk-board__item">
    <h3 title={row.title}>{index+1}. {row.title}</h3>
    <div className="gk-board__meta"><span>{owner}</span><span className="gk-board__status">{row.status==='done'&&row.source!=='plan'?'执行结束 · 待核实':row.status==='awaiting_acceptance'?(row.reviewMode==='chief'?'等待幕僚长核验':'等待审阅决定'):labels[row.status]||'待核实'}</span></div>
    {deps.length>0?<span className="gk-board__deps">前置：第 {deps.join('、')} 项</span>:null}
    {row.progress?<p>{({'active':'有执行进展','awaiting-tool':'等待工具返回','awaiting-approval':'等待审批','quiet':'暂未观察到新进展'} as Record<string,string>)[row.progress.observation]||row.progress.observation} · 已运行 {Math.floor(row.progress.elapsedMs/60000)} 分钟{row.progress.reviewNeeded?' · 建议检查进展（未自动停止）':''}</p>:null}
    {row.rework?<details><summary>第 {row.rework.cycle} 轮返工{row.rework.needsReview?' · 需要重新分析原因':''}</summary><p>退回原因：{row.rework.reason}</p><p>修复负责人：{bots.find(b=>b.id===(row.rework?.ownerBotId||row.botId))?.name||'待核实'}</p><p>复测要求：{row.rework.criteria}</p><p>复测负责人：{bots.find(b=>b.id===row.rework?.testerBotId)?.name||'待核实'}</p></details>:null}
    {row.checkpoint?<details><summary>工作检查点（待核实）</summary><p>已完成：{row.checkpoint.completed||'未记录'}</p><p>验证：{row.checkpoint.validation||'未记录'}</p><p>剩余：{row.checkpoint.remaining||'未记录剩余事项，仍需验收'}</p>{row.checkpoint.blockers?<p>阻塞：{row.checkpoint.blockers}</p>:null}<pre>{row.checkpoint.files.join('\n')}</pre></details>:null}
    {row.reason?<details><summary>{row.status==='failed'?'失败原因':'状态说明'}</summary><p>{row.reason}</p></details>:null}
    {row.status==='approval'?<button className="gk-board__approval" onClick={onApproval}>去幕僚长审批</button>:null}
   </div>
  </li>
 }
 return <aside className="gk-board" data-collapsed={collapsed} aria-label="群聊任务列表">
  <header><h2>任务</h2><span className="gk-board__count">{current?`${done} / ${tasks.length}`:'加载中'}</span><button className="gk-board__collapse" aria-label={collapsed?'展开任务列表':'收起任务列表'} aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)}>{collapsed?'⌄':'−'}</button></header>
  {!collapsed?<>
  {error?<p role="alert" className="gk-board__error">更新失败：{error}{current?'。当前显示上次记录。':''}</p>:null}
  {!current&&!error?<p className="gk-board__note">正在读取任务…</p>:null}
  {current?<>
   <p className="gk-board__note">{done} 项已验收，成员交付与执行结束不自动计入</p>
   {current.lifecycle?<section aria-label="项目生命周期">
    <p>项目状态：{({active:'进行中',paused:'已暂停',blocked:'阻塞',completed:'已完成',cancelled:'已取消',archived:'已归档'} as Record<string,string>)[current.lifecycle.status]}</p>
    {current.lifecycle.summary?<details><summary>状态记录</summary><p>{current.lifecycle.summary}</p></details>:null}
    <p className="gk-board__note">由幕僚长管理；需要审阅时会在对话中告诉你。暂停、继续或归档，直接告诉幕僚长。</p>
   </section>:null}
   <ol className="gk-board__tasks">{tasks.map(renderRow)}</ol>
   {!tasks.length?<p className="gk-board__note">尚未登记任务，请幕僚长安排计划。</p>:null}
   {history.length>0?<section className="gk-board__history"><button aria-expanded={historyOpen} onClick={()=>setHistoryOpen(v=>!v)}>{historyOpen?'收起':'查看'}其他执行记录（{history.length}）</button>{historyOpen?<ol className="gk-board__tasks">{history.map(renderRow)}</ol>:null}</section>:null}
  </>:null}
  </>:null}
 </aside>
}
export const BOARD_CSS=`
.grokbot-group-shell{display:flex;flex:1;min-width:0;min-height:0;height:100%;container-type:inline-size;font-family:var(--gk-font);color:var(--gk-text)}
.grokbot-group-shell>.grokbot-chat{flex:1;min-width:0}
.gk-board{box-sizing:border-box;width:300px;flex:none;overflow:auto;padding:20px 18px;border-left:1px solid var(--gk-line);background:var(--gk-bg-side);font-size:13px;line-height:1.5;scrollbar-width:thin}
.gk-board header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.gk-board h2{font-size:15px;font-weight:650;margin:0}.gk-board__count{font-size:12px;color:var(--gk-text-2);font-variant-numeric:tabular-nums}.gk-board progress{display:block;width:100%;height:4px;accent-color:var(--gk-text)}.gk-board__note{font-size:11px;color:var(--gk-text-2);margin:8px 0 12px}
.gk-board__tasks{list-style:none;margin:0;padding:0}.gk-board__tasks>li{display:flex;gap:10px;padding:14px 0;border-bottom:1px solid var(--gk-line)}.gk-board__number{font-variant-numeric:tabular-nums;min-width:19px;color:var(--gk-text-2);padding-top:1px}.gk-board__item{flex:1;min-width:0}.gk-board h3{font-size:13px;font-weight:550;margin:0 0 7px;overflow-wrap:anywhere;line-height:1.55}.gk-board__meta{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 10px;font-size:11px;color:var(--gk-text-2)}.gk-board__status{font-size:11px}.gk-board [data-status=running] .gk-board__status{color:#2256aa;font-weight:600}.gk-board [data-status=failed] .gk-board__status,.gk-board [data-status=approval] .gk-board__status,.gk-board__error{color:#a32929}.gk-board [data-status=done] .gk-board__status{color:#276c41}.gk-board__deps{display:block;margin-top:4px;color:var(--gk-text-2);font-size:11px}.gk-board details{font-size:11px;margin-top:6px;overflow-wrap:anywhere}.gk-board summary{cursor:pointer;min-height:26px;align-content:center}.gk-board details p{white-space:pre-wrap}
.gk-board textarea,.gk-board select{box-sizing:border-box;width:100%;font:inherit;color:var(--gk-text);background:var(--gk-bg);border:1px solid var(--gk-line);border-radius:6px;margin:4px 0;padding:6px}.gk-board textarea{min-height:58px;resize:vertical}.gk-board button:disabled{opacity:.5;cursor:default}
.gk-board button{font:inherit;cursor:pointer;border:1px solid var(--gk-line);border-radius:8px;background:var(--gk-bg);color:var(--gk-text);min-height:34px;padding:6px 10px}.gk-board button:hover{background:var(--gk-bg-soft)}.gk-board button:focus-visible,.gk-board summary:focus-visible{outline:2px solid var(--gk-accent);outline-offset:2px}.gk-board__approval{margin-top:8px}.gk-board__history{margin-top:18px}.gk-board__history>button{border:none;padding:4px 0;background:none;font-size:11px;color:var(--gk-text-2);text-align:left}
.gk-board-toggle{font:inherit;font-size:12px;border:1px solid var(--gk-line);border-radius:8px;background:var(--gk-bg);color:var(--gk-text);padding:8px;cursor:pointer;flex:none}
@container(max-width:760px){.grokbot-group-shell>.gk-board{width:270px}.grokbot-group-shell:has(>.gk-board)>.grokbot-chat .grokbot-chat__meta{display:none}}
@container(max-width:600px){.grokbot-group-shell{position:relative}.grokbot-group-shell>.gk-board{position:absolute;right:0;top:64px;bottom:0;width:min(300px,100%);z-index:20;box-shadow:var(--gk-shadow-md)}}
.grokbot-group-shell{position:relative}
.grokbot-group-shell:has(>.gk-board)>.grokbot-chat{margin-right:332px}
.grokbot-group-shell>.gk-board{position:absolute;right:16px;top:76px;bottom:auto;width:300px;max-height:calc(100% - 96px);padding:14px 16px;border:1px solid var(--gk-line);border-radius:16px;background:var(--gk-bg);box-shadow:0 2px 5px #00000012,0 8px 24px #00000005;z-index:10}
.gk-board header{justify-content:flex-start;gap:12px;margin:0}.gk-board h2{font-size:13px;font-weight:500;color:var(--gk-text-2)}.gk-board__count{font-size:12px}.gk-board button.gk-board__collapse{margin-left:auto;border:0;min-height:24px;width:24px;padding:0;font-size:17px;background:none;color:var(--gk-text-2)}
.gk-board__note{font-size:10px;margin:8px 0;color:var(--gk-text-2)}.gk-board__tasks>li{border:0;padding:9px 0;gap:8px}.gk-board__number{font-size:15px;min-width:16px;padding-top:0}.gk-board h3{font-size:12px;font-weight:400;line-height:1.55;margin:0 0 3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.gk-board__meta{font-size:10px;gap:4px 8px}.gk-board__status{font-size:10px}.gk-board__deps{display:none}.gk-board [data-status=done] h3{color:var(--gk-text-2)}.gk-board [data-status=running] .gk-board__number{color:var(--gk-text)}.gk-board [data-status=done] .gk-board__number{color:#276c41}.gk-board__history{margin-top:8px;border-top:1px solid var(--gk-line);padding-top:6px}
.grokbot-group-shell:has(>.gk-board[data-collapsed=true])>.grokbot-chat{margin-right:0}.grokbot-group-shell>.gk-board[data-collapsed=true]{width:170px;padding:10px 14px;border-radius:99px}
@container(max-width:900px){.grokbot-group-shell:has(>.gk-board)>.grokbot-chat{margin-right:0}.grokbot-group-shell>.gk-board{width:min(300px,calc(100% - 24px));right:12px;top:72px;max-height:calc(100% - 92px)}}
`
