// 效率配对证据标准（插件/直连同源同标准）——fixture 与回归测试共用，不复制表达式。
//
// 1) bashToolEvidence：outcome.activity 含显式名单内 shell 工具名（精确匹配，不做 /bash/i 泛化；
//    名单单源于 src/index.mjs 的 SHELL_TOOL_NAMES）。
// 2) targetEvidence：读取服务端生产判定 outcome.evidence.targetMatch——按 callId 关联的
//    【同一 shell 工具】【成功】结果包含标记；口头复述、其他工具结果、错误结果、孤立结果均不成立。
// 默认 chat 不附原始工具文本（evidence 仅在显式 evidenceMarker 请求时返回最小布尔证据）。
import { SHELL_TOOL_NAMES } from '../src/index.mjs'

export { SHELL_TOOL_NAMES }

/** activity 中存在显式名单内 shell 工具名（read_file/纯 toolCalls/not_bash 等不算） */
export function bashToolEvidence(outcomeLike) {
  const activity = Array.isArray(outcomeLike?.activity) ? outcomeLike.activity : []
  return activity.some((name) => SHELL_TOOL_NAMES.has(String(name)))
}

/** 同一 shell 成功结果命中标记（服务端 callId 关联判定；marker 仅作文档用途） */
export function targetEvidence(outcomeLike, marker = '') {
  void marker
  return outcomeLike?.evidence?.targetMatch === true
}
