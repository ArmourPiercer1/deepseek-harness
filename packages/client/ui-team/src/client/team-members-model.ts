/**
 * Pure projection of the leader-keyed team view into the "团队" tab's
 * member-group section: the fixed leading leader row (anchored to the
 * view's `leaderSessionId`, never to a roster row — the "回到 leader" entry)
 * plus one group per non-leader member definition in `members` order. A
 * group's container row tallies its running instances for the
 * `Name · N 活跃` label; its expansion lists the group's instance rows —
 * the projection member rows that bind a session, each carrying the row's
 * status, latest tool call, and pending control-request count. Unbound rows
 * establish the group but contribute no instance. Rows sharing a memberId
 * fold into one group (the multi-instance interface; this phase's
 * projection emits at most one row per definition). React-free; the
 * renderer supplies the snapshot and the locale. Status is read straight
 * from the projection — the log baseline with the live running overlay
 * already applied — and never re-derived here.
 */
import type { TeamView } from '@deepseek-ai/dsh-client-runtime/client'

/** One projection member row (the wire's `TeamView['members']` entry). */
type MemberRow = TeamView['members'][number]

/** One instance row inside a member group (a projection row that binds a session). */
export interface TeamMemberInstanceRow {
  /** Stable React key across mirror frames. */
  readonly key: string
  /** The row's first bound session: the row's click-to-switch target. */
  readonly sessionId: string
  /** The projection status (log baseline with the live running overlay applied). */
  readonly status: 'bound' | 'running' | 'settled'
  /** The latest tool call in the member's own log suffix; absent before any call. */
  readonly currentAction?: string
  /** The member's still-unpaired control requests (drives the waiting badge). */
  readonly pendingControlCount: number
}

/** One member group: the container row plus its instance rows. */
export interface TeamMemberGroupRow {
  readonly memberId: string
  /** Roster name; absent only on the synthesized leading row (the renderer falls back to the locale leader label). */
  readonly name?: string
  readonly role: 'leader' | 'teammate'
  /** Running instance count: the container row's `N` in `Name · N 活跃`. */
  readonly activeCount: number
  /** The group's instance rows in projection order. */
  readonly instances: readonly TeamMemberInstanceRow[]
}

/** The rendered members section: the fixed leading leader row plus the non-leader groups. */
export interface TeamMembersModel {
  /** The leading leader row (the "回到 leader" entry). */
  readonly leader: TeamMemberGroupRow
  /** The non-leader groups in `members` order. */
  readonly groups: readonly TeamMemberGroupRow[]
}

/** Mutable group while the fold runs; the returned groups freeze their instance lists. */
interface GroupBuild {
  memberId: string
  name?: string
  role: 'leader' | 'teammate'
  activeCount: number
  instances: TeamMemberInstanceRow[]
}

/**
 * Fold one projection member row into a group's running tally and instance
 * list. Unbound rows (no bound session) contribute nothing.
 * @param group - the group being built (mutated in place while the fold runs).
 * @param row - the projection member row.
 */
function appendRow(group: GroupBuild, row: MemberRow): void {
  if (row.status === 'unbound') return
  group.instances.push({
    key: `${row.memberId}:${row.sessionIds[0] ?? ''}:${group.instances.length}`,
    sessionId: row.sessionIds[0] ?? '',
    status: row.status,
    ...(row.currentAction !== undefined ? { currentAction: row.currentAction } : {}),
    pendingControlCount: row.pendingControlCount,
  })
  if (row.status === 'running') group.activeCount += 1
}

/**
 * Project the view's member rows onto the members-section model.
 * @param view - the leader-keyed team view snapshot.
 * @returns the leading leader row — synthesized from the view's leader
 *   session when the rows carry no leader — plus the non-leader groups in
 *   `members` order, rows sharing a memberId folded into one group.
 */
export function deriveTeamMembers(view: TeamView): TeamMembersModel {
  const groups: TeamMemberGroupRow[] = []
  const groupById = new Map<string, GroupBuild>()
  let leader: GroupBuild | undefined
  for (const row of view.members) {
    if (row.role === 'leader') {
      if (leader === undefined) {
        leader = { memberId: row.memberId, name: row.name, role: 'leader', activeCount: 0, instances: [] }
      }
      appendRow(leader, row)
      continue
    }
    let group = groupById.get(row.memberId)
    if (group === undefined) {
      group = { memberId: row.memberId, name: row.name, role: 'teammate', activeCount: 0, instances: [] }
      groupById.set(row.memberId, group)
      groups.push(group)
    }
    appendRow(group, row)
  }
  return {
    leader: leader ?? {
      memberId: view.leaderSessionId,
      role: 'leader',
      activeCount: 0,
      instances: [],
    },
    groups,
  }
}
