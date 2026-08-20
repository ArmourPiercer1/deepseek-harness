# Agent Note: Continuable Delegation Event Seeding

Status: implemented

English | [中文](2026-08-15-continuable-delegation-event-seeding.zh.md)

## Problem

Continuable subagent children reconstruct their composition on cold resume from the `subagent/descriptor` event, which deliberately snapshots only explicit fields (`provider`, `label`, `agentProvider`, `agentModel`, `persona`, `toolFilter`) and omits per-activation knobs such as `maxTokens` and any consumer-owned policy. A consumer that needs to persist per-child composition beyond the descriptor — the team plugin's member binding (`memberId`, `role`, MCP allowlist, approval-gated tools) — had no channel to write that state into the child's own durable log before the child's setup contribution ran, because `startContinuable` builds the seed internally and offers no per-delegation event input.

## Decision

`ContinuableStartSpec` gains an optional `delegationEvents` field: a discriminated union of `{ type, data }` pairs over `SessionEventMap`. `seedDescriptorTurn` appends these events to the child's own suffix after the `subagent/descriptor` turn and any fork seed, so `coldResume`'s `events.slice(seedLength)` reconstructs them verbatim. `Session.append` re-validates lossless-JSON at the append site, so a bad payload rejects `startContinuable` before the child is established. Absence is a no-op: existing one-shot and continuable callers are unchanged, and the field lives on `ContinuableStartSpec` rather than `SubagentStartRequest` so the one-shot path and provider capability surface are untouched.

The team plugin consumes this by seeding one `team/member-bound` event per delegation and registering a `registerContinuableSetup` contribution that reads that event from the child's session and installs the member's MCP guard and permission enforcement hook on both fresh creation and cold resume.

## Alternatives considered

**Extend `SubagentStartRequest` with a `guard`/`composition` field.** Rejected: a guard is execution-time state, not durable composition, and threading it through the shared request would force a provider capability flag and one-shot plumbing for a continuable-only need.

**Put `maxTokens` into the descriptor (bump `SUBAGENT_DESCRIPTOR_VERSION`).** Rejected for now: the descriptor's JSDoc treats `maxTokens` as a per-activation budget, not durable composition, and a version bump is a cross-cutting change. Team accepts that `maxTokens` applies on fresh delegation only.

**A process-local `childId → binding` map populated before setup.** Rejected: `startContinuable` reserves the child id internally, so the binding is unknown to the caller until after the seed is built; a process-local map also cannot survive restart.

## Consequences

A generic, durable per-delegation event channel now exists for any continuable-child consumer. The team member binding is reconstructable from the child log alone, closing the cold-resume gap that left MCP scoping and approval gating ineffectual. The one-shot subagent path and every existing `startContinuable` caller keep working unchanged; the cost is a small, documented seam extension plus the requirement that consumers append only lossless-JSON events.
