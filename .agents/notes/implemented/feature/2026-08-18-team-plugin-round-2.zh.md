# Agent Note: Team Plugin Round 2 Implementation

Status: implemented

[English](2026-08-18-team-plugin-round-2.md) | 中文

## 问题

在团队插件初始发布与运行时加固之后，仍有若干底座能力与计划承诺有待落实：
1. 无法在不删除磁盘 Markdown 文件的情况下按工作区启用/禁用 teammate 定义。
2. 技能过滤（`definition.skills`）此前被无依据移除，teammate 在技能加载上未受约束。
3. `send_team_message` 无法向处于非活跃状态（已结算或冷状态）的 teammate 投递消息，且缺少 teammate 间消息中转。
4. 重启 harness 会静默丢失未决控制请求，冷恢复时无对账机制。
5. 原计划中的方案审批决策（`approve_plan` 与 `request_revision`）在控制系统中缺失。
6. leader 默认工具缺少诊断检查以检测宿主组合中的能力缺失。

## 决策

第二轮开发通过模块化子代理分发实现了这些底座能力：

- **按工作区启用控制（N2）**：`dsh-team-local` 在 `team-enablement` 命名空间下集成 `ctx.settings`（`workspacePath -> teammateId -> boolean`）。当前活动工作区中被禁用的定义在注册进 `ctx.team` 前被过滤。设置更新通过 `settings/updated` 监听器实时热重载，无需重启进程。
- **恢复技能过滤（N3、N4）**：在 `TeamMemberDefinition` 与 `TeamMemberBoundData` 中恢复 `skills?: readonly string[]`（冷恢复默认降级为不限制）。通过 `createSkillGuard()` 在子上下文中安装局部 `tools.guard()`，在 `skill` 工具执行边界拒绝未列出的技能。
- **消息投递与中转（N6、N7）**：`send_team_message` 现利用 `subagents.followup` 冷恢复能力向非活跃/已结算的 teammate 投递消息并重新登记激活。teammate 间消息通过 leader 唤醒（带目标说明的 `reportFrom`）进行中转，且投递实现隔离在模块私有 `deliverTeamMessage` 函数接口后。
- **控制请求对账（N8）**：在 `TeamControlRegistry` 中增加 `reconcilePending`。在冷恢复和取消时，孤儿请求被显式以 `deny` 处置，避免无限挂起。
- **方案审批分支（N9）**：在 `TeamControlDecision` 中扩展 `approve_plan`（允许执行）与 `request_revision`（带修订反馈拒绝）。
- **leader 默认工具诊断（N10）**：在 `dsh-team-local` 中增加 `diagnoseLeaderTools()`，比对 `DEFAULT_LEADER_TOOLS` 与已注册工具 schema，并在工具缺失时发出结构化警告。
- **测试与设计交付物（N1、N5、N11）**：补齐 discovery、debounce 与 watcher 的完整单测；记录技能目录 prompt 可见性机制；产出 `maxContextTokens` 设计规范（`AGENT_TEAM_N11_MAXCONTEXTTOKENS_DESIGN.md`）。

## 考虑过的替代方案

- **完整结构化消息队列 broker**：推迟并采用 leader 中转消息方案以维持零新增 session 事件类型，同时保留 `deliverTeamMessage` 抽象边界以备后续升级。
- **插件加载期缺少 leader 工具即硬失败**：由于插件生命周期顺序限制（工具可能在 team 之后异步注册）而放弃；启动诊断警告（B+C 方案）提供了健壮反馈且无假阳性失败。
- **为技能过滤重写 prompt 目录消息**：放弃，因为修改 pre-step 持久化消息违背了模型可见日志约定；工具执行 guard 提供了严格的能力约束。

## 后果

- teammate 可按工作区管理、按技能过滤、非活跃时仍可触达，并能参与方案审批与消息中转。
- 团队全量测试覆盖从 100 个扩展到 183 个单元与集成测试（跨 24 个测试套件）。
- 未新增任何 session 事件类型；所有变更均与现有 session 事件日志及冷恢复保持兼容。
