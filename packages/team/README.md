# Team

Agent team capability for the DeepSeek Harness: leader-teammate coordination over continuable subagents.

## Packages

| Package | npm name | Plugin form | `ctx.*` key | Role |
|---|---|---|---|---|
| `team/` | `dsh-team` | Service subclass (default export) | `ctx.team` | **Service Definition**: types, events, constants, abstract `TeamRegistry` |
| `team-local/` | `dsh-team-local` | function plugin | — | **Service Provider**: local filesystem Markdown definition loader |
| `team-runtime/` | `dsh-team-runtime` | function plugin | — | **Consumer**: orchestration, delegation, MCP guard, skill filter |
| `team-channels/` | `dsh-team-channels` | function plugin | — | **Consumer**: messaging, progress tracking, approval coordination |
| `tool-team/` | `dsh-tool-team` | function plugin | — | **Consumer**: 5 model-facing team tools |

## Bundle

The `@deepseek-ai/dsh-bundle-team` package at `packages/bundle/team/` aggregates all 5 packages into an installable bundle.
