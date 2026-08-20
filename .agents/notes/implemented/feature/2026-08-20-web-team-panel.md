# Agent Note: The Web team panel Conversation Node (progress board and teammate status)

Status: implemented

English | [中文](2026-08-20-web-team-panel.zh.md)

## Problem

The team plugin's Web surface was the read-only `settings.section` configuration block. A leader session doing team work — delegating through `delegate_to_teammate`, updating task state through `team_progress` — rendered nothing about that work in the conversation: no progress board, no teammate state. Round 3 task M7 defines the MVP: a task progress panel consuming `team/progress` plus teammate status display (bound/running/settled); the `team/message` timeline is explicitly out of this batch per plan decision D7.

## Decision

- One `ConversationNodeDefinition` (`kind: 'team-panel'`, target `chat`) lives in [dsh-client-ui-team](../../../../packages/client/ui-team/README.md). It matches two durable event shapes of the current (leader) session — `team/progress` and `tool/call` for the `delegate_to_teammate` tool — all as `role: 'update'` under one Context id `board`. The family is checkpoint-based: every `team/progress` event carries the task's complete current value and no start event exists, so `buildViewNode` folds the Context's own matches (the startless checkpoint pattern the engine keeps pending until a start, with the fallback built directly). `start` and `update` fold the same matches if the engine ever invokes them, keeping replay deterministic by log seq.
- The keyed renderer registers into `conversation.chat.node` under key `team-panel` with the package locale seat, following the [Conversation Node cookbook](../../../../docs/cookbook/adding-a-conversation-node.md). Node data is the fold: latest event per `taskId` in first-seen order plus the sorted de-duplicated `delegate_to_teammate` targets.
- Teammate rows come from the framework kit, not from events: the component selects the parent-addressed subagent catalog through `useSessions` and reads the `team:`-labeled continuable children — the label prefix the delegate tool mints on every teammate child session.
- Row status is derived per row: `running` while the child's store-snapshot activity is running; `settled` for an inactive child whose name appears among the window's delegation targets; `bound` otherwise. Catalog labels carry the member name while delegate calls carry the member id — independent frontmatter fields — so the join is best-effort by name and is documented as MVP semantics in the package README.
- The change stays client-plane: no new host service, no new session event, no event structure change. The `dsh-team` import is type-only (it carries the `SessionEventMap` merge and payload types); value imports are limited to the bundle externals (react, ui-primitives, the runtime client face), so the client bundle purity gate is untouched. `tool/call.arguments` is model JSON and is parsed at that boundary: malformed or absent `teammate_id` produces no delegation fact.

## Alternatives considered

**A per-task Context started by the first `team/progress` event.** Rejected: the producer emits whole-value checkpoints with no dedicated start, and "first event in the loaded window" is not a stable business identity — the loaded window can be a mid-history page, and the cookbook forbids assigning updates to a synthetic "latest" Context.

**A per-session team store fed by session-event listeners.** Rejected: business components contain no subscription machinery, and the Conversation Node engine is the sanctioned channel for durable event families; the catalog half arrives through the standing `useSessions` seat.

**Deriving teammate rows from `team/member-bound`.** Rejected: that event is appended to the child's own log and never reaches the leader's conversation window; the catalog label is the client-side team signal.

**Per-row delegation join by member id.** Rejected for this batch: the catalog exposes no member id (labels only), and the message timeline batch that renders per-teammate detail is the right home for the id-carrying join.

## Consequences

- The panel appears in the conversation at the first team event of the loaded window and updates as events flow; prepending an older page adds earlier tasks to the same node (stable key, relocated anchor) and can reorder the task list by first-seen position.
- The `delegated` fact silently drops unparseable delegate arguments; a window with only such calls renders no node.
- Teammate rows depend on the catalog pull; while it loads, the group shows its empty state and fills in on arrival.
- The `team/message` timeline remains deferred with the dock bar and settings-section editing; the package README's Known Limitations section is the live record.
- Verification: the focused spec `packages/client/ui-team/tests/team-panel.client.spec.tsx` (assembler replace/prepend/append replay, the model-JSON boundary, component render, and the HMR-safe fiber lifecycle proving disposal) and the built-artifact spec `packages/client/ui-team/tests/client-bundle.client.spec.ts` (handoff id, export shape, real-ring registration and disposal).
