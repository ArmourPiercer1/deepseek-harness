---
Status: implemented
---

## Problem

Developing an agent-team plugin for DeepSeek Harness requires understanding what PilotDeck's agent team mode provides (teammate definitions, fine-grained per-agent permissions, team orchestration, leader approval channels) and mapping those features onto DSH's existing architecture (subagent seam, tool restriction, scoped registration, continuable subagents).

## Decision

Analyzed PilotDeck source at `references/PilotDeck-acc-preview/src/agent/team/` and oh-my-opencode source at `references/oh-my-opencode/src/agents/` + `src/tools/delegate-task/` + `src/features/background-agent/`, plus DSH's subagent, tool, scope, and preset subsystems. Produced a phased development plan with detailed coding blueprint in [`AGENT_TEAM_PLUGIN_PLAN.md`](../../../../AGENT_TEAM_PLUGIN_PLAN.md) covering: Phase 0 (PoC), Phase 1 (definition/loading), Phase 2 (runtime/delegation), Phase 3 (message/control channels), Phase 4 (fine-grained constraints), Phase 5 (integration), plus §六 detailed coding plan with package architecture, file lists, TypeScript interfaces, test requirements, and subagent task allocation.

Key architecture decisions:

- **Package group**: `packages/team/` with 5 packages (`dsh-team` Service Definition, `dsh-team-local` provider, `dsh-team-runtime` consumer, `dsh-team-channels` consumer, `dsh-tool-team` consumer) plus `dsh-bundle-team`.
- **Teammate lifecycle**: DSH continuable subagents (`ctx.subagents.startContinuable()`) with persona, tool restriction, and per-agent model config via `AgentOptions`.
- **MCP filtering**: dynamic `tools.guard()` checking `mcp__<server>__` prefix at execution time (not startup enumeration), covering late-connected and reconnected MCP servers. PilotDeck's MCP filtering has known bugs and is not referenced.
- **Cold resume**: team-specific `team/member-bound` session event persists the full member policy (including `maxTokens`, MCP allowlist, skill allowlist) independently of the continuable descriptor (which omits `maxTokens` by design). A `registerContinuableSetup()` contribution reads this event on resume.
- **Leader design**: unified `TeamMemberDefinition` type (`role: "leader" | "teammate"`) with 10 irremovable default tools. Plugin load fails if any default tool is absent from the registry.
- **Subagent model assignment**: `Qiyuan-Inter/deepseek-v4-flash-0731` as the primary model for complex tasks (interface design, state machines, cold resume, integration tests); `Qiyuan-Inter/gpt-5.6-luna` as auxiliary for straightforward tasks (parsing, guards, tool definitions, docs). Execution runs under DSH (not Codex), using `SubagentStartRequest.agentOptions` for per-child model selection. Provider route configured via `dsh-llm-pi-ai`, not hardcoded.

Identified 11 architecture gaps (G1–G11) in DSH relative to PilotDeck features; all addressable at the plugin layer without modifying DSH core packages, except optionally extending `AgentOptions` with `maxContextTokens`.

## Alternatives considered

- **Modify DSH core** (add team primitives to `dsh-agent` / `dsh-agent-loop`): rejected because AGENTS.md requires new behavior via extension points, not loop changes; and the existing subagent seam, tool restriction, and scoped registration already provide the needed primitives.
- **Workflow engine for team orchestration**: rejected because workflows are stateless fan-out scripts without persistent agent sessions; team mode requires stateful persistent teammates with follow-up turns.
- **One-shot subagents only** (no continuable): rejected because persistent teammate context across delegations is a primary PilotDeck feature; one-shot is offered as `contextPolicy: "fresh_per_delegation"` option.
- **PilotDeck Leader tool lockdown** (Leader restricted to coordination-only tools): rejected because users may want the Leader to perform domain work alongside coordination; a unified `TeamMemberDefinition` with 10 irremovable default leader tools provides coordination safety without sacrificing flexibility.
- **Reference PilotDeck MCP filtering code**: rejected because PilotDeck's `TeammateExtensionResolver.listMcpInstructions()` has known bugs where teammates frequently fail to detect MCP mounts; per-agent MCP filtering is independently implemented using DSH's native `ToolRestriction` mechanism.

## Consequences

- Development follows a 6-phase plan (Phase 0–5) with a detailed §六 coding blueprint specifying file lists, TypeScript interfaces, module decomposition, test strategy, and parallelized subagent task allocation.
- All team functionality lives in `packages/team/` as a capability seam (Service Definition + Provider + Consumers) installable via `dsh-bundle-team`.
- The plan file at workspace root serves as the authoritative development roadmap for the agent-team plugin series.
