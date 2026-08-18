# dsh-permission

English | [中文](README.zh.md)

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

### Service Definition surface

#### What the model sees

The package contributes no prompt, tool schema, or model request. It declares the `ctx.permission` service contract and the `permission/decision` session event type; the provider (`dsh-permission-engine`) and consumers (`dsh-tool-permission-guard` and the team plugin) own every model-visible effect the decision produces.

#### Token effect

Zero. No request, result, or failure from this Definition enters a model request.

#### KV Cache effect

Independent. The Definition adds no request-prefix tokens and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **Not mounted in any composition** — the row appears in no bundle or profile `cordis.yml`, so `ctx.permission` is absent until a provider row is composed.
- **`readonly` and `bypass` are reserved, unimplemented enum values** — the type declares them, and the first-stage engine rejects either with an error rather than acting on it.
- **Layered rule loading is not part of the Definition** — the merged, layer-tagged rule set is an input to `evaluate`; the loader that assembles managed/project/teammate layers is deferred.
- **Rule learning is deferred** — writing an approved `ask` back to a destination is shaped by the permission seam Agent Note but is not part of this Definition yet.
- **No session-log composition test yet** — the deny-to-`permission/decision` relation is asserted by a composition test that does not exist yet.
