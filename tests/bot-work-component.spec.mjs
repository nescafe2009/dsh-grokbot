import {Window} from '/tmp/react-test-env/node_modules/happy-dom/lib/index.js'
import test from 'node:test'
import assert from 'node:assert/strict'
const win=new Window()
globalThis.window=win;globalThis.document=win.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('/tmp/react-test-env/node_modules/react/index.js')
const {createRoot}=await import('/tmp/react-test-env/node_modules/react-dom/client.js')
const {BotWorkPanel}=await import(await import('./ctb-path.mjs').then(m=>m.CTB_DIR+'/test-entry.mjs'))
const {act}=React
const job=(id,status)=>({id,title:'真实点击测试',project:'贪吃蛇',status,createdAt:10,startedAt:status==='cancelled'?null:20,endedAt:null,lastActivityAt:30,stale:false,activeTools:['bash'],from:'幕僚长',request:'验证开始按钮',reply:'',checkpoint:null,activity:[]})

test('Bot detail renders running, cancelled history and empty actual tool records honestly',async()=>{
 const original=globalThis.fetch
 globalThis.fetch=async()=>({ok:true,json:async()=>({botId:'bot-a',observedAt:1000,recordScope:'实际记录',jobs:[job('a','running'),job('b','cancelled')]})})
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>{root.render(React.createElement(BotWorkPanel,{botId:'bot-a',botName:'白泽'}))})
  assert.match(host.textContent,/正在执行.*真实点击测试/)
  await act(async()=>host.querySelector('button').click())
  assert.match(host.textContent,/已取消/);assert.match(host.textContent,/幕僚长 → 白泽/);assert.match(host.textContent,/尚无已保存的执行事件/)
  assert.match(host.textContent,/等待工具返回：bash/)
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=original}
})
test('Bot detail ignores late fetch from previous Bot after navigation',async()=>{
 const original=globalThis.fetch,pending=[]
 globalThis.fetch=(url)=>new Promise(resolve=>pending.push({url,resolve}))
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>root.render(React.createElement(BotWorkPanel,{botId:'bot-a',botName:'甲'})))
  await act(async()=>root.render(React.createElement(BotWorkPanel,{botId:'bot-b',botName:'乙'})))
  await act(async()=>pending.find(p=>p.url.includes('bot-b')).resolve({ok:true,json:async()=>({botId:'bot-b',jobs:[],observedAt:1000})}))
  await act(async()=>pending.find(p=>p.url.includes('bot-a')).resolve({ok:true,json:async()=>({botId:'bot-a',jobs:[job('old','running')],observedAt:1001})}))
  assert.doesNotMatch(host.textContent,/真实点击测试/);assert.match(host.textContent,/当前没有执行中的派工任务/)
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=original}
})

test('Computer archive navigation reveals files and original chat without lifecycle controls',async()=>{
 const {ArchiveComputer}=await import(await import('./ctb-path.mjs').then(m=>m.CTB_DIR+'/test-entry.mjs'))
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const opened=[]
 const api=async()=>({workspace:'/workspace',computer:{vncUrl:null},artifacts:[],archive:{warnings:[],projects:[{id:'p',name:'贪吃蛇',summary:'项目归档摘要',archivedAt:1000,accepted:0,total:1,members:[],steps:[{id:'s',title:'QA',owner:'白泽',accepted:false}],artifacts:[{id:'art-x',name:'index.html',mime:'text/html',size:100,createdAt:1000,versions:[]}]}]}})
 try{
  await act(async()=>root.render(React.createElement(ArchiveComputer,{api,onConversation:id=>opened.push(id)})))
  assert.match(host.textContent,/归档项目/)
  await act(async()=>host.querySelector('[aria-label="查看归档项目 贪吃蛇"]').click())
  assert.match(host.textContent,/未确认验收/)
  assert.equal(host.querySelector('a[target="_blank"]').getAttribute('href'),'/api/plugins/grokbot/artifacts/art-x')
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='查看原会话 ↗').click())
  assert.deepEqual(opened,['p'])
  assert.ok(![...host.querySelectorAll('button')].some(b=>/^(归档|恢复|取消任务)$/.test(b.textContent)))
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='← 全部归档项目').click())
  assert.ok(host.querySelector('[aria-label="搜索归档项目"]'))
 }finally{await act(async()=>root.unmount());host.remove()}
})
test('execution timeline pairs tool input/output and keeps visible progress separate',async()=>{
 const {ExecutionTimeline}=await import(await import('./ctb-path.mjs').then(m=>m.CTB_DIR+'/test-entry.mjs'))
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try {
  await act(async()=>root.render(React.createElement(ExecutionTimeline,{activity:[{id:'1',kind:'progress',at:1,text:'检查构建'},{id:'2',kind:'call',at:2,callId:'x',name:'bash',text:'swift test'},{id:'3',kind:'result',at:3,callId:'x',text:'65 passed'}]})))
  assert.equal(host.querySelectorAll('.gk-execution__tool').length,1);assert.match(host.textContent,/检查构建/);assert.match(host.textContent,/swift test/);assert.match(host.textContent,/65 passed/)
 }finally{await act(async()=>root.unmount());host.remove()}
})
test('screenshot stays a draft preview and a late capture cannot enter another conversation',async()=>{
 const {Composer}=await import(await import('./ctb-path.mjs').then(m=>m.CTB_DIR+'/test-entry.mjs'))
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const old=globalThis.fetch;let finish;const drafts=[]
 globalThis.fetch=()=>new Promise(resolve=>{finish=resolve})
 const props={draft:'请看看',onDraft:v=>drafts.push(v),onSend:()=>{throw Error('must not send')}}
 try{
  await act(async()=>root.render(React.createElement(Composer,{...props,conversationId:'a'})))
  await act(async()=>host.querySelector('[aria-label="截图"]').click())
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes('立即选择区域')).click())
  await act(async()=>root.render(React.createElement(Composer,{...props,conversationId:'b'})))
  await act(async()=>finish({ok:true,json:async()=>({url:'/api/plugins/grokbot/artifacts/art-demo'})}))
  assert.equal(drafts.length,0)
  await act(async()=>host.querySelector('[aria-label="截图"]').click())
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes('立即选择区域')).click())
  await act(async()=>finish({ok:true,json:async()=>({url:'/api/plugins/grokbot/artifacts/art-demo'})}))
  assert.match(drafts[0],/\[截图\]/)
  await act(async()=>root.render(React.createElement(Composer,{...props,draft:drafts[0],conversationId:'b'})))
  assert.ok(host.querySelector('img[alt="待发送截图"]'))
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=old}
})
test('profile loads current custom duties and preserves the existing model on save',async()=>{
 const {BotForm}=await import(await import('./ctb-path.mjs').then(m=>m.CTB_DIR+'/test-entry.mjs'))
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const old=globalThis.fetch;let saved
 const bot={id:'dev',name:'工程师',avatar:'coder',title:'开发',roleTemplate:'coder',model:{provider:'p',model:'m'}}
 globalThis.fetch=async(url,opts)=>{
  if(opts?.method==='PATCH')saved=JSON.parse(opts.body)
  if(url.endsWith('/bot-templates'))return {ok:true,json:async()=>({templates:[{id:'coder',title:'工程师'}]})}
  return {ok:true,json:async()=>({bot:{...bot,persona:'先验证再交付'}})}
 }
 try{
  await act(async()=>root.render(React.createElement(BotForm,{initial:bot,onCancel(){},onSaved(){}})))
  assert.equal(host.querySelector('[aria-label="职责"]').value,'先验证再交付')
  assert.equal(host.querySelector('[aria-label="专业角色模板"]').value,'coder')
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='保存').click())
  assert.deepEqual(saved.model,bot.model);assert.equal(saved.persona,'先验证再交付');assert.equal(saved.roleTemplate,'coder')
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=old}
})
test('pasting a screenshot uploads only after the paste gesture and leaves it in the draft',async()=>{
 const {Composer}=await import(await import('./ctb-path.mjs').then(m=>m.CTB_DIR+'/test-entry.mjs'))
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),old=globalThis.fetch,oldReader=globalThis.FileReader;let sent,draft
 globalThis.FileReader=win.FileReader
 globalThis.fetch=async(url,opts)=>{sent={url,body:JSON.parse(opts.body)};return {ok:true,json:async()=>({url:'/api/plugins/grokbot/artifacts/art-pasted'})}}
 try{
  await act(async()=>root.render(React.createElement(Composer,{conversationId:'paste-bot',draft:'看看这个',onDraft:v=>draft=v,onSend:()=>{throw Error('must not auto-send')}})))
  assert.equal(sent,undefined)
  const e=new win.Event('paste',{bubbles:true,cancelable:true}),file=new win.File(['test png'],'screenshot.png',{type:'image/png'})
  Object.defineProperty(e,'clipboardData',{value:{items:[{kind:'file',type:'image/png',getAsFile:()=>file}]}})
  await act(async()=>{host.querySelector('textarea').dispatchEvent(e);await new Promise(r=>setTimeout(r,40))})
  assert.equal(sent.url,'/api/plugins/grokbot/screenshots/import');assert.equal(sent.body.conversationId,'paste-bot');assert.match(sent.body.image,/^data:image\/png;base64,/);assert.match(draft,/看看这个\n\[截图\]/)
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=old;globalThis.FileReader=oldReader}
})

test('Composer preserves trailing whitespace with attachments and protects composing Enter',async()=>{
 const {Composer}=await import(await import('./ctb-path.mjs').then(m=>m.CTB_DIR+'/test-entry.mjs'))
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 let sent=0
 const render=async(draft,sending=false)=>act(async()=>root.render(React.createElement(Composer,{conversationId:'a',draft,sending,onDraft:()=>{},onSend:()=>sent++})))
 try{
  for(const draft of ['第一行\n','第一行  ','第一行\n\n[截图](/api/plugins/grokbot/artifacts/art-test-1)']){
   await render(draft)
   assert.equal(host.querySelector('textarea').value,draft.includes('[截图]')?'第一行\n':draft)
  }
  const input=host.querySelector('textarea')
  await act(async()=>input.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})))
  await act(async()=>input.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true})))
  assert.equal(sent,0)
  await act(async()=>input.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true})))
  assert.equal(sent,1)
  await render('',false)
  await act(async()=>input.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true})))
  assert.equal(sent,1)
  await render('下一条',true)
  assert.equal(host.querySelector('[aria-label="截图"]').disabled,false)
  assert.equal(host.querySelector('[aria-label="发送消息"]').disabled,true)
 }finally{await act(async()=>root.unmount());host.remove()}
})
