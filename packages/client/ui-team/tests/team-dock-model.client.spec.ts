/**
 * team-dock-model: the D23 readout counts (N = the running member rows'
 * bound sessions team-wide, leader row included; M = the pending
 * control-request sum over every row) and the compact expanded content
 * (bound member rows in members order, unbound skipped; task rows in
 * first-seen order) — every field read straight from the projection.
 */
import { describe, expect, it } from 'vitest'
import type { TeamView } from '@deepseek-ai/dsh-api-session-controller/client'
import { deriveTeamDockContent, deriveTeamDockCounts } from '../src/client/team-dock-model.ts'

const LEADER = 'leader-s'
const SA = 'sa'
const SB = 'sb'

function view(overrides: Partial<TeamView> = {}): TeamView {
  return {
    teamId: LEADER,
    leaderSessionId: LEADER,
    rosterMemberCount: 3,
    members: [
      {
        memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
        status: 'bound', pendingControlCount: 0,
      },
      {
        memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [SA],
        status: 'running', currentAction: 'Bash', pendingControlCount: 1,
      },
      {
        memberId: 'b', name: 'Beta', role: 'teammate', sessionIds: [],
        status: 'unbound', pendingControlCount: 0,
      },
    ],
    delegations: [],
    tasks: [],
    approvals: [],
    messages: [],
    messageCount: 0,
    ...overrides,
  }
}

describe('deriveTeamDockCounts', () => {
  it('reads N as the running rows\' bound sessions, the leader row included', () => {
    const team = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'running', pendingControlCount: 0,
        },
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [SA],
          status: 'running', pendingControlCount: 0,
        },
        {
          memberId: 'b', name: 'Beta', role: 'teammate', sessionIds: [SB],
          status: 'bound', pendingControlCount: 0,
        },
      ],
    })
    expect(deriveTeamDockCounts(team)).toEqual({ runningSessions: 2, pendingControls: 0 })
  })

  it('counts a multi-session running row once per bound session', () => {
    const team = view({
      members: [
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: ['sa1', 'sa2'],
          status: 'running', pendingControlCount: 0,
        },
      ],
    })
    expect(deriveTeamDockCounts(team).runningSessions).toBe(2)
  })

  it('reads M as the pending sum over every row, leader and unbound alike', () => {
    const team = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'bound', pendingControlCount: 2,
        },
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [SA],
          status: 'bound', pendingControlCount: 1,
        },
        {
          memberId: 'b', name: 'Beta', role: 'teammate', sessionIds: [],
          status: 'unbound', pendingControlCount: 0,
        },
      ],
    })
    expect(deriveTeamDockCounts(team)).toEqual({ runningSessions: 0, pendingControls: 3 })
  })

  it('reads zero from a fully idle team', () => {
    const team = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'bound', pendingControlCount: 0,
        },
      ],
    })
    expect(deriveTeamDockCounts(team)).toEqual({ runningSessions: 0, pendingControls: 0 })
  })
})

describe('deriveTeamDockContent', () => {
  it('lists the bound rows in members order, the leader row included, and skips unbound rows', () => {
    const team = view()
    const content = deriveTeamDockContent(team)
    expect(content.members).toEqual([
      { key: 'lead:leader-s:0', memberId: 'lead', name: 'Lead', status: 'bound' },
      { key: 'a:sa:1', memberId: 'a', name: 'Alpha', status: 'running' },
    ])
    expect(content.tasks).toEqual([])
  })

  it('reads task rows straight through in first-seen order', () => {
    const team = view({
      tasks: [
        { taskId: 't1', subject: 'Wire the mirror', status: 'in_progress', memberId: 'a', seq: 1, at: 1000 },
        { taskId: 't2', subject: 'Ship the dock', status: 'blocked', memberId: 'lead', seq: 2, at: 2000 },
      ],
    })
    expect(deriveTeamDockContent(team).tasks).toEqual([
      { taskId: 't1', subject: 'Wire the mirror', status: 'in_progress' },
      { taskId: 't2', subject: 'Ship the dock', status: 'blocked' },
    ])
  })

  it('keeps a distinct key per row for a multi-instance member', () => {
    const team = view({
      members: [
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: ['sa1'],
          status: 'running', pendingControlCount: 0,
        },
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: ['sa2'],
          status: 'bound', pendingControlCount: 0,
        },
      ],
    })
    const keys = deriveTeamDockContent(team).members.map(row => row.key)
    expect(keys).toEqual(['a:sa1:0', 'a:sa2:1'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps a sessionless non-unbound row (the wire-legal shape) in the member list', () => {
    const team = view({
      members: [
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [],
          status: 'bound', pendingControlCount: 0,
        },
      ],
    })
    expect(deriveTeamDockContent(team).members).toEqual([
      { key: 'a::0', memberId: 'a', name: 'Alpha', status: 'bound' },
    ])
  })
})
