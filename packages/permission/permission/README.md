# dsh-permission

English | [中文](README.zh.md)

Permission Service Definition for the DeepSeek Harness.

Provides `ctx.permission` — the abstract contract deciding whether a tool call may be issued. The engine provider (`dsh-permission-engine`) supplies the implementation; consumers (`dsh-tool-permission-guard` and the team plugin) read the service.

## Role

**Service Definition** — rule and decision types, the `PermissionService.evaluate` contract, and the `permission/decision` audit event. No runtime behavior; the provider and consumers depend on this package. Publishing `ctx.permission`, this row belongs in the host composition.

## Key Exports

| Export | Description |
|---|---|
| `PermissionService` | The `evaluate(call, context)` and `loadRuleLayers(options)` contracts registered as `ctx.permission` |
| `PermissionMode` | Per-scope unmatched-call fallback: `enforce` / `default` (`readonly` / `bypass` reserved) |
| `RuleIR` | Parsed rule: kind, layer, tool, matcher discriminant, and authored `raw` string |
| `RuleSource` | One authored rule with its kind and declaring layer, as loaded from a layer source |
| `PermissionRules` | The stance-shaped rule list of one source: optional `deny` / `ask` / `allow` arrays |
| `LoadRuleLayersOptions` | `loadRuleLayers` input: layer file paths, optional teammate snapshot, and the bind-time managed presence |
| `LoadedRuleLayers` | `loadRuleLayers` result: the merged layer-tagged sources plus each layer's presence |
| `ToolCallView` | The tool name and JSON arguments `evaluate` decides against |
| `PermissionContext` | Mode, acting member, and merged layer-tagged rule set |
| `PermissionDecision` | `allow` / `deny{reason,cause}` / `ask`, with the matched rule for audit |
| Session event | `permission/decision` — the durable audit record of one decision |

## Decision contract

`evaluate` matches a call against the context's rules in `deny > ask > allow` order and falls back to the permission mode when nothing matches. A `managed`-layer `deny` is absolute in every mode. `evaluate` is a pure function of its inputs: the engine appends `permission/decision` at its commit point, and a consumer routes an `ask` to the approval seam or the leader rendezvous.

`loadRuleLayers` assembles the merged rule set `evaluate` consumes: it reads the managed and project rule files read-only from disk, merges in the caller's teammate snapshot, and returns the deduplicated, layer-tagged sources plus each layer's presence. When the caller was bound under a managed policy and that file is now missing, it rejects (`ManagedRulesMissingError`) rather than skipping the layer, so a recovered scope is constrained by the current policy or refused.

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
- **The cold-recovery enforcement point is deferred** — `loadRuleLayers` defines how a scope re-reads and re-merges its layers, but the teammate hook that denies calls against the recovered policy is a later stage of the permission seam.
- **Rule learning is deferred** — writing an approved `ask` back to a destination is shaped by the permission seam Agent Note but is not part of this Definition yet.
