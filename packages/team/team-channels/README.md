# dsh-team-channels

Team messaging, progress tracking, and approval coordination for the DeepSeek Harness team plugin.

## Role

**Consumer** — provides the host-level `ctx.teamControl` registry (teammate → leader approval flow, keyed by leader session) and the `TeamProgressStore` (structured task progress, keyed by leader session).

## Key Exports

| Export | Description |
|---|---|
| `TeamControlRegistry` | Host-level pending-approval registry keyed by leader session, with timeout sweep |
| `TeamProgressStore` | In-memory progress store keyed by leader session, with session-event restore |

## Config

| Key | Type | Default | Description |
|---|---|---|
| `controlRequestTimeoutMs` | `number` | `120000` | Auto-deny timeout for pending requests |

## Model Experience

None directly: the package provides coordination state consumed by the `team_control` and `team_progress` tools.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Control request persistence across process restart is not implemented; cold resume auto-denies pending requests.
- The progress store is in-memory only; session events provide durability and are replayed on `list`.
