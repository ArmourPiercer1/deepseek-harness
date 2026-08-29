/**
 * Team conversation view entry: the "团队" tab. Resolves the current
 * session's team view through the frozen team-ness derivation (leader key or
 * member binding in the leader-keyed mirror), cold-pulls when the mirror
 * lacks the session, and renders the one-line zero state for every
 * non-team session. The body is the four frozen sections top to bottom, all
 * live: the delegation timeline (P4a), the member groups (P4b), the task
 * board (D8i), and the event stream (D8g/D8h).
 */
import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the conversation.view slot declaration (declared by
// ui-conversation's session body) must be in the program for this props type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ClientResult, MessageAnchor, TeamMessagePage, TeamMirror,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resolveTeamView } from './team-view-model.ts'
import { TeamTimeline } from './TeamTimeline.tsx'
import { TeamMembers } from './TeamMembers.tsx'
import { TeamTasks } from './TeamTasks.tsx'
import { TeamFeed } from './TeamFeed.tsx'
import styles from './TeamView.module.css'

/**
 * Injected share of the team view entry. `useTeamMirror` (bound from the
 * hooks compartment) selects over the leader-keyed mirror record — read-only
 * by construction; the cold pull rides the `ensureTeam` callback, the
 * event-stream wire page rides `pageTeamMessages`, and the D9 session
 * switch rides `openSession`.
 */
export interface TeamViewInjected {
  /** Bare mirror source; the renderer binds it to the `useTeamMirror` selector hook. */
  hooks: { teamMirror: ObservableSnapshot<TeamMirror> }
  /** Cold-read the named session's team view when the mirror lacks it (single-flight). */
  ensureTeam: (sessionId: SessionId) => Promise<void>
  /**
   * Page-read the leader's member messages strictly earlier than the anchor
   * (the sessions team face's pagination entry; the page never enters the
   * mirror).
   */
  pageTeamMessages: (
    leaderSessionId: string,
    anchor: MessageAnchor,
    limit?: number,
  ) => Promise<ClientResult<TeamMessagePage>>
  /** Switch the current session to the named member session (D9 navigation). */
  openSession: (sessionId: string) => void
}

/** Full team-view props: the view-slot runtime share, injected face, and locale seat. */
export type TeamViewProps =
  & PropsRuntime<'conversation.view'>
  & InjectFace<TeamViewInjected>
  & PropsLocale<'team'>

/**
 * The team tab body: zero state for a non-team session; the complete
 * four-section body (timeline, member groups, task board, event stream)
 * for a team session, with the current session's member lane and member
 * group highlighted when the session is a member's.
 * @param props - the framework session kit, the injected mirror hook and
 *   cold-pull/navigation callbacks, and the team dictionary.
 * @returns the view body.
 */
export function TeamView(props: TeamViewProps): React.JSX.Element {
  const { sessionId, useTeamMirror, ensureTeam, pageTeamMessages, openSession, t } = props
  const team = useTeamMirror(mirror => resolveTeamView(mirror, sessionId))
  useEffect(() => {
    // The tab mounts per session and one-at-a-time, so "mounted" IS "the
    // team UI needs the view": fill a mirror gap once, then let frames win.
    if (team === undefined) void ensureTeam(sessionId)
  }, [sessionId, team, ensureTeam])
  if (team === undefined) {
    return <div className={styles.zero} data-team-zero>{t('view.zero')}</div>
  }
  const currentMember = team.members.find(member => member.sessionIds.includes(sessionId))
  return (
    <div className={styles.body} data-team-view>
      <section className={styles.section} data-team-section="timeline">
        <h3 className={styles.sectionTitle}>{t('view.timeline.title')}</h3>
        <TeamTimeline
          view={team}
          currentMemberId={currentMember?.memberId}
          onSelectSession={openSession}
          t={t}
        />
      </section>
      <section className={styles.section} data-team-section="members">
        <h3 className={styles.sectionTitle}>{t('view.members.title')}</h3>
        <TeamMembers
          view={team}
          currentSessionId={sessionId}
          onSelectSession={openSession}
          t={t}
        />
      </section>
      <section className={styles.section} data-team-section="tasks">
        <h3 className={styles.sectionTitle}>{t('view.tasks.title')}</h3>
        <TeamTasks view={team} t={t} />
      </section>
      <section className={styles.section} data-team-section="events">
        <h3 className={styles.sectionTitle}>{t('view.events.title')}</h3>
        <TeamFeed
          view={team}
          pageMessages={pageTeamMessages}
          onSelectSession={openSession}
          t={t}
        />
      </section>
    </div>
  )
}
