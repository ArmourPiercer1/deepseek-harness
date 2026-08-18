# Agent Note: Team Runtime Release Blockers

Status: implemented

English | [中文](2026-08-18-team-runtime-release-blockers.zh.md)

## Problem

The [team plugin](../feature/2026-08-14-agent-team-plugin.md) shipped with four runtime defects that block a clean version-coupled release. First, the `shutdown` action of `delegate_to_teammate` cleared only the orchestrator bookkeeping: the teammate's child session kept running after the leader considered it stopped. Second, `contextPolicy` was parsed from member definitions and persisted in `team/member-bound` but never consumed: every `run` delegation started a fresh child session, so the default `persistent` strategy — one durable session reused across delegations — never took effect. Third, `dsh-team-channels` declared `Config.controlRequestTimeoutMs` but its `apply` ignored the value, while `dsh-tool-team` hardcoded the same constant in its sweep timer; the timeout configured in `packages/bundle/team/cordis.patch.yml` had no effect. Fourth, `TeamOrchestrator.updateActivity` was called only from tests: nothing populated `lastActivityAt` or `lastAction` at runtime, so the leader's `already_running` response could never report a teammate's in-flight activity.

## Decision

All four fixes stay inside `packages/team/` and consume only public seams:

- **Shutdown interrupts the child.** For a running activation, `shutdown` calls `subagents.interrupt(SessionId(childSessionId), { kind: 'ancestor', agent: leader })` before `markDisposed`. The interrupt is fire-and-return: the stop signal is issued before the tool returns, and the result message says the teammate may keep running briefly. A settled activation skips the interrupt; an absent or disposed activation returns an informational result; a thrown interrupt (for example an authority mismatch) returns an error and leaves the activation running. No new session event is added.
- **`contextPolicy` is consumed on the `run` path.** `persistent` — the default, applied when the field is undefined — delivers a new delegation to a settled teammate's existing child session through the same module-private `deliverFollowup` helper the `follow_up` action uses, then re-records the activation as running. `fresh_per_delegation`, a missing activation, or a disposed activation keep the `startContinuable` path.
- **The sweep timer moved to the config owner.** `dsh-team-channels` now constructs `TeamControlRegistry` directly and registers a `ctx.effect` interval that calls `registry.sweep(Date.now(), config.controlRequestTimeoutMs)`. The cadence is the configured timeout clamped to 1–30 s, so the default 120000 keeps the previous 30-second cadence while a smaller configured timeout is enforced promptly. `dsh-tool-team` no longer owns a timer. The registry is built with `new TeamControlRegistry(ctx)` because `ctx.plugin()` returns a fiber, not the service instance; the `Service` constructor registers it under the owning plugin fiber, which keeps disposal automatic.
- **Activity tracking reads real session events.** The `session/event` listener in `dsh-tool-team` handles `tool/call` before its existing settlement branch: it matches the emitting session against running activations with `findByChildSession(session.id)` and records `updateActivity(memberId, event.data.name)`.

## Alternatives considered

**Dispose the child activation entirely on shutdown.** The subagent seam exposes `interrupt` as the only single-child stop verb; a full teardown exists only per parent root and would stop every child of the leader. Interrupting the current turn and dropping the leader's tracking is the scope the seam supports; the durable session remains and a later `run` starts a fresh delegation.

**Remove `contextPolicy` until implemented.** The plan of record pins the two strategies (`persistent` follows up the same child, `fresh_per_delegation` starts fresh), and the field already crosses the durable `team/member-bound` boundary. Removing it would edit the member-bound payload shape and the parser for more churn than implementing the documented branch.

**Keep the sweep timer in `dsh-tool-team` and read the configured timeout there.** The timeout would remain enforced by a package that declares no config, and the declared `Config` of `dsh-team-channels` would stay dead. Moving the timer places the tunable and its enforcement in one plugin.

**Observe teammate activity from a child-context hook in `dsh-team-runtime`.** The orchestrator instance is closed over by the session-scoped tool plugin; a host-scoped setup contribution reaching it would need a new service or a new runtime event. Extending the leader-side `session/event` listener needed no new surface, and a real-Loader test proves the event reaches it across session scopes.

## Consequences

`persistent` teammates continue one session across `run` delegations — a model-visible change from the previous always-fresh spawn; `fresh_per_delegation` restores the old behavior per member. `controlRequestTimeoutMs` is now genuinely configurable from cordis.yml, and tuning it also changes the sweep cadence within the 1–30 s clamp. The fixes add twelve tests, among them a real-Loader composition that appends a `tool/call` event to a store-created child session and asserts the leader's second delegation names the tool. No new session event type was introduced, so the generated event vocabulary and the version coupling recorded in the [team plugin note](../feature/2026-08-14-agent-team-plugin.md) are unchanged.
