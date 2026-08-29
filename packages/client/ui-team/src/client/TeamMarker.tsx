/**
 * Inline team marker row (D14–D16): one compact single-line Chat node per
 * durable team event — time + type marker + summary, long content truncated
 * to the one line with the full text in the row's title. The row is a ledger
 * record of its own event: a request row always shows the waiting state,
 * and its decision row (the same request id) shows the five-value result —
 * the pairing is rendered from each row's own data, never folded across
 * rows.
 *
 * Click (D16): the related session resolves from the row data and the
 * authoritative mirror (D19). When it is the row's own session, the row
 * anchors itself in the flow — its ChatView anchor wrapper scrolls to
 * center. A switch target opens that session; the in-flow anchor degrades
 * to the switch itself (declared): the corresponding row in the other
 * session's flow sits at a log seq of the other log space, unnameable from
 * here. A decision row whose request the mirror cannot pair renders inert.
 */
import { useMemo, type MouseEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the conversation slot declarations and the team-marker ChatNode merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TeamMirror } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import {
  type TeamMarkerChatData,
  type TeamMarkerControlDecisionData,
  type TeamMarkerProgressData,
} from './team-marker-definition.ts'
import { resolveTeamMarkerJump } from './team-marker-jump.ts'
import { formatTeamClock } from './team-timeline-model.ts'
import { resolveTeamView } from './team-view-model.ts'
import type { TeamKey } from './locales.ts'
import styles from './TeamMarker.module.css'

/** Injected share of the team marker Chat node. */
export interface TeamMarkerInjected {
  /** Bare mirror source; the renderer binds it to the `useTeamMirror` selector hook. */
  hooks: { teamMirror: ObservableSnapshot<TeamMirror> }
  /** Switch the current session to the named one (the existing D9 navigation path). */
  openSession: (sessionId: string) => void
}

/** Full team-marker props: the keyed Chat node runtime share, injected face, and locale seat. */
export type TeamMarkerProps =
  & PropsRuntime<'conversation.chat.node', 'team-marker'>
  & InjectFace<TeamMarkerInjected>
  & PropsLocale<'team'>

const PROGRESS_STATUS_KEYS = {
  pending: 'view.task.pending',
  in_progress: 'view.task.in_progress',
  completed: 'view.task.completed',
  blocked: 'view.task.blocked',
} as const satisfies Record<TeamMarkerProgressData['status'], TeamKey>

const DECISION_KEYS = {
  allow_once: 'view.events.decision.allow_once',
  deny: 'view.events.decision.deny',
  escalate_to_user: 'view.events.decision.escalate_to_user',
  approve_plan: 'view.events.decision.approve_plan',
  request_revision: 'view.events.decision.request_revision',
} as const satisfies Record<TeamMarkerControlDecisionData['decision'], TeamKey>

/** One rendered row's parts: the visible segments plus the title's full text. */
interface RowParts {
  /** The type marker label. */
  readonly label: string
  /** The leading actor segment (member, or member · tool); absent for decisions. */
  readonly actor?: string
  /** The truncated summary segment. */
  readonly summary: string
  /** The trailing state chip (the waiting badge, a status, or a decision value). */
  readonly state?: { readonly text: string; readonly pending: boolean }
  /** The row's full untruncated text (the title attribute). */
  readonly title: string
}

/**
 * Project one marker row's data onto its visible segments. Member names
 * resolve through the mirror's roster rows (D19); an unresolved id falls
 * back to the raw id (display only).
 * @param data - the row's event data.
 * @param nameOf - the member-id-to-roster-name resolver (the fallback included).
 * @param t - the team dictionary translate seat.
 * @returns the row's segments.
 */
function rowParts(
  data: TeamMarkerChatData,
  nameOf: (memberId: string) => string,
  t: PropsLocale<'team'>['t'],
): RowParts {
  switch (data.type) {
    case 'progress': {
      const subject = data.summary !== undefined ? `${data.subject} — ${data.summary}` : data.subject
      return {
        label: t('marker.progress'),
        actor: nameOf(data.memberId),
        summary: data.subject,
        state: { text: t(PROGRESS_STATUS_KEYS[data.status]), pending: false },
        title: subject,
      }
    }
    case 'request':
      return {
        label: t(data.requestKind === 'plan' ? 'view.events.approval.plan' : 'view.events.approval'),
        actor: `${nameOf(data.memberId)} · ${data.toolName}`,
        summary: data.reason,
        state: { text: t('view.events.waiting'), pending: true },
        title: `${data.toolName} · ${data.reason}`,
      }
    case 'decision':
      return {
        label: t('marker.decision'),
        summary: data.reason ?? '',
        state: { text: t(DECISION_KEYS[data.decision]), pending: false },
        title: data.reason ?? '',
      }
    case 'message':
      return {
        label: t('view.events.message'),
        actor: `${nameOf(data.from)} → ${nameOf(data.to)}`,
        summary: data.message,
        title: data.message,
      }
  }
}

/**
 * Render one compact single-line marker row for the keyed Chat node.
 * @param props - the keyed node runtime share (the node payload), the
 *   injected mirror hook and session-open callback, and the team dictionary.
 * @returns the row (inert-disabled when its target session is unresolvable).
 */
export function TeamMarker({
  node, sessionId, useTeamMirror, openSession, t,
}: TeamMarkerProps): React.JSX.Element {
  const data = node.data
  const view = useTeamMirror(mirror => resolveTeamView(mirror, sessionId))
  const nameOf = (memberId: string): string =>
    view?.members.find(member => member.memberId === memberId)?.name ?? memberId
  const parts = rowParts(data, nameOf, t)
  const jump = useMemo(
    () => resolveTeamMarkerJump(data, view, String(sessionId)),
    [data, view, sessionId],
  )
  const inert = jump.sessionId === ''
  // The disabled attribute withholds the click for an inert row, so the
  // handler only runs for a resolvable target.
  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (jump.ownSession) {
      // D16 in-flow anchor: the row's own flow position is this row — scroll
      // its ChatView anchor wrapper to center, staying in the session.
      event.currentTarget.closest<HTMLElement>('[data-chat-anchor-key]')?.scrollIntoView({ block: 'center' })
      return
    }
    // D16 cross-session: switch first. The anchor degrades to the switch
    // itself (declared): the corresponding row in the target session's flow
    // sits at a log seq of the other log space, unnameable from here.
    openSession(jump.sessionId)
  }
  return (
    <button
      type="button"
      className={styles.row}
      data-team-marker
      data-marker-type={data.type}
      disabled={inert}
      title={parts.title}
      onClick={onClick}
    >
      <span className={styles.time} data-marker-time>{formatTeamClock(data.at)}</span>
      <span className={styles.marker} data-marker-label>{parts.label}</span>
      {parts.actor !== undefined
        ? <span className={styles.actor} data-marker-actor>{parts.actor}</span>
        : null}
      <span className={styles.summary} data-marker-summary>{parts.summary}</span>
      {parts.state !== undefined
        ? <span className={styles.state} data-pending={parts.state.pending ? 'true' : 'false'} data-marker-state>{parts.state.text}</span>
        : null}
    </button>
  )
}
