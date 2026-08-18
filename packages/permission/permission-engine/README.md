# dsh-permission-engine

English | [中文](README.zh.md)

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

### Denied-call reason strings

#### What the model sees

A denied tool call reaches the model as a `reason` string. A deny decided by a rule uses the stable literal `` denied by rule "<raw>" (<layer>) ``, and an unmatched call in `enforce` mode uses `` no matching allow rule (enforce mode) ``. Each decision is appended to the acting session's log as a `permission/decision` audit event.

#### Token effect

Conditional. Only the one denied call's `reason` string enters the model request that follows; an allowed or `ask` call contributes no reason of its own.

#### KV Cache effect

Independent. The engine registers no prompt or tool schema, so it adds no request-prefix tokens and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **Not mounted in any composition** — the engine row appears in no bundle or profile `cordis.yml`, so `ctx.permission` is absent until a provider row is composed.
- **`readonly` and `bypass` modes are unimplemented stubs** — `resolveDecision` throws on either reserved mode rather than acting on it.
- **Layered rule loading and cold-resume snapshots are not implemented** — the engine evaluates an already-merged rule set; the loader that assembles managed/project/teammate layers and the cold-recovery snapshot are deferred.
- **No session-log composition test yet** — the deny-to-`permission/decision` relation is asserted by a composition test that does not exist yet.
- **Rule learning and MCP lifecycle are deferred** — later stages of the permission seam Agent Note own write-back destinations and MCP lifecycle, and are not implemented here.
