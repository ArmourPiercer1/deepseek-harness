/**
 * In-package team-ness derivation: the same frozen fold the object layer
 * exports as `resolveTeamView` from the session-controller client. A feature
 * bundle cannot share that dynamic row's module identity, so this package
 * carries the identical derivation and keeps it in lockstep with the object
 * layer's copy.
 */
import type { TeamMirror, TeamView } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
