# Agent Note: 可续子代理委派事件播种

Status: implemented

[English](2026-08-15-continuable-delegation-event-seeding.md) | 中文

## Problem

可续（continuable）子代理在冷恢复时，从 `subagent/descriptor` 事件重建自身组合；该事件刻意只快照显式字段（`provider`、`label`、`agentProvider`、`agentModel`、`persona`、`toolFilter`），并省略 per-activation 的旋钮（如 `maxTokens`）以及任何消费者自有的策略。需要在 descriptor 之外持久化 per-child 组合的消费者——例如 team 插件的成员绑定（`memberId`、`role`、MCP allowlist、审批门控工具）——在子代理的 setup 贡献运行之前，没有任何通道把这些状态写入子代理自己的 durable log，因为 `startContinuable` 在内部构建 seed，且不提供 per-delegation 的事件输入。

## Decision

`ContinuableStartSpec` 新增一个可选的 `delegationEvents` 字段：一个基于 `SessionEventMap` 的 `{ type, data }` 判别联合。`seedDescriptorTurn` 在 `subagent/descriptor` turn 与任何 fork seed 之后、按序把这些事件追加到子代理自己的 suffix 中，使 `coldResume` 的 `events.slice(seedLength)` 能逐字重建它们。`Session.append` 在追加点重新校验 lossless-JSON，因此坏载荷会在子代理建立之前拒绝 `startContinuable`。缺省为 no-op：既有的一次性（one-shot）与可续调用方保持不变；字段放在 `ContinuableStartSpec` 而非 `SubagentStartRequest` 上，使 one-shot 路径与 provider 能力面保持原样。

team 插件消费这一机制的方式是：每次委派播种一个 `team/member-bound` 事件，并注册一个 `registerContinuableSetup` 贡献，该贡献从子代理 session 读取该事件，在首次创建与冷恢复时都安装成员的 MCP guard 与权限强制钩子。

## Alternatives considered

**扩展 `SubagentStartRequest`，增加 `guard`/`composition` 字段。** 拒绝：guard 是执行期状态而非 durable 组合，且把它贯穿共享 request 会迫使 one-shot 路径与 provider 能力旗标为仅可续需求做改动。

**把 `maxTokens` 放进 descriptor（提升 `SUBAGENT_DESCRIPTOR_VERSION`）。** 暂时拒绝：descriptor 的 JSDoc 把 `maxTokens` 视为 per-activation 预算而非 durable 组合，且版本提升是跨切面改动。team 接受 `maxTokens` 仅在首次委派时生效。

**进程内的 `childId → binding` 映射，在 setup 前填充。** 拒绝：`startContinuable` 在内部预留 child id，因此调用方在 seed 构建完成后才知道 binding；进程内映射也无法跨重启存活。

## Consequences

现在存在一个通用的、durable 的 per-delegation 事件通道，任何可续子代理消费者都可使用。team 成员绑定可仅从子代理 log 重建，弥合了此前使 MCP 作用域与审批门控失效的冷恢复缺口。one-shot 子代理路径与所有既有的 `startContinuable` 调用方保持不变；代价是一处小型、有文档的 seam 扩展，以及消费者只能追加 lossless-JSON 事件的要求。
