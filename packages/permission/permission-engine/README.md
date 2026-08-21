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

Tool-name comparison is case-insensitive for the command, path, and param matchers — harness tool names are lowercase while rule spellings are Claude Code-style capitalized — with the `mcp__` prefix as the one exact-match exception. The path matcher resolves a relative input path against the scope's session cwd before the gitignore comparison.

## Adjudication

`evaluate` matches in `deny → ask → allow → mode fallback` order; the first match wins regardless of specificity. A `managed`-layer `deny` cannot be overridden by a lower layer's `allow`. An unmatched call is decided by the mode: `enforce` denies, `default` allows; `readonly` and `bypass` are rejected as unimplemented.

## Rule Layer Loading

`loadRuleLayers` assembles the rule set `evaluate` consumes, from three sources:

- **managed** — `$DSH_HOME/permissions.yml` (the organization's policy file)
- **project** — `<workspace>/.dsh/permissions.yml`, where the workspace is the scope's session cwd
- **teammate** — the inline rules a caller snapshots in (a member's frontmatter rules, frozen into the durable `team/member-bound` payload at bind time)

A layer path that cannot be resolved, or a file that is absent, reads as a layer absence; a present file that cannot be read or that falls outside the rule-file format rejects with a `RuleFileError` naming the source and every diagnostic. The file format is a single top-level `permissions:` key whose `deny` / `ask` / `allow` values are rule-string lists, inline (`deny: [a, b]`) or block (`- a`); anything else is rejected, so a typo fails loud instead of skipping a deny.

Merging concatenates the layers and deduplicates an identical `(kind, raw)` rule, keeping the highest layer (managed > project > teammate). A `deny` and an `allow` that share a raw string are distinct rules and both survive; deny absoluteness is enforced at adjudication, not by dropping the `allow`.

When the caller was bound under a managed policy (`managedPresent: true`) and the managed file is now missing, the load rejects with a `ManagedRulesMissingError` instead of skipping the layer: a recovered session is constrained by the organization's current policy or refused, never by a stale one. A managed file deployed after the bind is picked up by the re-read and constrains the session immediately.

## Model Experience

### Denied-call reason strings

#### What the model sees

A denied tool call reaches the model as a `reason` string. A deny decided by a rule uses the stable literal `` denied by rule "<raw>" (<layer>) ``, and an unmatched call in `enforce` mode uses `` no matching allow rule (enforce mode) ``. Each decision is appended to the acting session's log as a `permission/decision` audit event.

#### Token effect

Conditional. Only the one denied call's `reason` string enters the model request that follows; an allowed or `ask` call contributes no reason of its own.

#### KV Cache effect

Independent. The engine registers no prompt or tool schema, so it adds no request-prefix tokens and cannot invalidate an otherwise reusable provider cache entry.

### Rule file load failures

#### What the model sees

Load failures (`RuleFileError`, `ManagedRulesMissingError`) reject `loadRuleLayers`; the engine itself puts no load-failure text into a model request. Callers decide the surface: the team delegate tool's bind-time probe is a plain existence check that never rejects, and the team runtime's enforcement point settles a rejected policy load into a fail-closed deny (logged, and without a `permission/decision` audit, since no evaluation ran).

#### Token effect

Conditional on the caller's surface; the load path itself contributes nothing to a model request.

#### KV Cache effect

Independent.

## Known Limitations and Deferred Work

- **`readonly` and `bypass` modes are unimplemented stubs** — `resolveDecision` throws on either reserved mode rather than acting on it.
- **Rule learning and MCP lifecycle are deferred** — later stages of the permission seam Agent Note own write-back destinations and MCP lifecycle, and are not implemented here.
