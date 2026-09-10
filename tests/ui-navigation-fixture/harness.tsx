import React from 'react'
import { createRoot } from 'react-dom/client'
import * as ReactDOM from 'react-dom'
import * as JSXRuntime from 'react/jsx-runtime'
let GrokbotSidebarCrew: any, GrokbotMainView: any
import { AvatarView } from '../../src/client/components'
import { ROLE_DEFS } from '../../src/client/avatars'
const bots = [{id:'chief',name:'幕僚长',avatar:'🎖',roleTemplate:null,title:'常驻待命',status:'idle',rating:null},{id:'coder',name:'程序员',avatar:'🛠️',roleTemplate:'coder',title:'代码助手',status:'idle',rating:null}]
const state={accessControl:{supported:true},bots,conversations:bots.map(b=>({id:b.id,name:b.name,memberBotIds:[b.id],isGroup:false})),routines:[],queued:[],approvals:location.search.includes("approval")?[{id:"fixture-approval",botId:"coder",botName:"程序员",toolName:"edit",stage:"user",reason:"执行边界变更",reviewReason:"此操作超出常规文件代审范围，请你确认。",details:JSON.stringify(JSON.stringify({file_path:"/workspace/chief/memory/PROFILE.md",old_string:"## 项目需求\n仅支持局域网文件传输。",new_string:"## 项目需求\n同时支持局域网与公网文件传输。\n用户可以提供一台公网服务器。",justification:"记录新增的外网访问需求，供后续设计使用。"}))}]:[]}
if(location.search.includes('board')) state.conversations.push({id:'group',name:'跨端传输应用',memberBotIds:['chief','coder'],isGroup:true})
const chatMessages = Array.from({length:40},(_,i)=>({ts:Date.now()+i,role:i%2?'bot':'user',text:`Scroll fixture message ${i}\n`+'Long reply line. '.repeat(30)}))
let finishWorking: (()=>void)|null=null
const calls:string[]=[]
;(globalThis as any).fetch=async(url:string,opts:any={})=>{
  const path=String(url).replace('/api/plugins/grokbot','');calls.push(`${opts.method??'GET'} ${path}`)
  const log=document.getElementById('calls'); if(log)log.textContent=calls.slice(-5).join('\n')
  let data:any={}
  if(path==='/state')data=state
  else if(path.endsWith('/access') && opts.method==='POST'){state.approvals=[];data={ok:true}}
  else if(path.startsWith('/approvals/') && opts.method==='POST'){state.approvals=[];data={ok:true}}
  else if(path==='/routines')data={routines:[{id:'r',botId:'coder',prompt:'每日项目检查',schedule:{time:'09:00'},enabled:false}]}
  else if(path==='/workspace')data={workspace:'/tmp/ui-fixture/workspace',computer:{enabled:false,local:true,vncUrl:null},artifacts:[]}
  else if(path==='/workspace/reveal')data={ok:true}
  else if(path==='/model-catalog')data={catalog:[]}
  else if(path.endsWith('/chat')) {
    if(location.search.includes('working')){bots[0].status='working';(bots[0] as any).currentJob='执行滚动验证';await new Promise<void>(resolve=>{finishWorking=resolve});bots[0].status='idle';finishWorking=null}
    const body=JSON.parse(opts.body);chatMessages.push({ts:Date.now(),role:'user',text:body.text});
    chatMessages.push({ts:Date.now(),role:'bot',text:'SCROLL_REPLY_END\n'+'Reply content. '.repeat(120)});
    data={reply:chatMessages.at(-1)!.text}
  }
  else if(path.endsWith('/board'))data={lifecycle:{status:location.search.includes('archived')?'archived':'active',revision:1,summary:'生命周期界面测试，未连接真实项目'},conversationId:'group',updatedAt:Date.now(),hasPlan:true,rows:[
    {id:'architecture',title:'总体架构与传输协议',botId:'chief',status:'done',dependsOn:[],artifacts:1,source:'plan'},
    {id:'mobile',title:'鸿蒙端文件选择与传输',botId:'coder',status:'running',dependsOn:['architecture'],artifacts:0,source:'plan'},
    {id:'desktop',title:'桌面端接收目录与权限',botId:'coder',status:'approval',reason:'需要确认本机目录访问权限',dependsOn:['architecture'],artifacts:0,source:'plan'},
    {id:'test',title:'跨端联调与验收',botId:'chief',status:'blocked',dependsOn:['mobile','desktop'],artifacts:0,source:'plan'},
  ]}
  else if(path.startsWith('/conversations/'))data={messages:chatMessages}
  return {ok:true,status:200,json:async()=>structuredClone(data)}
}

function App(){
 const [rail,setRail]=React.useState(false)
 return <><div style={{display:'flex',height:'100vh',fontFamily:'system-ui'}}>
 <aside style={{width:rail?79:280,flexShrink:0,display:'flex',flexDirection:'column'}}><button onClick={()=>setRail(!rail)} style={{height:32}}>切换窄栏</button><div style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}><GrokbotSidebarCrew/></div></aside>
 <div className="centerCol" style={{flex:1,minWidth:0}}/>
 <GrokbotMainView/>
 </div><details style={{position:'fixed',right:10,bottom:8,zIndex:2000,background:'#fff',maxWidth:600}}><summary>批准头像与请求记录（测试）</summary>{location.search.includes('working')?<button onClick={()=>finishWorking?.()}>结束模拟执行</button>:null}<div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{Object.keys(ROLE_DEFS).map(key=><div key={key}><AvatarView seed={key} name={key} glyph={key} size={36}/><small>{key}</small></div>)}</div><pre id="calls"/></details></>
}
// Execute the actual release bundle with the host's ModuleLoader contract.
;(window as any).__ModuleLoader__ = { load: ({ factory }: any) => {
  const plugin = factory((name: string) => {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDOM
    if (name === 'react/jsx-runtime') return JSXRuntime
    throw new Error(`Unexpected external module: ${name}`)
  })
  GrokbotSidebarCrew = plugin.GrokbotSidebarCrew
  GrokbotMainView = plugin.GrokbotMainView
  plugin.apply({effect:(f:any)=>f(),slots:{inject:()=>{},register:()=>{}}})
  createRoot(document.getElementById('root')!).render(<App/> )
}}
const script = document.createElement('script');script.src='/client.js';document.body.append(script)
