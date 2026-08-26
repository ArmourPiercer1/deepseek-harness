/**
 * Pure-fold behavior of {@link foldTeamView} and the message pagination:
 * determinism, the seedLength gate, span pairing, approval pairing, message
 * global order and cap, roster join semantics, and task timeline endpoints.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import { TeamProjectionError } from '../src/error.ts'
import { foldTeamView, resolvePageLimit, scanTeamFacts, sliceMessagePage, MESSAGE_CAP } from '../src/fold.ts'
import type { TeamChildCorpus, TeamCorpus, TeamFacts } from '../src/fold.ts'

const sid = (value: string): SessionId => value as SessionId

/** Minimal typed header builder. */
function header(over: Partial<SessionHeader> & { id: SessionId }): SessionHeader {
  return { version: 0, createdAt: 1, cwd: '/w', ...over }
}

/** Event builder: seq defaults to the call site's order. */
function ev(type: string, data: unknown, seq: number, time: number): SessionEvent {
  return { type, seq, time, data } as unknown as SessionEvent
}

/** delegate_to_teammate tool/call with the given teammate_id argument. */
function delegate(memberId: string, seq: number, time: number, args?: string): SessionEvent {
  return ev('tool/call', {
    turn: 1, step: 1, callId: 'c', name: 'delegate_to_teammate',
    arguments: args ?? JSON.stringify({ teammate_id: memberId, prompt: 'go' }),
  }, seq, time)
}

/** subagent-settled notice user/message in the leader log. */
function settled(childSessionId: string, seq: number, time: number): SessionEvent {
  return ev('user/message', {
    id: 'm', role: 'user', content: [{ type: 'text', text: 'settled' }],
    source: { kind: 'subagent-settled', form: 'notice', summary: 'done', senderSessionId: childSessionId },
  }, seq, time)
}

const roster = (ids: { id: string; role?: 'leader' | 'teammate'; name?: string }[]): TeamMemberDefinition[] =>
  ids.map(({ id, role = 'teammate', name }) => ({
    id: TeamMemberId(id), role, name: name ?? id, description: 'd', prompt: 'p',
  }))

const neverRunning = (): boolean => false

/** Fold shorthand over a corpus with no running agents. */
function fold(corpus: TeamCorpus, members: TeamMemberDefinition[], isRunning = neverRunning) {
  return foldTeamView(sid('leader'), corpus, members, isRunning)
}

describe('foldTeamView determinism and seed gate', () => {
  it('returns deeply equal views for identical inputs (no clock, no random)', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [
        delegate('backend', 0, 10),
        ev('team/progress', { taskId: 't1', subject: 'Build', status: 'in_progress', memberId: 'backend' }, 1, 11),
      ] },
      children: [],
    }
    const members = roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])
    expect(fold(corpus, members)).toEqual(fold(corpus, members))
  })

  it('ignores child events below the durable seed boundary (fork seed never double-counts)', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [] },
      children: [{
        id: sid('child'),
        header: header({ id: sid('child'), parentSession: sid('leader'), seedLength: 2, origin: 'subagent' }),
        label: 'team:Backend',
        events: [
          ev('team/member-bound', { memberId: 'ancestor-member', role: 'teammate' }, 0, 5),
          ev('team/message', { from: 'ancestor-member', to: 'leader', message: 'seed' }, 1, 6),
          ev('team/member-bound', { memberId: 'backend', role: 'teammate' }, 2, 7),
          ev('team/message', { from: 'backend', to: 'leader', message: 'own' }, 3, 8),
        ],
      }],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    expect(view.messages.map(message => message.message)).toEqual(['own'])
    expect(view.members.find(member => member.memberId === 'backend')?.sessionIds).toEqual(['child'])
    expect(view.members.some(member => member.memberId === 'ancestor-member')).toBe(false)
  })
})

describe('scanTeamFacts (team-ness gate)', () => {
  it('finds each team fact type alone in the own suffix', () => {
    const one = (type: string, data: unknown): TeamFacts =>
      scanTeamFacts(header({ id: sid('s') }), [ev(type, data, 0, 5)])
    for (const [type, data] of [
      ['team/progress', { taskId: 't', subject: 'S', status: 'pending', memberId: 'm' }],
      ['team/control-decision', { requestId: 'r', decision: 'deny' }],
      ['team/message', { from: 'a', to: 'b', message: 'm' }],
      ['team/control-request', { requestId: 'r', memberId: 'm', toolName: 't', reason: 'r' }],
      ['team/member-bound', { memberId: 'm', role: 'teammate' }],
    ] as const) {
      expect(one(type, data)).toEqual({ fact: true, bound: type === 'team/member-bound' })
    }
    expect(one('tool/call', { name: 'delegate_to_teammate', arguments: '{}' })).toEqual({ fact: true, bound: false })
  })

  it('ignores other tool calls and non-team event families', () => {
    expect(scanTeamFacts(header({ id: sid('s') }), [
      ev('tool/call', { name: 'other_tool', arguments: '{}' }, 0, 5),
      ev('turn/start', { turn: 1 }, 1, 6),
      ev('user/message', { id: 'm', role: 'user', content: [], source: { kind: 'user' } }, 2, 7),
    ])).toEqual({ fact: false, bound: false })
  })

  it('never counts facts below the durable seed boundary', () => {
    expect(scanTeamFacts(
      header({ id: sid('s'), seedLength: 2 }),
      [
        ev('team/message', { from: 'a', to: 'b', message: 'seed' }, 0, 5),
        ev('team/member-bound', { memberId: 'm', role: 'teammate' }, 1, 6),
        ev('turn/start', { turn: 1 }, 2, 7),
      ],
    )).toEqual({ fact: false, bound: false })
  })

  it('stops scanning once a bound log already carries both facts', () => {
    // member-bound alone sets both flags, so the later event is never read.
    expect(scanTeamFacts(header({ id: sid('s') }), [
      ev('team/member-bound', { memberId: 'm', role: 'teammate' }, 0, 5),
      ev('team/message', { from: 'a', to: 'b', message: 'own' }, 1, 6),
    ])).toEqual({ fact: true, bound: true })
  })
})

describe('delegation span pairing', () => {
  const childOf = (memberId: string, id: string, label = 'team:X'): TeamChildCorpus => ({
    id: sid(id),
    header: header({ id: sid(id), parentSession: sid('leader'), origin: 'subagent' }),
    label,
    events: [ev('team/member-bound', { memberId, role: 'teammate' }, 0, 5)],
  })

  it('pairs each open span with the member FIFO settlement and closes it with the sender session', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [
        delegate('backend', 0, 10),
        delegate('backend', 1, 20),
        settled('child-a', 2, 30),
        settled('child-b', 3, 40),
      ] },
      children: [childOf('backend', 'child-a'), childOf('backend', 'child-b')],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    expect(view.delegations).toEqual([
      { memberId: 'backend', childSessionId: 'child-a', startedAt: 10, endedAt: 30, inProgress: false },
      { memberId: 'backend', childSessionId: 'child-b', startedAt: 20, endedAt: 40, inProgress: false },
    ])
  })

  it('keeps an unclosed span in progress with the latest bound session, empty without one', () => {
    const withChild: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [delegate('backend', 0, 10)] },
      children: [childOf('backend', 'child-a')],
    }
    expect(fold(withChild, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view.delegations)
      .toEqual([{ memberId: 'backend', childSessionId: 'child-a', startedAt: 10, inProgress: true }])

    const childless: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [delegate('ghost', 0, 10)] },
      children: [],
    }
    expect(fold(childless, roster([{ id: 'leader', role: 'leader' }])).view.delegations)
      .toEqual([{ memberId: 'ghost', childSessionId: '', startedAt: 10, inProgress: true }])
  })

  it('drops delegate calls whose arguments carry no parseable teammate_id', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [
        delegate('backend', 0, 10, 'not-json'),
        delegate('backend', 1, 11, JSON.stringify({ prompt: 'missing id' })),
        delegate('backend', 2, 12, JSON.stringify({ teammate_id: 42 })),
        // A parseable scalar/null document is not a member argument object.
        delegate('backend', 3, 13, '42'),
        delegate('backend', 4, 14, 'null'),
        delegate('backend', 5, 15, JSON.stringify({ teammate_id: '' })),
        ev('tool/call', { turn: 1, step: 1, callId: 'c', name: 'other_tool', arguments: '{}' }, 6, 16),
      ] },
      children: [],
    }
    expect(fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view.delegations).toEqual([])
  })

  it('ignores a settlement for a bound member with no open delegation span', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [settled('child-a', 0, 20)] },
      children: [{
        id: sid('child-a'),
        header: header({ id: sid('child-a'), parentSession: sid('leader'), origin: 'subagent' }),
        label: 'team:Backend',
        events: [ev('team/member-bound', { memberId: 'backend', role: 'teammate' }, 0, 5)],
      }],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    expect(view.delegations).toEqual([])
    // The settlement still marks the member's session settled.
    expect(view.members.find(member => member.memberId === 'backend')?.status).toBe('settled')
  })

  it('ignores a subagent-settled source that names no sender session', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [
        ev('user/message', {
          id: 'm', role: 'user', content: [{ type: 'text', text: 'settled' }],
          source: { kind: 'subagent-settled', form: 'notice', summary: 'done' },
        }, 0, 20),
      ] },
      children: [],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }])).view
    expect(view.members[0]?.status).toBe('bound')
  })

  it('skips event families the fold does not consume in either log', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [
        ev('turn/start', { turn: 1 }, 0, 1),
        delegate('backend', 1, 10),
        ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2, 30),
      ] },
      children: [{
        id: sid('child-a'),
        header: header({ id: sid('child-a'), parentSession: sid('leader'), origin: 'subagent' }),
        label: 'team:Backend',
        // A teammate's own self-recorded progress stays in its log (known
        // limitation): the fold consumes neither arm here.
        events: [
          ev('turn/start', { turn: 1 }, 0, 2),
          ev('team/progress', { taskId: 'own', subject: 'Own', status: 'pending', memberId: 'backend' }, 1, 3),
        ],
      }],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    expect(view.tasks).toEqual([])
    expect(view.delegations).toHaveLength(1)
  })

  it('ignores settlement notices whose sender is no bound member', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [
        delegate('backend', 0, 10),
        settled('unknown-child', 1, 30),
        // A user message with a different source kind reads as no settlement.
        ev('user/message', {
          id: 'm', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
        }, 2, 31),
      ] },
      children: [],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    expect(view.delegations[0]?.inProgress).toBe(true)
  })
})

describe('approval pairing', () => {
  const request = (requestId: string, memberId: string, time: number, seq: number, kind?: 'tool' | 'plan'): SessionEvent =>
    ev('team/control-request', {
      requestId, memberId, toolName: 'pwsh', reason: 'build', ...(kind !== undefined ? { kind } : {}),
    }, seq, time)

  it('pairs decisions by requestId and keeps unmatched requests pending', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [
        ev('team/control-decision', { requestId: 'r1', decision: 'deny', reason: 'too risky' }, 0, 20),
        // A decision without a reason keeps the paired view reason-free.
        ev('team/control-decision', { requestId: 'r2', decision: 'approve_plan' }, 1, 21),
      ] },
      children: [{
        id: sid('child'),
        header: header({ id: sid('child'), parentSession: sid('leader'), origin: 'subagent' }),
        label: 'team:Backend',
        events: [
          request('r1', 'backend', 10, 0),
          request('r2', 'backend', 12, 1, 'plan'),
          request('r3', 'leader', 14, 2),
        ],
      }],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    expect(view.approvals).toEqual([
      {
        requestId: 'r1', memberId: 'backend', toolName: 'pwsh', reason: 'build', requestedAt: 10,
        decision: { value: 'deny', reason: 'too risky', decidedAt: 20 },
      },
      {
        requestId: 'r2', memberId: 'backend', toolName: 'pwsh', reason: 'build', kind: 'plan', requestedAt: 12,
        decision: { value: 'approve_plan', decidedAt: 21 },
      },
      { requestId: 'r3', memberId: 'leader', toolName: 'pwsh', reason: 'build', requestedAt: 14 },
    ])
    expect(view.members.find(member => member.memberId === 'backend')?.pendingControlCount).toBe(0)
    expect(view.members.find(member => member.memberId === 'leader')?.pendingControlCount).toBe(1)
  })
})

describe('message global order, cap, and pagination', () => {
  /** Build a corpus whose leader and two children each recorded messages. */
  function corpusOf(count: number): { corpus: TeamCorpus; all: { text: string; at: number; sessionId: string; seq: number }[] } {
    const leaderEvents: SessionEvent[] = []
    const childA: SessionEvent[] = []
    const childB: SessionEvent[] = []
    const all: { text: string; at: number; sessionId: string; seq: number }[] = []
    for (let i = 0; i < count; i++) {
      const target = i % 3 === 0 ? leaderEvents : i % 3 === 1 ? childA : childB
      const sessionId = i % 3 === 0 ? 'leader' : i % 3 === 1 ? 'child-a' : 'child-b'
      const at = 1000 + i
      const text = `m${i}`
      target.push(ev('team/message', { from: 'backend', to: 'leader', message: text }, target.length, at))
      all.push({ text, at, sessionId, seq: target.length - 1 })
    }
    return {
      corpus: {
        leader: { header: header({ id: sid('leader') }), events: leaderEvents },
        children: [
          { id: sid('child-a'), header: header({ id: sid('child-a'), origin: 'subagent' }), label: 'team:A', events: childA },
          { id: sid('child-b'), header: header({ id: sid('child-b'), origin: 'subagent' }), label: 'team:B', events: childB },
        ],
      },
      all,
    }
  }

  it('orders messages by (at, recording session, seq) and reports the full count', () => {
    const { corpus, all } = corpusOf(7)
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    const ordered = [...all].sort((a, b) => a.at - b.at
      || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0)
      || a.seq - b.seq)
    expect(view.messages.map(message => message.message)).toEqual(ordered.map(entry => entry.text))
    expect(view.messageCount).toBe(7)
  })

  it('caps the snapshot tail at MESSAGE_CAP while messageCount keeps the total', () => {
    const { corpus } = corpusOf(MESSAGE_CAP + 30)
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    expect(view.messages).toHaveLength(MESSAGE_CAP)
    expect(view.messageCount).toBe(MESSAGE_CAP + 30)
    expect(view.messages[0]?.message).toBe('m30')
  })

  it('breaks event-time ties on the recording session id (no shared seq across logs)', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [
        ev('team/message', { from: 'a', to: 'b', message: 'leader-msg' }, 0, 5),
      ] },
      children: [
        { id: sid('child-a'), header: header({ id: sid('child-a'), origin: 'subagent' }), label: 'team:A', events: [
          ev('team/message', { from: 'a', to: 'b', message: 'child-a-msg' }, 0, 5),
        ] },
        { id: sid('child-b'), header: header({ id: sid('child-b'), origin: 'subagent' }), label: 'team:B', events: [
          ev('team/message', { from: 'a', to: 'b', message: 'child-b-msg' }, 0, 5),
        ] },
      ],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }])).view
    expect(view.messages.map(message => message.message))
      .toEqual(['child-a-msg', 'child-b-msg', 'leader-msg'])
  })

  it('pages strictly before a real anchor, ascending, and echoes the count', () => {
    const { corpus } = corpusOf(12)
    const foldResult = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }]))
    const anchor = foldResult.allMessages[5] as { at: number; sessionId: string; seq: number }
    const page = sliceMessagePage(foldResult, sid('leader'), anchor, 3)
    expect(page.kind).toBe('message-page')
    expect(page.messages.map(message => message.message)).toEqual(['m2', 'm3', 'm4'])
    expect(page.messageCount).toBe(12)
    expect(page.teamId).toBe('leader')
    expect(page.leaderSessionId).toBe('leader')

    const shortPage = sliceMessagePage(foldResult, sid('leader'), anchor, 10)
    expect(shortPage.messages.map(message => message.message)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
  })

  it('joins a page and the snapshot window into one contiguous slice across the cap boundary', () => {
    const { corpus } = corpusOf(MESSAGE_CAP + 30)
    const foldResult = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }]))
    // The snapshot window is the last MESSAGE_CAP rows (m30..m529); the client
    // anchors at the window's oldest row and prepends the pages before it.
    const windowOldest = foldResult.view.messages[0]
    if (windowOldest === undefined) throw new Error('expected a capped window')
    const fullPage = sliceMessagePage(foldResult, sid('leader'), windowOldest, MESSAGE_CAP)
    // The full page carries every row strictly before the window.
    expect(fullPage.messages).toHaveLength(30)
    expect(fullPage.messages[0]?.message).toBe('m0')
    // Page plus window reconstructs the complete ordered fold, gap- and
    // overlap-free across the cap boundary.
    expect([...fullPage.messages, ...foldResult.view.messages]).toEqual(foldResult.allMessages)
    // A shorter page joins the same window into one contiguous slice.
    const shortPage = sliceMessagePage(foldResult, sid('leader'), windowOldest, 10)
    expect(shortPage.messages).toHaveLength(10)
    expect(shortPage.messages[0]?.message).toBe('m20')
    expect([...shortPage.messages, ...foldResult.view.messages]).toEqual(foldResult.allMessages.slice(20))
  })

  it('rejects an anchor naming no folded message, never silently falling back', () => {
    const { corpus } = corpusOf(3)
    const foldResult = fold(corpus, roster([{ id: 'leader', role: 'leader' }]))
    expect(() => sliceMessagePage(foldResult, sid('leader'), { at: 999, sessionId: 'leader', seq: 9 }, 3))
      .toThrow(TeamProjectionError)
  })

  it('validates the limit range loudly', () => {
    expect(resolvePageLimit({})).toBe(MESSAGE_CAP)
    expect(resolvePageLimit({ limit: 1 })).toBe(1)
    expect(resolvePageLimit({ limit: MESSAGE_CAP })).toBe(MESSAGE_CAP)
    for (const invalid of [0, -1, MESSAGE_CAP + 1, 1.5]) {
      expect(() => resolvePageLimit({ limit: invalid })).toThrow(TeamProjectionError)
    }
  })
})

describe('roster join semantics', () => {
  const boundChild = (id: string, memberId: string, label: string, role: 'leader' | 'teammate' = 'teammate'): TeamChildCorpus => ({
    id: sid(id),
    header: header({ id: sid(id), parentSession: sid('leader'), origin: 'subagent' }),
    label,
    events: [ev('team/member-bound', { memberId, role }, 0, 5)],
  })

  it('publishes never-bound roster teammates as unbound rows with roster naming', () => {
    const corpus: TeamCorpus = { leader: { header: header({ id: sid('leader') }), events: [] }, children: [] }
    const view = fold(corpus, roster([
      { id: 'leader', role: 'leader' },
      { id: 'backend', name: 'Backend' },
      { id: 'idle-one', name: 'Idle' },
    ])).view
    expect(view.rosterMemberCount).toBe(3)
    const idle = view.members.find(member => member.memberId === 'idle-one')
    expect(idle).toMatchObject({ status: 'unbound', sessionIds: [], name: 'Idle', pendingControlCount: 0 })
    expect('currentAction' in (idle ?? {})).toBe(false)
  })

  it('anchors the leader row on the leader session and never settles it', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [
        ev('tool/call', { turn: 1, step: 1, callId: 'c', name: 'list_teammates', arguments: '{}' }, 0, 6),
      ] },
      children: [],
    }
    const view = fold(corpus, roster([{ id: 'captain', role: 'leader', name: 'Captain' }])).view
    expect(view.members[0]).toMatchObject({
      memberId: 'captain', name: 'Captain', role: 'leader', sessionIds: ['leader'], status: 'bound',
      currentAction: 'list_teammates',
    })
  })

  it('falls back to the leader id row when the roster defines no leader', () => {
    const corpus: TeamCorpus = { leader: { header: header({ id: sid('leader') }), events: [] }, children: [] }
    const view = fold(corpus, roster([{ id: 'backend' }])).view
    expect(view.members[0]).toMatchObject({ memberId: 'leader', role: 'leader', sessionIds: ['leader'] })
  })

  it('gives the leader row the leader session id when a teammate definition takes the fallback id', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('lead-1') }), events: [] },
      children: [boundChild('child-r', 'leader', 'team:Rogue')],
    }
    const view = foldTeamView(sid('lead-1'), corpus, roster([
      { id: 'leader', name: 'Rogue' },
      { id: 'backend' },
    ]), neverRunning).view
    expect(view.members[0]).toMatchObject({ memberId: 'lead-1', name: 'leader', role: 'leader', sessionIds: ['lead-1'] })
    expect(view.members.find(member => member.memberId === 'leader')).toMatchObject({
      role: 'teammate', name: 'Rogue', status: 'bound', sessionIds: ['child-r'],
    })
    expect(view.members.map(member => member.memberId)).toEqual(['lead-1', 'leader', 'backend'])
  })

  it('keeps bound-but-derostered members with the label-derived display name', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [] },
      children: [boundChild('child-gone', 'gone', 'team:Gone Member')],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }])).view
    const gone = view.members.find(member => member.memberId === 'gone')
    expect(gone).toMatchObject({ status: 'bound', sessionIds: ['child-gone'], name: 'Gone Member', role: 'teammate' })
  })

  it('derives the bound status baseline and settles on a subagent-settled notice', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [settled('child-a', 0, 20)] },
      children: [boundChild('child-a', 'backend', 'team:Backend')],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    expect(view.members.find(member => member.memberId === 'backend')?.status).toBe('settled')
  })

  it('overlays running from the live probe before the log baseline, leader included', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [settled('child-a', 0, 20)] },
      children: [boundChild('child-a', 'backend', 'team:Backend')],
    }
    const members = roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])
    const running = foldTeamView(sid('leader'), corpus, members, id => id === 'child-a' || id === 'leader').view
    expect(running.members.find(member => member.memberId === 'backend')?.status).toBe('running')
    expect(running.members[0]?.status).toBe('running')
  })

  it('reports the latest tool call name as the current action of the bound session', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [] },
      children: [{
        id: sid('child-a'),
        header: header({ id: sid('child-a'), parentSession: sid('leader'), origin: 'subagent' }),
        label: 'team:Backend',
        events: [
          ev('team/member-bound', { memberId: 'backend', role: 'teammate' }, 0, 5),
          ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{}' }, 1, 6),
          ev('tool/call', { turn: 1, step: 2, callId: 'c2', name: 'read_file', arguments: '{}' }, 2, 7),
        ],
      }],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    expect(view.members.find(member => member.memberId === 'backend')?.currentAction).toBe('read_file')
  })

  it('rebinds a child that bound twice and keeps only the latest binding', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [] },
      children: [{
        id: sid('child-a'),
        header: header({ id: sid('child-a'), parentSession: sid('leader'), origin: 'subagent' }),
        label: 'team:Backend',
        events: [
          ev('team/member-bound', { memberId: 'first', role: 'teammate' }, 0, 5),
          ev('team/member-bound', { memberId: 'second', role: 'teammate' }, 1, 6),
        ],
      }],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }])).view
    // The superseded member stays in the corpus-binding half of the union with
    // no session left to name (a rebinding cannot occur in production — the
    // binding event is appended once per child).
    expect(view.members.find(member => member.memberId === 'first')).toMatchObject({
      status: 'unbound', sessionIds: [],
    })
    expect(view.members.find(member => member.memberId === 'second')?.sessionIds).toEqual(['child-a'])
  })
})

describe('task board fold', () => {
  it('keeps the latest progress per taskId with its event time as the endpoint', () => {
    const corpus: TeamCorpus = {
      leader: { header: header({ id: sid('leader') }), events: [
        ev('team/progress', { taskId: 't1', subject: 'Build', status: 'pending', memberId: 'backend' }, 0, 10),
        ev('team/progress', {
          taskId: 't1', subject: 'Build v2', status: 'in_progress', summary: 'half', memberId: 'backend',
        }, 1, 25),
        ev('team/progress', { taskId: 't2', subject: 'Test', status: 'completed', memberId: 'leader' }, 2, 30),
      ] },
      children: [],
    }
    const view = fold(corpus, roster([{ id: 'leader', role: 'leader' }, { id: 'backend' }])).view
    expect(view.tasks).toEqual([
      { taskId: 't1', subject: 'Build v2', status: 'in_progress', summary: 'half', memberId: 'backend', seq: 1, at: 25 },
      { taskId: 't2', subject: 'Test', status: 'completed', memberId: 'leader', seq: 2, at: 30 },
    ])
  })
})
