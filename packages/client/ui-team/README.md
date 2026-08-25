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
| `conversation.view` | list/session, id `team`, order 20 | Team tab: one-line zero state for a non-team session; for a team session the complete four-section body — the delegation timeline, the member groups, the task board, and the event stream |

## Team view data

The tab reads the sessions service's team mirror through its registration's inject hooks compartment (`useTeamMirror`, a read-only selector hook over the leader-keyed `TeamView` record) and cold-fills a mirror gap through `ensureTeam` (the single-flight `team.projection` unary) when the tab is mounted and the mirror lacks the session. A session is a team session exactly when it leads a mirrored view or any mirrored view binds it as a member (`members.sessionIds`); every other session renders the zero state and nothing else. The registration also threads the existing session-open path as a plain `openSession` callback, which the timeline bars, member rows, and event-stream rows use for their click-to-switch.

## Team timeline

The timeline section renders the leader view's delegations as swim lanes: one row per teammate (the leader gets no row), lane colors cycling a fixed ramp of existing `--dsw-alias-state-*` tokens by lane index, and one bar per delegation span over the linear time domain — the left edge is the earliest delegation start or task event, the right edge the last settlement, extended to the component's local clock while any span runs. Idle time between spans stays blank. Wheel zooms at the pointer, left/right-button drag pans, and arrow keys / `+` / `-` / `0` / `Escape` cover keyboard pan, zoom, and reset. Hovering a bar shows the member name, the start→end range, and the duration; clicking a bar with a bound session switches the current session to that member's session. Without any delegation the section shows a one-line note instead of the lane matrix.

## Team member groups

The member-group section renders the leader view's members as groups: the fixed leading row is the leader (the "return to leader" entry, anchored to the view's `leaderSessionId` — it renders even when the member rows carry no leader), followed by one group per non-leader member definition in `members` order. A group's container row reads `Name · N 活跃`, where `N` is the running-instance count; the interface stays multi-instance (rows sharing a memberId fold into one group) even though this phase runs at most one. The expansion lists the member's instance rows — the three-state status (bound/running/settled, read straight from the projection and never re-derived), the latest tool call or a placeholder, and a waiting badge while control requests are unpaired. Unbound members keep their container row with a no-instances note. Clicking the leading row or an instance row switches the current session to the bound session; the group and instance rows whose session is the current one highlight.

## Task board

The task-board section renders the leader view's task list: one row per task in first-seen order, each with the state dot (pending/in progress/completed/blocked), the task subject, the status label, the assignee (the member name resolved through the member rows, D19, falling back to the raw id), and the optional progress summary. The rows are read straight from the projection's `tasks` — the same source and fold as the chat node's `foldTeamBoard` (latest `team/progress` per taskId) — and never re-folded here. Rows are non-interactive, and the section shows a one-line note while the team has recorded no task progress.

## Event stream

The event-stream section renders the approval chains and the member-to-member messages as one mixed list in ascending time order (oldest first). An approval row pairs each control request with its decision: an unpaired request shows the waiting state, a decided one shows the five-value decision label (allow once / deny / escalate to user / approve plan / request revision) plus the optional decision reason. A message row shows the sender → recipient plus the content, truncated to one line (the full text stays in the row's title). The section renders the most recent 200 mixed rows by default; the top "load earlier" button first appends older rows in 200-row steps from the snapshot's representable stream (the projection carries the full approval history plus the most recent ≤500 messages), then — once that stream is loaded — pages the host's `messagesBefore` form through the sessions team face (`pageMessagesBefore`, the anchor is the oldest loaded message's triple, the window grows by the page length, and "more" is derived from the newest fold-observed `messageCount`). A failed page stays loud: an error note with the business/transport message plus the counted remainder as a note, with the button kept for retry. Clicking a row switches the current session to the row's session: the recording session for messages, the requesting member's bound session for approvals (D9). The D16 in-stream position anchoring ships with the P5b inline marker rows; until then the click degrades to the session switch.

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
- The event stream's wire pages are tab-local: a new snapshot frame resets the fetched pages (the load depth is kept and the window re-derives over the new frame), so already-paged older messages must be paged again — a retained page's seam with the snapshot window would otherwise open a gap.
