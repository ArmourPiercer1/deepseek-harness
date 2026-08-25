# dsh-client-ui-team

English | [中文](README.zh.md)

Web team configuration and status surface for the DeepSeek Harness team plugin.

## Role

Browser-side UI plugin for the team plugin. Adds a Team settings section to the Settings panel showing teammate configuration and usage instructions, a durable team panel Chat node in the leader's conversation: the task progress board folded from `team/progress` events plus teammate status rows from the subagent catalog, and the globally visible Team conversation view tab backed by the read-only leader-keyed team mirror (`ctx.sessions.teams`; the frozen team-ness derivation lives in the runtime as `resolveTeamView`).

## Slot Registrations

| Target slot | Kind | Content |
|---|---|---|
| `settings.section` | list/root | Team configuration section with teammate list and setup instructions |
| `conversation.chat.node` | keyed/session, key `team-panel` | Team panel: task progress board and teammate status rows; renders once the session log carries a `team/progress` event or a `delegate_to_teammate` tool call |
| `conversation.view` | list/session, id `team`, order 20 | Team tab: one-line zero state for a non-team session, placeholder body for a team session until the four-section view lands |

## Team view data

The tab reads the sessions service's team mirror through its registration's inject hooks compartment (`useTeamMirror`, a read-only selector hook over the leader-keyed `TeamView` record) and cold-fills a mirror gap through `ensureTeam` (the single-flight `team.projection` unary) when the tab is mounted and the mirror lacks the session. A session is a team session exactly when it leads a mirrored view or any mirrored view binds it as a member (`members.sessionIds`); every other session renders the zero state and nothing else.

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
