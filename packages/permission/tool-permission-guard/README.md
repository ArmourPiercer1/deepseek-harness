# dsh-tool-permission-guard

Permission guard Consumer for the DeepSeek Harness.

A `tools/pre-execute` listener that applies `ctx.permission.evaluate` for the main agent and single delegated subagents. `allow` proceeds; `deny` blocks the call with the engine's reason; `ask` routes to the approval seam.

## Role

**Consumer** — reads `ctx.permission` (from `@deepseek-ai/dsh-permission`), provides no service. It sits loose in a composition and resolves the host permission engine. The team plugin is a separate consumer that routes an `ask` to the leader rendezvous instead.

## Config

| Field | Description |
|---|---|
| `mode` | The scope's permission mode (`enforce` / `default`). |
| `rules` | The authored rule strings for this scope, by kind. |

Rule-source layering and cold-recovery snapshots are the loader's concern; this consumer receives the resolved mode and rules.

## Model Experience

The guard adds no tool. Its model-visible effect is a denied call's `reason` and, for an `ask`, the approval prompt. A denied call returns an error result the model sees; the decision is also recorded as a `permission/decision` audit event.

## Known Limitations and Deferred Work

The listener and config land in S5 of the permission seam Agent Note. Rule learning and MCP lifecycle are later stages and are not consumed here.
