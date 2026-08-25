/**
 * The "团队" tab's member-group section (the second of the four sections):
 * the fixed leading leader row (the "回到 leader" entry, anchored to the
 * view's `leaderSessionId` — rendered even when the member rows carry no
 * leader) plus one group per member. A group's container row reads
 * `Name · N 活跃`; its expansion lists the member's instance rows —
 * three-state status (bound/running/settled, read straight from the
 * projection), the latest tool call or the action placeholder, and a
 * waiting badge while a control request is unpaired. Unbound members keep
 * their container row with the no-instances note. Clicking the leading row
 * or an instance row switches the current session to the bound session
 * (D9); the group and instance rows whose session is the current one
 * highlight (D7).
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamView } from '@deepseek-ai/dsh-client-runtime/client'
import {
  deriveTeamMembers,
  type TeamMemberGroupRow, type TeamMemberInstanceRow,
} from './team-members-model.ts'
import type { TeamKey } from './locales.ts'
import styles from './TeamMembers.module.css'

/** The members section props: the team view, the current session, the D9 navigation callback, and the team dictionary. */
export interface TeamMembersProps {
  /** The leader-keyed team view snapshot (the mirror's own reference). */
  view: TeamView
  /** The current session id (the framework session kit); its group and instance rows highlight. */
  currentSessionId: string
  /** Switch the current session to the clicked row's bound session. */
  onSelectSession: (sessionId: string) => void
  /** The team dictionary translate seat. */
  t: PropsLocale<'team'>['t']
}

const INSTANCE_STATUS_KEYS = {
  bound: 'view.members.bound',
  running: 'view.members.running',
  settled: 'view.members.settled',
} as const satisfies Record<TeamMemberInstanceRow['status'], TeamKey>

/**
 * Map an instance status onto the four StateDot states.
 * @param status - the instance row's projection status.
 * @returns the dot state (bound: amber, running: blue, settled: green).
 */
function memberDot(status: TeamMemberInstanceRow['status']): StateDotState {
  switch (status) {
    case 'bound': return 'warning'
    case 'running': return 'ongoing'
    case 'settled': return 'done'
  }
}

/** The instance-row props: the projection row, the highlight, the switch callback, and the dictionary. */
interface InstanceRowProps {
  readonly instance: TeamMemberInstanceRow
  /** True when the instance's session is the current session. */
  readonly current: boolean
  /** Switch to the instance's session; absent when the row binds none. */
  readonly onSelect?: (() => void) | undefined
  readonly t: PropsLocale<'team'>['t']
}

/** One instance row: status dot and label, latest tool call, waiting badge. */
function InstanceRow({ instance, current, onSelect, t }: InstanceRowProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.instanceRow}
      data-member-instance
      data-status={instance.status}
      data-current={current || undefined}
      disabled={onSelect === undefined}
      onClick={onSelect}
    >
      <span className={styles.dotSlot} aria-hidden="true">
        <StateDot state={memberDot(instance.status)} />
      </span>
      <span className={styles.instanceStatus} data-member-status-text>{t(INSTANCE_STATUS_KEYS[instance.status])}</span>
      <span className={styles.instanceAction} data-member-action>
        {instance.currentAction ?? t('view.members.action.empty')}
      </span>
      {instance.pendingControlCount > 0
        ? <span className={styles.waitingBadge} data-member-waiting>{t('view.members.waiting', { count: instance.pendingControlCount })}</span>
        : null}
    </button>
  )
}

/** The group props: the model group, the resolved highlight, the current session, the switch callback, and the dictionary. */
interface MemberGroupProps {
  readonly group: TeamMemberGroupRow
  /** The group-row highlight (the caller resolves the leader against the view anchor). */
  readonly current: boolean
  /** The current session id (the per-instance highlight). */
  readonly currentSessionId: string
  /** Switch the current session to the named bound session. */
  readonly onSelectSession: (sessionId: string) => void
  /** Switch to the leader session (D10); present only on the leading row. */
  readonly onSelectLeader?: () => void
  readonly t: PropsLocale<'team'>['t']
}

/** One member group: the container row plus the instance expansion. */
function MemberGroup({
  group, current, currentSessionId, onSelectSession, onSelectLeader, t,
}: MemberGroupProps): React.JSX.Element {
  const name = group.name ?? t('member.leader')
  const label = `${name} · ${t('view.members.active', { count: group.activeCount })}`
  return (
    <div className={styles.group} data-member-group data-current={current || undefined}>
      {onSelectLeader === undefined
        ? (
          <div className={styles.groupRow} data-member-group-row>
            <span className={styles.groupName} data-member-group-name>{label}</span>
          </div>
        )
        : (
          <button
            type="button"
            className={styles.groupRow}
            data-member-group-row
            data-leader="true"
            onClick={onSelectLeader}
          >
            <span className={styles.groupName} data-member-group-name>{label}</span>
          </button>
        )}
      <div className={styles.instances} data-member-instances>
        {group.instances.length === 0
          ? <span className={styles.noInstances} data-member-no-instances>{t('view.members.noInstances')}</span>
          : group.instances.map(instance => (
            <InstanceRow
              key={instance.key}
              instance={instance}
              current={instance.sessionId !== '' && instance.sessionId === currentSessionId}
              onSelect={instance.sessionId === '' ? undefined : () => { onSelectSession(instance.sessionId) }}
              t={t}
            />
          ))}
      </div>
    </div>
  )
}

/**
 * The team member-group section (D8e, D8f, D9, D10) with the D7 highlight.
 * @param props - the team view, the current session, the session-switch callback, and the dictionary.
 * @returns the members section.
 */
export function TeamMembers({
  view, currentSessionId, onSelectSession, t,
}: TeamMembersProps): React.JSX.Element {
  const model = deriveTeamMembers(view)
  return (
    <div className={styles.root} data-team-members>
      <MemberGroup
        group={model.leader}
        current={view.leaderSessionId === currentSessionId}
        currentSessionId={currentSessionId}
        onSelectSession={onSelectSession}
        onSelectLeader={() => { onSelectSession(view.leaderSessionId) }}
        t={t}
      />
      {model.groups.map(group => (
        <MemberGroup
          key={group.memberId}
          group={group}
          current={group.instances.some(instance => instance.sessionId === currentSessionId)}
          currentSessionId={currentSessionId}
          onSelectSession={onSelectSession}
          t={t}
        />
      ))}
    </div>
  )
}
