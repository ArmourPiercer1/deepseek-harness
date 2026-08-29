# @deepseek-ai/dsh-team-projection

English | [中文](README.zh.md)

Host-side read-only team projection. `TeamProjectionService` (default export, `ctx.teamProjection`) folds one leader session's complete `TeamView` from the session logs — the leader log plus every `team:`-labeled continuable child — joined with the enabled workspace roster, overlays live `agent/status` running state, publishes whole snapshots on its change feed, and slices older-message pages on demand. The session logs are the single authority: `TeamProgressStore` and `TeamControlRegistry` process state is never read, so a process restart rebuilds the same baseline (cold-safe by construction).

## Placement

Host-plane service package in the web bundle's host roster (the wire is owned by `dsh-client-connection`; the browser-side team mirror lands in the `dsh-api-session-controller` client face). It does not read `ctx.team` — the team group sits behind the agent preset's isolate realm, invisible to the host plane — so the roster is re-scanned from the filesystem (`$DSH_HOME/teammates` plus the leader session's workspace `.dsh/teammates`, self-contained workspace semantics) with the `team-enablement` settings applied through `ctx.get('settings')` when composed.

## Service API

| Member | Contract |
|---|---|
| `get(leaderSessionId, signal?)` | Full snapshot; cold path reads persistence, never resumes an Agent. The requested session must pass the [team-ness gate](#team-ness-gate); a failure throws `TeamProjectionError('LEADER_UNKNOWN')` — loud, never a synthetic empty team. |
| `project(leaderSessionId, signal?, options?)` | Snapshot form unchanged; with `options.messagesBefore` returns a `TeamMessagePage` strictly earlier than the anchor (`limit` in `[1, MESSAGE_CAP]`, default `MESSAGE_CAP`; an anchor naming no folded message is `ANCHOR_UNKNOWN`, never a silent fallback). Same gate as `get`. |
| `onChanged(listener)` | One whole-snapshot publication per committed leader state (last-wins); triggers are the team event families, leader `delegate_to_teammate` / settlement notices, team-child creation/disposal, and `agent/status` (which recomputes only a leader whose snapshot this process has already folded). A trigger that lands after an in-flight fold's log read re-arms exactly one follow-up publication, so no committed trigger is dropped; a fold that dies before its log read (the store is gone) arms nothing. |

## Team-ness gate

`get` and `project` fold only a team session, marked by deterministic observable facts — the roster entry alone never qualifies (every workspace session sits under a roster):

- a `team:`-labeled continuable child in the session's subagent directory; or
- a team fact in the session's own log suffix (`seq >= seedLength`): `team/progress`, `team/control-decision`, `team/message`, `team/control-request`, or a `delegate_to_teammate` call; or
- a `team/member-bound` mark in the session's own log suffix: the session is a bound teammate, and the fold anchors its leader.

A session passing no criterion is rejected with `TeamProjectionError('LEADER_UNKNOWN')` — a loud failure, never a silent empty view.

## Fold contract highlights

- Child logs fold only their own suffix (`seq >= header.seedLength`), so a forked child replaying ancestor history never double-counts.
- Message global order is `(event.time, recording sessionId, seq)`; the snapshot carries the most recent `MESSAGE_CAP = 500` plus the total `messageCount`.
- Delegation spans pair a `delegate_to_teammate` call with the member's next `subagent-settled` notice (FIFO per member); an open span's `childSessionId` cold-resolves to the member's latest bound session.
- `members` is the enabled roster union the corpus bindings: never-bound teammates publish `status: 'unbound'` rows; bound-but-derostered members survive with the label-derived display name; the leader row anchors `sessionIds: [leaderSessionId]` and never reads `settled`, and its `memberId` is the roster leader entry's id, falling back to `'leader'` when the roster defines no leader — or to the leader session id when a non-leader roster entry already occupies `'leader'`.

## Model Experience

None, as this read-only GUI projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Timeout/restart auto-denials stay pending in the log view** — the control coordinator resolves only in-memory promises without appending `team/control-decision`, so the folded approvals keep showing such requests as undecided; wording lands with the consuming UI, not here.
- **Teammate self-recorded progress time** — `tasks.at` is the leader log's latest `team/progress` time; a progress event a teammate records only in its own log does not advance it (same posture as the existing panel).
- **Roster changes surface on the next trigger** — roster directories are re-scanned on every fold but not watched; a pure roster edit publishes nothing until a team event, status flip, or explicit read.
- **`sessionIds` heuristics for `fresh_per_delegation` children** — under the persistent policy (the current default) a member holds at most one bound session; a future multi-instance runtime must widen the span-to-session pairing before reusing this fold.
- **One-shot and unresolvable team children are skipped** — the child corpus is the `subagents.listChildren` directory, so a child the directory does not list as a `team:`-labeled continuable child (one-shot, or an unresolvable descriptor) contributes no facts to the fold (same basis as the subagent catalog); a bound teammate of such a child shows `unbound` while its directory row is missing.
