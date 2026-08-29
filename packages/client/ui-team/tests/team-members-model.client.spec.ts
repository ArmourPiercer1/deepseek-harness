/**
 * Team member-group projection: the fixed leading leader row (including the
 * roster-absent fallback anchored to the view's leader session), the
 * group/instance fold with the running tally, the unbound no-instance
 * groups, the same-memberId multi-row merge (the multi-instance interface),
 * and the instance field pass-through (status never re-derived).
 */
import { describe, expect, it } from 'vitest'
import type { TeamView } from '@deepseek-ai/dsh-api-session-controller/client'
import { deriveTeamMembers } from '../src/client/team-members-model.ts'

type MemberRow = TeamView['members'][number]

const LEADER = 'leader-s'
const A = 'a'
const B = 'b'

function row(overrides: Partial<MemberRow> & Pick<MemberRow, 'memberId' | 'name' | 'role'>): MemberRow {
  return { sessionIds: [], status: 'unbound', pendingControlCount: 0, ...overrides }
}

function view(members: readonly MemberRow[]): TeamView {
  return {
    teamId: LEADER,
    leaderSessionId: LEADER,
    rosterMemberCount: members.length,
    members,
    delegations: [],
    tasks: [],
    approvals: [],
    messages: [],
    messageCount: 0,
  }
}

function leaderRow(status: MemberRow['status'] = 'bound'): MemberRow {
  return row({
    memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER], status,
  })
}

function mate(id: string, status: MemberRow['status'], sessionId?: string): MemberRow {
  return row({
    memberId: id, name: id, role: 'teammate',
    ...(sessionId === undefined ? {} : { sessionIds: [sessionId] }),
    status,
  })
}

describe('deriveTeamMembers', () => {
  it('builds the leading leader row from the leader member row and keeps it out of the groups', () => {
    const model = deriveTeamMembers(view([
      leaderRow('running'),
      mate(A, 'bound', 'sa'),
    ]))
    expect(model.leader).toEqual({
      memberId: 'lead',
      name: 'Lead',
      role: 'leader',
      activeCount: 1,
      instances: [{ key: 'lead:leader-s:0', sessionId: LEADER, status: 'running', pendingControlCount: 0 }],
    })
    expect(model.groups.map(group => group.memberId)).toEqual([A])
  })

  it('keeps a bound leader instance out of the running tally', () => {
    const model = deriveTeamMembers(view([leaderRow('bound'), mate(A, 'running', 'sa')]))
    expect(model.leader.activeCount).toBe(0)
    expect(model.leader.instances).toHaveLength(1)
    expect(model.leader.instances[0]?.status).toBe('bound')
    expect(model.groups[0]?.activeCount).toBe(1)
  })

  it('synthesizes the leading row from the view anchor when the rows carry no leader', () => {
    const model = deriveTeamMembers(view([mate(A, 'running', 'sa')]))
    expect(model.leader).toEqual({
      memberId: LEADER,
      role: 'leader',
      activeCount: 0,
      instances: [],
    })
    expect(model.leader.name).toBeUndefined()
    expect(model.groups.map(group => group.memberId)).toEqual([A])
  })

  it('tallies the container row per running instance, including a multi-instance member', () => {
    const model = deriveTeamMembers(view([
      leaderRow(),
      mate(A, 'running', 'sa1'),
      mate(A, 'running', 'sa2'),
      mate(A, 'settled', 'sa3'),
    ]))
    const group = model.groups[0]
    expect(group?.activeCount).toBe(2)
    expect(group?.instances.map(instance => instance.sessionId)).toEqual(['sa1', 'sa2', 'sa3'])
    expect(group?.instances.map(instance => instance.key)).toEqual([
      'a:sa1:0', 'a:sa2:1', 'a:sa3:2',
    ])
  })

  it('keeps an unbound row as a group without instances', () => {
    const model = deriveTeamMembers(view([leaderRow(), mate(B, 'unbound')]))
    expect(model.groups[0]).toEqual({
      memberId: B,
      name: B,
      role: 'teammate',
      activeCount: 0,
      instances: [],
    })
  })

  it('passes the instance fields through untouched (status, action, pending count, session)', () => {
    const model = deriveTeamMembers(view([
      leaderRow(),
      row({
        memberId: B, name: 'Beta', role: 'teammate', sessionIds: ['sb'],
        status: 'running', currentAction: 'Bash', pendingControlCount: 2,
      }),
    ]))
    expect(model.groups[0]?.instances).toEqual([{
      key: 'b:sb:0',
      sessionId: 'sb',
      status: 'running',
      currentAction: 'Bash',
      pendingControlCount: 2,
    }])
    const plain = deriveTeamMembers(view([leaderRow(), mate(A, 'bound', 'sa')]))
    expect(plain.groups[0]?.instances[0]).toEqual({
      key: 'a:sa:0',
      sessionId: 'sa',
      status: 'bound',
      pendingControlCount: 0,
    })
    expect(plain.groups[0]?.instances[0]?.currentAction).toBeUndefined()
  })

  it('folds a second leader row into the leading group (multi-instance interface)', () => {
    const model = deriveTeamMembers(view([
      row({
        memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
        status: 'running', pendingControlCount: 0,
      }),
      row({
        memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: ['leader-s2'],
        status: 'settled', pendingControlCount: 0,
      }),
    ]))
    expect(model.leader.activeCount).toBe(1)
    expect(model.leader.instances.map(instance => instance.sessionId)).toEqual([LEADER, 'leader-s2'])
    expect(model.groups).toEqual([])
  })

  it('synthesizes an empty leader group for a view with no member rows at all', () => {
    const model = deriveTeamMembers(view([]))
    expect(model.leader).toEqual({
      memberId: LEADER,
      role: 'leader',
      activeCount: 0,
      instances: [],
    })
    expect(model.groups).toEqual([])
  })

  it('keeps the groups in members order with a mid-list leader row', () => {
    const model = deriveTeamMembers(view([
      mate(A, 'bound', 'sa'),
      leaderRow(),
      mate(B, 'unbound'),
    ]))
    expect(model.groups.map(group => group.memberId)).toEqual([A, B])
    expect(model.leader.memberId).toBe('lead')
  })
})
