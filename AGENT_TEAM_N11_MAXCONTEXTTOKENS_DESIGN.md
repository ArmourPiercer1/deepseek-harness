# N11 — `maxContextTokens` 设计（Phase 1.7）

制订日期：2026-08-19。本文档是 [第二轮计划](AGENT_TEAM_PLUGIN_ROUND2_PLAN.md) N11 的产出：只读调研 + 设计决策，**不含实现**。
Companion design note for round-2 task N11 (Phase 1.7): read-only investigation plus the design decision for per-teammate `maxContextTokens`. Design only — no implementation.

**摘要 / Summary**：推荐 Option B——在 core `AgentOptions` 增加可选 `maxContextTokens`，由 compaction 层在压力路径做容量钳制（`min(适配器窗口, maxContextTokens)`）；team 定义字段经现有 `team/member-bound` + `agentOptions` 链路传递，与 `maxTokens` 完全同构。冷恢复沿用 `maxTokens` 既有的 per-activation 语义（descriptor 不持久化，重启后回落到模型窗口），列为已知限制并规划 descriptor v3 后续项。不新增 session 事件类型。
**Recommend Option B**: add optional `AgentOptions.maxContextTokens` in core, clamped by the compaction layer in its pressure path (`min(adapter window, maxContextTokens)`); the team definition field flows through the existing `team/member-bound` + `agentOptions` chain, fully parallel to `maxTokens`. Cold resume keeps the established per-activation semantics of `maxTokens` (not persisted in the descriptor; the cap relaxes to the model window after restart) — recorded as a known limitation with a descriptor v3 follow-up. No new session event types.

---

## 1. 调研结论 / Findings

### 1.1 上下文压缩在哪里触发（Q1）

Compaction is triggered **during the agent loop, at step boundaries and on request failure** — by the compaction backend plugin, not by the loop core. The loop (`packages/core/agent-loop`) only exposes the extension points; it never budgets context itself.

Three trigger paths, all in `packages/compaction/compaction-basic/src/index.ts` (`BasicCompactionEngine`, mounted as `ctx.compaction` in the standard/cordis/code agent presets and the base bundle):

1. **Step-boundary pressure (primary, automatic).** A `ctx.on('agent/pre-step', …)` waterfall listener runs before every step's model request (i.e. between steps inside a turn, not before the turn). It calls `compactIfNeeded(agent, 'pressure', signal)`:
   - Measures the session with the singleton `ctx.tokenMeter` service — a replay-aware meter that re-anchors on the latest provider `usage` when the request envelope matches, otherwise heuristically reprices the whole surface.
   - Threshold: `thresholdTokens = floor(contextWindow × thresholdRatio)` (default `0.8`), where `contextWindow` comes **live** from `ctx.llm.resolveModelInfo(provider, model).context` (adapter catalog capacity for the exact routed target, overridable per provider/model via `modelPolicies`).
   - When `totalTokens >= thresholdTokens`: run the optional model-free `toolResultPruner` first, remeasure, then up to `compactionRetries + 1` (default 2) LLM-summary compactions of a selected surface span (retaining the recent tail `retainTokens = floor(contextWindow × retainRatio)`, default `0.16`, or an absolute `retainTokens`), until below threshold; a still-over-threshold result throws and is contained as a warning — the turn continues.
2. **Context-overflow recovery.** A `ctx.on('agent/request-error', …)` waterfall listener reacts to provider-confirmed `CONTEXT_WINDOW_EXCEEDED` failures: forces one balanced reduction (`selectCompactableRange(…, 0)`, bypassing the threshold), and returns `{ kind: 'retry' }`. Bounded by `maxOverflowRetries` (default 1), reset on the next successful `assistant/message` or `idle` status.
3. **Manual.** The `/compact` command (`packages/compaction/command-compact`) calls `ctx.compaction.compactNow(agent, …)` — an idle-session maintenance task between turns, allowed below the pressure threshold.

The abstract seam is `CompactionEngine` (`packages/compaction/compaction/src/index.ts`) with `compactIfNeeded` / `compactNow` / `compactRegion`; backends own trigger policy. **Team children are covered automatically**: the pre-step listener is registered on the host context and dispatches to every agent (scope-filtered), so any compaction-basic mounted in the running composition compacts teammate child sessions too.

### 1.2 `maxTokens` vs 上下文窗口预算（Q2）

**`maxTokens` is an output cap; the context window is not an `AgentOptions` concept at all.**

- `AgentOptions` (`packages/core/agent/src/runtime-types.ts`) is documented as *"Merge-extensible agent creation options"* and currently is `{ provider?, model?, maxTokens? }`. `maxTokens` = maximum **output** tokens per conversation-model request; it maps 1:1 onto the `LlmCallConfig.maxTokens` request-wire field.
- Flow in the loop (`packages/core/agent-loop/src/agent.ts`, `buildRequest`): the first request seeds `maxTokens` from `this.options.maxTokens` into the proposed config; the `agent/request` waterfall may replace the config; `ctx.llm.prepareCall(config)` materializes adapter defaults; the resolved config is durably logged as a `request/header` event, and **all later requests derive from the logged header** (`requestProposal`), so mutating `options.maxTokens` mid-conversation has no effect.
- Validation: `assertAgentOptions` (positive safe integer) at agent create/resume — the same path subagent children take (`agents.createAgent` → `setupAndPublish` → `prepare` → `assertAgentOptions`); plus the agent-loop `Config.agents` schema for declarative `cordis.yml` agents.
- The **context window** is an adapter catalog fact: `LlmResolvedModelInfo.context.contextWindow` per exact provider/model. The loop logs it as the `request/context` session event `{ provider, model, contextWindow }` on change (`session.requestContext()`). Current production readers of that event: only the token-meter context-pressure projection (UI context display) — nothing that budgets.
- **All context budgeting lives in the compaction layer**: `resolveCompactSpec(policy, contextWindow)` (compaction-basic `config.ts`) derives `thresholdTokens` and `retainTokens` from the capacity and the ratios above. The loop's only reaction to token pressure is the `max-tokens` finish reason (sticky turn outcome) for the output cap.

### 1.3 Team 侧现状（`packages/team/team/src/types.ts`）

- `TeamMemberDefinition` already carries `provider`, `model`, `maxTokens` (*"Max output tokens per request"*), `contextPolicy: 'persistent' | 'fresh_per_delegation'`, tools/mcp/approval policies. **No context-window field.** The team README's Known Limitations state: *"`maxContextTokens` is not modeled in `TeamMemberDefinition`; context-window limiting is deferred to compaction-layer integration."*
- Delegation wiring (`packages/team/tool-team/src/tool-delegate.ts`): member fields are copied into (a) the durable `TeamMemberBoundData` payload of the `team/member-bound` event seeded into the child log, and (b) the process-local `request.agentOptions` for child creation. `maxTokens` flows through both today.
- **Per-activation semantics are an explicit, documented subagent decision.** The subagent descriptor (`packages/subagent/subagent/src/descriptor.ts`) deliberately omits per-activation knobs: *"Per-activation knobs such as `maxTokens` are omitted for the same reason as `outputSchema`: they budget one activation. … it neither restores the prior budget nor inherits the parent's current one; the resumed route's defaults apply instead."* Cold resume reconstructs child `agentOptions` from the descriptor's `agentProvider`/`agentModel` only (`continuation.ts` cold-resume path). The descriptor is versioned (`SUBAGENT_DESCRIPTOR_VERSION = 2`), strict on unknown keys, and a version mismatch makes a child `NOT_RESUMABLE`.
- Team-local validation is light: the parser accepts `maxTokens` when `typeof frontmatter['maxTokens'] === 'number'`; `validateTeamDefinitions` does not range-check it. The fail-loud point is `assertAgentOptions` at first delegation.

### 1.4 Why Option A is not a pure plugin-layer change

The threshold/retention computation is private to `compaction-basic.compactIfNeeded`. Its only per-agent inputs are the narrow `CompactionAgentContext` view (`session` + `options: { provider?; model? }`) and the agent's session log. There is no existing per-agent budget channel, and a team plugin **cannot** steer the global engine from outside: the `agent/request` waterfall replaces only `LlmCallConfig` (no context-window field), and a scope-shadowed `compaction` service would not intercept the global engine's own pre-step dispatch. So every Option-A flavor still ends up modifying the compaction layer; the only question is what per-agent value it consumes and who owns that value.

---

## 2. 方案比较 / Options compared

### Option A — compaction 层 per-member 阈值覆盖

The per-member budget reaches compaction through one of:

- **A1.** `compaction-basic` scans the child session's `team/member-bound` events and clamps the capacity.
- **A2.** `team-runtime` registers a per-agent budget annotation (optional service or scoped value) that compaction-basic consults via `ctx.get`.
- **A3.** `team-runtime` installs a per-scope `CompactionEngine` for each child that clamps and delegates to the global engine.

Costs: A1 couples a generic compaction backend to team event vocabulary (inverted ownership — the backend must not know teams). A2 creates a new optional seam with exactly one consumer (the "public service method with one internal caller" smell flagged in `packages/AGENTS.md`). A3 requires compaction-basic to change its dispatch so the pre-step listener resolves the engine from the agent's scope — the most invasive change to compaction semantics. None of the three makes the budget available to non-team agent creation paths (plain subagents, ACP, SDK, declarative agents), and the §1.8 precedence chain (*env override > teammate definition > leader config > agent defaults > model catalog*) has no stable landing point outside team glue code.

### Option B — 扩展 core `AgentOptions`

Add optional `AgentOptions.maxContextTokens` (effective context-window cap for this agent's conversation, in tokens). The compaction layer clamps the capacity: `effectiveCapacity = min(adapter contextWindow, agent.options.maxContextTokens)`; ratios, `modelPolicies`, and the overflow path are unchanged. Team wires `maxContextTokens` in the member definition → bound payload → agentOptions, exactly parallel to the existing `maxTokens` flow.

Core deltas: `AgentOptions` (one optional field on an interface documented as merge-extensible), `assertAgentOptions` + the agent-loop `Config` schema (fail loud at creation), `CompactionAgentContext.options` (type-only), and the clamp in compaction-basic's pressure path. All additive; zero behavior change when omitted.

### Comparison

| Criterion | Option A (compaction per-member) | Option B (AgentOptions extension) |
|---|---|---|
| Core packages touched | None | `core/agent` (type), `core/agent-loop` (validation + schema) — additive |
| Compaction change | Substantial: a per-agent value channel (team-event scan, new one-consumer seam, or scope-dispatch change) | Small: one clamp in the pressure path + one type field |
| Coupling | Compaction (generic backend) learns team vocabulary, or a one-consumer seam is created | Team stays a pure producer; compaction stays model-agnostic |
| Generality | Team members only | Every agent-creation path (subagents, ACP, SDK, declarative agents) |
| §1.8 precedence chain | Lives in team glue; each layer must reinvent the channel | The chain resolves into one field at definition/leader/env time |
| Fail-loud validation | Parser level + trigger-time compaction warning | Parser + `assertAgentOptions` at creation + declarative schema (earliest) |
| Symmetry | Asymmetric: `maxTokens` (output cap) is an AgentOptions field; the context cap is not | Symmetric: both caps are per-agent request knobs |
| Blast radius | Smaller for core | Small, pre-release window, purely additive |

---

## 3. 推荐 / Recommendation (Phase 1.7)

**Option B.** Rationale: the per-agent context budget is an agent-level request knob, the sibling of `maxTokens`; the agent seam owns it, the compaction seam consumes it — the same owner/consumer split as today. It keeps the generic compaction backend team-agnostic, keeps team a pure producer over its existing durable channel, is reusable by every other agent-creation path, and its core delta is additive and fail-loud in the pre-release window the repo prefers ("foundation over blast radius").

### Semantics

- `maxContextTokens` is a **soft compaction budget**: `effectiveCapacity = min(adapter contextWindow, maxContextTokens)` feeds `resolveCompactSpec`, so both `thresholdTokens` and ratio-based `retainTokens` scale to the member's budget. The provider's actual capacity is unchanged; a request that still overflows the real window is handled by the existing provider-confirmed overflow-recovery path.
- `maxContextTokens >= contextWindow` is a documented no-op (the clamp is a `min`).
- Applies to the pressure path only; the overflow-recovery path and the summarization call's own `maxTokens` (default 8192) are untouched.

### Change list (for the implementation round)

1. `packages/core/agent/src/runtime-types.ts` — `AgentOptions.maxContextTokens?: number`. JSDoc: effective context-window cap for this agent's conversation in tokens; compaction pressure policy treats the routed model as having at most this capacity; the provider's actual capacity is unchanged.
2. `packages/core/agent-loop/src/index.ts` — extend `assertAgentOptions` (positive safe integer, mirroring `maxTokens`); add the field to the `Config.agents` schema for declarative agents.
3. `packages/compaction/compaction/src/index.ts` — `CompactionAgentContext.options.maxContextTokens?: number` (type-only view extension).
4. `packages/compaction/compaction-basic/src/index.ts` — in the `compactIfNeeded` pressure branch, clamp `context.contextWindow` before `resolveCompactSpec`. Design detail: `TargetPressureConfigError.targetKey` is currently `${provider}/${model}` and drives once-per-target warning suppression; if the clamp triggers the retain-vs-threshold conflict, extend the key with the effective capacity so distinct per-agent budgets each warn once.
5. `packages/team/team/src/types.ts` — `TeamMemberDefinition.maxContextTokens?: number` and `TeamMemberBoundData.maxContextTokens?: number` (additive payload extension; cold resume: field absent = no cap, backward compatible; **no new session event type**).
6. `packages/team/team-local/src/parser.ts` (+ validation) — parse frontmatter `maxContextTokens`, mirroring the existing `maxTokens` handling and fail-loud point.
7. `packages/team/tool-team/src/tool-delegate.ts` — spread the field into the `bound` payload and `request.agentOptions`, mirroring the `maxTokens` spreads.

### Deliberate non-changes (record in the Agent Note)

- **No descriptor version bump.** `maxContextTokens` takes the same per-activation semantics as `maxTokens` today: the descriptor deliberately omits per-activation knobs, and cold resume applies the resumed route's defaults. Consequence: after a process restart, a persistent teammate's cap silently relaxes to the full model window until the next delegation re-applies it. This is a **known limitation** — replace the team README's "not modeled" line with the modeled-but-per-activation wording (bilingual) — and the designated follow-up is a descriptor v3 that persists **both** `maxTokens` and `maxContextTokens` (one version bump, one Agent Note, symmetric for both knobs, owned by the subagent seam).
- The `request/context` event and its projections stay adapter capacity (UI context bar unaffected). Recording the *effective* capacity there and switching compaction to read the logged context instead of calling `resolveModelInfo` live is a clean follow-up, not Phase 1.7.
- The leader uses the same definition schema, so a leader `maxContextTokens` works unchanged. Phase 1.7 realizes only the definition level of the §1.8 precedence chain; env/leader-config override layers are future work.

### Test plan (for the implementation round)

- `compaction-basic` unit: clamp on/off (threshold **and** retain scaling under the clamp), no-op when the cap exceeds the window, retain-vs-threshold warning key under per-agent budgets.
- `agent-loop`: `assertAgentOptions` rejection cases (0, negative, non-integer) mirroring the existing `maxTokens` specs (`loop.spec.ts`).
- `team-local` parser/validation: frontmatter parsing plus invalid values.
- `tool-delegate`: `bound` payload + `agentOptions` spread (existing test patterns).
- Cold resume: pin the current per-activation semantics (cap absent after resume) as a regression test.
- Keyless snapshot: early compaction is model-visible (summary nodes in the transcript); per the testing policy, the implementation PR needs a keyless snapshot through a real runnable example — extend the headless-agent compaction snapshot example or add a team+compaction example.

### Risks / open questions

- If the team later requires the cap to survive restarts, the descriptor v3 follow-up is the designated path (seam owned by `packages/subagent`).
- `fresh_per_delegation` members start at ~0 tokens, so the cap rarely triggers for them — harmless and consistent.
- `packages/context/` (request-context injection plugins) is **not** involved in window budgeting: pre-step-injected context is just surface content priced by the token meter like anything else. No change needed there.
