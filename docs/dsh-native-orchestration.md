# DSH 原生编排接入决策

2026-09-09。本机核对基线：DSH 相关包 0.1.2-alpha.1。本文件描述设计与已验证边界，开发任务在 Beads ENV-iehy 及后续关联项跟踪。

## 执行路径与权威

Grokbot 已使用 ctx.agents.create/resume、Agent.followup、whenIdle 和 Session 事件执行模型，并非直接调用 ctx.llm.stream。继续复用这个边界；原生 llm-retry 在 Agent 打开的步骤中处理提供方错误，插件不叠加对整个任务的盲目重试。包存在不代表特定 profile 已挂载，迁移验收需要检查实际事件。

当前插件仍自行维护 inbox jobs、WakeScheduler、工作目录锁和项目计划。它们不是 DSH 原生 Team 服务。工作目录隔离、审批上下文和群归属必须在任何迁移中保留。

## 原生能力选择

- Goal/round-driver：适合同一会话的长期目标。需要真实用户授权来源；自动协调通知不能冒充用户创建或恢复目标。暂停、取消、阻塞以及会话恢复后的续行授权遵守原生约定。不能仅注册工具后就声称目标闭环已接入。
- Subagent：可继续子会话、FIFO 后续消息、冷恢复。followup 需要确切在线直接父 Agent；现有长期具名 bot 与群之间的身份映射须先设计。当前版本有取消收敛期间的唤醒缺口、无持久报告邮箱，不能以替换 API 自动解决可靠投递。
- Workflow：适合有限并行批处理，其 worker 隔离与取消清理可复用；不能把事件日志当成任意脚本的崩溃续跑保证。
- 实验性 Agent Team：参考其 Lead 日志、消息确认去重、任务 revision CAS 和依赖 DAG。官方不承诺稳定性且当前安装包不含它；只支持单进程共享工作目录、不自动释放任务 owner。不能直接替换当前多个 bot 工作目录。

运行状态由 DSH Session/Agent 负责；项目验收由 Grokbot 的工作包合同与证据负责。阶段不能根据最后一个 job 的 replied 状态自动完成。此次不新增 Beads 运行时账本或第二套独立工作流服务。

## 首批时序修复

WakeScheduler 在 inTransit 时无条件保留后续事件，即使已超过限频窗口也不再 fire。窗口回调没有实际触发执行时不刷新 lastFiredAt。当前协调完成后，未处理事件继续触发下一次协调。

协调在任何异步读取前领取当前批次。群消息、项目状态及计划通过延迟输入，在工作目录锁和原生 Agent.whenIdle 之后读取，避免排队期间的旧状态成为新一轮指令。读取期间的新事件保留给下一批。

原生取消结果不会再进入普通失败的自动重试。当前批次仍显示未处理，既有重试停止；未来新的有效交付事件仍能发起新的协调。这是取消当前协调的语义，不是整个项目的持久暂停。

这些修复尚未提供跨重启的可靠协调邮箱，不能宣称已经完成团队引擎迁移。

## 后续接入验收边界

可靠邮箱需要持久事件标识、消费批次与确认水位；状态和待投递动作应原子提交。重放不能重复派工，旧执行批次不能覆盖新任务。先使用隔离 Session 与虚拟时钟验证，再考虑运行 profile。

任务应区分项目/工作包/执行尝试/验收；解阻需要明确条件，环境阻塞与提供方暂时失败采用不同策略。对外部操作超时先核对结果，不保证任意副作用恰好一次。

必须覆盖：长协调后交付、读取中来事件、两群争用 chief、重复与乱序结果、写入失败、取消后迟到完成、进程重启、Goal 暂停后恢复权限、子任务工作目录与审批归属。原生组件的测试和插件模型回复都不能代替这些组合验收。

## 参考

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/agent-team/README.md
- 本机 @deepseek-ai/dsh-goal-round-driver/README.zh.md
- 本机 @deepseek-ai/dsh-subagent/README.zh.md
- 本机 @deepseek-ai/dsh-llm-retry/README.zh.md
- 本机 @deepseek-ai/dsh-workflow-worker-thread/README.zh.md
