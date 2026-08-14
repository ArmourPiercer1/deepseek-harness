# dsh-team-channels

Team messaging, progress tracking, and approval coordination for the DeepSeek Harness team plugin.

## Role

**Consumer** — provides the `TeamControlCoordinator` (teammate → leader approval flow) and `TeamProgressStore` (structured task progress).

## Key Exports

| Export | Description |
|---|---|
| `TeamControlCoordinator` | Manages pending approval requests with timeout sweep |
| `TeamProgressStore` | In-memory progress store with session-event restore |

## Config

| Key | Type | Default | Description |
|---|---|---|---|
| `controlRequestTimeoutMs` | `number` | `120000` | Auto-deny timeout for pending requests |

## Model Experience

None, as the package provides in-memory coordination state with no prompt, schema, or result.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Control request persistence across process restart is not implemented; cold resume auto-denies pending requests.
- The progress store is in-memory only; session events provide durability but are not replayed automatically on startup.
