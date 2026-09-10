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
  assert.match(host.textContent,/已取消/);assert.match(host.textContent,/幕僚长 → 白泽/);assert.match(host.textContent,/尚无已保存的工具事件/)
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
