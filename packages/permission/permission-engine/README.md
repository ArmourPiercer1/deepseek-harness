# dsh-permission-engine

Permission engine provider for the DeepSeek Harness.

Implements `ctx.permission` (the `@deepseek-ai/dsh-permission` Service Definition): parses authored rule strings into a compiled form, matches a tool call with the four matchers, adjudicates `deny > ask > allow` across the managed/project/teammate layers with an absolute managed layer, falls back to the permission mode, and appends the `permission/decision` audit event.

## Role

**Service Provider** — the concrete `evaluate` implementation and the plugin that registers it. Publishing `ctx.permission`, this row belongs in the host composition.

## Matchers

| Matcher | Targets | Semantics |
|---|---|---|
| command | `Bash` / `pwsh` | compound-command split, wrapper stripping, pwsh alias canonicalization, `*` and `:*` patterns |
| path | `Read` / `Edit` / `Write` / … | gitignore semantics with `//` / `~` / `/` anchors, POSIX normalization |
| mcp | `mcp__server[__tool]` | whole-server, exact-tool, and `mcp__*` prefixes |
| param | any tool | `Tool(param:value)` over a top-level scalar field, never a primary content field |

## Adjudication

`evaluate` matches in `deny → ask → allow → mode fallback` order; the first match wins regardless of specificity. A `managed`-layer `deny` cannot be overridden by a lower layer's `allow`. An unmatched call is decided by the mode: `enforce` denies, `default` allows; `readonly` and `bypass` are rejected as unimplemented.

## Model Experience

The engine produces no prompt or tool. Its effect on the model is a denied tool call's `reason` (model-visible) and the `permission/decision` audit record; a denied call's reason states why, and a leader-unreachable teammate `ask` denies with a reason that says it is not a final verdict.

## Known Limitations and Deferred Work

Rule learning (write-back destinations) and MCP lifecycle are later stages of the permission seam Agent Note and are not implemented here. The single-segment allow/deny path-depth asymmetry and symlink dual-path handling are resolved by the loader that supplies match bases, not by the matcher.
