# Agent Note: Agent Team 插件实现

Status: implemented

[English](2026-08-14-agent-team-plugin.md) | 中文

## 问题

harness 原先没有 leader-teammate 协调模型：subagent 都是按任务划分的匿名委托，没有持久花名册、没有逐成员权限范围划分、没有 leader 审批门禁，也没有团队进度看板。team 插件在可继续 subagent 运行时之上把这些作为能力接缝（capability seam）加入进来。

## 决策

agent-team 插件以 `packages/team/` 下的六个包加上 `packages/bundle/team/` 的一个组合包形式发布，遵循能力接缝模式（Service Definition / Service Provider / Consumer）。

| 包 | npm 名称 | 角色 |
|---|---|---|
| `team/team/` | `dsh-team` | Service Definition：类型、事件、常量、`TeamRegistry` |
| `team/team-local/` | `dsh-team-local` | Service Provider：带热重载的 Markdown 定义加载器 |
| `team/team-runtime/` | `dsh-team-runtime` | Consumer：编排、MCP guard、审批钩子 |
| `team/team-channels/` | `dsh-team-channels` | Consumer：`TeamControlRegistry` 服务、进度存储 |
| `team/tool-team/` | `dsh-tool-team` | Consumer：5 个面向模型的工具 |
| `bundle/team/` | `dsh-bundle-team` | Bundle 清单 |

关键设计决策：

- **`TeamRegistry` 是具体 Service**，而非抽象类：单一数据加载策略，无提供方多态。
- **逐成员 MCP 过滤使用 `tools.guard()` 配合运行时 `mcp__<server>__` 前缀匹配**，而非启动时枚举，因而能覆盖后连接的 server。
- **leader 定义仅为元数据。** 根 agent 由其 preset 组合，绝不由注册表组合；`DEFAULT_LEADER_TOOLS` 记录预期的 leader 暴露面，但不在运行时强制约束。
- **成员绑定是持久且可重建的。** `delegate_to_teammate` 通过 subagent 接缝的 `delegationEvents` 字段植入一条 `team/member-bound` 事件；`registerContinuableSetup` 贡献项在全新创建和冷恢复时读取它以重新安装 MCP guard 和审批钩子。参见[委托事件植入说明](../architecture/2026-08-15-continuable-delegation-event-seeding.md)。
- **leader 审批门禁挂起 `requiresApproval` 工具**：通过作用域内 `tools/pre-execute` 监听器在宿主级 `TeamControlRegistry`（按 leader 会话键控）上创建请求，通过 `reportFrom` 唤醒 leader，并在做出决策后恢复或拒绝。
- **技能过滤待恢复**：首次交付记录了该字段但未强制执行，理由是不存在逐作用域技能目录 API；2026-08-18 审计确认 skill 注册表是 scope 分层的，证伪了该理由，scoped guard 强制已列入[第二轮开发计划](../../../../AGENT_TEAM_PLUGIN_ROUND2_PLAN.md)。

## 备选方案

**参考 PilotDeck 的 `TeammateExtensionResolver` 进行 MCP 过滤。** 不予采纳：它存在已知缺陷，teammate 会无法检测到 MCP 挂载；动态前缀 guard 是独立的且是正确的。

**修改 `dsh-agent`/`dsh-agent-loop` 以支持团队原语。** 不予采纳：subagent 接缝、工具限制和作用域注册已经提供了所需的原语，且仓库规则是优先采用扩展点而非修改 loop。

**使用 workflow 引擎进行编排。** 不予采纳：workflow 是无状态的扇出脚本；团队成员是带后续轮次的持久可继续 subagent。

## 后果

teammate 是持久的可继续 subagent，其 persona、工具过滤、MCP 范围和审批门禁在委托时固定，并在冷恢复时重建。teammate 绝不会收到 `delegate_to_teammate`、`team_control` 或 `list_teammates`。这五个团队工具、键控注册表以及审批汇合点由单元测试、集成测试以及通过 Loader 启动的真实组合（REAL-composition）测试所固定。`maxTokens` 仅在全新委托时应用（描述符按设计省略了每次激活的预算）。

team 事件是持久的 `SessionEventMap` 成员，因此会并入 harness 生成的会话事件词汇表：持久化读取路径会拒绝包含其不认识、且未标记可忽略（ignorable）事件类型的日志，而 `team/member-bound` 是冷恢复所必需。因此该插件随 `@deepseek-ai/dsh-session` 版本耦合发布，而非作为独立包。它对基座唯一的运行时耦合就是这一词汇表，且被隔离在 `team/team/src/events.ts`；插件将该处保持为唯一接触面，以便在基座提供事件注册接口时迁移到运行时事件注册。
