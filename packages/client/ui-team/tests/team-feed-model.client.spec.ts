/**
 * Event-stream projection: the approval ∪ message mixed order (time
 * ascending, the approval-before-message tie-break at equal times, the
 * projection fold order within each kind), the 200-row default cap, the
 * "load earlier" depth as a plain count (splice: the loaded window's tail
 * stays stable as the head grows older), the hasMore flag, the fetched
 * wire pages spliced ahead of the snapshot window in global order, the
 * unloaded-message count (messages the fold observed but the loaded set
 * does not hold, over the newest observed count), the oldest-loaded-message
 * anchor, the member-name/session joins (D19 with the raw-id fallback),
 * the stable row keys, and the frame-swap semantics (the depth is a count,
 * the window re-derives over the new snapshot).
 */
import { describe, expect, it } from 'vitest'
import type { TeamView } from '@deepseek-ai/dsh-client-runtime/client'
import {
  TEAM_FEED_INITIAL_LIMIT, TEAM_FEED_STEP, deriveTeamFeed, type TeamFeedRow,
} from '../src/client/team-feed-model.ts'

type MemberRow = TeamView['members'][number]
type ApprovalRow = TeamView['approvals'][number]
type MessageRow = TeamView['messages'][number]

const LEADER = 'leader-s'

function member(memberId: string, sessionId: string = `${memberId}-s`): MemberRow {
  return {
    memberId, name: `Name-${memberId}`, role: 'teammate', sessionIds: [sessionId],
    status: 'bound', pendingControlCount: 0,
  }
}

function approval(requestId: string, requestedAt: number, overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    requestId,
    memberId: 'a',
    toolName: 'write_file',
    reason: `reason ${requestId}`,
    requestedAt,
    ...overrides,
  }
}

function message(at: number, seq: number, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    from: 'lead', to: 'a', message: `msg ${seq}`, at, seq, sessionId: 'leader-s',
    ...overrides,
  }
}

function view(
  members: readonly MemberRow[],
  approvals: readonly ApprovalRow[],
  messages: readonly MessageRow[],
  messageCount: number = messages.length,
): TeamView {
  return {
    teamId: LEADER,
    leaderSessionId: LEADER,
    rosterMemberCount: members.length,
    members,
    delegations: [],
    tasks: [],
    approvals,
    messages,
    messageCount,
  }
}

/** `count` messages at 1000+i (ascending), from the lead to the mate. */
function manyMessages(count: number): MessageRow[] {
  return Array.from({ length: count }, (_, i) => message(1000 + i, i))
}

function rowKeys(rows: readonly TeamFeedRow[]): string[] {
  return rows.map(row => row.key)
}

describe('deriveTeamFeed', () => {
  it('reads the frozen constants (200 default depth, 200 step)', () => {
    expect(TEAM_FEED_INITIAL_LIMIT).toBe(200)
    expect(TEAM_FEED_STEP).toBe(200)
  })

  it('mixes approvals and messages into one ascending time order', () => {
    const model = deriveTeamFeed(view(
      [member('lead'), member('a')],
      [approval('r1', 300), approval('r2', 100)],
      [message(400, 1), message(200, 2)],
    ), TEAM_FEED_INITIAL_LIMIT)
    expect(model.total).toBe(4)
    expect(model.rows.map(row => row.kind)).toEqual(['approval', 'message', 'approval', 'message'])
    expect(model.rows.map(row => row.at)).toEqual([100, 200, 300, 400])
  })

  it('breaks equal times approvals-before-messages and keeps the fold order within each kind', () => {
    const model = deriveTeamFeed(view(
      [member('lead'), member('a')],
      [approval('r1', 100), approval('r2', 100)],
      [message(100, 1), message(100, 2)],
    ), TEAM_FEED_INITIAL_LIMIT)
    // All four share t=100: both approvals (fold order) first, then both
    // messages (global order).
    expect(model.rows).toEqual([
      expect.objectContaining({ kind: 'approval' }),
      expect.objectContaining({ kind: 'approval' }),
      expect.objectContaining({ kind: 'message' }),
      expect.objectContaining({ kind: 'message' }),
    ])
    expect((model.rows[0] as { approval: ApprovalRow }).approval.requestId).toBe('r1')
    expect((model.rows[1] as { approval: ApprovalRow }).approval.requestId).toBe('r2')
    expect((model.rows[2] as { message: MessageRow }).message.seq).toBe(1)
    expect((model.rows[3] as { message: MessageRow }).message.seq).toBe(2)
  })

  it('caps the first render at the most recent 200 rows (D8h)', () => {
    const model = deriveTeamFeed(view([member('lead'), member('a')], [], manyMessages(250)), TEAM_FEED_INITIAL_LIMIT)
    expect(model.total).toBe(250)
    expect(model.rows).toHaveLength(200)
    expect(model.hasMore).toBe(true)
    const first = model.rows[0] as { message: MessageRow }
    const last = model.rows[199] as { message: MessageRow }
    expect(first.message.seq).toBe(50)
    expect(last.message.seq).toBe(249)
    // The window itself is ascending.
    expect(model.rows.map(row => row.at)).toEqual([...model.rows.map(row => row.at)].sort((x, y) => x - y))
  })

  it('renders the whole representable stream when it fits in 200 rows', () => {
    const model = deriveTeamFeed(view(
      [member('lead'), member('a')],
      [approval('r1', 100)],
      manyMessages(2),
    ), TEAM_FEED_INITIAL_LIMIT)
    expect(model.rows).toHaveLength(3)
    expect(model.hasMore).toBe(false)
  })

  it('reports hasMore=false exactly at the representable total', () => {
    const v = view([member('lead'), member('a')], [], manyMessages(200))
    expect(deriveTeamFeed(v, 199).hasMore).toBe(true)
    expect(deriveTeamFeed(v, 200).hasMore).toBe(false)
    expect(deriveTeamFeed(v, 201).hasMore).toBe(false)
  })

  it('splices older rows ahead of the initial window without duplication or gaps', () => {
    const v = view([member('lead'), member('a')], [], manyMessages(450))
    const initial = deriveTeamFeed(v, 200)
    const loaded = deriveTeamFeed(v, 400)
    expect(loaded.total).toBe(450)
    expect(loaded.rows).toHaveLength(400)
    expect(loaded.hasMore).toBe(true)
    // The 400-row window's tail is exactly the initial 200-row window: the
    // older half splices ahead, nothing repeats or drops.
    expect(rowKeys(loaded.rows.slice(200))).toEqual(rowKeys(initial.rows))
    // The splice point is time-consistent: the oldest loaded row is the
    // 50th message, the newest the 449th.
    const head = loaded.rows[0] as { message: MessageRow }
    const seamBefore = loaded.rows[199] as { message: MessageRow }
    const seamAfter = loaded.rows[200] as { message: MessageRow }
    const tail = loaded.rows[399] as { message: MessageRow }
    expect(head.message.seq).toBe(50)
    expect(seamBefore.message.seq).toBe(249)
    expect(seamAfter.message.seq).toBe(250)
    expect(tail.message.seq).toBe(449)
    const complete = deriveTeamFeed(v, 450)
    expect(complete.rows).toHaveLength(450)
    expect(complete.hasMore).toBe(false)
    expect((complete.rows[0] as { message: MessageRow }).message.seq).toBe(0)
  })

  it('keeps approvals in the spliced window (approvals are never truncated)', () => {
    // 300 messages plus 50 older approvals: the initial 200 hold the newest
    // 200 (messages 100..299); loading 400 pulls in the 50 approvals and
    // the 150 oldest window messages.
    const approvals = Array.from({ length: 50 }, (_, i) => approval(`r${i}`, i))
    const v = view([member('lead'), member('a')], approvals, manyMessages(300))
    const initial = deriveTeamFeed(v, 200)
    expect(initial.rows.filter(row => row.kind === 'approval')).toHaveLength(0)
    const loaded = deriveTeamFeed(v, 400)
    expect(loaded.rows.filter(row => row.kind === 'approval')).toHaveLength(50)
    expect(loaded.rows.filter(row => row.kind === 'message')).toHaveLength(300)
    expect(loaded.rows[0]?.kind).toBe('approval')
    // 400 ≥ the representable total of 350, so the stream is fully loaded.
    expect(loaded.hasMore).toBe(false)
  })

  it('counts messages the loaded set does not hold (the loud counted-note fact)', () => {
    const v = view([member('lead'), member('a')], [], manyMessages(500), 620)
    expect(deriveTeamFeed(v, TEAM_FEED_INITIAL_LIMIT).unloadedMessageCount).toBe(120)
    const untruncated = view([member('lead'), member('a')], [], manyMessages(10), 10)
    expect(deriveTeamFeed(untruncated, TEAM_FEED_INITIAL_LIMIT).unloadedMessageCount).toBe(0)
    const empty = view([], [], [], 0)
    expect(deriveTeamFeed(empty, TEAM_FEED_INITIAL_LIMIT).unloadedMessageCount).toBe(0)
  })

  it('splices the fetched wire pages ahead of the snapshot window in global order', () => {
    // 50 fetched messages strictly earlier than the snapshot's 250, from a
    // different recording session.
    const older = Array.from({ length: 50 }, (_, i) => message(500 + i, i, { sessionId: 'old-s' }))
    const v = view([member('lead'), member('a')], [], manyMessages(250))
    const model = deriveTeamFeed(v, TEAM_FEED_INITIAL_LIMIT, older)
    expect(model.total).toBe(300)
    expect(model.hasMore).toBe(true)
    // The depth cut applies to the loaded stream: the newest 200 are
    // snapshot messages 50..249, the page rows sit outside the window.
    const first = model.rows[0] as { message: MessageRow }
    const last = model.rows[199] as { message: MessageRow }
    expect(first.message.seq).toBe(50)
    expect(last.message.seq).toBe(249)
    // Fully loaded: the page rows splice ahead, ascending, no gap.
    const loaded = deriveTeamFeed(v, 300, older)
    expect(loaded.rows).toHaveLength(300)
    expect(loaded.hasMore).toBe(false)
    const head = loaded.rows[0] as { message: MessageRow }
    const seamBefore = loaded.rows[49] as { message: MessageRow }
    const seamAfter = loaded.rows[50] as { message: MessageRow }
    const tail = loaded.rows[299] as { message: MessageRow }
    expect(head.message.sessionId).toBe('old-s')
    expect(head.message.seq).toBe(0)
    expect(seamBefore.message.seq).toBe(49)
    expect(seamAfter.message.sessionId).toBe(LEADER)
    expect(seamAfter.message.seq).toBe(0)
    expect(tail.message.seq).toBe(249)
    expect(loaded.rows.map(row => row.at)).toEqual([...loaded.rows.map(row => row.at)].sort((x, y) => x - y))
    // The window's tail stays stable as the head grows older (depth splice).
    const windowed = deriveTeamFeed(v, 250, older)
    expect(rowKeys(windowed.rows.slice(50))).toEqual(rowKeys(deriveTeamFeed(v, TEAM_FEED_INITIAL_LIMIT).rows))
  })

  it('counts unloaded messages over the newest observed count, not only the snapshot', () => {
    const v = view([member('lead'), member('a')], [], manyMessages(500), 620)
    const older = Array.from({ length: 120 }, (_, i) => message(500 + i, i, { sessionId: 'old-s' }))
    // The page closed the gap: nothing left to load.
    expect(deriveTeamFeed(v, 620, older).unloadedMessageCount).toBe(0)
    // A page that outran the snapshot's count raises the observed total.
    expect(deriveTeamFeed(v, 300, older.slice(0, 20), 700).unloadedMessageCount).toBe(180)
    // A newer observed total still outruns the loaded rows.
    expect(deriveTeamFeed(view([member('lead'), member('a')], [], [], 0), 0, older.slice(0, 50), 100).unloadedMessageCount).toBe(50)
    // The loaded set bounds the observed count from below: an observed total
    // below the loaded rows cannot open a negative remainder.
    expect(deriveTeamFeed(view([member('lead'), member('a')], [], [], 0), 0, older, 100).unloadedMessageCount).toBe(0)
  })

  it('exposes the oldest loaded message as the page anchor, approvals aside', () => {
    // Approvals older than every message: the anchor is still a message.
    const v = view(
      [member('lead'), member('a')],
      [approval('r1', 100)],
      [message(200, 1), message(300, 2)],
    )
    const model = deriveTeamFeed(v, TEAM_FEED_INITIAL_LIMIT)
    expect(model.oldestMessage).toEqual({ from: 'lead', to: 'a', message: 'msg 1', at: 200, seq: 1, sessionId: LEADER })
    // A fetched page becomes the new anchor source.
    const older = [message(50, 0, { sessionId: 'old-s' })]
    const paged = deriveTeamFeed(v, TEAM_FEED_INITIAL_LIMIT, older)
    expect(paged.oldestMessage).toEqual({ from: 'lead', to: 'a', message: 'msg 0', at: 50, seq: 0, sessionId: 'old-s' })
    // Approvals alone carry no message anchor.
    const approvalsOnly = view([member('lead'), member('a')], [approval('r1', 100)], [])
    expect(deriveTeamFeed(approvalsOnly, TEAM_FEED_INITIAL_LIMIT).oldestMessage).toBeUndefined()
  })

  it('resolves member names and binds approval rows to the member session (D19)', () => {
    const v = view(
      [member('lead', 'lead-s'), member('a', 'a-s')],
      [approval('r1', 100), approval('r2', 200, { memberId: 'ghost' })],
      [message(300, 1, { from: 'lead', to: 'a' }), message(400, 2, { from: 'ghost', to: 'nowhere' })],
    )
    const model = deriveTeamFeed(v, TEAM_FEED_INITIAL_LIMIT)
    const first = model.rows[0] as { kind: 'approval'; memberName: string; sessionId: string }
    expect(first.memberName).toBe('Name-a')
    expect(first.sessionId).toBe('a-s')
    const second = model.rows[1] as { kind: 'approval'; memberName: string; sessionId: string }
    expect(second.memberName).toBe('ghost')
    expect(second.sessionId).toBe('')
    const third = model.rows[2] as { kind: 'message'; fromName: string; toName: string }
    expect(third.fromName).toBe('Name-lead')
    expect(third.toName).toBe('Name-a')
    const fourth = model.rows[3] as { kind: 'message'; fromName: string; toName: string }
    expect(fourth.fromName).toBe('ghost')
    expect(fourth.toName).toBe('nowhere')
  })

  it('binds approval rows to the empty session for unbound members', () => {
    const v = view(
      [
        { memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER], status: 'bound', pendingControlCount: 0 },
        { memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [], status: 'unbound', pendingControlCount: 0 },
      ],
      [approval('r1', 100, { memberId: 'a' })],
      [],
    )
    const row = deriveTeamFeed(v, TEAM_FEED_INITIAL_LIMIT).rows[0] as { kind: 'approval'; sessionId: string; memberName: string }
    expect(row.memberName).toBe('Alpha')
    expect(row.sessionId).toBe('')
  })

  it('uses the first member row when rows share a memberId (multi-instance interface)', () => {
    const v = view(
      [member('a', 'a-s1'), { ...member('a', 'a-s2'), name: 'Alpha-2' }],
      [approval('r1', 1000, { memberId: 'a' })],
      [message(2000, 1, { from: 'a', to: 'lead' })],
    )
    const model = deriveTeamFeed(v, TEAM_FEED_INITIAL_LIMIT)
    const approvalRow = model.rows[0] as { kind: 'approval'; memberName: string; sessionId: string }
    expect(approvalRow.memberName).toBe('Name-a')
    expect(approvalRow.sessionId).toBe('a-s1')
    const messageRow = model.rows[1] as { kind: 'message'; fromName: string }
    expect(messageRow.fromName).toBe('Name-a')
  })

  it('keeps the row keys stable across invocations and frames', () => {
    const v = view(
      [member('lead'), member('a')],
      [approval('r1', 100)],
      [message(200, 1)],
    )
    expect(rowKeys(deriveTeamFeed(v, 200).rows)).toEqual([
      'approval:r1',
      'message:leader-s:1',
    ])
    expect(rowKeys(deriveTeamFeed(v, 100).rows)).toEqual(rowKeys(deriveTeamFeed(v, 100).rows))
  })

  it('re-derives the window over a new frame at the same depth (the depth is a count)', () => {
    const v1 = view([member('lead'), member('a')], [], manyMessages(250))
    const before = deriveTeamFeed(v1, 200)
    // Five newer messages land in the next snapshot frame.
    const newer = Array.from({ length: 5 }, (_, i) => message(2500 + i, 250 + i))
    const v2 = view([member('lead'), member('a')], [], [...manyMessages(250), ...newer])
    const after = deriveTeamFeed(v2, 200)
    expect(after.total).toBe(255)
    expect(after.rows).toHaveLength(200)
    const headBefore = before.rows[0] as { message: MessageRow }
    const headAfter = after.rows[0] as { message: MessageRow }
    const tailAfter = after.rows[199] as { message: MessageRow }
    // The window slides with the newest: the previous head drops out, the
    // five new rows append at the tail.
    expect(headBefore.message.seq).toBe(50)
    expect(headAfter.message.seq).toBe(55)
    expect(tailAfter.message.seq).toBe(254)
  })

  it('returns an empty model for an empty stream', () => {
    const model = deriveTeamFeed(view([], [], [], 0), TEAM_FEED_INITIAL_LIMIT)
    expect(model).toEqual({ rows: [], total: 0, hasMore: false, unloadedMessageCount: 0, oldestMessage: undefined })
  })

  it('clamps the depth to the representable bounds', () => {
    const v = view([member('lead'), member('a')], [approval('r1', 100)], [message(200, 1)])
    const over = deriveTeamFeed(v, 1000)
    expect(over.rows).toHaveLength(2)
    expect(over.hasMore).toBe(false)
    const under = deriveTeamFeed(v, 0)
    expect(under.rows).toHaveLength(0)
    expect(under.hasMore).toBe(true)
    expect(under.total).toBe(2)
  })
})
