# dsh-team

English | [中文](README.zh.md)

Agent team Service Definition for the DeepSeek Harness.

Provides `ctx.team` — the abstract contract for loading, querying, and validating team member definitions. Concrete providers (e.g. `dsh-team-local`) supply the implementation.

## Role

**Service Definition** — types, branded ids, session events, and the abstract `TeamRegistry` class. No runtime behavior; providers and consumers depend on this package.

## Key Exports

| Export | Description |
|---|---|
| `TeamRegistry` (default) | Abstract `Service` subclass registered as `ctx.team` |
| `TeamMemberId` | Branded id type + factory for team members |
| `TeamMemberDefinition` | Unified definition type for leaders and teammates, including optional inline `permissions` rules and `permissionMode` |
| `TeamPermissionRules` | A member's inline rule lists: optional `deny` / `ask` / `allow` rule strings |
| `TeamPermissionMode` | A member's permission mode: `enforce` / `default` (`readonly` / `bypass` reserved and rejected) |
| `DEFAULT_LEADER_TOOLS` | 10 irremovable leader tools |
| `TEAMMATE_DENIED_TOOLS` | Tools teammates may never invoke |
| Session events | `team/member-bound` (optionally carrying the member's rules snapshot and bind-time managed presence), `team/progress`, `team/control-request`, `team/control-decision`, `team/message` |

## Model Experience

None, as the Service Definition provides types, events, and constants with no prompt, schema, or result.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- `maxContextTokens` is not modeled in `TeamMemberDefinition`; context-window limiting is deferred to compaction-layer integration.
