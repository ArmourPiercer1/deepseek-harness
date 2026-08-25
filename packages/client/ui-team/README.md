# dsh-client-ui-team

English | [中文](README.zh.md)

Web team configuration and status surface for the DeepSeek Harness team plugin.

## Role

Browser-side UI plugin for the team plugin. Adds a Team settings section to the Settings panel showing teammate configuration and usage instructions, inline team marker Chat nodes in the conversation — one compact single-line row per durable team event (`team/progress`, `team/control-request`, `team/control-decision`, `team/message`), the globally visible Team conversation view tab backed by the read-only leader-keyed team mirror (`ctx.sessions.teams`; the frozen team-ness derivation lives in the runtime as `resolveTeamView`), and the resident team dock bar above the input for team sessions.

## Slot Registrations

| Target slot | Kind | Content |
|---|---|---|
| `settings.section` | list/root | Team configuration section with teammate list and setup instructions |
| `conversation.chat.node` | keyed/session, key `team-marker` | Inline team markers: one compact single-line row per durable team event at the event's own log position — the conversation flow's reproducible team ledger |
| `conversation.view` | list/session, id `team`, order 20 | Team tab: one-line zero state for a non-team session; for a team session the complete four-section body — the delegation timeline, the member groups, the task board, and the event stream |
| `conversation.input.dock` | list/session, id `team`, order 15 | Team dock: the resident bar above the input (between the goal bar, order 10, and the queue strip, order 20) — the collapsed readout `Team · N running · M pending` (zero-count segments omitted) plus the expandable compact member status rows and task rows; renders only for a team session, the jump entry activates the Team tab |

## Team view data

The tab reads the sessions service's team mirror through its registration's inject hooks compartment (`useTeamMirror`, a read-only selector hook over the leader-keyed `TeamView` record) and cold-fills a mirror gap through `ensureTeam` (the single-flight `team.projection` unary) when the tab is mounted and the mirror lacks the session. A session is a team session exactly when it leads a mirrored view or any mirrored view binds it as a member (`members.sessionIds`); every other session renders the zero state and nothing else. The registration also threads the existing session-open path as a plain `openSession` callback, which the timeline bars, member rows, event-stream rows, and inline marker rows use for their click-to-switch. The dock consumes the same mirror source and `ensureTeam` callback through its own registration, so its team-session criterion is the tab's.

## Team inline markers

The conversation flow renders each durable team event as one compact single-line marker — the whole-card team panel was removed. Every event is its own row at the event's log position, so every state change adds a row: the flow is a reproducible ledger of team progress, and the per-event repetition is the intended behavior. Four event kinds render, each with the event time, a type marker, and a summary truncated to the one line (the full text stays in the row's title): task progress (`team/progress` — the task subject plus the four-state status chip), the approval request (`team/control-request` — the requesting member and the tool, the reason, and the waiting chip; the plan-approval kind carries its own label), the approval decision (`team/control-decision` — the five-value result plus the optional reason), and the member-to-member message (`team/message` — sender → recipient plus the content). Request and decision rows pair at the render layer through their own request id; the pairing is never folded across rows, so the ledger replays one event at a time. Clicking a row resolves the related session from the row data and the authoritative mirror (the member rows and approval pairs are the id-to-session join — no catalog-label or delegate-argument parsing): when the target is the row's own session the row anchors itself in the flow (scroll to center); a cross-session target switches the current session first, and the in-flow anchor degrades to the switch itself — the corresponding row of the target session sits at a log seq of the other log space and is unnameable from here. A decision row whose request the mirror cannot pair renders inert: disabled, and never opening a session.

## Team timeline

The timeline section renders the leader view's delegations as swim lanes: one row per teammate (the leader gets no row), lane colors cycling a fixed ramp of existing `--dsw-alias-state-*` tokens by lane index, and one bar per delegation span over the linear time domain — the left edge is the earliest delegation start or task event, the right edge the last settlement, extended to the component's local clock while any span runs. Idle time between spans stays blank. Wheel zooms at the pointer, left/right-button drag pans, and arrow keys / `+` / `-` / `0` / `Escape` cover keyboard pan, zoom, and reset. Hovering a bar shows the member name, the start→end range, and the duration; clicking a bar with a bound session switches the current session to that member's session. Without any delegation the section shows a one-line note instead of the lane matrix.

## Team member groups

The member-group section renders the leader view's members as groups: the fixed leading row is the leader (the "return to leader" entry, anchored to the view's `leaderSessionId` — it renders even when the member rows carry no leader), followed by one group per non-leader member definition in `members` order. A group's container row reads `Name · N 活跃`, where `N` is the running-instance count; the interface stays multi-instance (rows sharing a memberId fold into one group) even though this phase runs at most one. The expansion lists the member's instance rows — the three-state status (bound/running/settled, read straight from the projection and never re-derived), the latest tool call or a placeholder, and a waiting badge while control requests are unpaired. Unbound members keep their container row with a no-instances note. Clicking the leading row or an instance row switches the current session to the bound session; the group and instance rows whose session is the current one highlight.

## Task board

The task-board section renders the leader view's task list: one row per task in first-seen order, each with the state dot (pending/in progress/completed/blocked), the task subject, the status label, the assignee (the member name resolved through the member rows, D19, falling back to the raw id), and the optional progress summary. The rows are read straight from the projection's `tasks` (latest `team/progress` per taskId) and never re-folded here. Rows are non-interactive, and the section shows a one-line note while the team has recorded no task progress.

## Event stream

The event-stream section renders the approval chains and the member-to-member messages as one mixed list in ascending time order (oldest first). An approval row pairs each control request with its decision: an unpaired request shows the waiting state, a decided one shows the five-value decision label (allow once / deny / escalate to user / approve plan / request revision) plus the optional decision reason. A message row shows the sender → recipient plus the content, truncated to one line (the full text stays in the row's title). The section renders the most recent 200 mixed rows by default; the top "load earlier" button first appends older rows in 200-row steps from the snapshot's representable stream (the projection carries the full approval history plus the most recent ≤500 messages), then — once that stream is loaded — pages the host's `messagesBefore` form through the sessions team face (`pageMessagesBefore`, the anchor is the oldest loaded message's triple, the window grows by the page length, and "more" is derived from the newest fold-observed `messageCount`). A failed page stays loud: an error note with the business/transport message plus the counted remainder as a note, with the button kept for retry. Clicking a row switches the current session to the row's session: the recording session for messages, the requesting member's bound session for approvals (D9); the D16 in-flow position anchoring lives on the inline marker rows (see Team inline markers), not on the tab's feed.

## Team dock

The dock registers the team bar into the input dock above the composer (order 15: between the goal bar's 10 and the queue strip's 20). It renders only for a team session — the tab's same frozen criterion (the mirror's presence, cold-filled through the same `ensureTeam` single-flight pull) — and reads the same leader-keyed view. The collapsed one-line readout carries the D23 team-wide counts (`N` running member sessions, `M` unpaired control requests; a zero-count segment is omitted), and the chevron expands the compact member status rows (name + state dot, unbound members skipped) and the task rows (subject + status label). The bar's jump entry activates the current session's Team tab; the view write is ui-conversation-private, so the entry degrades to a DOM activation of the tab ring's team button until a sanctioned cross-plugin view-switch verb exists.

## Model Experience

None, as the package is a browser-side UI plugin that registers nothing model-facing.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Settings section is read-only for MVP; inline teammate definition editing is deferred.
- The dock's team-tab jump degrades to a DOM activation of the tab ring's team button (the chat store's view action is ui-conversation-private); a sanctioned cross-plugin view-switch verb would replace it.
- An inline marker's cross-session click degrades to the session switch: the corresponding row of the target session sits at a log seq of the other log space and is unnameable from the row's own session, so only the row's own session gets the in-flow anchor.
- An inline decision marker renders inert (disabled, no click) while the mirror carries no approval pair for its request id — e.g. before the first snapshot frame — so the click is unavailable rather than misdirected.
- The event stream's wire pages are tab-local: a new snapshot frame resets the fetched pages (the load depth is kept and the window re-derives over the new frame), so already-paged older messages must be paged again — a retained page's seam with the snapshot window would otherwise open a gap.
