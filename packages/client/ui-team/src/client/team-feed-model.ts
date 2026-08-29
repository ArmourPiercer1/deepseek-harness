/**
 * Pure projection of the leader-keyed team view into the "团队" tab's
 * event-stream section (D8g/D8h): the approval-chain and member-message
 * rows mixed into one ascending time order (oldest first), rendered capped
 * to the most recent `loadedCount` rows (default 200) with the "load
 * earlier" depth carried as a plain count.
 *
 * The loaded stream is the snapshot's representable stream (the full
 * approval history plus the snapshot's ≤500-message tail) plus the wire
 * pages the caller has fetched: `olderMessages`, the `messagesBefore`
 * pages strictly earlier than the snapshot window, already spliced in
 * global order (each page's anchor was the previously loaded oldest
 * message, so page after page runs older). The model re-sorts the whole
 * loaded set, so the splice stays globally ascending by construction.
 * Messages the fold observed but the loaded set does not hold are counted
 * in `unloadedMessageCount` — the fact behind the section's loud counted
 * note when a page load fails.
 *
 * The mixed order is (time ascending, kind, source order): an approval
 * anchors at its request time (its later decision updates the row in
 * place, the position never moves), a message at its own event time;
 * equal times put approvals before messages and keep the projection's
 * fold order within each kind (messages already arrive in their global
 * `(at, sessionId, seq)` order), so the result is deterministic for one
 * loaded set. `oldestMessage` is the loaded stream's oldest message —
 * the `messagesBefore` anchor the next wire page must name.
 *
 * React-free; the renderer supplies the snapshot, the load depth, and the
 * wire pages it has fetched.
 */
import type { TeamView, TeamMessageView } from '@deepseek-ai/dsh-api-session-controller/client'

type ApprovalRow = TeamView['approvals'][number]
type MessageRow = TeamView['messages'][number]

/** First render depth (D8h): the most recent 200 mixed rows. */
export const TEAM_FEED_INITIAL_LIMIT = 200
/** One "load earlier" step (D8h): 200 older mixed rows per click. */
export const TEAM_FEED_STEP = 200

/** One approval-chain row: the request with its paired decision (pending while absent). */
export interface TeamFeedApprovalRow {
  readonly kind: 'approval'
  /** Stable React key across mirror frames: the request id. */
  readonly key: string
  /** The request's event time (the row's position in the mixed order). */
  readonly at: number
  readonly approval: ApprovalRow
  /** The requesting member's roster name; the raw member id when no member row matches (D19 fallback, display only). */
  readonly memberName: string
  /** The member's first bound session (the click-to-switch target); '' when none (inert row). */
  readonly sessionId: string
}

/** One member-to-member message row. */
export interface TeamFeedMessageRow {
  readonly kind: 'message'
  /** Stable React key across mirror frames: the recording session plus its seq. */
  readonly key: string
  /** The message's event time (the row's position in the mixed order). */
  readonly at: number
  readonly message: MessageRow
  /** The sender's roster name; the raw member id when unresolved. */
  readonly fromName: string
  /** The recipient's roster name; the raw member id when unresolved. */
  readonly toName: string
  /** The recording session (the sender's; the click-to-switch target). */
  readonly sessionId: string
}

/** One event-stream row: an approval-chain row or a message row. */
export type TeamFeedRow = TeamFeedApprovalRow | TeamFeedMessageRow

/** The rendered event-stream section: the loaded window plus its pagination facts. */
export interface TeamFeedModel {
  /** The most recent `loadedCount` mixed rows, oldest first (D8h order). */
  readonly rows: readonly TeamFeedRow[]
  /** The loaded stream's full length (all approvals plus every loaded message). */
  readonly total: number
  /** True while the loaded stream still has rows beyond the window (the depth axis). */
  readonly hasMore: boolean
  /** Messages the fold observed but the loaded set does not hold (older than the oldest loaded message). */
  readonly unloadedMessageCount: number
  /** The loaded stream's oldest message — the `messagesBefore` anchor for the next wire page; undefined while no message is loaded. */
  readonly oldestMessage: TeamMessageView | undefined
}

/** The kind's tie-break rank: approvals sort before messages at equal times. */
const KIND_RANK: Record<TeamFeedRow['kind'], 0 | 1> = { approval: 0, message: 1 }

/** One sorted-stream entry before the window cut. */
interface FeedItem {
  readonly kind: TeamFeedRow['kind']
  readonly at: number
  /** The source array's index: the within-kind order tie-break. */
  readonly order: number
  readonly row: TeamFeedRow
}

/**
 * Project the view onto the event-stream model at one load depth.
 * @param view - the leader-keyed team view snapshot.
 * @param loadedCount - how many of the most recent mixed rows the section
 *   currently renders (clamped to the loaded stream's length).
 * @param olderMessages - the fetched `messagesBefore` pages, globally
 *   ascending and strictly earlier than the snapshot window's oldest
 *   message (the caller keeps the seam; the model re-sorts everything).
 * @param observedMessageCount - the newest fold-observed message total
 *   (the caller passes the latest page's count when it outruns the
 *   snapshot's); defaults to the snapshot's own `messageCount`.
 * @returns the loaded window (oldest first) plus the loaded total, the
 *   depth-axis hasMore flag, the unloaded-message count, and the oldest
 *   loaded message (the next page's anchor).
 */
export function deriveTeamFeed(
  view: TeamView,
  loadedCount: number,
  olderMessages: readonly TeamMessageView[] = [],
  observedMessageCount?: number,
): TeamFeedModel {
  const names = new Map<string, string>()
  const sessions = new Map<string, string>()
  for (const member of view.members) {
    if (names.has(member.memberId)) continue
    names.set(member.memberId, member.name)
    sessions.set(member.memberId, member.sessionIds[0] ?? '')
  }
  const items: FeedItem[] = []
  view.approvals.forEach((approval, order) => {
    items.push({
      kind: 'approval',
      at: approval.requestedAt,
      order,
      row: {
        kind: 'approval',
        key: `approval:${approval.requestId}`,
        at: approval.requestedAt,
        approval,
        memberName: names.get(approval.memberId) ?? approval.memberId,
        sessionId: sessions.get(approval.memberId) ?? '',
      },
    })
  })
  // Older pages first, the snapshot tail after: the within-kind source
  // order is the global `(at, sessionId, seq)` order across the seam.
  const messages: readonly TeamMessageView[] = [...olderMessages, ...view.messages]
  messages.forEach((message, order) => {
    items.push({
      kind: 'message',
      at: message.at,
      order,
      row: {
        kind: 'message',
        key: `message:${message.sessionId}:${message.seq}`,
        at: message.at,
        message,
        fromName: names.get(message.from) ?? message.from,
        toName: names.get(message.to) ?? message.to,
        sessionId: message.sessionId,
      },
    })
  })
  items.sort((left, right) =>
    left.at - right.at
    || KIND_RANK[left.kind] - KIND_RANK[right.kind]
    || left.order - right.order,
  )
  const total = items.length
  const limit = Math.max(0, Math.min(loadedCount, total))
  const rows = items.slice(total - limit).map(item => item.row)
  const observed = Math.max(observedMessageCount ?? view.messageCount, messages.length)
  return {
    rows,
    total,
    hasMore: limit < total,
    unloadedMessageCount: Math.max(0, observed - messages.length),
    oldestMessage: messages[0],
  }
}
