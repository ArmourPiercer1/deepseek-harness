/**
 * Pure projection of the leader-keyed team view into the input dock bar:
 * the D23 team-wide counts (running member sessions, unpaired control
 * requests) for the collapsed readout, plus the compact expanded content
 * (member status rows and task rows). React-free; the renderer supplies the
 * snapshot. Every field is read straight from the projection — the log
 * baseline with the live running overlay already applied — and never
 * re-derived here (D20).
 */
import type { TeamView } from '@deepseek-ai/dsh-api-session-controller/client'

/** The D23 dock readout counts over the whole team. */
export interface TeamDockCounts {
  /** N: the running member rows' bound sessions (the leader row included). */
  readonly runningSessions: number
  /** M: every member row's pendingControlCount summed (the leader row included). */
  readonly pendingControls: number
}

/** One expanded member status row (unbound rows carry no status and are skipped). */
export interface TeamDockMemberRow {
  /** Stable React key across mirror frames (rows can share a memberId). */
  readonly key: string
  /** The projection row's member id (the D19 authority). */
  readonly memberId: string
  /** The roster name (the row's own field, never re-resolved). */
  readonly name: string
  /** The projection status of the row (log baseline with the live overlay applied). */
  readonly status: 'bound' | 'running' | 'settled'
}

/** One expanded task row (the projection's task list, compact). */
export interface TeamDockTaskRow {
  /** Stable task identity from the projection. */
  readonly taskId: string
  /** The task subject from the projection. */
  readonly subject: string
  /** The task status from the projection. */
  readonly status: 'pending' | 'in_progress' | 'completed' | 'blocked'
}

/** The dock's expanded content: the member status rows plus the task rows. */
export interface TeamDockContent {
  /** The bound member rows in `members` order (the leader row included). */
  readonly members: readonly TeamDockMemberRow[]
  /** The task rows in first-seen order. */
  readonly tasks: readonly TeamDockTaskRow[]
}

/**
 * Count the D23 readout over the whole team: N is the running member rows'
 * bound sessions (a running row contributes its `sessionIds` length — one
 * under this phase's single-instance limit), M is the pending control-request
 * sum over every row, leader and unbound alike.
 * @param view - the leader-keyed team view snapshot.
 * @returns the team-wide counts.
 */
export function deriveTeamDockCounts(view: TeamView): TeamDockCounts {
  let runningSessions = 0
  let pendingControls = 0
  for (const row of view.members) {
    if (row.status === 'running') runningSessions += row.sessionIds.length
    pendingControls += row.pendingControlCount
  }
  return { runningSessions, pendingControls }
}

/**
 * Project the expanded content: every bound member row (unbound rows carry
 * no status and are skipped, the leader row included) plus every task row,
 * each field read straight from the projection.
 * @param view - the leader-keyed team view snapshot.
 * @returns the compact member status rows and task rows.
 */
export function deriveTeamDockContent(view: TeamView): TeamDockContent {
  const members: TeamDockMemberRow[] = []
  for (const row of view.members) {
    if (row.status === 'unbound') continue
    members.push({
      key: `${row.memberId}:${row.sessionIds[0] ?? ''}:${members.length}`,
      memberId: row.memberId,
      name: row.name,
      status: row.status,
    })
  }
  const tasks: TeamDockTaskRow[] = view.tasks.map(task => ({
    taskId: task.taskId,
    subject: task.subject,
    status: task.status,
  }))
  return { members, tasks }
}
