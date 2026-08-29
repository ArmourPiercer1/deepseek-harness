/**
 * The resident team dock bar above the input (D11–D13): the thin collapsed
 * readout `团队 · N 运行中 · M 待裁决` (zero-count segments omitted, D12/D23)
 * plus the expandable compact member status rows (name + state dot) and task
 * rows, all read straight from the projection mirror (D20). The entry
 * renders only for a team session — the frozen resolveTeamView test, the
 * tab's same criterion — and cold-fills a mirror gap through `ensureTeam`
 * like the tab. The jump entry activates the "团队" view tab (D13) and the
 * chevron toggles the expansion.
 */
import { useEffect, useId, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the conversation.input.dock slot declaration (declared by
// ui-conversation's root entry) must be in the program for this props type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  TeamMirror, TeamView,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  IconChevronDownOutline14, IconChevronUpOutline14, StateDot, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  deriveTeamDockContent, deriveTeamDockCounts,
  type TeamDockMemberRow, type TeamDockTaskRow,
} from './team-dock-model.ts'
import { resolveTeamView } from './team-view-model.ts'
import type { TeamKey } from './locales.ts'
import styles from './TeamDock.module.css'

/** Injected share of the team dock entry. */
export interface TeamDockInjected {
  /** Bare mirror source; the renderer binds it to the `useTeamMirror` selector hook. */
  hooks: { teamMirror: ObservableSnapshot<TeamMirror> }
  /** Cold-read the named session's team view when the mirror lacks it (single-flight). */
  ensureTeam: (sessionId: SessionId) => Promise<void>
  /** Activate the current session's "团队" view tab (D13). */
  openTeamTab: () => void
}

/** Full team-dock props: the input-dock runtime share, injected face, and locale seat. */
export type TeamDockProps =
  & PropsRuntime<'conversation.input.dock'>
  & InjectFace<TeamDockInjected>
  & PropsLocale<'team'>

/** Presentational dock props: the team view, the tab-jump callback, and the team dictionary. */
export interface TeamDockPanelProps {
  /** The leader-keyed team view snapshot (the mirror's own reference). */
  view: TeamView
  /** Activate the current session's "团队" view tab (D13). */
  openTeamTab: () => void
  /** The team dictionary translate seat. */
  t: PropsLocale<'team'>['t']
}

const MEMBER_STATUS_KEYS = {
  bound: 'view.members.bound',
  running: 'view.members.running',
  settled: 'view.members.settled',
} as const satisfies Record<TeamDockMemberRow['status'], TeamKey>

const TASK_STATUS_KEYS = {
  pending: 'view.task.pending',
  in_progress: 'view.task.in_progress',
  completed: 'view.task.completed',
  blocked: 'view.task.blocked',
} as const satisfies Record<TeamDockTaskRow['status'], TeamKey>

/**
 * Map a member status onto the StateDot states.
 * @param status - the member row's projection status.
 * @returns the dot state (bound: amber, running: blue, settled: green).
 */
function memberDot(status: TeamDockMemberRow['status']): StateDotState {
  switch (status) {
    case 'bound': return 'warning'
    case 'running': return 'ongoing'
    case 'settled': return 'done'
  }
}

/**
 * Map a task status onto the StateDot states.
 * @param status - the task row's projection status.
 * @returns the dot state (pending: amber, in progress: blue, completed: green, blocked: red).
 */
function taskDot(status: TeamDockTaskRow['status']): StateDotState {
  switch (status) {
    case 'pending': return 'warning'
    case 'in_progress': return 'ongoing'
    case 'completed': return 'done'
    case 'blocked': return 'error'
  }
}

/**
 * The presentational dock bar (D11/D12): the collapsed one-line readout
 * (zero-count segments omitted) and the expandable compact member status and
 * task rows. The jump entry activates the team tab (D13); the chevron toggles
 * the expansion.
 * @param props - the team view, the tab-jump callback, and the team dictionary.
 * @returns the dock bar.
 */
export function TeamDockPanel({ view, openTeamTab, t }: TeamDockPanelProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(true)
  const bodyId = useId()
  const counts = deriveTeamDockCounts(view)
  const content = deriveTeamDockContent(view)
  // En spaces (U+2002): HTML collapses runs of ASCII spaces, so widening the
  // separator breathing room needs a literal wide space (the todo strip's
  // same pattern). D12 format `团队 · N 运行中 · M 待裁决`: zero-count
  // segments are omitted with the separator that would dangle; the leading
  // separator after the title renders only while some segment remains.
  const readout = [
    ...counts.runningSessions > 0 ? [t('dock.running', { count: counts.runningSessions })] : [],
    ...counts.pendingControls > 0 ? [t('dock.pending', { count: counts.pendingControls })] : [],
  ].join('\u2002·\u2002')
  return (
    <section className={styles.root} data-team-dock aria-label={t('dock.title')}>
      <div className={styles.row}>
        {/* No aria-label: the accessible name derives from the content, so
            the D12 resident readout stays exposed to assistive tech (the
            todo-strip header's same posture); the title carries the jump
            intent for mouse users. */}
        <button
          type="button"
          className={styles.jump}
          data-team-dock-jump
          title={t('dock.jump')}
          onClick={() => { openTeamTab() }}
        >
          <span className={styles.title} data-dock-title>{t('dock.title')}</span>
          {readout !== '' && (
            <>
              <span className={styles.sep} data-dock-sep aria-hidden="true">{'\u2002·\u2002'}</span>
              <span className={styles.readout} data-dock-readout>{readout}</span>
            </>
          )}
        </button>
        <button
          type="button"
          className={styles.chevron}
          data-team-dock-toggle
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : bodyId}
          aria-label={collapsed ? t('dock.expand') : t('dock.collapse')}
          onClick={() => { setCollapsed(value => !value) }}
        >
          {collapsed ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
        </button>
      </div>
      {!collapsed && (
        <div id={bodyId} className={styles.expanded} data-team-dock-expanded>
          <ul className={styles.members}>
            {content.members.length === 0
              ? <li className={styles.empty} data-dock-members-empty>{t('dock.members.empty')}</li>
              : content.members.map(member => (
                <li
                  key={member.key}
                  className={styles.member}
                  data-dock-member
                  data-member-status={member.status}
                  aria-label={`${member.name} ${t(MEMBER_STATUS_KEYS[member.status])}`}
                >
                  <span className={styles.dotSlot} aria-hidden="true">
                    <StateDot state={memberDot(member.status)} />
                  </span>
                  <span className={styles.name}>{member.name}</span>
                </li>
              ))}
          </ul>
          <ul className={styles.tasks}>
            {content.tasks.length === 0
              ? <li className={styles.empty} data-dock-tasks-empty>{t('dock.tasks.empty')}</li>
              : content.tasks.map(task => (
                <li key={task.taskId} className={styles.task} data-dock-task data-task-status={task.status}>
                  <span className={styles.dotSlot} aria-hidden="true">
                    <StateDot state={taskDot(task.status)} />
                  </span>
                  <span className={styles.subject}>{task.subject}</span>
                  <span className={styles.taskStatus}>{t(TASK_STATUS_KEYS[task.status])}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * The dock entry adapter: resolves the current session's team view through
 * the frozen team-ness test (the tab's same criterion — the mirror's
 * presence), cold-fills a mirror gap through `ensureTeam`, renders nothing
 * for a non-team session, and hands the view to the presentational panel.
 * @param props - the framework session kit, the injected mirror hook and
 *   cold-pull/jump callbacks, and the team dictionary.
 * @returns the dock bar, or nothing for a non-team session.
 */
export function TeamDock({
  sessionId, useTeamMirror, ensureTeam, openTeamTab, t,
}: TeamDockProps): React.JSX.Element | null {
  const team = useTeamMirror(mirror => resolveTeamView(mirror, sessionId))
  useEffect(() => {
    // The dock mounts with every session, so a mirror gap means the team
    // view is still unknown for this session: fill it once, then let frames win.
    if (team === undefined) void ensureTeam(sessionId)
  }, [sessionId, team, ensureTeam])
  if (team === undefined) return null
  return <TeamDockPanel view={team} openTeamTab={openTeamTab} t={t} />
}
