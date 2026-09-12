// A bare acceptance is never authority to remove a project from active work.
// This guard uses the CURRENT user message, never the chief's proposed bundle.
export function assertArchiveRequest(text){
 const value=String(text||'').trim()
 if(!/(归档|封存|archive)/i.test(value)||/(不要|别|不必|不用|无需|暂不|不能|不该|不应该|是否|为什么|为何|怎么|如果|假如|能否|可否|不要自动|不想|没让|没有要求|未要求|不许|不允许|不需要).{0,16}(归档|封存)|[?？]|\b(don.t|do not|why|whether|if)\b/i.test(value))throw Error('验收通过不代表归档授权。请保留项目群和成员；只有用户当前明确要求归档时才能归档。')
}
export const CONTINUITY_RULES=`项目团队持续存在：用户说“通过”“功能正常”只验收当前交付，不授权归档、解散、移除成员或冻结后续协作。即使最终验收通过，也默认保留原项目群和成员，说明本轮已交付、可继续反馈；不要把“通过后就归档”捆绑成选项。归档仅在用户明确要求归档/封存时执行。
用户反馈同一产品的缺陷或优化，就是本轮修改授权，无需要求他说“恢复项目”这种内部口令。先定位原项目：active直接沿用；completed/archived用team_project_lifecycle action=iterate开启新迭代，填写本轮范围；取消或明确暂停的项目不能擅自恢复，先核实其暂停/取消边界。原群、成员、代码和历史验收继续保留，不新建同名群。
迭代开始不自动派工。缺陷用team_return_step开启修复→独立复测；新优化在原计划追加本轮实现、测试、最终验收步骤，保留旧步骤和jobIds，将旧finalDelivery标记改为false、新末端设为true，旧验收只覆盖旧成果。若改变原阶段范围，用正式返工/范围变更撤销受影响验收，不能把新实现算作旧版已验收。
幕僚长负责组织、核验和交付，已有专业团队的代码/UI修改由对应成员完成，独立测试由测试角色承担；不能以“小改动”“已归档”为由私聊直接改项目代码绕开派工与复测。启动现有应用、解释使用方法等不改产物的操作可直接处理。`
