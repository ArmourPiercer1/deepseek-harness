# Agent Note: team-agent keyless end-to-end snapshot

Status: implemented

English | [中文](2026-08-20-team-agent-keyless-e2e-snapshot.zh.md)

## Problem

The shipped `team` agent preset and the team capability's model-visible behavior (delegation, the leader approval rendezvous, cold recovery of a suspended gate, workspace teammate discovery) had no keyless regression at the assembled-application level. The audit recorded it as S11 debt: the team bundle had no shipped mount and no integration test. Package-level tests cover each plugin in isolation, but none of them boots the shipped preset through the Loader with real profile composition, real session persistence, and a real crash/restart boundary. The round-3 plan therefore required a REAL-composition end-to-end path — delegation → teammate execution → approval → cold recovery → workspace discovery — plus keyless snapshots of the model-visible team interaction per the testing policy.

## Decision

The `examples/team-agent/` leaf carries the scenario. Its driver runs as **two phases over one temporary home** (`DSH_TEAM_DRIVER_PHASE=crash|recover`), each phase booting the shipped base + web-app bundles with the shipped `team` preset (`apps/cli/config/agent-presets/team/`) as the composition entry; the only model route is a deterministic scripted adapter (`team-mock-llm.mjs`) registered as a profile-local plugin. The scenario:

1. **Crash phase (boot one).** A leader session in workspace-a delegates `WRITER_TASK` to the workspace `writer` teammate. The writer warms up with a read, calls the approval-gated `write` tool, and the leader's approval rendezvous (`team/control-request` in the child log → steered report → `team_control decide` → `team/control-decision` in the leader log) releases it; the writer verifies and settles. The leader then delegates `SENTRY_TASK` to `sentry`, whose approval-gated `todo_write` suspends while the leader declines to decide (pre-restart rule). The driver then **hard-crashes the process**: after the settled writer leaves the live store (its retirement drain persists the log tail) and after flushing the still-resident leader and the suspended sentry — the immediate durability barrier — it exits without the fiber dispose. The durable prefix therefore ends at sentry's pending `team/control-request` with no result, and the child session ids are recorded to stdout for the caller to relay.
2. **Recover phase (boot two).** A second driver launch re-boots the same home with the relayed child ids (`DSH_TEAM_CHILD_SESSIONS`). The resumed leader's `agent/created` re-points `team-local` discovery at workspace-a, shadowing the `$DSH_HOME/teammates` set with the workspace set (workspace `team-leader` + `writer` + `sentry`; the home `home-member` never appears). The leader lists teammates, discovers its pre-restart decide no longer resolves (`Error: Unknown control request: …` from the fresh in-memory registry), re-drives sentry through `subagents.followup` (a cold resume, since the child is not in the live store), and approves the fresh request once it arrives; the team settles. Sentry's cold resume demonstrates the suspended gate's repair (`TOOL_OUTCOME_UNKNOWN` — the `tool/call` persisted before the gate, so the load-time crash repair closes it as unknown, not not-started, with an interrupted turn closer) and the member skill guard (`Skill "beta" is not authorized for this team member`).

The snapshot test (`tests/team-e2e.snapshot.ts`) replays this keyless by spawning the two phases against one shared temporary home, reads the three durable `session.jsonl` logs, normalizes them (`normalizeSessionLog` + `scrubRequestHeaders`), and compares against checked-in goldens under `tests/snapshots/team-e2e/`. Determinism of the goldens rests on scripted serialization: every child keeps at least one full model step (its warm-up read, and for the writer a post-write verification read) ahead of the leader's current turn tail before it emits a leader-visible event, so each approval report and settlement notice deterministically opens a fresh leader turn.

## Alternatives considered

**A per-package `tests/snapshot/` entry.** The plan text named `tests/snapshot/team-*`, but the snapshot harness only includes `examples/*/tests/**/*.snapshot.ts`, and the testing policy requires the snapshot to boot the real runnable composition rather than a package-owned fixture. The plan's own file domain authorized "examples 下的 team 例子入口，视 snapshot harness 要求", so the examples placement is the correct reading.

**Driving the children with a real (mocked-at-the-wire) LLM.** A wire-level mock would leave the transcript's timing and interleaving to the runtime, making the goldens racy. The adapter-level scripted model decides every response from visible history alone (no driver-shared state) and paces child actions one model step behind the leader, which pins the interleaving.

**Waiting for live `team/member-bound` events to identify child sessions.** `team/member-bound` is a constructor-seed event and constructor seeds do not emit on the `session/event` firehose, so it is only readable from the durable log. The driver instead captures the member→child-session map from `team/control-request`, which is appended mid-turn and carries the member id with the child session as subject.

**A soft in-process crash (fiber dispose) between the two boots.** A single process that disposes the fiber with the gate pending looks like a restart, but the dispose aborts the suspended tool execution and the approval hook's abort path settles the request with a deny result — the log stays balanced and the cold resume never sees the dangling `tool/call`, so the repair under test never fires. The crash must be a real process death that the approval hook cannot clean up, which a single `runLoaderSmoke` launch cannot express (it owns and deletes its cwd per launch), hence the two-phase driver and the shared-home test spawn.

## Consequences

The scenario pins the full approval rendezvous, the crash/restart boundary, and the workspace-discovery re-point at the assembled level, so any regression in team event payloads, repair codes, or discovery shadowing fails keyless. The cost is a two-boot profile start per run (tens of seconds) and a scripted-model coupling: if the shipped prompt, tool rendering, or the approval report's text changes, the goldens and the adapter's string-based markers must be re-derived together (refresh mode). The warm-up/verification steps exist solely to hold the leader's turn boundaries deterministic; they are scenario content, not product behavior.

## Testing

`pnpm vitest run --config vitest.snapshot.config.ts examples/team-agent/tests/team-e2e.snapshot.ts` replays the two phases and the three goldens keyless (src mode by default; lib mode in CI after a build). Repeated replays are byte-stable on the normalized logs, which is the determinism gate for the serialization design above.
