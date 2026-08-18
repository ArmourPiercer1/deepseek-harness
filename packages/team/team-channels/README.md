# dsh-team-channels

English | [中文](README.zh.md)

Team messaging, progress tracking, and approval coordination for the DeepSeek Harness team plugin.

## Role

**Consumer** — provides the host-level `ctx.teamControl` registry (teammate → leader approval flow, keyed by leader session) and the `TeamProgressStore` (structured task progress, keyed by leader session).

## Key Exports

| Export | Description |
|---|---|
| `TeamControlRegistry` | Host-level pending-approval registry keyed by leader session, with timeout sweep, dispose auto-deny, and cold-resume reconciliation |
| `TeamProgressStore` | In-memory progress store keyed by leader session, with session-event restore |

## Config

| Key | Type | Default | Description |
|---|---|---|---|
| `controlRequestTimeoutMs` | `number` | `120000` | Auto-deny timeout for pending requests, enforced by the plugin's periodic sweep |

## Model Experience

None, as the package provides in-memory coordination state consumed by the `team_control` and `team_progress` tools; it registers no prompt, schema, or result of its own.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Control request state is in-memory only: a request lost with a process restart is not restored and remains as log history. A cold resume auto-denies the resuming child's persisted requests that are still pending in the registry, as do the timeout sweep and leader session dispose.
- The progress store is in-memory only; session events provide durability and are replayed on `list`.
