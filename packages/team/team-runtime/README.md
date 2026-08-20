# dsh-team-runtime

English | [中文](README.zh.md)

Team runtime orchestration, delegation, and per-member capability filtering for the DeepSeek Harness team plugin.

## Role

**Consumer** — orchestrates teammate lifecycles and installs per-member composition (skill guard, MCP guard + approval hook) on continuable child scopes.

## Key Exports

| Export | Description |
|---|---|
| `TeamOrchestrator` | Session-scoped activation manager |
| `createMcpGuard` | Dynamic MCP tool guard factory |
| `createSkillGuard` | Dynamic skill tool guard factory |
| `installMemberComposition` | Composite member setup from bound data |
| `installApprovalHook` | Scoped `tools/pre-execute` hang for `requiresApproval` tools; settles with deny on abort, leader unreachability, or timeout |
| `teamMemberSetupContribution` | `registerContinuableSetup` contribution reading `team/member-bound` and reconciling pending control requests on cold resume |

## Model Experience

Indirectly, through the subagent seam that the orchestrator delegates to for teammate execution.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- `maxTokens` is applied on fresh delegation only; a cold-resumed teammate falls back to its route default because the continuable descriptor omits per-activation budgets by design.
