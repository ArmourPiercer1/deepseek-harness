# Agent Team Plugin Implementation

## Decision

Implemented the agent-team plugin as 6 packages under `packages/team/` plus a bundle at `packages/bundle/team/`, following the capability-seam pattern (Service Definition / Service Provider / Consumer).

## Architecture

| Package | npm name | Role | Plugin form |
|---|---|---|---|
| `team/team/` | `dsh-team` | Service Definition | Service subclass (default export) |
| `team/team-local/` | `dsh-team-local` | Service Provider | function plugin |
| `team/team-runtime/` | `dsh-team-runtime` | Consumer (orchestration) | function plugin |
| `team/team-channels/` | `dsh-team-channels` | Consumer (messaging) | function plugin |
| `team/tool-team/` | `dsh-tool-team` | Consumer (5 tools) | function plugin |
| `bundle/team/` | `dsh-bundle-team` | Bundle manifest | cordis.patch.yml |

## Key Design Decisions

### Concrete Service vs Abstract

`TeamRegistry` is a **concrete** `Service` subclass (not abstract) with a `register()` method. The provider (`dsh-team-local`) populates it by calling `ctx.team.register(definitions)`. This avoids the complexity of the abstract Service Definition + separate concrete Provider class pattern, since there is exactly one data-loading strategy and no need for provider polymorphism.

### MCP Guard — Dynamic Prefix Matching

Per-member MCP tool filtering uses `ctx.tools.guard()` with runtime prefix matching (`mcp__<server>__`), not startup-time tool enumeration. This covers MCP servers that connect late, reconnect, or add new tools after the guard is installed. PilotDeck's `TeammateExtensionResolver` was explicitly not referenced due to known bugs.

### Leader Configuration Parity

Leader uses the same `TeamMemberDefinition` as teammates. 10 default tools (`DEFAULT_LEADER_TOOLS`) are always merged into the leader's effective tool set and cannot be removed by configuration.

### Skill Filter Deferred

Skill catalog filtering is recorded in `team/member-bound` but not yet enforced at runtime, pending integration with the skill registry's per-scope API.

### Tool Policy in Service Definition

`effectiveToolPolicy()` lives on `TeamRegistry` (the Service Definition) rather than in `team-runtime`, because the tool restriction computation is a pure function of the definition and constants — no runtime state needed.

## Session Events

Five events declared via `SessionEventMap` merging: `team/member-bound`, `team/progress`, `team/control-request`, `team/control-decision`, `team/message`.

## Test Coverage

48 tests across 10 test files covering: branded id construction, constants completeness, Markdown parsing (valid/invalid/edge cases), cross-definition validation, MCP guard (allow/deny/non-MCP), tool policy (leader merging, teammate deny), orchestrator state machine, control coordinator lifecycle, progress store CRUD, and plugin shape verification.
