# Agent Note: Team Plugin Round 2 Implementation

Status: implemented

English | [中文](2026-08-18-team-plugin-round-2.zh.md)

## Problem

Following the initial team plugin release and runtime hardening, several foundational capabilities and plan commitments remained unaddressed:
1. Teammate definitions could not be enabled/disabled per-workspace without deleting markdown files from disk.
2. Skill filtering (`definition.skills`) had been dropped without justification, leaving teammates unrestricted on skills.
3. `send_team_message` could not deliver messages to inactive (settled or cold) teammates, and lacked inter-teammate message relay.
4. Restarting the harness dropped pending control requests silently without reconciliation on cold resume.
5. Plan approval decisions (`approve_plan` and `request_revision`) from the original plan were missing from the control system.
6. Leader default tools had no diagnostic check to detect missing capabilities in the host composition.

## Decision

The second development round implemented these foundational capabilities through modular subagent execution:

- **Per-workspace enablement (N2)**: `dsh-team-local` integrates with `ctx.settings` under the `team-enablement` namespace (`workspacePath -> teammateId -> boolean`). Definitions disabled for the active workspace are filtered before registration into `ctx.team`. Updates to settings reload definitions live via `settings/updated` listeners without process restart.
- **Skill filtering restored (N3, N4)**: Restored `skills?: readonly string[]` in `TeamMemberDefinition` and `TeamMemberBoundData` (with cold-resume fallback to unrestricted). Installed a scoped `tools.guard()` in child contexts via `createSkillGuard()` denying unlisted skills at the `skill` tool execution boundary.
- **Message delivery and relay (N6, N7)**: `send_team_message` now uses `subagents.followup` cold-resume to deliver messages to inactive/settled teammates and re-records activations. Teammate-to-teammate messaging routes through leader wakeup (`reportFrom` with target indication) as a relay, with delivery isolated behind a modular `deliverTeamMessage` function interface.
- **Control request reconciliation (N8)**: Added `reconcilePending` in `TeamControlRegistry`. On cold resume and cancellation, orphaned requests are cleanly settled with `deny` instead of hanging indefinitely.
- **Plan approval branches (N9)**: Extended `TeamControlDecision` with `approve_plan` (permits execution) and `request_revision` (denies with requested feedback).
- **Leader default tools diagnostic (N10)**: Added `diagnoseLeaderTools()` in `dsh-team-local` checking `DEFAULT_LEADER_TOOLS` against registered schemas and issuing a structured warning on missing tools.
- **Testing and design deliverables (N1, N5, N11)**: Added comprehensive unit tests for discovery, debounce, and watchers; documented skill catalog prompt visibility mechanics; authored the `maxContextTokens` design specification (`AGENT_TEAM_N11_MAXCONTEXTTOKENS_DESIGN.md`).

## Alternatives considered

- **Full structured message queue broker**: Deferred in favor of leader-relay messaging to maintain zero new session event types, while preserving the `deliverTeamMessage` abstraction boundary for future upgrades.
- **Hard-failing on missing leader tools at plugin load**: Rejected due to plugin lifecycle order constraints (tools may register asynchronously after team); startup diagnostic warning (B+C scheme) provides robust feedback without false failures.
- **Rewriting prompt catalog messages for skill filtering**: Rejected because modifying pre-step durable messages violates the model-visible log contract; tool execution guard provides strict capability enforcement.

## Consequences

- Teammates can be managed per-workspace, filtered by skills, reached when inactive, and participate in plan approval and message relay.
- Total team test coverage expanded from 100 to 183 unit and integration tests across 24 test suites.
- No new session event types were added; all changes remain compatible with existing session event logs and cold resume.
