import { realpath, stat } from 'node:fs/promises'
import { resolve, relative, basename } from 'node:path'

// Delegation is bounded to regular files already inside the task workspace.
// Shell commands, missing evidence and any escalation remain human decisions.
export async function approvalScope({ toolName, args, workspace, reason = '' }) {
  if (/sudo|root|elevat|sandbox|network|提权|沙箱|联网/i.test(reason)) return { eligible:false, reason:'请求涉及权限或执行边界变更' }
  if (!['read', 'write', 'edit'].includes(toolName) || !args || typeof args !== 'object') return { eligible:false, reason:'此类操作不在常规文件代审范围内' }
  const path = args.path ?? args.file_path
  if (!workspace || typeof path !== 'string' || !path) return { eligible:false, reason:'缺少可核实的工作区或目标路径' }
  try {
    const root = await realpath(workspace)
    const target = await realpath(resolve(root, path))
    const rel = relative(root, target)
    if (!rel || rel.startsWith('..') || rel.startsWith('/') || !(await stat(target)).isFile()) return { eligible:false, reason:'目标不属于任务工作区内的普通文件' }
    if (/(^|\/)(\.[^/]+|credentials?[^/]*|secrets?[^/]*|id_rsa|id_ed25519)(\/|$)|\.(pem|key|p12|pfx)$/i.test(rel)) return { eligible:false, reason:'目标可能包含凭据或隐藏配置' }
    if (toolName !== 'read' && /^(AGENTS\.md|SKILL\.md|package\.json|.*lock.*|.*config.*)$/i.test(basename(target))) return { eligible:false, reason:'修改会影响执行规则或项目配置' }
    return { eligible:true, path:target, reason:'任务工作区内的常规文件操作' }
  } catch { return { eligible:false, reason:'无法核实目标文件，需由你确认' } }
}

export function parseApprovalReview(text) {
  try {
    const value=JSON.parse(text.trim())
    if (!['allow','reject','escalate'].includes(value.decision) || typeof value.reason!=='string' || !value.reason.trim()) return null
    return {decision:value.decision,reason:value.reason.slice(0,400)}
  } catch {return null}
}
