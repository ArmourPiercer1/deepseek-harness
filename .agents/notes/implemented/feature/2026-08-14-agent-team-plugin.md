# Agent Note: Agent Team Plugin Implementation

Status: implemented

English | [中文](2026-08-14-agent-team-plugin.zh.md)

## Problem

The harness had no leader-teammate coordination model: subagents were anonymous per-task delegations with no durable roster, no per-member permission scoping, no leader approval gate, and no team progress board. The team plugin adds these as a capability seam over the continuable-subagent runtime.

## Decision

The agent-team plugin ships as six packages under `packages/team/` plus a bundle at `packages/bundle/team/`, following the capability-seam pattern (Service Definition / Service Provider / Consumer).

| Package | npm name | Role |
|---|---|---|
| `team/team/` | `dsh-team` | Service Definition: types, events, constants, `TeamRegistry` |
| `team/team-local/` | `dsh-team-local` | Service Provider: Markdown definition loader with hot reload |
| `team/team-runtime/` | `dsh-team-runtime` | Consumer: orchestration, MCP guard, approval hook |
| `team/team-channels/` | `dsh-team-channels` | Consumer: `TeamControlRegistry` service, progress store |
| `team/tool-team/` | `dsh-tool-team` | Consumer: 5 model-facing tools |
| `bundle/team/` | `dsh-bundle-team` | Bundle manifest |

Key design decisions:

- **`TeamRegistry` is a concrete Service**, not abstract: one data-loading strategy, no provider polymorphism.
- **Per-member MCP filtering uses `tools.guard()` with runtime `mcp__<server>__` prefix matching**, not startup enumeration, so late-connected servers are covered.
- **The leader definition is metadata only.** The root agent is composed by its preset, never by the registry; `DEFAULT_LEADER_TOOLS` documents the intended leader surface but is not enforced at runtime.
- **Member binding is durable and reconstructable.** `delegate_to_teammate` seeds one `team/member-bound` event through the subagent seam's `delegationEvents` field; a `registerContinuableSetup` contribution reads it on fresh creation and cold resume to reinstall the MCP guard and approval hook. See the [delegation-event-seeding note](../architecture/2026-08-15-continuable-delegation-event-seeding.md).
- **The leader approval gate suspends `requiresApproval` tools** via a scoped `tools/pre-execute` listener that creates a request on the host-level `TeamControlRegistry` (keyed by leader session), wakes the leader through `reportFrom`, and resumes or denies on the decision.
- **Skill filtering was removed**: the field was recorded but never enforced, and there is no per-scope skill-catalog API to enforce it against.

## Alternatives considered

**Reference PilotDeck's `TeammateExtensionResolver` for MCP filtering.** Rejected: it has a known bug where teammates fail to detect MCP mounts; the dynamic prefix guard is independent and correct.

**Modify `dsh-agent`/`dsh-agent-loop` for team primitives.** Rejected: the subagent seam, tool restriction, and scoped registration already provide the needed primitives, and the repo rule is extension points over loop changes.

**Use the workflow engine for orchestration.** Rejected: workflows are stateless fan-out scripts; team members are persistent continuable subagents with follow-up turns.

## Consequences

Teammates are durable continuable subagents whose persona, tool filter, MCP scope, and approval gate are fixed at delegation and reconstructed on cold resume. Teammates never receive `delegate_to_teammate`, `team_control`, or `list_teammates`. The five team tools, the keyed registries, and the approval rendezvous are pinned by unit, integration, and Loader-booted REAL-composition tests. `maxTokens` applies on fresh delegation only (the descriptor omits per-activation budgets).

The team events are durable `SessionEventMap` members and therefore join the harness's generated session-event vocabulary: the persistence read path refuses a log containing a non-ignorable event type it does not know, and `team/member-bound` is required for cold resume. The plugin consequently publishes version-coupled with `@deepseek-ai/dsh-session` rather than as a standalone package. Its only runtime coupling to the base is this vocabulary, isolated to `team/team/src/events.ts`; the plugin keeps that as the single contact point so it can migrate to runtime event registration when the base provides a registration surface.
