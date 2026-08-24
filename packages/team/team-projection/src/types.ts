/**
 * Read-only team projection view types. Contains only types — no runtime code.
 * Every timestamp is the producing session event's `time` (epoch ms); nothing
 * here reads a wall clock, so a fold over the same logs is byte-stable.
 *
 * @module @deepseek-ai/dsh-team-projection
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TeamControlDecision } from '@deepseek-ai/dsh-team/types'

/** Complete team snapshot keyed by the leader session. */
export interface TeamView {
  /** This phase's team identity: always the leader session id (no separate team entity). */
  readonly teamId: string
  /** The leader session whose logs anchor the fold. */
  readonly leaderSessionId: string
  /** Enabled roster definition count (leader included, after enablement filtering). */
  readonly rosterMemberCount: number
  /** Enabled roster members plus every member the logs bound (unbound rows included). */
  readonly members: readonly TeamMemberView[]
  /** One row per leader-log `delegate_to_teammate` call with a parseable teammate id. */
  readonly delegations: readonly TeamDelegationView[]
  /** Latest `team/progress` event per taskId, in first-seen order. */
  readonly tasks: readonly TeamTaskView[]
  /** Every `team/control-request` with its paired decision when one exists. */
  readonly approvals: readonly TeamApprovalView[]
  /** Globally ordered message tail, capped at MESSAGE_CAP (most recent last). */
  readonly messages: readonly TeamMessageView[]
  /** Total `team/message` count the fold observed (distinguishes truncation from absence). */
  readonly messageCount: number
}

/** One member row: the roster half joined with the log-bound half. */
export interface TeamMemberView {
  /** `team/member-bound` memberId when bound; otherwise the roster definition id. */
  readonly memberId: string
  /** Roster name; a never-rostered bound member falls back to its `team:`-stripped creation label (display only). */
  readonly name: string
  readonly role: 'leader' | 'teammate'
  /** Sessions bound to this member (at most one under the persistent policy); empty while unbound. */
  readonly sessionIds: readonly string[]
  /** Log baseline (`unbound`/`bound`/`settled`) with the live running overlay applied. */
  readonly status: 'unbound' | 'bound' | 'running' | 'settled'
  /** Name of the latest `tool/call` in the member's own log suffix; absent while unbound or before any call. */
  readonly currentAction?: string
  /** This member's control requests that still have no paired decision. */
  readonly pendingControlCount: number
}

/** One delegation span from a `delegate_to_teammate` call to its settlement notice. */
export interface TeamDelegationView {
  readonly memberId: string
  /** The settling child id once revealed; an open span names the member's latest bound session ('' when the child log is unavailable). */
  readonly childSessionId: string
  /** The delegate call's event time. */
  readonly startedAt: number
  /** The settlement notice's event time; absent while the span is open. */
  readonly endedAt?: number
  /** True while no settlement notice has closed this span. */
  readonly inProgress: boolean
}

/** One task-board row: the latest `team/progress` event for a taskId. */
export interface TeamTaskView {
  readonly taskId: string
  readonly subject: string
  readonly status: 'pending' | 'in_progress' | 'completed' | 'blocked'
  readonly summary?: string
  readonly memberId: string
  /** Log seq of the latest progress event. */
  readonly seq: number
  /** Event time of the latest progress event (the row's timeline endpoint). */
  readonly at: number
}

/** One control request paired with its decision when the leader log carries one. */
export interface TeamApprovalView {
  readonly requestId: string
  readonly memberId: string
  readonly toolName: string
  readonly reason: string
  readonly kind?: 'tool' | 'plan'
  /** Event time of the request. */
  readonly requestedAt: number
  /** Paired `team/control-decision`; absent means the request is still pending in the log view. */
  readonly decision?: {
    readonly value: TeamControlDecision
    readonly reason?: string
    readonly decidedAt: number
  }
}

/** One member-to-member message in the global order. */
export interface TeamMessageView {
  readonly from: string
  readonly to: string
  readonly message: string
  /** Event time. */
  readonly at: number
  /** Event seq within the recording session. */
  readonly seq: number
  /** The session that recorded the event (the sender's session). */
  readonly sessionId: string
}

/** Identifies one folded message: the global order's deciding triple. */
export interface MessageAnchor {
  readonly at: number
  readonly sessionId: string
  readonly seq: number
}

/** One older-messages page: strictly earlier than the anchor, ascending, at most `limit` rows. */
export interface TeamMessagePage {
  readonly kind: 'message-page'
  /** Echoes the team identity for concurrent-request matching. */
  readonly teamId: string
  /** Echoes the request's leader session. */
  readonly leaderSessionId: string
  readonly messages: readonly TeamMessageView[]
  /** Same count basis as the snapshot; the client derives hasMore from loaded < messageCount. */
  readonly messageCount: number
}

/** Pagination options for the message-page request form. */
export interface TeamPageOptions {
  /** Anchor naming one folded message; the page is strictly earlier. */
  readonly messagesBefore?: MessageAnchor
  /** Page length bound in [1, MESSAGE_CAP]; defaults to MESSAGE_CAP. */
  readonly limit?: number
}

/** Change-feed listener: one call per committed leader snapshot. */
export type TeamProjectionListener = (leaderSessionId: SessionId, view: TeamView) => void
