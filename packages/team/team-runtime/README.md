# dsh-team-runtime

Team runtime orchestration, delegation, and per-member capability filtering for the DeepSeek Harness team plugin.

## Role

**Consumer** — orchestrates teammate lifecycles, builds per-member tool restrictions, installs MCP guards and skill filters on child agent scopes.

## Key Exports

| Export | Description |
|---|---|
| `TeamOrchestrator` | Session-scoped activation manager |
| `createMcpGuard` | Dynamic MCP tool guard factory |
| `installSkillFilter` | Scoped skill catalog filter installer |
| `buildToolRestriction` | Leader/teammate tool policy resolver |
| `installMemberComposition` | Composite member setup from bound data |

## Model Experience

Indirectly, through the subagent seam that the orchestrator delegates to for teammate execution.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Conditional tool constraints (`pathWithin`, `executableEquals`) are deferred to Phase 4.
- Cold resume from `team/member-bound` session event is not yet fully integrated with the subagent continuation manager.
