# dsh-client-ui-team

English | [中文](README.zh.md)

Web team configuration and status surface for the DeepSeek Harness team plugin.

## Role

Browser-side UI plugin for the team plugin. Adds a Team settings section to the Settings panel showing teammate configuration and usage instructions, and a durable team panel Chat node in the leader's conversation: the task progress board folded from `team/progress` events plus teammate status rows from the subagent catalog.

## Slot Registrations

| Target slot | Kind | Content |
|---|---|---|
| `settings.section` | list/root | Team configuration section with teammate list and setup instructions |
| `conversation.chat.node` | keyed/session, key `team-panel` | Team panel: task progress board and teammate status rows; renders once the session log carries a `team/progress` event or a `delegate_to_teammate` tool call |

## Teammate status semantics

Teammate rows are the parent session's `team:`-labeled continuable subagent children. Status is derived per row: `running` while the child's store-snapshot activity is running; `settled` for an inactive child whose name appears among the window's `delegate_to_teammate` targets; `bound` otherwise (bound baseline with no delegation in the loaded window). Catalog labels carry the member name while delegate calls carry the member id — independent frontmatter fields — so the join is best-effort by name.

## Model Experience

None, as the package is a browser-side UI plugin that registers nothing model-facing.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Settings section is read-only for MVP; inline teammate definition editing is deferred.
- Session-level team status dock bar and toggle button are deferred to a follow-up.
- The team/message timeline (per-teammate message rows in the conversation) is deferred; the panel renders the progress board and teammate status only.
