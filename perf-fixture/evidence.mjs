// 效率配对证据标准（插件/直连同源同标准）——fixture 与回归测试共用，不复制表达式。
//
// 1) bashToolEvidence：必须显式检验 outcome.activity 中的真实 shell 类工具标识；
//    read_file-only / 纯 toolCalls 计数不能伪造 bash 证据。
// 2) targetEvidence：必须命中实际工具执行结果（outcome.toolResults / 响应 toolResults，
//    即 tool/result 事件的 message.content 文本）；口头复述（reply 含标记）与
//    replyBytes>0 都不算。
export const SHELL_TOOL_RE = /(^|\/|:)(ba|z|da|k)?sh(ell)?$/i

/** activity 中存在真实 shell 类工具标识（bash/sh/zsh/shell 等；read_file 等不算） */
export function bashToolEvidence(outcomeLike) {
  const activity = Array.isArray(outcomeLike?.activity) ? outcomeLike.activity : []
  return activity.some((name) => typeof name === 'string' && (SHELL_TOOL_RE.test(name) || /bash/i.test(name)))
}

/** 实际工具执行结果包含目标标记（口头复述/字节数不算） */
export function targetEvidence(outcomeLike, marker) {
  const results = Array.isArray(outcomeLike?.toolResults) ? outcomeLike.toolResults : []
  return results.some((text) => typeof text === 'string' && text.includes(marker))
}
