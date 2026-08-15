# dsh-permission

Permission Service Definition for the DeepSeek Harness.

Provides `ctx.permission` — the abstract contract deciding whether a tool call may be issued. The engine provider (`dsh-permission-engine`) supplies the implementation; consumers (`dsh-tool-permission-guard` and the team plugin) read the service.

## Role

**Service Definition** — rule and decision types, the `PermissionService.evaluate` contract, and the `permission/decision` audit event. No runtime behavior; the provider and consumers depend on this package. Publishing `ctx.permission`, this row belongs in the host composition.

## Key Exports

| Export | Description |
|---|---|
| `PermissionService` | The `evaluate(call, context)` contract registered as `ctx.permission` |
| `PermissionMode` | Per-scope unmatched-call fallback: `enforce` / `default` (`readonly` / `bypass` reserved) |
| `RuleIR` | Parsed rule: kind, layer, tool, matcher discriminant, and authored `raw` string |
| `ToolCallView` | The tool name and JSON arguments `evaluate` decides against |
| `PermissionContext` | Mode, acting member, and merged layer-tagged rule set |
| `PermissionDecision` | `allow` / `deny{reason,cause}` / `ask`, with the matched rule for audit |
| Session event | `permission/decision` — the durable audit record of one decision |

## Decision contract

`evaluate` matches a call against the context's rules in `deny > ask > allow` order and falls back to the permission mode when nothing matches. A `managed`-layer `deny` is absolute in every mode. `evaluate` is a pure function of its inputs: the engine appends `permission/decision` at its commit point, and a consumer routes an `ask` to the approval seam or the leader rendezvous.

## Model Experience

None, as the Service Definition provides types, the evaluate contract, and one audit event with no prompt, schema, or result.

## Known Limitations and Deferred Work

Rule learning (writing an approved `ask` back to a destination) and MCP lifecycle types are shaped for the later stages of the permission seam Agent Note but are not part of this Definition yet. `readonly` and `bypass` modes are reserved enum values the first-stage engine rejects as unimplemented.
