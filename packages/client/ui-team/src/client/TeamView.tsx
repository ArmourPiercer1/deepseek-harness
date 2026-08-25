/**
 * Team conversation view entry: the "团队" tab. Resolves the current
 * session's team view through the frozen team-ness derivation (leader key or
 * member binding in the leader-keyed mirror), cold-pulls when the mirror
 * lacks the session, and renders the one-line zero state for every
 * non-team session. The four-section body is deferred (timeline, member
 * groups, task board, event stream); a team session sees a placeholder
 * until it lands.
 */
import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the conversation.view slot declaration (declared by
// ui-conversation's session body) must be in the program for this props type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ObservableSnapshot, SessionId, TeamMirror,
} from '@deepseek-ai/dsh-client-runtime/client'
import { resolveTeamView } from '@deepseek-ai/dsh-client-runtime/client'
import styles from './TeamView.module.css'

/**
 * Injected share of the team view entry. `useTeamMirror` (bound from the
 * hooks compartment) selects over the leader-keyed mirror record — read-only
 * by construction; the cold pull rides the `ensureTeam` callback.
 */
export interface TeamViewInjected {
  /** Bare mirror source; the renderer binds it to the `useTeamMirror` selector hook. */
  hooks: { teamMirror: ObservableSnapshot<TeamMirror> }
  /** Cold-read the named session's team view when the mirror lacks it (single-flight). */
  ensureTeam: (sessionId: SessionId) => Promise<void>
}

/** Full team-view props: the view-slot runtime share, injected face, and locale seat. */
export type TeamViewProps =
  & PropsRuntime<'conversation.view'>
  & InjectFace<TeamViewInjected>
  & PropsLocale<'team'>

/**
 * The team tab body: zero state for a non-team session, placeholder body for
 * a team session.
 * @param props - the framework session kit, the injected mirror hook and
 *   cold-pull callback, and the team dictionary.
 * @returns the view body.
 */
export function TeamView(props: TeamViewProps): React.JSX.Element {
  const { sessionId, useTeamMirror, ensureTeam, t } = props
  const team = useTeamMirror(mirror => resolveTeamView(mirror, sessionId))
  useEffect(() => {
    // The tab mounts per session and one-at-a-time, so "mounted" IS "the
    // team UI needs the view": fill a mirror gap once, then let frames win.
    if (team === undefined) void ensureTeam(sessionId)
  }, [sessionId, team, ensureTeam])
  if (team === undefined) {
    return <div className={styles.zero} data-team-zero>{t('view.zero')}</div>
  }
  return <div className={styles.body} data-team-view>{t('view.placeholder')}</div>
}
