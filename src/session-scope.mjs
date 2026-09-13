export function parseSessionKey(value) {
  const key=String(value||''),marker=key.indexOf('|ws:'),base=marker>=0?key.slice(0,marker):key
  const cut=base.lastIndexOf(':')
  if(cut<=0||cut===base.length-1)return null
  const conversation=base.slice(0,cut),botId=base.slice(cut+1)
  return {sessionKey:key,botId,conversationId:conversation===botId?null:conversation,workspace:marker>=0?key.slice(marker+4):null}
}

export function resolveSessionOwner(entries, sessionId) {
  const found=[...entries].find(([,sid])=>String(sid)===String(sessionId))
  return found?parseSessionKey(found[0]):null
}
