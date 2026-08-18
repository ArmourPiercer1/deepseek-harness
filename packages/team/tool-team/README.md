# dsh-tool-team

English | [中文](README.zh.md)

Model-facing team tools for the DeepSeek Harness team plugin.

## Role

**Consumer** — registers 5 tools for team coordination: delegation, discovery, messaging, progress tracking, and approval control.

## Tools

| Tool | Description |
|---|---|
| `delegate_to_teammate` | Delegate a task to a teammate (leader-only) |
| `list_teammates` | List available teammates with status |
| `send_team_message` | Send a message to a teammate or leader |
| `team_progress` | Read/update the team task progress board |
| `team_control` | Review/decide pending teammate permission requests (leader-only) |

## Model Experience

Indirectly, through dsh-tools which owns the model-visible tool catalog rendering for the 5 registered team tools.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Direct teammate-to-teammate delivery is not available: `send_team_message` from a teammate to a peer reports to the leader, which is woken to forward the message. A structured cross-member message queue is deferred.
- Tool result content blocks use plain text; rich structured rendering is deferred.
