import {realpath,stat,readFile,mkdir} from 'node:fs/promises'
import {join,parse} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {atomicWriteFile} from './inbox.mjs'
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v
export async function approvalRuleCandidate({botId,conversationId,toolName,args,workspace,reason}){
 if(toolName!=='bash'||!botId||!workspace||typeof args?.command!=='string'||args.command.length>16000)return null
 const mode=/^escalate sandbox to (workspace-write|danger-full-access):/.exec(String(reason||''))?.[1]
 if(!mode||args.sandbox_permissions!==mode)return null
 const command=args.command
 if(/\b(sudo|su|rm|rmdir|mkfs|diskutil|shutdown|reboot|security|launchctl)\b|\b(?:git\s+push|curl.*\|\s*(sh|bash))\b|(?:api[_-]?key|password|token|secret|authorization)\s*[=:]|\bsk-[a-zA-Z0-9_-]{12,}/i.test(command))return null
 try{
  const cwd=await realpath(workspace),meta=await stat(cwd)
  if(!meta.isDirectory()||cwd===parse(cwd).root)return null
  const {justification,...execution}=args
  const identity={version:1,botId,conversationId:conversationId||botId,workspace:cwd,inode:`${meta.dev}:${meta.ino}`,toolName,mode,args:execution}
  const fingerprint=createHash('sha256').update(JSON.stringify(stable(identity))).digest('hex')
  return {fingerprint,botId,conversationId:identity.conversationId,workspace:cwd,mode,commandPreview:command.slice(0,2000),label:'同一成员、工作目录与完整命令，24 小时内有效'}
 }catch{return null}
}
export class ApprovalRules{
 constructor(root){this.path=join(root,'approval-rules.json');this.root=root;this.queue=Promise.resolve()}
 async read(){try{const d=JSON.parse(await readFile(this.path,'utf8'));if(d.version!==1||!Array.isArray(d.rules))throw Error('授权规则文件损坏');return d}catch(e){if(e.code==='ENOENT')return {version:1,rules:[]};throw e}}
 async write(d){await mkdir(this.root,{recursive:true});await atomicWriteFile(this.path,JSON.stringify(d))}
 serial(fn){const p=this.queue.then(fn,fn);this.queue=p.catch(()=>{});return p}
 async list(now=Date.now()){return (await this.read()).rules.filter(r=>!r.revokedAt&&r.expiresAt>now)}
 async match(candidate,now=Date.now()){if(!candidate)return null;return (await this.list(now)).find(r=>r.fingerprint===candidate.fingerprint)||null}
 grant(candidate,{approvalId,stillPending=()=>true,now=Date.now()}={}){return this.serial(async()=>{
  if(!candidate||!approvalId||!stillPending())throw Error('审批已经结束或此操作不支持记住授权')
  const data=await this.read(),rule={...candidate,id:'rule-'+randomUUID(),approvalId,createdAt:now,expiresAt:now+24*60*60*1000}
  if(!stillPending())throw Error('审批已经结束')
  data.rules.push(rule);await this.write(data)
  if(!stillPending()){rule.revokedAt=Date.now();await this.write(data);throw Error('审批已取消，未保留授权')}
  return rule
 })}
 revoke(id){return this.serial(async()=>{const data=await this.read(),rule=data.rules.find(r=>r.id===id);if(!rule)throw Error('授权规则不存在');rule.revokedAt=Date.now();await this.write(data);return {ok:true}})}
}
