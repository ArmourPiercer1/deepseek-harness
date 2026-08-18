# Permission

English | [中文](permission.zh.md)

The permission capability of [packages/permission](../../packages/permission) decides whether a tool call may be issued. `ctx.permission` ([dsh-permission](../../packages/permission/permission/README.md)) is the [Service Definition](../../packages/permission/permission/README.md): the abstract `PermissionService` contract with `compile` and `evaluate`. The provider [dsh-permission-engine](../../packages/permission/permission-engine/README.md) implements `evaluate` by parsing authored rule strings, matching a tool call with four matchers, adjudicating the layered rule set, and appending the `permission/decision` audit event; [dsh-tool-permission-guard](../../packages/permission/tool-permission-guard/README.md) and the team plugin are its consumers. The package READMEs own composition status and limitations; the [permission seam Agent Note](../../.agents/notes/proposed/architecture/2026-08-15-permission-seam-and-mcp-fusion.md) owns the design rationale.

Source: [`packages/permission/permission/src/index.ts`](../../packages/permission/permission/src/index.ts)

## The service

`ctx.permission.compile(rules)` parses an authored `RuleSource` set once at load into an opaque `CompiledPolicy` handle, returning any parse diagnostics as strings. `ctx.permission.evaluate(call, context)` decides one `ToolCallView` (the tool name and frozen JSON arguments) against the context's compiled policy, permission mode, path bases, and acting member id. Both methods are pure: neither appends the audit event nor runs the approval flow — a consumer appends `permission/decision` at its commit point and routes an `ask` to the approval seam (main agent) or the leader rendezvous (teammate).

## The rule engine

Rules are authored strings parsed into a [`RuleIR`](../../packages/permission/permission/src/types.ts) with a `kind` (`allow`/`ask`/`deny`), a `layer` (`managed`/`project`/`teammate`), a target tool name, and a matcher discriminant. The engine compiles each rule into one of four matchers: a **command** matcher splits compound commands and strips wrappers for `Bash`/`pwsh`, a **path** matcher applies gitignore semantics with `//`/`~`/`/` anchors for file tools, an **mcp** matcher checks the `mcp__server[__tool]` prefix, and a **param** matcher checks a top-level scalar input field of any tool. See the [engine README](../../packages/permission/permission-engine/README.md) for the matcher table.

## Adjudication

`evaluate` matches in `deny → ask → allow` order by layer, then falls back to the scope's permission mode when nothing matches. The first match wins regardless of specificity; a `managed`-layer `deny` is absolute in every mode and cannot be overridden by a lower layer's `allow`. `enforce` mode denies an unmatched call (allowlist, the default for a controlled teammate), `default` allows it (denylist, for the main agent), and the reserved `readonly`/`bypass` modes throw as unimplemented. A denied call carries a model-visible `reason` (`` denied by rule "<raw>" (<layer>) `` for a rule deny, `` no matching allow rule (enforce mode) `` for a mode deny).

## The `permission/decision` event

`permission/decision` is the durable audit record of one evaluation: the tool name, the outcome kind, the deciding rule and layer when a rule decided it, the acting member, the active mode, and the deny cause. Model-visible policy outcomes must be reconstructable from the session log, so a consumer appends this event at its commit point. Layered rule loading, rule learning (writing an approved `ask` back), and the `readonly`/`bypass` modes are deferred; the seam is not yet wired into any composition, so `ctx.permission` is absent until a provider row is composed.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpermission--permissionservice"></a>

### `ctx.permission` — `PermissionService`

The permission engine. Consumers `compile` a scope's authored rules once at load into an opaque CompiledPolicy, then `evaluate` each tool call against it. Both are pure: neither appends the audit event or runs the approval flow — a consumer appends `permission/decision` at its commit point and routes an `ask` to the approval seam or the leader rendezvous.

```ts cordis-catalog
/**
 * Compile a scope's authored rules into an opaque policy.
 * @param rules - the authored rule strings with their kinds and layers.
 * @returns the compiled policy, plus any parse diagnostics as human-readable strings.
 */
compile(rules: readonly RuleSource[]): { readonly policy: CompiledPolicy; readonly diagnostics: readonly string[] }

/**
 * Decide whether a tool call may be issued.
 * @param call - the tool name and JSON arguments to decide.
 * @param context - the compiled policy, mode, path bases, and acting member.
 * @returns the allow/ask/deny decision, with the matched rule when a rule decided it.
 */
evaluate(call: ToolCallView, context: PermissionContext): PermissionDecision
```

Source: [`packages/permission/permission/src/index.ts:56`](../../packages/permission/permission/src/index.ts)
<!-- END GENERATED cordis-surface -->
