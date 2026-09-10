import {useEffect, useState} from 'react'
import type {ReactNode} from 'react'
import {AvatarView} from './components'

type Model = {provider:string; model:string}
type Preset = Model & {name:string}
type Bot = {id:string;name:string;avatar?:string;roleTemplate?:string;model?:Model|null}
type Provider = {id:string;name:string;models:{id:string;name:string}[]}
type Api = (path:string, opts?:RequestInit)=>Promise<any>
const same = (a?:Model|null,b?:Model|null)=>!!a && !!b && a.provider===b.provider && a.model===b.model
const chip = {border:'1px solid var(--gk-border, #ddd)',borderRadius:9,padding:'7px 11px',font:'inherit',fontSize:13,cursor:'pointer'}

export function ModelLibrary({api,defaultEditor,onDefaultChange}:{api:Api;defaultEditor:ReactNode;onDefaultChange:(value:Model|null)=>void}) {
  const [presets,setPresets]=useState<Preset[]>([]),[bots,setBots]=useState<Bot[]>([]),[providers,setProviders]=useState<Provider[]>([])
  const [team,setTeam]=useState<Model|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [editorOpen,setEditorOpen]=useState(false),[scope,setScope]=useState('library')
  const [name,setName]=useState(''),[provider,setProvider]=useState(''),[model,setModel]=useState(''),[editing,setEditing]=useState<number|null>(null)
  const load=async()=>{setLoading(true);setError('');try{const [c,p]=await Promise.all([api('/crew'),api('/model-catalog')]);setPresets(c.crew?.modelPresets||[]);setBots(c.crew?.bots||[]);setTeam(c.crew?.defaultModel||null);setProviders(p.catalog||[])}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
  useEffect(()=>{void load()},[])
  const perform=async(action:()=>Promise<void>,where='library')=>{setScope(where);setBusy(true);setError('');setNotice('');try{await action()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const reset=()=>{setEditing(null);setName('');setModel('')}
  const save=()=>perform(async()=>{
    const item={name:name.trim()||model.trim(),provider,model:model.trim()}
    const next=editing===null?[...presets,item]:presets.map((p,i)=>i===editing?item:p)
    const result=await api('/crew',{method:'PATCH',body:JSON.stringify({modelPresets:next})})
    setPresets(result.crew.modelPresets);reset();setEditorOpen(false);setNotice('常用模型已保存，可以在下方分配。')
  })
  const remove=(index:number)=>perform(async()=>{const result=await api('/crew',{method:'PATCH',body:JSON.stringify({modelPresets:presets.filter((_,i)=>i!==index)})});setPresets(result.crew.modelPresets);reset();setNotice('已移除快捷选项，现有 Bot 的模型设置保留。')})
  const assign=(bot:Bot,value:Model|null)=>perform(async()=>{const result=await api(`/bots/${encodeURIComponent(bot.id)}`,{method:'PATCH',body:JSON.stringify({model:value})});setBots(list=>list.map(b=>b.id===bot.id?{...b,model:result.bot.model}:b));setNotice('已保存，下次执行生效')},bot.id)
  const chooseDefault=(value:Model|null)=>perform(async()=>{const result=await api('/crew',{method:'PATCH',body:JSON.stringify({defaultModel:value})});setTeam(result.crew.defaultModel);onDefaultChange(result.crew.defaultModel);setNotice('默认模型已保存')},'team')
  const choice=(label:string,selected:boolean,click:()=>void,key:string)=><button key={key} type="button" disabled={busy} aria-pressed={selected} onClick={click} className="gkm-choice" style={{...chip,background:selected?'var(--gk-text, #222)':'transparent',color:selected?'var(--gk-bg, #fff)':'inherit',opacity:busy?.6:1}}>{label}</button>
  const feedback=(id:string)=><div className="gkm-feedback" aria-live="polite">{scope===id?(busy?<span>正在保存…</span>:error?<span role="alert" className="gkm-error">{error}</span>:notice?<span role="status">{notice}</span>:null):null}</div>
  return <div className="gkm" style={{maxWidth:1040}}>
    <style>{`
      .gkm{container-type:inline-size;color:var(--gk-text,#222)}
      .gkm button:focus-visible,.gkm input:focus-visible,.gkm select:focus-visible{outline:2px solid var(--gk-text,#222);outline-offset:3px}
      .gkm button{min-height:36px;transition:background .15s,opacity .15s}
      .gkm button:not(:disabled):hover{filter:brightness(.94)}
      .gkm button:disabled{cursor:default;opacity:.5}
      .gkm h3{font-size:16px;margin:0}
      .gkm-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
      .gkm-sub{font-size:13px;color:var(--gk-text-2,#666);margin:6px 0 0;line-height:1.5}
      .gkm-feedback{font-size:12px;min-height:18px;color:var(--gk-text-2,#666);line-height:18px}
      .gkm-error{color:var(--gk-red,#b42318)}
      .gkm .grokbot-form{box-shadow:none;border:0;background:var(--gk-bg-side,#f7f7f7);padding:16px;border-radius:10px}
      .gkm .grokbot-form label{display:flex;flex-direction:column;align-items:stretch;gap:7px;font-size:12px;min-width:0}
      .gkm input,.gkm select{width:100%;min-height:38px;box-sizing:border-box}
      .gkm-assignment{display:grid;grid-template-columns:minmax(150px,200px) minmax(0,1fr);gap:16px;align-items:center;padding:12px 0;border-top:1px solid var(--gk-border,#ddd)}
      .gkm-person{display:flex;align-items:center;gap:10px;min-width:0}
      .gkm-person strong{font-size:14px}
      .gkm-current{font-size:12px;color:var(--gk-text-2,#666);margin-top:4px;overflow-wrap:anywhere}
      .gkm-options{display:flex;flex-wrap:wrap;gap:8px}
      .gkm-selected-label{font-size:12px;margin-left:6px;color:var(--gk-text-2,#666)}
      @container(max-width:580px){.gkm-assignment{grid-template-columns:1fr;gap:10px}.gkm-head{align-items:flex-start}.gkm-options button{min-height:44px}}
      @media(prefers-reduced-motion:reduce){.gkm button{transition:none}}
    `}</style>
    {error&&loading?<p role="alert">{error} {loading?null:<button disabled={busy} onClick={()=>void load()}>重新加载</button>}</p>:null}
    {loading?<p>正在加载模型配置…</p>:<>
    <section aria-label="常用模型配置" style={{border:'1px solid var(--gk-border, #ddd)',borderRadius:14,padding:20,marginBottom:22}}>
      <div className="gkm-head"><div><h3>常用模型 <span className="gkm-selected-label">{presets.length} 个</span></h3><p className="gkm-sub">配置一次，团队成员直接选用。</p></div><button type="button" style={chip} disabled={busy} onClick={()=>{reset();setEditorOpen(v=>!v)}} aria-expanded={editorOpen||!presets.length}>{editorOpen?'收起表单':'+ 添加模型'}</button></div>
      {editorOpen||!presets.length?<>
      <div className="grokbot-form" style={{margin:0,maxWidth:'none'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12}}>
          <label>显示名称<input aria-label="常用模型名称" placeholder="例如：快速响应" value={name} maxLength={80} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
          <label>服务商<select aria-label="常用模型服务商" value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value);setModel('')}}><option value="">选择服务商</option>{provider&&!providers.some(p=>p.id===provider)?<option value={provider}>{provider}（当前未连接）</option>:null}{providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>模型 ID<input aria-label="常用模型ID" list="gk-model-suggestions" placeholder="输入或选择模型 ID" value={model} maxLength={200} disabled={busy} onChange={e=>setModel(e.target.value)}/><datalist id="gk-model-suggestions">{(providers.find(p=>p.id===provider)?.models||[]).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</datalist></label>
        </div>
        <div style={{display:'flex',gap:8}}><button type="button" className="grokbot-form__submit" disabled={busy||!provider||!model.trim()||presets.length>=30&&editing===null} onClick={()=>void save()}>{editing===null?'添加常用模型':'保存模型修改'}</button><button type="button" disabled={busy} style={chip} onClick={()=>{reset();setEditorOpen(false)}}>取消</button></div>
      </div>
      <p className="gkm-sub">模型 ID 可直接输入；服务商连接在 DSH 中配置。修改常用项后，已分配的 Bot 保持原选择。</p></>:null}
      {feedback('library')}
      {!presets.length?<p style={{fontSize:13,opacity:.65}}>还没有常用模型。添加后，下方会出现对应的快捷按钮。</p>:presets.map((p,i)=><div key={JSON.stringify([p.provider,p.model])} style={{display:'flex',gap:12,alignItems:'center',borderTop:'1px solid var(--gk-border, #ddd)',padding:'12px 0',flexWrap:'wrap'}}><div style={{flex:1,minWidth:150}}><strong>{p.name}</strong><div style={{fontSize:12,opacity:.6,overflowWrap:'anywhere'}}>{p.provider} / {p.model}</div></div><button disabled={busy} style={chip} onClick={()=>{setEditorOpen(true);setEditing(i);setName(p.name);setProvider(p.provider);setModel(p.model)}}>编辑</button><button disabled={busy} style={chip} title="仅移除快捷选项，保留 Bot 当前配置" onClick={()=>void remove(i)}>移除</button></div>)}
    </section>
    <section aria-label="Bot模型快捷分配" style={{border:'1px solid var(--gk-border, #ddd)',borderRadius:14,padding:20}}>
      <div className="gkm-head"><div><h3>模型分配</h3><p className="gkm-sub">点击即保存，运行中的任务不受影响。</p></div><span className="gkm-selected-label">{bots.filter(b=>!b.model).length} / {bots.length} 位跟随默认</span></div>
      <div style={{paddingBottom:14}}><div className="gkm-assignment" style={{borderTop:0,paddingTop:0}}><div><strong>团队默认</strong><div className="gkm-current">{team?`${team.provider} / ${team.model}`:'DSH 全局默认'}</div></div><div><div className="gkm-options">{choice('DSH 全局默认',!team,()=>void chooseDefault(null),'host')}{presets.map(p=>choice(p.name,same(team,p),()=>void chooseDefault({provider:p.provider,model:p.model}),JSON.stringify(p)))}</div>{feedback('team')}</div></div>
      <details style={{marginTop:12}} onToggle={e=>{if(!e.currentTarget.open)void api('/crew').then(c=>setTeam(c.crew.defaultModel||null)).catch(()=>{})}}><summary>从服务商列表选择其他默认模型</summary>{defaultEditor}</details></div>
      {bots.map(bot=><div key={bot.id} className="gkm-assignment"><div className="gkm-person"><AvatarView seed={bot.id} name={bot.name} glyph={bot.roleTemplate||bot.avatar} size={32}/><div><strong>{bot.name}</strong><div className="gkm-current">{bot.model?`${bot.model.provider} / ${bot.model.model}`:`默认 · ${team?.model||'DSH 全局模型'}`}</div></div></div><div><div className="gkm-options">{choice('跟随团队默认',!bot.model,()=>void assign(bot,null),'default')}{presets.map(p=>choice(p.name,same(bot.model,p),()=>void assign(bot,{provider:p.provider,model:p.model}),JSON.stringify(p)))}</div>{feedback(bot.id)}</div></div>)}
    </section></>}
  </div>
}
