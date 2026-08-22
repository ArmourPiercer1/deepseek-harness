# Agent Note: Team Runtime Release Blockers

Status: implemented

[English](2026-08-18-team-runtime-release-blockers.md) | 中文

## 问题

[团队插件](../feature/2026-08-14-agent-team-plugin.zh.md)交付时带有四个运行时缺陷，阻碍干净的版本耦合发布。第一，`delegate_to_teammate` 的 `shutdown` 动作只清除 orchestrator 的登记状态：leader 认为 teammate 已停止后，其子会话仍在运行。第二，`contextPolicy` 从成员定义解析并持久化进 `team/member-bound`，却从未被消费：每次 `run` 委派都新建子会话，因此默认策略 `persistent`（跨委派复用一个 durable 会话）从未生效。第三，`dsh-team-channels` 声明了 `Config.controlRequestTimeoutMs` 但其 `apply` 忽略该值，而 `dsh-tool-team` 在自己的清理定时器里硬编码同一常量；`packages/bundle/team/cordis.patch.yml` 中配置的超时没有任何效果。第四，`TeamOrchestrator.updateActivity` 只被测试调用：运行时没有任何路径写入 `lastActivityAt` 与 `lastAction`，leader 的 `already_running` 响应因此永远无法报告 teammate 的进行中活动。

## 决策

四项修复全部位于 `packages/team/` 之内，且只消费公开接缝：

- **shutdown 中断子会话。**对 running 状态的激活，`shutdown` 在 `markDisposed` 之前调用 `subagents.interrupt(SessionId(childSessionId), { kind: 'ancestor', agent: leader })`。该中断是 fire-and-return：停止信号在工具返回前发出，结果消息说明 teammate 可能短暂继续运行。settled 状态的激活跳过中断；不存在或已 disposed 的激活返回信息性结果；中断抛错（例如权限不匹配）返回错误且激活保持 running。不新增 session 事件。
- **`contextPolicy` 在 `run` 路径被消费。**`persistent`——默认值，字段缺省时同样适用——通过 `follow_up` 动作使用的同一个模块私有 `deliverFollowup` 辅助函数，把新委派投递给 settled teammate 的现有子会话，随后把激活重新记录为 running。`fresh_per_delegation`、无激活或已 disposed 的激活维持 `startContinuable` 路径。
- **清理定时器移入配置属主。**`dsh-team-channels` 现在直接构造 `TeamControlRegistry`，并注册一个 `ctx.effect` 周期任务调用 `registry.sweep(Date.now(), config.controlRequestTimeoutMs)`。执行周期取配置超时并夹在 1–30 秒之间，因此默认值 120000 保持此前的 30 秒周期，而更小的配置超时能被及时执行。`dsh-tool-team` 不再拥有定时器。注册表用 `new TeamControlRegistry(ctx)` 构造，因为 `ctx.plugin()` 返回 fiber 而非服务实例；`Service` 构造器将其注册在属主插件 fiber 之下，处置仍然自动。
- **活动跟踪读取真实 session 事件。**`dsh-tool-team` 的 `session/event` 监听器在既有结算分支之前处理 `tool/call`：用 `findByChildSession(session.id)` 把发射事件的会话与 running 激活匹配，并记录 `updateActivity(memberId, event.data.name)`。

## 考虑过的替代方案

**shutdown 时彻底销毁子激活。**subagent 接缝只把 `interrupt` 暴露为单个子会话的停止动词；完整拆除只按父根提供，会停止该 leader 的全部子会话。中断当前 turn 并放弃 leader 的跟踪是接缝支持的范围；durable 会话保留，之后的 `run` 会开启新委派。

**在实现之前移除 `contextPolicy`。**计划文档已固定两种策略（`persistent` 对同一 child 执行 followup，`fresh_per_delegation` 每次新建），且该字段已经跨越 `team/member-bound` 这一 durable 边界。移除它需要改动 member-bound 载荷形状与解析器，比实现已文档化的分支更折腾。

**把清理定时器留在 `dsh-tool-team`、在那里读取配置超时。**超时仍将和一个不声明任何配置的包绑在一起，`dsh-team-channels` 声明的 `Config` 继续是死字段。移动定时器让可调参数与其执行落在同一个插件里。

**从 `dsh-team-runtime` 的子上下文钩子观察 teammate 活动。**orchestrator 实例被会话作用域的 tool 插件闭包持有；host 作用域的 setup 贡献要触达它，需要新增服务或运行时事件。扩展 leader 侧的 `session/event` 监听器不需要任何新表面，且一个真实 Loader 测试证明事件能跨会话作用域到达它。

## 后果

`persistent` teammate 跨 `run` 委派延续同一个会话——这是相对此前"每次新建"行为的模型可见变化；`fresh_per_delegation` 按成员恢复旧行为。`controlRequestTimeoutMs` 现在可以从 cordis.yml 真正配置，调整它同时会在 1–30 秒夹取范围内改变清理周期。修复新增十二个测试，其中一个真实 Loader 组合测试向 store 创建的子会话追加 `tool/call` 事件，并断言 leader 的第二次委派点名该工具。没有引入新的 session 事件类型，因此生成的事件词汇表与[团队插件说明](../feature/2026-08-14-agent-team-plugin.zh.md)记录的版本耦合保持不变。
