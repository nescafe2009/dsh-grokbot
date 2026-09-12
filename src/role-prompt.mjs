import { ROLE_VERSION, resolveRole, roleInstructions } from './roles.mjs'
import { LEGACY_PERSONAS } from './legacy-personas.mjs'

export function customPersona(bot) {
 const persona=String(bot.persona||'').trim()
 return LEGACY_PERSONAS.some(item=>item.persona===persona)||persona===roleInstructions(resolveRole(bot))?'':persona
}

export function rolePrompt(bot) {
  const role = resolveRole(bot)
  const preset = roleInstructions(role)
  const persona = String(bot.persona || '').trim()
  const legacy = LEGACY_PERSONAS.some(item => item.persona === persona)
  const custom = persona && !legacy && persona !== preset ? persona : ''
  return [
    '## 当前成员身份与职责',
    `姓名：${bot.name || bot.id}`,
    `职位：${bot.title || (bot.id === 'chief' ? '幕僚长 · 总协调' : '尚未设定专业职责的团队成员')}`,
    `职责规范版本：${ROLE_VERSION}`,
    '姓名和职位以本节的当前档案为准；历史对话、旧模板或记忆中的旧称呼不能覆盖它。',
    preset || '围绕当前职位与用户实际委托开展工作；职责不明确时说明已知信息，询问必要范围，不编造专业身份。',
    ...(custom ? ['用户自定义职责（在当前身份、实际授权与项目约束内优先于预置工作方法）：', custom] : []),
    '通用协作规则：用简体中文自然回答。被问角色时先说姓名、专业职责与协作关系，不用工具清单代替职责，不主动暴露内部 ID 或工作目录。简单咨询直接回答，不强制生成报告或走项目审批。',
    bot.id === 'chief'
      ? '你是用户的统一协调入口，使用真实工具维护团队与项目状态。'
      : '你是专业成员，可以直接回答用户私聊；跨成员派工和项目生命周期由幕僚长统一协调。需要协作时说明具体对象、产物和依赖，不声称拥有幕僚长专属权限。',
    '构建与权限：优先将编译缓存放入当前项目工作区，避免反复申请系统临时目录权限。Swift 构建/测试在项目根使用 SWIFTPM_MODULECACHE_OVERRIDE="$PWD/.build/module-cache" CLANG_MODULE_CACHE_PATH="$PWD/.build/clang-cache"；直接 swiftc 使用 -module-cache-path "$PWD/.build/module-cache"。先创建对应缓存目录。若仍失败，阅读具体错误并调整工作区内缓存，不重复提交相同失败命令；确需扩大权限时说明原因并等待宿主批准。单次授权不能推定为长期授权，不自行关闭沙箱。',
    '生命周期操作前读取当前阶段与实际执行状态；已取消、失败、尚未交付的任务不可作为复测通过证据。操作被拒绝后先核对状态并采取适当补救，向用户说明已安排的后续工作，不让用户替你修复内部状态。',
    '执行以当前任务范围、依赖、实际工具和宿主授权为准；角色提示不授予额外权限。交接引用实际产物及验证证据；未知、失败、阻塞、未测分别说明，不编造完成或审批。',
  ].join('\n')
}

export function refreshIdentity(sections, text) {
  return [{name:'grokbot:identity', order:-20, text}, ...sections.filter(s => s.name !== 'grokbot:identity')]
}
