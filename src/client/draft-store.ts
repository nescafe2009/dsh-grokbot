/*
 * 跨视图卸载/重挂的会话草稿存储（模块级，对齐 retry-store 模式）。
 * 组件本地 useRef Map 在父级切换视图（DM↔群↔工作区互斥渲染）时会随卸载销毁——
 * 草稿与任务引用（deliver_file 卡片「继续修改」选择的 taskId）必须存活于组件生命周期之外。
 * 键为会话 id（DM=botId，群=会话 id）；新会话无记录时为空（不继承他人草稿）。
 */
export interface DraftEntry {
  draft: string
  draftTask: { taskId: string; name: string } | null
}

const drafts = new Map<string, DraftEntry>()

export function saveDraft(conversationId: string | null | undefined, entry: DraftEntry): void {
  if (!conversationId) return
  drafts.set(conversationId, entry)
}

export function loadDraft(conversationId: string | null | undefined): DraftEntry {
  return drafts.get(conversationId ?? '') ?? { draft: '', draftTask: null }
}
