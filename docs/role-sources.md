# 预置角色设计与来源

2026-09-10。角色规范版本 `2026-09-10.1`。

## 选型

检索并阅读 GitHub 原始角色文件后，采用适配 DSH 的中文职责规范，不引入外部调度器、工具或自动联网更新。角色是专业行为约定，不保证模型能力，也不产生工具权限。

| 项目 | 采用思路 | 不直接引入的部分 |
| --- | --- | --- |
| Agency Agents | 架构决策的取舍与可逆性、专业角色的使命/方法/产物/边界、QA 对实际交付证据的核对 | Laravel/固定脚本与端口、默认首轮失败、固定返工轮数、浮夸履历与质量评分 |
| BMAD Method | 身份与可配置职责分层、架构支撑实现、需求和验证证据衔接 | 固定外国姓名、菜单激活流程、强制每件事都走完整软件流程 |
| MetaGPT | profile/goal/constraints 和角色行动、输入产物的显式关联 | Python 工具链、固定 SOP、外部运行时和轮次上限 |

所有下列源码版本的 LICENSE 均已实际读取，为 MIT（BMAD 另带商标说明）。中文规范是针对本项目重写的适配，不整段复制上游提示语；许可证随安装包的 docs/licenses 保留。不宣称得到上游认证或品牌授权。

## 固定来源

### agency-agents

版本：`6d29a9b08785a0e49ffc9818bbdd381164c2df5f`。许可证：[本地副本](licenses/agency-agents-MIT.txt)。

- [engineering/engineering-software-architect.md](https://github.com/msitarzewski/agency-agents/blob/6d29a9b08785a0e49ffc9818bbdd381164c2df5f/engineering/engineering-software-architect.md)
- [engineering/engineering-senior-developer.md](https://github.com/msitarzewski/agency-agents/blob/6d29a9b08785a0e49ffc9818bbdd381164c2df5f/engineering/engineering-senior-developer.md)
- [testing/testing-reality-checker.md](https://github.com/msitarzewski/agency-agents/blob/6d29a9b08785a0e49ffc9818bbdd381164c2df5f/testing/testing-reality-checker.md)
- [testing/testing-evidence-collector.md](https://github.com/msitarzewski/agency-agents/blob/6d29a9b08785a0e49ffc9818bbdd381164c2df5f/testing/testing-evidence-collector.md)
- [specialized/agents-orchestrator.md](https://github.com/msitarzewski/agency-agents/blob/6d29a9b08785a0e49ffc9818bbdd381164c2df5f/specialized/agents-orchestrator.md)

### BMAD-METHOD

版本：`abe4eb1bce919c9d22cd18b3519353d5824c4b75`。许可证：[本地副本](licenses/BMAD-METHOD-MIT.txt)。

- [skills/bmad-agent-architect/customize.toml](https://github.com/bmad-code-org/BMAD-METHOD/blob/abe4eb1bce919c9d22cd18b3519353d5824c4b75/skills/bmad-agent-architect/customize.toml)
- [skills/bmad-agent-dev/customize.toml](https://github.com/bmad-code-org/BMAD-METHOD/blob/abe4eb1bce919c9d22cd18b3519353d5824c4b75/skills/bmad-agent-dev/customize.toml)

### MetaGPT

版本：`11cdf466d042aece04fc6cfd13b28e1a70341b1f`。许可证：[本地副本](licenses/MetaGPT-MIT.txt)。

- [metagpt/roles/architect.py](https://github.com/FoundationAgents/MetaGPT/blob/11cdf466d042aece04fc6cfd13b28e1a70341b1f/metagpt/roles/architect.py)
- [metagpt/roles/qa_engineer.py](https://github.com/FoundationAgents/MetaGPT/blob/11cdf466d042aece04fc6cfd13b28e1a70341b1f/metagpt/roles/qa_engineer.py)

## 本地映射与行为

- 幕僚长：计划、依赖、真实状态和协调；由已有项目工具控制生命周期。
- 林一舟：架构方案、模块边界、接口契约、技术决策与跨端一致性。
- 陈沐 / 苏晚 / 顾行洲：鸿蒙 / macOS / Windows 实现与各自平台验证；平台约束为本项目原创补充。
- 白泽：版本明确的独立测试、复现证据、修复后复测；通过/失败/阻塞/未测分别报告。
- 通用工程、调研、写作、分析、产品、运维、翻译、秘书、审核：保留原有角色并按同一结构补全。

`src/roles.mjs` 是版本化角色库，模板 UI 与运行时共用它。`roleTemplate` 为可持久化的显式选择；省略时按职位保守匹配，特定平台及 QA 优先于通用工程师。未知职位只注入真实身份和通用协作约束，不乱猜专业。

姓名/职位来自当前档案；预置工作方法与用户补充职责分离。精确匹配 v0.5.0 内置旧文案时仅在运行时升级其规则，用户修改过的文案原样保留。无需重建 Bot、清空对话或修改历史任务。默认模板不再把名字写入职责文本，改名不会留住另一个模板人物。

私聊、群聊和后台工作会话都注入同一角色规范；每轮组装替换旧身份段而不叠加，保留团队章程、长期记忆和授权机制。角色选择不授予幕僚长专属权限，实际工具仍校验 chief 身份。新预置 Bot 完成角色设置，只有空白 Bot 进入角色选择流程。

简单的身份问题直接回答，不强制生成文档、重复自我介绍或索取审批。测试依据实际证据，未测不是失败、也不是通过；用户验收仍由用户决定。
