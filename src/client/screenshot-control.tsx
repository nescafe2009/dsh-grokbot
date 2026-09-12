import {useEffect,useRef,useState} from 'react'
import type {ClipboardEvent} from 'react'
export function useScreenshot({conversationId,draft,onDraft,sending}:{conversationId?:string;draft:string;onDraft:(v:string)=>void;sending?:boolean}) {
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[deadline,setDeadline]=useState(0),[seconds,setSeconds]=useState(0)
 const latest=useRef({conversationId,draft,onDraft});latest.current={conversationId,draft,onDraft}
 const controller=useRef<AbortController|null>(null),container=useRef<HTMLDivElement|null>(null)
 useEffect(()=>{setOpen(false);setError('');return()=>controller.current?.abort()},[conversationId])
 useEffect(()=>{if(!deadline)return;const tick=()=>setSeconds(Math.max(0,Math.ceil((deadline-Date.now())/1000)));tick();const t=setInterval(tick,200);return()=>clearInterval(t)},[deadline])
 useEffect(()=>{if(!open)return;const outside=(e:MouseEvent)=>{if(!container.current?.contains(e.target as Node))setOpen(false)};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false)}};document.addEventListener('mousedown',outside);document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',key,true)}},[open])
 const request=async(payload:Record<string,unknown>,path='/screenshots')=>{
  if(controller.current||!conversationId)return
  const id=conversationId,c=new AbortController();controller.current=c
  setBusy(true);setError('');setOpen(false)
  const delay=Number(payload.delay||0);setSeconds(delay);setDeadline(delay?Date.now()+delay*1000:0)
  try{
   const r=await fetch('/api/plugins/grokbot'+path,{method:'POST',signal:c.signal,headers:{'content-type':'application/json'},body:JSON.stringify({conversationId:id,...payload})})
   const data=await r.json();if(!r.ok)throw Error(data.error||'截图未完成，请重试')
   if(!c.signal.aborted&&latest.current.conversationId===id&&!data.cancelled)latest.current.onDraft(`${latest.current.draft}${latest.current.draft?'\n':''}[截图](${data.url})`)
  }catch(e){if(!c.signal.aborted&&latest.current.conversationId===id)setError(String((e as Error).message))}
  finally{if(controller.current===c){controller.current=null;setBusy(false);setDeadline(0);setSeconds(0)}}
 }
 const onPaste=(e:ClipboardEvent)=>{
  const file=[...e.clipboardData.items].find(i=>i.kind==='file'&&i.type==='image/png')?.getAsFile()
  if(!file||!conversationId)return
  e.preventDefault()
  if(busy)return
  if(file.size>12*1024*1024){setError('截图超过 12 MB，请缩小截图区域');return}
  const id=conversationId,reader=new FileReader()
  reader.onload=()=>{if(latest.current.conversationId===id)void request({image:reader.result},'/screenshots/import')}
  reader.onerror=()=>setError('无法读取剪贴板图片，请重新复制')
  reader.readAsDataURL(file)
 }
 const control=conversationId?<div className="gk-shot" ref={container}>
  <button type="button" className="gk-capture-button" onClick={()=>setOpen(v=>!v)} disabled={busy} aria-label="截图" aria-expanded={open} title="截图与粘贴"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 5 10 3h4l2 2h4v15H4V5Z"/><circle cx="12" cy="12" r="4"/></svg></button>
  {open?<div className="gk-shot-menu" role="group" aria-label="截图选项">
   <strong>截图</strong>
   <button type="button" onClick={()=>void request({mode:'screen',delay:5})}><span>5 秒后截图</span><small>先点击，再打开菜单栏弹窗</small></button>
   <button type="button" onClick={()=>void request({mode:'screen',delay:10})}><span>10 秒后截图</span><small>留出更多操作时间</small></button>
   <button type="button" onClick={()=>void request({mode:'region'})}><span>立即选择区域</span><small>适合普通窗口内容</small></button>
   <p>也可以在目标界面按 <kbd>⌃⇧⌘4</kbd> 截图到剪贴板，再回来按 <kbd>⌘V</kbd> 粘贴。</p>
  </div>:null}
 </div>:null
 const status=busy?<div className="gk-shot-status" role="status"><span>{seconds>0?`${seconds} 秒后自动截屏 · 现在打开要截取的菜单，无需返回此窗口`:'正在准备截图…'}</span><button type="button" onClick={()=>controller.current?.abort()}>取消</button></div>:error?<p className="gk-shot-error" role="alert">{error}</p>:null
 return {control,status,onPaste}
}
