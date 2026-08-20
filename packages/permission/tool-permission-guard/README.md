# dsh-tool-permission-guard

English | [中文](README.zh.md)

Permission guard Consumer for the DeepSeek Harness.

A `tools/pre-execute` listener that applies `ctx.permission.evaluate` for the main agent and single delegated subagents. `allow` proceeds; `deny` blocks the call with the engine's reason; `ask` routes to the approval seam.

## Role

**Consumer** — reads `ctx.permission` (from `@deepseek-ai/dsh-permission`), provides no service. It sits loose in a composition: the service is resolved per tool call, not at apply time, because the Loader activates rows in parallel and an apply-time read could permanently disable the guard; when the service is absent the call proceeds unguarded. A rule the engine drops or ignores at compile is logged through the guard's logger at the first evaluated call, so a dropped deny cannot vanish silently. The team plugin is a separate consumer that routes an `ask` to the leader rendezvous instead.

## Config

| Field | Description |
|---|---|
| `mode` | The scope's permission mode (`enforce` / `default`). |
| `rules` | The authored rule strings for this scope, by kind. |
| `pathBases` | Resolution bases for path-rule anchors (`settingsDir` / `homeDir` / `cwd`). |

Rule-source layering and cold-recovery snapshots are the loader's concern; this consumer receives the resolved mode and rules.

## Model Experience

### Guarded tool-call outcomes

#### What the model sees

The guard registers no tool. Its model-visible effect is the outcome of a guarded call: an allowed call proceeds, a denied call returns an error result carrying the engine's `reason`, and an `ask` routes to the approval seam and surfaces the engine's reason. Every decision is appended to the acting session's log as a `permission/decision` audit event.

#### Token effect

Conditional. Only a denied or asked call contributes its `reason` and the approval prompt to the model request; an allowed call contributes nothing beyond the tool call itself.

#### KV Cache effect

Independent. The guard adds no request-prefix tokens and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **Not mounted in any composition** — the listener row appears in no bundle or profile `cordis.yml`, so the guard is inactive until a row is composed and `ctx.permission` is present.
- **Rule-source layering and cold-recovery snapshots are not implemented** — the guard receives the resolved mode and rules; the loader that assembles managed/project/teammate layers and cold-resume snapshots is deferred.
- **The `ask` path depends on the approval seam** — the guard routes an `ask` to the approval seam, proven by a composition test against a real `ApprovalService`; without the service the seam denies the call. The team plugin's leader-rendezvous route is a separate consumer's concern.
