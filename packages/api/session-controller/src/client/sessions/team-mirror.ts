/**
 * Read-only team projection mirror: the object layer's last-wins record of
 * whole-snapshot team views keyed by each view's own leader session (see the
 * `team` control frame). An absent key means "no team known for that
 * leader" — absence, never a sentinel value. Contains the mirror type and
 * the frozen team-ness derivation every team surface shares.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TeamView } from '@deepseek-ai/dsh-team-projection/types'

/** The leader-keyed team mirror record (stable reference between changes). */
export type TeamMirror = Readonly<Record<SessionId, TeamView>>

/**
 * Resolve the team view one session belongs to — the frozen team-ness test:
 * a session is a team session exactly when it leads a mirrored view or when
 * any mirrored view binds it as a member (`members.sessionIds`). Every other
 * session resolves undefined and its team surfaces render the no-team zero
 * state. Returns a stored view reference (never a projection), so a selector
 * over this function stays identity-stable between mirror changes.
 * @param mirror - the leader-keyed mirror snapshot.
 * @param sessionId - the session to resolve.
 * @returns the session's team view, or undefined for a non-team session.
 */
export function resolveTeamView(mirror: TeamMirror, sessionId: SessionId): TeamView | undefined {
  const own = mirror[sessionId]
  if (own !== undefined) return own
  for (const leader of Object.keys(mirror)) {
    const view = mirror[leader as SessionId]
    if (view !== undefined && view.members.some(member => member.sessionIds.includes(sessionId))) return view
  }
  return undefined
}
