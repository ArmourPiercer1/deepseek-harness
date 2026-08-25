/**
 * D16 jump target of one inline team marker row: the related session plus
 * whether it is the row's own session. The resolution reads the event's own
 * data and the authoritative mirror (the host projection's member rows and
 * approval pairs are the id-to-session join, D19) — it never parses catalog
 * labels or delegate arguments.
 *
 * Target rules per row kind: progress and request rows target the assigned
 * or requesting member's first bound session (a progress row recorded by the
 * leader on a member's task jumps to that member; a request row records in
 * the requesting member's own session, so its target normally is the row's
 * own session); a decision row targets the requesting member's session via
 * the mirror's approval pair; a message row targets the recording session —
 * the row's own session, where its flow row is the D16 position.
 *
 * When the mirror cannot resolve the target (no team wiring, an unbound
 * member, an unpaired decision), the row degrades: progress and request
 * rows fall back to the row's own session (the in-flow anchor), a decision
 * row renders inert (no target at all), and a message row keeps its own
 * session by construction.
 *
 * React-free; the renderer supplies the row data, the mirror view for the
 * row's session, and the current session id.
 */
import type { TeamView } from '@deepseek-ai/dsh-client-runtime/client'
import type { TeamMarkerChatData } from './team-marker-definition.ts'

/** The resolved D16 jump of one marker row. */
export interface TeamMarkerJump {
  /** The related session id; '' when unresolvable (the row renders inert). */
  readonly sessionId: string
  /** True when the target is the row's own session (in-flow anchor, no switch). */
  readonly ownSession: boolean
}

/**
 * The member's first bound session id from the mirror; '' when the member
 * row is absent or unbound.
 * @param view - the mirror view for the row's session, or undefined.
 * @param memberId - the member id to resolve.
 * @returns the session id, or '' when unresolvable.
 */
function memberSessionId(view: TeamView | undefined, memberId: string): string {
  const member = view?.members.find(entry => entry.memberId === memberId)
  return member?.sessionIds[0] ?? ''
}

/**
 * Resolve the D16 jump of one marker row.
 * @param data - the row's event data.
 * @param view - the mirror view for the row's session (undefined while the mirror lacks it).
 * @param currentSessionId - the session the row renders in (its recording session).
 * @returns the target session plus the in-flow/switch split.
 */
export function resolveTeamMarkerJump(
  data: TeamMarkerChatData,
  view: TeamView | undefined,
  currentSessionId: string,
): TeamMarkerJump {
  switch (data.type) {
    case 'progress':
    case 'request': {
      const target = memberSessionId(view, data.memberId)
      if (target !== '') return { sessionId: target, ownSession: target === currentSessionId }
      return { sessionId: currentSessionId, ownSession: true }
    }
    case 'decision': {
      const requestId = data.requestId
      const member = view?.approvals.find(entry => entry.requestId === requestId)?.memberId
      const target = member !== undefined ? memberSessionId(view, member) : ''
      if (target !== '') return { sessionId: target, ownSession: target === currentSessionId }
      return { sessionId: '', ownSession: false }
    }
    case 'message':
      return { sessionId: currentSessionId, ownSession: true }
  }
}
