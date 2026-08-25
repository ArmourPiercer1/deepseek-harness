/**
 * The "团队" tab's task-board section (the third of the four sections): a
 * list of the leader view's tasks, each a state dot plus subject, status
 * label, assignee, and optional summary. The rows are read straight from
 * the projection's `tasks` — the same source and fold as the chat node's
 * `foldTeamBoard` (latest `team/progress` per taskId) — and never
 * re-folded here. Rows are non-interactive: D9 names no click-to-switch
 * for task rows, so there is no session target to open.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamView } from '@deepseek-ai/dsh-client-runtime/client'
import type { TeamKey } from './locales.ts'
import styles from './TeamTasks.module.css'

/** The task-board section props: the team view and the team dictionary. */
export interface TeamTasksProps {
  /** The leader-keyed team view snapshot (the mirror's own reference). */
  view: TeamView
  /** The team dictionary translate seat. */
  t: PropsLocale<'team'>['t']
}

type TaskStatus = TeamView['tasks'][number]['status']

const TASK_STATUS_KEYS = {
  pending: 'view.task.pending',
  in_progress: 'view.task.in_progress',
  completed: 'view.task.completed',
  blocked: 'view.task.blocked',
} as const satisfies Record<TaskStatus, TeamKey>

/**
 * Map a task status onto the four StateDot states.
 * @param status - the task status.
 * @returns the dot state (pending: amber, in_progress: blue, completed: green, blocked: red).
 */
function taskDot(status: TaskStatus): StateDotState {
  switch (status) {
    case 'pending': return 'warning'
    case 'in_progress': return 'ongoing'
    case 'completed': return 'done'
    case 'blocked': return 'error'
  }
}

/**
 * Resolve one task's assignee member id to a roster name through the view's
 * member rows (D19: the memberId is the authority), falling back to the raw
 * id when no member row matches.
 * @param view - the leader-keyed team view snapshot.
 * @param memberId - the task's assignee member id.
 * @returns the roster name, or the raw id when unresolved.
 */
function assigneeName(view: TeamView, memberId: string): string {
  const member = view.members.find(row => row.memberId === memberId)
  return member?.name ?? memberId
}

/**
 * The task-board section (D8i): the projection's task list, one row per
 * task in first-seen order.
 * @param props - the team view and the team dictionary.
 * @returns the task-board section.
 */
export function TeamTasks({ view, t }: TeamTasksProps): React.JSX.Element {
  return (
    <div className={styles.root} data-team-tasks>
      {view.tasks.length === 0
        ? <span className={styles.empty} data-tasks-empty>{t('view.tasks.empty')}</span>
        : view.tasks.map(task => (
          <div key={task.taskId} className={styles.taskRow} data-task-row data-task-status={task.status}>
            <span className={styles.dotSlot} aria-hidden="true">
              <StateDot state={taskDot(task.status)} />
            </span>
            <div className={styles.taskMain}>
              <div className={styles.taskLine}>
                <span className={styles.taskSubject} data-task-subject>{task.subject}</span>
                <span className={styles.taskStatus} data-task-status-text>{t(TASK_STATUS_KEYS[task.status])}</span>
              </div>
              <div className={styles.taskAssignee} data-task-assignee>
                {t('view.tasks.assignee', { member: assigneeName(view, task.memberId) })}
              </div>
              {task.summary !== undefined
                ? <div className={styles.taskSummary} data-task-summary>{task.summary}</div>
                : null}
            </div>
          </div>
        ))}
    </div>
  )
}
