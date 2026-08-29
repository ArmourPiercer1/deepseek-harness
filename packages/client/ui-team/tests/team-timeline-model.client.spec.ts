/**
 * Team timeline model: the lane projection (teammate-only lanes in members
 * order, stable color slots, per-lane spans, the not-rostered fallback
 * lane), the linear honest time domain (task-before-delegation left edge,
 * running-span clock extension, zero-width guard), the axis tick picker,
 * and the locale-free clock/duration formatters.
 */
import { describe, expect, it } from 'vitest'
import type { TeamView } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  deriveTeamTimeline, formatTeamClock, formatTeamDuration, teamTimelineTicks,
  TEAM_LANE_COLOR_SLOTS,
} from '../src/client/team-timeline-model.ts'

const T = 1_700_000_000_000

function view(
  partial: Partial<TeamView> & Pick<TeamView, 'members' | 'delegations'>,
): TeamView {
  return {
    teamId: 'leader-s',
    leaderSessionId: 'leader-s',
    rosterMemberCount: 0,
    tasks: [],
    approvals: [],
    messages: [],
    messageCount: 0,
    ...partial,
  }
}

const LEADER = {
  memberId: 'lead',
  name: 'Lead',
  role: 'leader' as const,
  sessionIds: ['leader-s'],
  status: 'bound' as const,
  pendingControlCount: 0,
}
const MATE_A = {
  memberId: 'a',
  name: 'Alpha',
  role: 'teammate' as const,
  sessionIds: ['sa'],
  status: 'bound' as const,
  pendingControlCount: 0,
}
const MATE_B = {
  memberId: 'b',
  name: 'Beta',
  role: 'teammate' as const,
  sessionIds: ['sb'],
  status: 'bound' as const,
  pendingControlCount: 0,
}
const DELEGATION_A = {
  memberId: 'a',
  childSessionId: 'sa',
  startedAt: T,
  endedAt: T + 90_000,
  inProgress: false,
}

describe('deriveTeamTimeline', () => {
  it('returns null without delegations, even with members and tasks', () => {
    expect(deriveTeamTimeline(view({ members: [LEADER, MATE_A], delegations: [] }), T)).toBeNull()
    expect(deriveTeamTimeline(view({
      members: [MATE_A],
      delegations: [],
      tasks: [{ taskId: 't1', subject: 's', status: 'pending', memberId: 'a', seq: 1, at: T }],
    }), T)).toBeNull()
  })

  it('spans the linear domain from the earliest team timestamp to the last settlement', () => {
    const earlyTask = { taskId: 't0', subject: 's', status: 'pending' as const, memberId: 'a', seq: 0, at: T - 5_000 }
    const model = deriveTeamTimeline(view({
      members: [LEADER, MATE_A],
      delegations: [DELEGATION_A],
      tasks: [earlyTask],
    }), T)
    expect(model).not.toBeNull()
    expect(model?.start).toBe(T - 5_000)
    expect(model?.end).toBe(T + 90_000)
  })

  it('lets a task recorded after the last settlement extend the right edge', () => {
    const lateTask = { taskId: 't1', subject: 's', status: 'completed' as const, memberId: 'a', seq: 9, at: T + 200_000 }
    const model = deriveTeamTimeline(view({
      members: [MATE_A],
      delegations: [DELEGATION_A],
      tasks: [lateTask],
    }), T)
    expect(model?.start).toBe(T)
    expect(model?.end).toBe(T + 200_000)
  })

  it('extends a running span to the caller clock and never beyond a known settlement', () => {
    const running = { memberId: 'a', childSessionId: 'sa', startedAt: T, inProgress: true }
    const open = deriveTeamTimeline(view({ members: [MATE_A], delegations: [running] }), T + 30_000)
    expect(open?.end).toBe(T + 30_000)
    expect(open?.lanes[0]?.spans[0]).toMatchObject({ endedAt: T + 30_000, inProgress: true })

    // A clock earlier than an inconsistent settlement keeps the settlement.
    const odd = { ...running, endedAt: T + 40_000 }
    const capped = deriveTeamTimeline(view({ members: [MATE_A], delegations: [odd] }), T + 10_000)
    expect(capped?.end).toBe(T + 40_000)
    expect(capped?.lanes[0]?.spans[0]?.endedAt).toBe(T + 40_000)
  })

  it('never reads the clock for a fully settled view', () => {
    const model = deriveTeamTimeline(view({ members: [MATE_A], delegations: [DELEGATION_A] }), T + 10**12)
    expect(model?.end).toBe(T + 90_000)
  })

  it('draws one lane per teammate in members order and skips the leader', () => {
    const model = deriveTeamTimeline(view({
      members: [LEADER, MATE_A, MATE_B],
      delegations: [DELEGATION_A],
    }), T)
    expect(model?.lanes.map(lane => [lane.memberId, lane.name, lane.lane, lane.colorSlot, lane.sessionId]))
      .toEqual([
        ['a', 'Alpha', 0, 0, 'sa'],
        ['b', 'Beta', 1, 1, 'sb'],
      ])
  })

  it('sorts a member\u2019s spans by start time with unique stable keys', () => {
    const later = { memberId: 'a', childSessionId: 'sa', startedAt: T + 10_000, endedAt: T + 20_000, inProgress: false }
    const model = deriveTeamTimeline(view({
      members: [MATE_A],
      delegations: [later, DELEGATION_A],
    }), T)
    const spans = model?.lanes[0]?.spans ?? []
    expect(spans.map(span => span.startedAt)).toEqual([T, T + 10_000])
    expect(new Set(spans.map(span => span.key)).size).toBe(spans.length)
  })

  it('keeps same-timestamp spans in delegation order', () => {
    const twin = { ...DELEGATION_A }
    const model = deriveTeamTimeline(view({
      members: [MATE_A],
      delegations: [DELEGATION_A, twin],
    }), T)
    const spans = model?.lanes[0]?.spans ?? []
    expect(spans).toHaveLength(2)
    expect(spans.map(span => span.key)).toEqual([`a:${T}:0`, `a:${T}:1`])
  })

  it('renders a not-rostered delegation id as a fallback lane after the roster', () => {
    const ghost = { memberId: 'ghost', childSessionId: '', startedAt: T + 5_000, endedAt: T + 15_000, inProgress: false }
    const model = deriveTeamTimeline(view({
      members: [MATE_A],
      delegations: [DELEGATION_A, ghost, ghost],
    }), T)
    expect(model?.lanes.map(lane => [lane.memberId, lane.name, lane.sessionId, lane.spans.length]))
      .toEqual([
        ['a', 'Alpha', 'sa', 1],
        ['ghost', 'ghost', '', 2],
      ])
  })

  it('keeps an unbound teammate row on the matrix with an empty session id', () => {
    const unboundB = { ...MATE_B, sessionIds: [], status: 'unbound' as const }
    const toUnbound = {
      memberId: 'b', childSessionId: '', startedAt: T, endedAt: T + 10_000, inProgress: false,
    }
    const model = deriveTeamTimeline(view({
      members: [MATE_A, unboundB],
      delegations: [toUnbound],
    }), T)
    expect(model?.lanes.map(lane => [lane.memberId, lane.name, lane.sessionId, lane.spans.length]))
      .toEqual([
        ['a', 'Alpha', 'sa', 0],
        ['b', 'Beta', '', 1],
      ])
  })

  it('cycles the color slot by lane position past the ramp length', () => {
    const mates = Array.from({ length: TEAM_LANE_COLOR_SLOTS + 1 }, (_, index) => ({
      memberId: `m${index}`,
      name: `M${index}`,
      role: 'teammate' as const,
      sessionIds: [`s${index}`],
      status: 'bound' as const,
      pendingControlCount: 0,
    }))
    const model = deriveTeamTimeline(view({
      members: mates,
      delegations: [{ memberId: 'm0', childSessionId: 's0', startedAt: T, endedAt: T + 1, inProgress: false }],
    }), T)
    expect(model?.lanes).toHaveLength(TEAM_LANE_COLOR_SLOTS + 1)
    expect(model?.lanes.at(-1)?.colorSlot).toBe(0)
  })

  it('widens a zero-width domain to 1 ms', () => {
    const instant = { ...DELEGATION_A, startedAt: T, endedAt: T }
    const model = deriveTeamTimeline(view({ members: [MATE_A], delegations: [instant] }), T + 1)
    expect(model?.start).toBe(T)
    expect(model?.end).toBe(T + 1)
  })
})

describe('teamTimelineTicks', () => {
  it('picks a 1/2/5 step that keeps the visible density near the target', () => {
    // Normalized exactly 1 keeps the 1×10^n step.
    expect(teamTimelineTicks(0, 5_000)).toEqual([0, 1_000, 2_000, 3_000, 4_000, 5_000])
    expect(teamTimelineTicks(0, 10_000)).toEqual([0, 2_000, 4_000, 6_000, 8_000, 10_000])
    expect(teamTimelineTicks(0, 12_000)).toEqual([0, 5_000, 10_000])
    expect(teamTimelineTicks(0, 1_200_000)).toEqual([0, 500_000, 1_000_000])
    // Normalized above 5 rounds the step up to 10×10^n.
    expect(teamTimelineTicks(0, 6_000, 2)).toEqual([0])
  })

  it('keeps ticks inside an offset domain and ascending', () => {
    const ticks = teamTimelineTicks(T, T + 1_200_000)
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks.every(tick => tick >= T && tick <= T + 1_200_000)).toBe(true)
    expect(ticks).toEqual([...ticks].sort((left, right) => left - right))
    // The length > 1 assertion makes both indexed reads total.
    const first = ticks[0]!
    const step = ticks[1]! - first
    expect(ticks.every((tick, index) => tick === first + index * step)).toBe(true)
  })

  it('degenerates gracefully on equal, inverted, or non-finite bounds', () => {
    expect(teamTimelineTicks(T, T)).toEqual([T])
    expect(teamTimelineTicks(T, T - 1)).toEqual([])
    expect(teamTimelineTicks(Number.NaN, T + 1)).toEqual([])
  })
})

describe('formatTeamClock', () => {
  // Anchor at the local midnight so the assertion holds in every timezone.
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const BASE = midnight.getTime()

  it('prints fixed 24-hour HH:MM:SS', () => {
    expect(formatTeamClock(BASE)).toBe('00:00:00')
    expect(formatTeamClock(BASE + 3_661_000)).toBe('01:01:01')
    expect(formatTeamClock(BASE + 86_399_999)).toBe('23:59:59')
  })
})

describe('formatTeamDuration', () => {
  it.each([
    [0, '0毫秒'],
    [-5, '0毫秒'],
    [Number.NaN, '0毫秒'],
    [500, '500毫秒'],
    [999, '999毫秒'],
    [8_400, '8.4秒'],
    [9_990, '10秒'],
    [10_000, '10秒'],
    [59_500, '60秒'],
    [61_000, '1分01秒'],
    [188_000, '3分08秒'],
    [3_599_999, '59分59秒'],
    [3_600_000, '1小时00分'],
    [3_661_000, '1小时01分'],
  ])('formats %i as %s', (input, expected) => {
    expect(formatTeamDuration(input)).toBe(expected)
  })
})
