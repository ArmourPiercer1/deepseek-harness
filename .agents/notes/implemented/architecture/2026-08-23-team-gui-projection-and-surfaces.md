# Agent Note: The Team GUI — Host-Read-Only Projection and Web Surfaces

Status: implemented

English | [中文](2026-08-23-team-gui-projection-and-surfaces.zh.md)

## Problem

The team plugin's Web surface was a read-only `settings.section` configuration block. A leader session doing team work — delegating through `delegate_to_teammate`, recording `team/progress` checkpoints, raising control requests — rendered nothing about that work in the conversation, and the one earlier attempt, the whole-card `team-panel` Chat node, collapsed the whole team state into a single card anchored at the first team event: it could not place each event at its own log position, so the conversation flow carried no per-event team ledger, and its teammate rows joined catalog labels to delegate arguments best-effort by name.

The redesign (frozen spec D1–D23) required a live team surface — a conversation tab, a dock readout, and per-event inline markers — under two hard constraints: zero changes to the team orchestration runtime, and a host-owned projection, since the web layer is pure presentation and the session logs live on the host.

## Decision

- **Host projection.** `@deepseek-ai/dsh-team-projection` (the `ctx.teamProjection` service) folds one leader's `TeamView` from session logs — cold-safe, the logs the single authority, in-process orchestration state never read — overlays live running state from the agent registry, and republishes the whole snapshot after every team-relevant commit (leader facts, child facts, subagent-origin lifecycle, status flips of active leaders). Rebuilds coalesce per leader; a trigger that lands after the in-flight fold's log read re-arms exactly one follow-up (a per-leader trigger sequence compared against the fold's read-start watermark), so no commit is missed and already-covered triggers cost no extra broadcast. A roster without a leader definition gives the leader row the id `leader` — or the leader session id when a teammate definition already takes it — so member ids stay unique. The [package README](../../../../packages/team/team-projection/README.md) owns the fold contract.
- **Wire.** The API gateway broadcasts a whole-snapshot `session/team` frame per published leader view and serves the `team.projection` unary (snapshot form, or a `messagesBefore` page with limit in [1, 500]) with the error codes `team-leader-unknown`, `team-anchor-unknown`, and `team-unavailable` ([apiproxy README](../../../../packages/host/apiproxy/README.md)).
- **Client object layer.** `ctx.sessions.teams` holds the read-only mirror: whole `TeamView` snapshots keyed by leader session, last-wins from the frames, re-baselined on `session/subscribed` and `host/session-removed`, cold-filled by the single-flight `teams.refresh`. `resolveTeamView` is the one frozen team-ness derivation every surface shares. [runtime README](../../../../packages/client/runtime/README.md).
- **Web surfaces.** [dsh-client-ui-team](../../../../packages/client/ui-team/README.md) registers three: the globally visible Team tab (`conversation.view`, order 20 — a one-line zero state for non-team sessions, the four-section body for team sessions), the resident dock bar (`conversation.input.dock`, order 15 — the collapsed `Team · N running · M pending` readout for team sessions), and inline team markers (`conversation.chat.node`, key `team-marker` — one compact single-line row per durable team event at the event's own log position, the conversation flow's reproducible team ledger). The whole-card `team-panel` node is abolished; this note consolidates the panel's note (`2026-08-20-web-team-panel`, deleted with this note) and preserves its unique decisions below.
- **Identity join.** Member rows join through the `team/member-bound` memberId recorded on each child — no label or delegate-argument parsing, replacing the panel's best-effort name join. `tool/call.arguments` remains model JSON, parsed only at that boundary: a malformed or absent `teammate_id` produces no delegation fact.
- **D13 downgrade.** The dock's jump to the team tab degrades to DOM activation of the tab ring's team button — the chat store's `setView` action is ui-conversation-private and no cross-plugin view-switch verb exists. The fragility is documented in the package README's Known Limitations.
- **D16 downgrade.** An inline marker clicked from another session degrades to the session switch: the row's target sits at a seq of the other log space, unnameable from the row's own session, so only own-session clicks get the in-flow scroll anchor.
- **Inherited from the panel.** `team/progress` is a startless whole-value checkpoint family (the fold keeps the latest per task id); the catalog supplies member names while the projection supplies ids and session bindings.

## Alternatives considered

**Keep the whole-card panel as the ledger.** Rejected (spec D14/D15): a single card cannot carry one row per event at each event's log position, and an aggregated card hides per-event detail behind an expandable card the user must know to open.

**Client-side aggregation of team state.** Rejected: the web layer is pure presentation and the session logs — the only complete authority — are host-side; folding them in the browser would duplicate the projection over the wire and split the truth between planes. The object layer carries frames, not logs.

**Extend the `ViewTab` contract or add a cross-package view-switch verb for D13.** Not taken: `ViewTab` is frozen at `{id, label}` (spec D2), and a programmatic switch would be new public surface of ui-conversation crossing packages — out of this batch's scope, deferred to orchestration arbitration; the DOM fallback stands in the meantime.

**A per-task Context started by the first `team/progress` event (panel era).** Rejected: the producer emits whole-value checkpoints with no dedicated start, and "first event in the loaded window" is not a stable business identity — the loaded window can be a mid-history page.

**A per-session team store fed by session-event listeners (panel era).** Rejected: business components contain no subscription machinery, and shared live business state belongs in the object layer (or the Conversation Node engine for durable event families), not in an entry store.

**Deriving teammate rows from `team/member-bound` client-side (panel era).** Superseded: that event still never reaches the leader's conversation window, which is why names come from the catalog — but the join itself now happens host-side over the durable memberId, so the client derives rows from the mirror, not from the window.

## Consequences

- The per-event ledger is reproducible from the log: markers sit at their own positions, and prepending older pages relocates rather than duplicates rows; the tab body is a derived view over the same frames.
- The dock jump is fragile in the documented ways: a same-labeled tab in any tab list wins the match, and with no rendered tab ring (a blank conversation hides its header) the jump is a silent no-op.
- Cross-session marker clicks land in the target session without the row in view (switch-only); own-session clicks scroll the row into view.
- Pending control counts are log-based: timeout auto-denials are not logged decisions, so such requests stay pending in the readout.
- A commit that lands while a rebuild is in flight is covered by exactly one re-armed follow-up publish; the extra broadcast happens only when the commit truly missed the fold's copy.
- Verification: `packages/team/team-projection/tests/` (fold, invariant, and real-Loader composition including the re-arm window), `packages/client/ui-team/tests/` (marker definition and render, timeline, members, tasks, feed, dock, and the built-artifact spec asserting the `team-panel` kind is gone from the `ChatNodeKind` merge), and the regenerated client slot catalog.
