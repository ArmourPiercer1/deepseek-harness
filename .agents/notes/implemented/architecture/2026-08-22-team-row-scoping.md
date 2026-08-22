# Agent Note: Preset-row team contributions scope to their standing generation

Status: implemented

English | [中文](2026-08-22-team-row-scoping.zh.md)

## Problem

Full GUI acceptance of the agent-team plugin (issue `20260822-team-acceptance`) found the leader-approval chain broken in any long-lived process: after a page reload or a second team session, every permission-gated teammate call was evaluated twice — two `permission/decision` events and two `team/control-request` entries per `tool/call` — and the leader's `allow_once` on the first request never executed the call, because the second evaluation re-suspended it into a request nobody answered. A second defect made the first `run` delegation after a session switch fail with `Follow-up failed: subagent "…" belongs to another parent session`.

Instrumented reproduction on the dev instance pinned the mechanism: every distinct preset id named by any session in the history list gets its own standing composition (`presenterScopeFor` → `standingKeyFor`), and the deployment carried two presets that both mount `dsh-team-runtime` (shipped `team` plus a user copy). Both generations register a member-setup contribution on the process-global `subagents` activation-setup registry, and `SubagentActivationSetupRegistry.apply()` installed every live contribution into every continuable child with no origin check — one `tools/pre-execute` hook per generation, hence the double evaluation. The orchestrator defect was the same sharing seen from the other side: `dsh-tool-team` holds one `TeamOrchestrator` per plugin instance, one instance per standing generation, and its activations (leader-session facts) were keyed by member id only, so a new leader session inherited the previous leader's settled child and cold-followed-up a child whose durable parent was that other session.

## Decision

- A preset row's continuable-setup contribution installs only into children derived under the same standing composition. The filter reads identity that already exists: `scopeOf(rowCtx)` is the standing scope key (preset rows inherit the scope tag from the mount scope context), and a child derived through `composeFrom` has that key as its scope parent (`scopeParentOf(scopeOf(childCtx))`). A host-plane row carries no scope tag and keeps installing into every team child — deployment-wide reading is correct there because a host row is mounted once.
- `TeamOrchestrator` partitions activations by leader session id: every method takes the leader id, and the `session/event` listener attributes a child's events to the leader via the child header's `parentSession`. Cross-leader reads return nothing, so a stale child session id from another leader can no longer reach `followup`.
- The `enforce`-mode interception of team-internal tools (`report`) stays as engine behavior; the contract is documented in the agent-team cookbook: an `enforce` member's allow list must name the team's own reporting tools.

## Consequences

A preset row whose child is derived under a different generation of itself (a composition edit mid-flight) no longer enforces that child — correct, because the child's own generation carries its own row. The orchestrator retains activations per leader with no cross-leader reuse, which costs nothing since activations were never valid across leaders. `TeamOrchestrator`'s public methods all take the leader session id first, which touches every caller in `dsh-tool-team` and its tests.

## Alternatives considered

Filtering by fiber ancestry (`withinFiber`) — rejected: a child agent's scope fiber is minted from the host-root agent loop, not from the preset subtree, so fiber membership cannot express derivation. Deduplicating registrations in `SubagentActivationSetupRegistry` — rejected: two live generations registering the same contribution are both legitimate; the registry cannot know which children belong to which generation, only the scope chain can. An engine-side exemption for team-internal tools — rejected for `report`: it would place tools outside the every-call evaluation invariant; the cookbook documents the allow-list requirement instead.

## Verification

- `packages/team/team-runtime/tests/member-setup.spec.ts` — four new cases: installs into the own-generation child, skips a foreign-generation child, skips an unparented child, installs everything from an untagged (host) row context.
- `packages/team/team-runtime/tests/orchestrator.spec.ts` and `packages/team/tool-team/tests/settlement.spec.ts` — cross-leader invisibility, per-leader member reuse, same member id under two leaders with distinct children.
- `examples/team-agent/tests/team-e2e.snapshot.ts` passes unchanged (single-generation boot path is byte-stable: ask → allow_once → execute still works).
- `pnpm vitest run packages/team packages/permission packages/subagent packages/preset` and `pnpm run typecheck` green.
