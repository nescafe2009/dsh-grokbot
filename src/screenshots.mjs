import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,stat,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createArtifactSnapshot} from './delivery-core.mjs'
const run=promisify(execFile)
let capturing=false
export async function captureScreenshot(stateDir,conversationId,{platform=process.platform,execute=run,mode='region',delay=0,signal}={}) {
 if(![0,5,10].includes(delay))throw Error('截图延时无效')
 if(!['region','screen'].includes(mode))throw Error('截图范围无效')
 if(platform!=='darwin')throw Error('此设备暂不支持内置截图，请使用系统截图。')
 if(capturing)throw Error('已有截图正在选择，请先完成或按 Esc 取消。')
 capturing=true
 const root=join(stateDir,'workspace','screenshots'),path=join(root,`${randomUUID()}.png`)
 try {
  await mkdir(root,{recursive:true})
  try {await execute('/usr/sbin/screencapture',[...(mode==='screen'?['-m']:['-i']),'-x',...(delay?['-T',String(delay)]:[]),path],{timeout:120000,signal})}
  catch {if(signal?.aborted)return {cancelled:true};throw Error('截图未完成。可以重试；若系统拒绝，请在系统设置中允许 DSH Desktop 录制屏幕。')}
  if(!await stat(path).catch(()=>null))return {cancelled:true}
  const {meta}=await createArtifactSnapshot({artifactsRoot:join(stateDir,'artifacts'),sourceReal:path,workspaceRoot:root,extra:{conversationId,kind:'user-screenshot'}})
  return {id:meta.id,url:`/api/plugins/grokbot/artifacts/${meta.id}`}
 }finally{capturing=false;await rm(path,{force:true}).catch(()=>{})}
}

export async function importScreenshot(stateDir,conversationId,image) {
 if(typeof image!=='string'||image.length>18*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))throw Error('请粘贴 PNG 截图（不超过 12 MB）')
 const bytes=Buffer.from(image.slice(image.indexOf(',')+1),'base64')
 if(bytes.length<24||bytes.length>12*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20))throw Error('截图图片无效或过大')
 const root=join(stateDir,'workspace','screenshots'),path=join(root,`${randomUUID()}.png`)
 await mkdir(root,{recursive:true})
 try {await writeFile(path,bytes);const {meta}=await createArtifactSnapshot({artifactsRoot:join(stateDir,'artifacts'),sourceReal:path,workspaceRoot:root,extra:{conversationId,kind:'user-screenshot'}});return {id:meta.id,url:`/api/plugins/grokbot/artifacts/${meta.id}`}}
 finally{await rm(path,{force:true}).catch(()=>{})}
}
