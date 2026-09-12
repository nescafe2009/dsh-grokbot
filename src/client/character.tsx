import {memo,useEffect,useRef,useState} from 'react'
import {identityParts} from './avatar-mark'
import type {CharacterActivity,CharacterState} from './character-state'
export type MotionMode='standard'|'quiet'|'off'
const modeKey='grokbot-character-motion-v1'
export function readMotionMode():MotionMode{try{const v=localStorage.getItem(modeKey);return v==='quiet'||v==='off'?v:'standard'}catch{return 'standard'}}
export function setMotionMode(mode:MotionMode){try{localStorage.setItem(modeKey,mode)}catch{}window.dispatchEvent(new Event('grokbot-motion-change'))}
export function MotionSettings(){const [mode,setMode]=useState(readMotionMode);return <label className="gk-motion-setting">角色动作<select aria-label="角色动作" value={mode} onChange={e=>{const m=e.target.value as MotionMode;setMode(m);setMotionMode(m)}}><option value="standard">标准 · 明显动作</option><option value="quiet">安静 · 减少动作</option><option value="off">关闭</option></select><small>遵循系统“减少动态效果”；历史消息头像保持静止。</small></label>}
export const Character=memo(function Character({seed,name,role,size,activity,quiet=false,specialty=''}:{seed:string;name:string;role?:string;size:number;activity:CharacterActivity;quiet?:boolean;specialty?:string}){
 const ref=useRef<HTMLSpanElement>(null),[mode,setMode]=useState(readMotionMode),[visible,setVisible]=useState(true),[foreground,setForeground]=useState(()=>!document.hidden)
 const token=`${activity.state}:${activity.eventId||''}`
 const last=useRef(token),[event,setEvent]=useState<string|null>(null)
 useEffect(()=>{const update=()=>setMode(readMotionMode());window.addEventListener('grokbot-motion-change',update);return()=>window.removeEventListener('grokbot-motion-change',update)},[])
 useEffect(()=>{const update=()=>setForeground(!document.hidden);document.addEventListener('visibilitychange',update);let observer:IntersectionObserver|undefined;if(typeof IntersectionObserver!=='undefined'){observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting));if(ref.current)observer.observe(ref.current)}return()=>{observer?.disconnect();document.removeEventListener('visibilitychange',update)}},[])
 useEffect(()=>{const fresh=activity.eventId&&token!==last.current;last.current=token;setEvent(null);if(fresh&&visible&&foreground&&!quiet&&['done','error'].includes(activity.state)){setEvent(activity.eventId!);const timer=setTimeout(()=>setEvent(null),1200);return()=>clearTimeout(timer)}},[activity.eventId,activity.state,visible,foreground,quiet])
 const parts=identityParts(role,name||seed),personality=role==='chief'?'chief':role==='researcher'||role==='analyst'||/架构|技术负责人|architect/i.test(specialty)?'architect':role==='reviewer'||/测试|质量|\bQA\b/i.test(specialty)?'qa':'developer'
 const phase=Array.from(seed).reduce((n,c)=>n+c.charCodeAt(0),0),pace=1.5+(phase%5)*.16
 const pose:CharacterState=activity.state==='done'&&!event?'idle':activity.state
 const frozen=mode==='off'||!visible||!foreground||(quiet&&(mode==='quiet'||activity.state==='idle'))
 return <span ref={ref} className="gk-character" role="img" aria-label={`${name} · ${activity.label}`} data-state={pose} data-personality={personality} data-static={frozen} data-quiet={quiet} data-motion={mode} data-event={Boolean(event)} style={{width:size,height:size,'--pace':`${pace}s`,'--blink-delay':`${-(phase%6)}s`} as React.CSSProperties}>
  <svg viewBox="0 0 64 64" aria-hidden="true" data-avatar-role={role||'custom'}><g className="body"><path d={parts.shape} fill={parts.color}/><g className="eyes"><g className="blink"><path d={parts.eyes} fill="none" stroke="white" strokeWidth="4.5" strokeLinecap="round"/></g></g>{size>=48?<><ellipse className="hand" cx="12" cy="46" rx="4.5" ry="3" fill={parts.color}/><ellipse className="hand right" cx="53" cy="46" rx="4.5" ry="3" fill={parts.color}/></>:null}</g>{['waiting','queued','error','paused'].includes(activity.state)?<g><circle cx="54" cy="12" r="7" fill={activity.state==='error'?'#a44530':'#6f746b'}/><text x="54" y="15.7" fontSize="11" fontFamily="sans-serif" fill="white" textAnchor="middle">{activity.state==='error'?'!':activity.state==='waiting'?'?':activity.state==='paused'?'Ⅱ':'·'}</text></g>:null}</svg>
 </span>
})
