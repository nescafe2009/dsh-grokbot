import {readFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {atomicWriteFile} from './inbox.mjs'
/** Legacy grant revocation only. Persistent authorization belongs to the native host. */
export class BotAccess {
 constructor(root){
  this.path=join(root,'bot-access.json');this.root=root;this.agents=new Map();this.data={fullBots:[],baselines:{}};this.queue=Promise.resolve()
  this.ready=(async()=>{try{
   const data=JSON.parse(await readFile(this.path,'utf8'))
   if(!Array.isArray(data.fullBots)||!data.baselines||typeof data.baselines!=='object'||Array.isArray(data.baselines))throw Error('权限配置无效')
   this.data={fullBots:[],baselines:data.baselines}
   if(data.fullBots.length)await this.persist()
  }catch(e){if(e.code!=='ENOENT')throw e}})()
 }
 isFull(){return false}
 serial(fn){const work=this.queue.then(()=>this.ready).then(fn);this.queue=work.catch(()=>{});return work}
 async persist(){await mkdir(this.root,{recursive:true});await atomicWriteFile(this.path,JSON.stringify(this.data))}
 async register(botId,agent){return this.serial(async()=>{await this.apply(botId,agent);this.agents.set(agent,botId)})}
 forget(agent){this.agents.delete(agent)}
 async apply(botId,agent,full=false){
  if(full!==false)throw Error('插件完全访问已停用，请使用宿主原生授权')
  const session=agent.session,id=session?.id,baseline=Object.hasOwn(this.data.baselines,id)?this.data.baselines[id]:null
  if(!Object.hasOwn(this.data.baselines,id))return
  if(!baseline||typeof baseline!=='object')throw Error('旧权限基线无效')
  if(!id||typeof session.append!=='function')throw Error('宿主执行会话不支持权限切换')
  if(baseline.botId!==botId)throw Error('执行会话归属不一致')
  // Never restore a permissive or malformed legacy policy from plugin state.
  if(!['read-only','workspace-write'].includes(baseline.mode)||!['ask','never'].includes(baseline.policy))throw Error('旧权限基线不安全，请在宿主中恢复会话权限')
  session.append('sandbox/mode',{mode:baseline.mode});session.append('approval/policy',{policy:baseline.policy})
  delete this.data.baselines[id];await this.persist()
 }
 set(botId,full){return this.serial(async()=>{
  if(full!==false)throw Error('插件完全访问已停用，请使用宿主原生授权')
  this.data.fullBots=[];await this.persist()
  for(const [agent,id] of this.agents)if(id===botId)await this.apply(botId,agent)
  return {botId,mode:'review'}
 })}
}
export {decodeToolArguments} from './approval-data.mjs'
