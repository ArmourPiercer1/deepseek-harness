/**
 * The "团队" tab's event-stream section (the fourth of the four sections,
 * D8g/D8h): the approval-chain and member-message rows mixed into one
 * ascending time order (oldest first). An approval row pairs its request
 * with its decision — the waiting badge while unpaired, then the five-value
 * decision label plus the optional decision reason. A message row shows
 * `from → to` plus one-line content. The section renders the most recent
 * 200 mixed rows and grows older on demand through the top "load earlier"
 * button: over the snapshot's representable stream the click is a plain
 * depth append, and once that stream is loaded the click pages the wire
 * (`messagesBefore` with the oldest loaded message as anchor), splicing the
 * page ahead in global order. A failed page stays loud — the error note
 * plus the counted remainder — and the windowed fallback is what the
 * counted note was before pagination existed. Each row carries a stable
 * identity (request id, or session+seq) and switches the current session
 * to the row's session on click (D9); the D16 in-stream position anchoring
 * ships with the P5b inline marker rows, so this phase degrades to the
 * session switch.
 *
 * Paged messages are component-local state, keyed to the snapshot frame:
 * a new frame re-derives the window at the same depth (the P4c frame-swap
 * semantics) and the fetched pages reset, because a moved window would
 * break the page's seam with the snapshot.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ClientFailure, ClientResult, MessageAnchor, TeamMessagePage, TeamMessageView, TeamView,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { TeamKey } from './locales.ts'
import {
  TEAM_FEED_INITIAL_LIMIT, TEAM_FEED_STEP,
  deriveTeamFeed,
  type TeamFeedRow,
} from './team-feed-model.ts'
import { formatTeamClock } from './team-timeline-model.ts'
import styles from './TeamFeed.module.css'

/** The event-stream section props: the team view, the pagination callback, the D9 navigation callback, and the team dictionary. */
export interface TeamFeedProps {
  /** The leader-keyed team view snapshot (the mirror's own reference). */
  view: TeamView
  /**
   * Page-read the leader's member messages strictly earlier than the anchor
   * (the injected sessions team-face pagination entry).
   */
  pageMessages: (
    leaderSessionId: string,
    anchor: MessageAnchor,
    limit?: number,
  ) => Promise<ClientResult<TeamMessagePage>>
  /** Switch the current session to the clicked row's session. */
  onSelectSession: (sessionId: string) => void
  /** The team dictionary translate seat. */
  t: PropsLocale<'team'>['t']
}

type DecisionValue = NonNullable<TeamView['approvals'][number]['decision']>['value']

const DECISION_KEYS = {
  allow_once: 'view.events.decision.allow_once',
  deny: 'view.events.decision.deny',
  escalate_to_user: 'view.events.decision.escalate_to_user',
  approve_plan: 'view.events.decision.approve_plan',
  request_revision: 'view.events.decision.request_revision',
} as const satisfies Record<DecisionValue, TeamKey>

/** The single-row props: the feed row, the switch callback (absent when the row binds no session), and the dictionary. */
interface FeedRowProps {
  readonly row: TeamFeedRow
  /** Switch to the row's session; absent when the row binds none. */
  readonly onSelect?: (() => void) | undefined
  readonly t: PropsLocale<'team'>['t']
}

/**
 * Map one feed row onto the StateDot state: an approval is amber while its
 * request is unpaired and green once the chain settles (the decision value
 * itself carries the polarity); a message reads as ongoing.
 * @param row - the feed row.
 * @returns the dot state.
 */
function rowDot(row: TeamFeedRow): StateDotState {
  if (row.kind === 'message') return 'ongoing'
  return row.approval.decision === undefined ? 'warning' : 'done'
}

/** One event-stream row: time, type marker, actor, one-line summary, and (for approvals) the pairing state. */
function FeedRow({ row, onSelect, t }: FeedRowProps): React.JSX.Element {
  const decision = row.kind === 'approval' ? row.approval.decision : undefined
  const summaryText = row.kind === 'approval'
    ? `${row.approval.toolName} ${row.approval.reason}`.trim()
    : row.message.message
  return (
    <button
      type="button"
      className={styles.row}
      data-feed-row
      data-feed-kind={row.kind}
      data-decision={decision?.value}
      disabled={onSelect === undefined}
      onClick={onSelect}
    >
      <span className={styles.dotSlot} aria-hidden="true">
        <StateDot state={rowDot(row)} />
      </span>
      <span className={styles.time} data-feed-time>{formatTeamClock(row.at)}</span>
      <span className={styles.marker} data-feed-marker>
        {row.kind === 'approval'
          ? t(row.approval.kind === 'plan' ? 'view.events.approval.plan' : 'view.events.approval')
          : t('view.events.message')}
      </span>
      <span className={styles.actor} data-feed-actor>
        {row.kind === 'approval' ? row.memberName : `${row.fromName} → ${row.toName}`}
      </span>
      <span className={styles.summary} data-feed-summary title={summaryText}>{summaryText}</span>
      {row.kind === 'approval'
        ? decision === undefined
          ? <span className={styles.state} data-feed-state data-pending="true">{t('view.events.waiting')}</span>
          : (
            <span className={styles.state} data-feed-state>
              {t(DECISION_KEYS[decision.value])}
              {decision.reason !== undefined
                ? <span className={styles.stateReason} data-feed-state-reason title={decision.reason}>{decision.reason}</span>
                : null}
            </span>
          )
        : null}
    </button>
  )
}

/**
 * The event-stream section (D8g, D8h) with the top "load earlier" control:
 * the depth append over the loaded stream, the wire page once it is loaded,
 * and the loud error note with the counted remainder when a page fails.
 * @param props - the team view, the pagination callback, the session-switch
 *   callback, and the dictionary.
 * @returns the event-stream section.
 */
export function TeamFeed({ view, pageMessages, onSelectSession, t }: TeamFeedProps): React.JSX.Element {
  const [loadedCount, setLoadedCount] = useState(TEAM_FEED_INITIAL_LIMIT)
  const [olderMessages, setOlderMessages] = useState<readonly TeamMessageView[]>([])
  const [pageMessageCount, setPageMessageCount] = useState<number | undefined>(undefined)
  const [pageError, setPageError] = useState<ClientFailure | null>(null)
  const [loading, setLoading] = useState(false)
  // A new snapshot frame re-derives the window at the same depth and
  // resets the fetched pages: the page's seam is the snapshot window's
  // oldest message, and a moved window would open a gap.
  useEffect(() => {
    setOlderMessages([])
    setPageMessageCount(undefined)
    setPageError(null)
  }, [view])
  const model = deriveTeamFeed(view, loadedCount, olderMessages, pageMessageCount)
  const canLoadEarlier = model.hasMore || model.unloadedMessageCount > 0
  const loadEarlier = async (): Promise<void> => {
    if (model.hasMore) {
      setLoadedCount(count => Math.min(count + TEAM_FEED_STEP, model.total))
      return
    }
    // The button only renders while there is more to load; a view that
    // reports messages it does not hold (a fold inconsistency) has no
    // anchor to page from, so the click is a no-op instead of a crash.
    if (model.oldestMessage === undefined) return
    const anchor: MessageAnchor = {
      at: model.oldestMessage.at,
      sessionId: model.oldestMessage.sessionId,
      seq: model.oldestMessage.seq,
    }
    setLoading(true)
    const result = await pageMessages(view.leaderSessionId, anchor, TEAM_FEED_STEP)
    if (result.ok) {
      // The page runs strictly earlier than the anchor and ascending: it
      // splices after the already-fetched pages, before the snapshot.
      const length = result.value.messages.length
      setOlderMessages(prev => [...prev, ...result.value.messages])
      setPageMessageCount(result.value.messageCount)
      setPageError(null)
      // Grow the window by the fetched page so the rows appear immediately.
      setLoadedCount(count => Math.min(count + length, model.total + length))
    } else {
      setPageError(result.error)
    }
    setLoading(false)
  }
  return (
    <div className={styles.root} data-team-feed>
      {model.total === 0
        ? <span className={styles.empty} data-feed-empty>{t('view.events.empty')}</span>
        : (
          <>
            <div className={styles.top} data-feed-top>
              {pageError !== null
                ? <span className={styles.loadFailed} data-feed-load-failed>{t('view.events.loadFailed', { message: pageError.message })}</span>
                : null}
              {canLoadEarlier
                ? (
                  <button
                    type="button"
                    className={styles.loadEarlier}
                    data-feed-load-earlier
                    disabled={loading}
                    onClick={() => { void loadEarlier() }}
                  >
                    {t('view.events.loadEarlier')}
                  </button>
                )
                : null}
              {pageError !== null && model.unloadedMessageCount > 0
                ? <span className={styles.truncated} data-feed-truncated>{t('view.events.truncated', { count: model.unloadedMessageCount })}</span>
                : null}
            </div>
            <div className={styles.rows}>
              {model.rows.map(row => (
                <FeedRow
                  key={row.key}
                  row={row}
                  onSelect={row.sessionId === '' ? undefined : () => { onSelectSession(row.sessionId) }}
                  t={t}
                />
              ))}
            </div>
          </>
        )}
    </div>
  )
}
