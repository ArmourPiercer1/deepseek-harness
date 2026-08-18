# Team

English | [中文](README.zh.md)

Agent team capability for the DeepSeek Harness: leader-teammate coordination over continuable subagents.

## Packages

| Package | npm name | Plugin form | `ctx.*` key | Role |
|---|---|---|---|---|
| `team/` | `dsh-team` | Service subclass (default export) | `ctx.team` | **Service Definition**: types, events, constants, `TeamRegistry` |
| `team-local/` | `dsh-team-local` | function plugin | — | **Service Provider**: local filesystem Markdown definition loader |
| `team-runtime/` | `dsh-team-runtime` | function plugin | — | **Consumer**: orchestration, MCP guard, approval hook |
| `team-channels/` | `dsh-team-channels` | function plugin | `ctx.teamControl` | **Consumer**: approval registry, progress store |
| `tool-team/` | `dsh-tool-team` | function plugin | — | **Consumer**: 5 model-facing team tools |

## Bundle

The `@deepseek-ai/dsh-bundle-team` package at `packages/bundle/team/` aggregates all 5 packages into an installable bundle.

## Quick start

Add the bundle rows to a composition alongside a continuable subagent backend:

```yaml
- id: team
  name: '@deepseek-ai/dsh-team'
- id: team-local
  name: '@deepseek-ai/dsh-team-local'
  config:
    homePath: !!js process.env.DSH_HOME ?? ''
- id: team-runtime
  name: '@deepseek-ai/dsh-team-runtime'
- id: team-channels
  name: '@deepseek-ai/dsh-team-channels'
- id: tool-team
  name: '@deepseek-ai/dsh-tool-team'
```

Team members are Markdown files (YAML frontmatter + persona body) in `$DSH_HOME/teammates/` or `.dsh/teammates/`. Exactly one file must declare `role: leader`. See [`team-local/examples/teammates/`](team-local/examples/teammates/) for a worked roster — `backend-dev.md` shows per-member tool allow/deny, `requiresApproval` (leader-gated tools), and MCP server scoping.

The leader coordinates with five tools:

| Tool | Purpose |
|---|---|
| `delegate_to_teammate` | Start (`run`), continue (`follow_up`), or stop (`shutdown`) a teammate |
| `list_teammates` | List teammates with live status |
| `send_team_message` | Bidirectional leader ↔ teammate messaging |
| `team_control` | Review and decide pending teammate approval requests |
| `team_progress` | Read/update the team task board |

A teammate is a durable continuable subagent whose persona, tool filter, MCP scope, and approval gate are fixed at delegation and reconstructed on cold resume. Teammates never receive `delegate_to_teammate`, `team_control`, or `list_teammates`.
