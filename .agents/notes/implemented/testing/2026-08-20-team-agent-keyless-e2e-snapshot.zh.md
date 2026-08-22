# Agent Note: team-agent keyless end-to-end snapshot

Status: implemented

[English](2026-08-20-team-agent-keyless-e2e-snapshot.md) | 中文

## Problem

shipped 的 `team` agent preset 与 team 能力的 model-visible 行为（委派、leader 审批 rendezvous、挂起 gate 的冷恢复、工作区 teammate 发现）在装配后的应用层面没有 keyless 回归测试。审计将其记为 S11 欠账：team bundle 既无 shipped 挂载点，也没有集成测试。各包级测试只覆盖单个插件的隔离行为，没有任何一个测试通过 Loader 以真实 profile 组合、真实会话持久化和真实的崩溃/重启边界启动 shipped preset。因此第三轮计划要求一条 REAL-composition 端到端路径——委派 → teammate 执行 → 审批 → 冷恢复 → 工作区发现——并按测试政策为 model-visible 的团队交互补充 keyless snapshot。

## Decision

该场景由 `examples/team-agent/` 叶子承载。其驱动以**同一个临时 home 上的两个阶段**运行（`DSH_TEAM_DRIVER_PHASE=crash|recover`），每个阶段都在 shipped 的 base + web-app bundle 之上启动 profile，并以 shipped 的 `team` preset（`apps/cli/config/agent-presets/team/`）作为组合入口；唯一的模型路由是一个确定性脚本化适配器（`team-mock-llm.mjs`），注册为 profile 本地插件。场景如下：

1. **Crash 阶段（boot one）。** workspace-a 中的 leader 会话把 `WRITER_TASK` 委派给工作区 `writer` teammate。writer 先以一次读做热身，随后调用受审批门禁的 `write` 工具，leader 的审批 rendezvous（子日志中的 `team/control-request` → 被转向的报告 → `team_control decide` → leader 日志中的 `team/control-decision`）放行它；writer 校验后结算。随后 leader 把 `SENTRY_TASK` 委派给 `sentry`，其受门禁的 `write` 在 leader 拒绝决策（重启前规则）时挂起。两处门禁都是 `permissionMode: default` 下的内联 `ask: [Write]` 规则——[强制钩子](../architecture/2026-08-20-teammate-permission-enforcement-at-the-executor.zh.md)的 ask 路径；watch 写入 `notes/watch.txt`，因为规则语言没有任何形式能匹配 `todo_write`。之后驱动**硬崩溃进程**：等已结算的 writer 离开 live store（其退役 drain 已持久化日志尾部）、并 flush 仍驻留的 leader 与挂起的 sentry（即时持久化屏障）之后，不做 fiber dispose 直接退出。持久化前缀因此恰好止于 sentry 悬空的 `team/control-request`（无结果），子会话 id 记录到 stdout 供调用方转交。
2. **Recover 阶段（boot two）。** 第二次驱动启动携带转交的子会话 id（`DSH_TEAM_CHILD_SESSIONS`）在同一 home 上重新启动。被恢复的 leader 的 `agent/created` 事件把 `team-local` 的发现重新指向 workspace-a，用工作区集合（工作区 `team-leader` + `writer` + `sentry`）遮蔽 `$DSH_HOME/teammates` 集合（home 的 `home-member` 不会出现在列表中）。leader 列出 teammates，发现其重启前的 decide 已不再可解析（来自全新内存注册表的 `Error: Unknown control request: …`），通过 `subagents.followup` 重新驱动 sentry（子会话不在 live store 中，因此是冷恢复），并在新请求到达后批准它，团队结算。sentry 的冷恢复演示了挂起 gate 的修复（`TOOL_OUTCOME_UNKNOWN`——`tool/call` 在门禁前已持久化，因此加载期崩溃修复按未知而非未开始闭合，并补一条 interrupted 回合闭合事件）与成员 skill 守卫（`Skill "beta" is not authorized for this team member`）。

snapshot 测试（`tests/team-e2e.snapshot.ts`）以 keyless 方式在同一个共享临时 home 上启动两个阶段来重放该场景，读取三份持久化 `session.jsonl` 日志，归一化（`normalizeSessionLog` + `scrubRequestHeaders`）后与 `tests/snapshots/team-e2e/` 下的入库 golden 比较。golden 的确定性依赖脚本化串行化：每个子代理在发出 leader 可见事件（审批报告或结算通知）之前，始终比 leader 当前回合的尾部领先至少一个完整模型步骤（热身读；writer 另有一次写后校验读），因此每个审批报告和结算通知都确定性地开启一个全新的 leader 回合。

## Alternatives considered

**每包一个 `tests/snapshot/` 入口。** 计划文本曾写 `tests/snapshot/team-*`，但 snapshot harness 只包含 `examples/*/tests/**/*.snapshot.ts`，且测试政策要求 snapshot 启动真实可运行的组合，而非包私有 fixture。计划自身的文件域已授权"视 snapshot harness 要求使用 examples 下的 team 例子入口"，因此 examples 放置是对计划的正确解读。

**用真实（在 wire 层 mock）的 LLM 驱动子代理。** wire 层 mock 会让 transcript 的时序与交错交给运行时，使 golden 存在竞态。adapter 层脚本化模型仅依据可见历史决定每个响应（不与驱动共享状态），并把子代理的动作节奏压在 leader 之后一个模型步骤，从而固定交错顺序。

**等待实时的 `team/member-bound` 事件来识别子会话。** `team/member-bound` 是构造期种子事件，构造期种子不会在 `session/event` 火道上发出，只能从持久化日志读取。驱动改为从 `team/control-request` 捕获成员→子会话映射：它在回合中途追加，携带成员 id，且以子会话为事件主体。

**两代 boot 之间用进程内软崩溃（fiber dispose）。** 在 gate 挂起时 dispose fiber 的单进程方案看似是重启，但 dispose 会中止挂起的工具执行，审批 hook 的 abort 路径以 deny 结果结算该请求——日志保持配平，冷恢复永远看不到悬空的 `tool/call`，被测的修复路径不会触发。崩溃必须是审批 hook 无法清理的真实进程死亡，而单次 `runLoaderSmoke` 无法表达（它每次启动独占并删除自己的 cwd），因此采用两阶段驱动与共享 home 的测试启动。

## Consequences

该场景在装配层面固定了完整审批 rendezvous、崩溃/重启边界与工作区发现重指向，因此 team 事件载荷、修复码或发现遮蔽的任何回归都会 keyless 失败。代价是每次运行要启动两代 profile（数十秒），以及脚本化模型的耦合：若 shipped 的 prompt、工具渲染或审批报告的文本变化，golden 与适配器基于字符串的 marker 必须一起重新推导（refresh 模式）。热身/校验步骤只为保持 leader 回合边界确定而存在，是场景内容，不是产品行为。

## Testing

`pnpm vitest run --config vitest.snapshot.config.ts examples/team-agent/tests/team-e2e.snapshot.ts` keyless 重放两个阶段与三份 golden（默认 src 模式；CI 构建后为 lib 模式）。重复重放在归一化日志上逐字节稳定，这是上述串行化设计的确定性闸门。
