/**
 * Team panel Chat node: teammate rows read from the subagent catalog (the
 * delegate tool labels every teammate child `team:<name>`) beside the task
 * progress board folded by the team panel Definition.
 */
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the conversation slot declarations and the team-panel ChatNode merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  shallowEqual, type SessionId, type SubagentCatalogSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TeamKey } from './locales.ts'
import { TEAM_LABEL_PREFIX, type TeamTaskItem } from './team-definition.ts'
import styles from './TeamPanel.module.css'

export type TeamPanelProps =
  & PropsRuntime<'conversation.chat.node', 'team-panel'>
  & PropsLocale<'team'>

/** One teammate row projected from the parent-addressed subagent catalog. */
interface TeammateRow {
  /** The durable teammate child session id. */
  readonly sessionId: SessionId
  /** The member name carried by the catalog label after its `team:` prefix. */
  readonly name: string
  /** Store-snapshot activity of the child. */
  readonly activity: 'running' | 'inactive'
}

/** Window-level teammate status shown in the panel. */
export type TeammateUiStatus = 'bound' | 'running' | 'settled'

const MEMBER_STATUS_KEYS = {
  bound: 'panel.member.bound',
  running: 'panel.member.running',
  settled: 'panel.member.settled',
} as const satisfies Record<TeammateUiStatus, TeamKey>

const TASK_STATUS_KEYS = {
  pending: 'panel.task.pending',
  in_progress: 'panel.task.in_progress',
  completed: 'panel.task.completed',
  blocked: 'panel.task.blocked',
} as const satisfies Record<TeamTaskItem['status'], TeamKey>

/**
 * Project the `team:`-labeled continuable children of one parent catalog
 * into teammate rows.
 * @param catalog - the parent-addressed catalog snapshot, or undefined while absent.
 * @returns the teammate rows in catalog order.
 */
function teamRows(catalog: SubagentCatalogSnapshot | undefined): readonly TeammateRow[] {
  if (catalog === undefined) return []
  const rows: TeammateRow[] = []
  for (const entry of catalog.entries) {
    if (entry.kind !== 'child' || entry.mode !== 'continuable') continue
    if (!entry.label.startsWith(TEAM_LABEL_PREFIX)) continue
    rows.push({
      sessionId: entry.id,
      name: entry.label.slice(TEAM_LABEL_PREFIX.length),
      activity: entry.activity,
    })
  }
  return rows
}

/**
 * Derive one teammate row's window-level status.
 * `running` follows the store-snapshot activity; an inactive child reads
 * `settled` when its name appears among the window's delegate_to_teammate
 * targets, otherwise `bound` (bound baseline, no delegation in the loaded
 * window yet). The name-to-id join is best-effort: catalog labels carry the
 * member name while delegate calls carry the member id, and the two are
 * independent frontmatter fields.
 * @param row - the teammate row.
 * @param delegated - the window's de-duplicated delegate_to_teammate targets.
 * @returns the panel status for the row.
 */
function teammateStatus(row: TeammateRow, delegated: readonly string[]): TeammateUiStatus {
  if (row.activity === 'running') return 'running'
  return delegated.includes(row.name) ? 'settled' : 'bound'
}

/**
 * Map a task status onto the four StateDot states.
 * @param status - the task status.
 * @returns the dot state (pending: amber, in_progress: blue, completed: green, blocked: red).
 */
function taskDot(status: TeamTaskItem['status']): StateDotState {
  switch (status) {
    case 'pending': return 'warning'
    case 'in_progress': return 'ongoing'
    case 'completed': return 'done'
    case 'blocked': return 'error'
  }
}

/**
 * Map a teammate panel status onto the four StateDot states.
 * @param status - the teammate panel status.
 * @returns the dot state (bound: amber, running: blue, settled: green).
 */
function memberDot(status: TeammateUiStatus): StateDotState {
  switch (status) {
    case 'bound': return 'warning'
    case 'running': return 'ongoing'
    case 'settled': return 'done'
  }
}

/**
 * Team panel content: teammate status rows plus the task progress board.
 * @param props - the keyed Chat node data, the framework session kit, and the team dictionary.
 * @returns the panel section.
 */
export function TeamPanel(props: TeamPanelProps): React.JSX.Element {
  const { node, sessionId, useSessions, t } = props
  const { tasks, delegated } = node.data
  const rows = teamRows(useSessions(
    sessions => sessions.subagentsByParent[sessionId],
    shallowEqual,
  ))
  return (
    <section className={styles.root} data-team-panel>
      <header className={styles.header} data-team-header>
        <span className={styles.title} data-team-title>{t('panel.title')}</span>
        <span className={styles.headerSummary}>
          <span data-member-count>{t('panel.members.count', { count: rows.length })}</span>
          <span className={styles.separator} aria-hidden />
          <span data-task-count>{t('panel.tasks.count', { count: tasks.length })}</span>
        </span>
      </header>
      <div className={styles.body}>
        <div className={styles.group} data-teammates-group>
          <span className={styles.groupTitle} data-teammates-title>{t('panel.teammates')}</span>
          {rows.length === 0
            ? <span className={styles.empty} data-teammates-empty>{t('panel.teammates.empty')}</span>
            : (
              <div className={styles.rows}>
                {rows.map((row) => {
                  const status = teammateStatus(row, delegated)
                  return (
                    <div key={row.sessionId} className={styles.row} data-member-status={status}>
                      <span className={styles.dotSlot}><StateDot state={memberDot(status)} /></span>
                      <span className={styles.rowLabel} data-member-name>{row.name}</span>
                      <span className={styles.rowStatus} data-member-status-text>{t(MEMBER_STATUS_KEYS[status])}</span>
                    </div>
                  )
                })}
              </div>
            )}
        </div>
        <div className={styles.group} data-tasks-group>
          <span className={styles.groupTitle} data-tasks-title>{t('panel.tasks')}</span>
          {tasks.length === 0
            ? <span className={styles.empty} data-tasks-empty>{t('panel.tasks.empty')}</span>
            : (
              <div className={styles.rows}>
                {tasks.map(task => (
                  <div key={task.taskId} className={styles.taskRow} data-task-status={task.status}>
                    <span className={styles.dotSlot}><StateDot state={taskDot(task.status)} /></span>
                    <div className={styles.taskMain}>
                      <div className={styles.taskLine}>
                        <span className={styles.taskSubject} data-task-subject>{task.subject}</span>
                        <span className={styles.rowStatus} data-task-status-text>{t(TASK_STATUS_KEYS[task.status])}</span>
                      </div>
                      <div className={styles.taskMeta} data-task-assignee>
                        {t('panel.assignee', { member: task.memberId })}
                      </div>
                      {task.summary !== undefined
                        ? <div className={styles.taskSummary} data-task-summary>{task.summary}</div>
                        : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </section>
  )
}
