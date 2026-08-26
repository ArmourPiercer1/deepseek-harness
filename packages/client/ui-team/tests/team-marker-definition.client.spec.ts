// @vitest-environment jsdom
/**
 * The inline team marker Definition (D14/D15): per-event rows over the four
 * durable team event types — identity extraction, row data, deterministic
 * replay (same log, same output), and the D16 jump-target resolution model.
 * Also asserts the old whole-card `team-panel` renderer kind is gone from
 * the ChatNodeKind merge (the whole-card path was removed).
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ConversationNodeAssembler, conversationContextKey,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ChatConversationViewNode, ConversationEventInput, ConversationMatch,
  ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeKind } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TeamView } from '@deepseek-ai/dsh-client-runtime/client'
import type { TeamProgressStatus } from '@deepseek-ai/dsh-team'
import {
  teamMarkerData, teamMarkerDefinition, teamMarkerId,
} from '../src/client/team-marker-definition.ts'
import { resolveTeamMarkerJump } from '../src/client/team-marker-jump.ts'

interface ChatSnapshot {
  readonly nodes: ReadonlyMap<string, ChatConversationViewNode>
}

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [teamMarkerDefinition] }
  fallbackEntry(): undefined { return undefined }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [chatViewDefinition] }
}

const chatViewDefinition: ConversationViewDefinition<ChatConversationViewNode, ChatSnapshot> = {
  target: 'chat',
  create: () => {
    let nodes = new Map<string, ChatConversationViewNode>()
    const snapshot = (): ChatSnapshot => ({ nodes })
    return {
      empty: snapshot(),
      replace: ({ nodes: values }) => {
        nodes = new Map(values.map(node => [node.key, node]))
        return snapshot()
      },
      apply: ({ upserts }) => {
        nodes = new Map(nodes)
        for (const node of upserts) nodes.set(node.key, node)
        return snapshot()
      },
    }
  },
}

function at(seq: number, type: string, data: unknown): ConversationEventInput {
  return { event: { seq, time: seq * 100, type, data } as ConversationEventInput['event'], view: undefined }
}

function assembler(entries: readonly ConversationEventInput[], hasMore = false): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, hasMore)
  value.flush()
  return value
}

/** The snapshot node map is a lookup; the flow order is the anchorSeq order. */
function nodes(value: ConversationNodeAssembler): ChatConversationViewNode[] {
  const snapshot = value.snapshot('chat') as ChatSnapshot
  return [...snapshot.nodes.values()].sort((a, b) => a.anchorSeq - b.anchorSeq)
}

function progress(
  seq: number,
  taskId: string,
  status: TeamProgressStatus,
  memberId: string,
  subject?: string,
  summary?: string,
): ConversationEventInput {
  return at(seq, 'team/progress', {
    taskId, subject: subject ?? taskId, status, memberId,
    ...(summary === undefined ? {} : { summary }),
  })
}

function request(seq: number, requestId: string, memberId: string, kind?: 'tool' | 'plan'): ConversationEventInput {
  return at(seq, 'team/control-request', {
    requestId, memberId, toolName: 'bash', reason: 'need to push',
    ...(kind === undefined ? {} : { kind }),
  })
}

function decision(seq: number, requestId: string, value: string, reason?: string): ConversationEventInput {
  return at(seq, 'team/control-decision', {
    requestId, decision: value,
    ...(reason === undefined ? {} : { reason }),
  })
}

function message(seq: number, from: string, to: string, text: string): ConversationEventInput {
  return at(seq, 'team/message', { from, to, message: text })
}

describe('team-marker Conversation Definition', () => {
  it('extracts the per-event id for each marker type and throws on a non-matching event', () => {
    expect(teamMarkerId(progress(1, 't1', 'pending', 'm1').event)).toBe('progress:t1:1')
    expect(teamMarkerId(request(2, 'r1', 'm1', 'plan').event)).toBe('request:r1:2')
    expect(teamMarkerId(decision(3, 'r1', 'deny').event)).toBe('decision:r1:3')
    expect(teamMarkerId(message(4, 'a', 'b', 'hi').event)).toBe('message:4')
    // match() narrows before calling; a non-matching event names a definition bug.
    expect(() => teamMarkerId(at(5, 'turn/start', { turn: 1 }).event)).toThrow(/unmatched event type/)
  })

  it('matches only the four team event types, one unique start per event', () => {
    expect(teamMarkerDefinition.match(progress(2, 't1', 'pending', 'm1').event))
      .toEqual({ id: 'progress:t1:2', role: 'start' })
    expect(teamMarkerDefinition.match(request(3, 'r1', 'm1').event))
      .toEqual({ id: 'request:r1:3', role: 'start' })
    expect(teamMarkerDefinition.match(request(4, 'r1', 'm1', 'plan').event))
      .toEqual({ id: 'request:r1:4', role: 'start' })
    expect(teamMarkerDefinition.match(decision(5, 'r1', 'deny').event))
      .toEqual({ id: 'decision:r1:5', role: 'start' })
    expect(teamMarkerDefinition.match(message(6, 'a', 'b', 'hi').event))
      .toEqual({ id: 'message:6', role: 'start' })
    expect(teamMarkerDefinition.match(at(1, 'turn/start', { turn: 1 }).event)).toBeNull()
    expect(teamMarkerDefinition.match(at(
      7, 'tool/call', { turn: 1, step: 1, callId: 'c7', name: 'delegate_to_teammate', arguments: '{}' },
    ).event)).toBeNull()
    expect(teamMarkerDefinition.match(at(8, 'team/member-bound', { memberId: 'm1', role: 'teammate' }).event)).toBeNull()
  })

  it('renders one row per event: same taskId twice is two rows, a request and its decision are two rows', () => {
    const value = assembler([
      progress(1, 't1', 'pending', 'm1'),
      progress(2, 't1', 'in_progress', 'm1'),
      request(3, 'r1', 'm1'),
      decision(4, 'r1', 'deny'),
      message(5, 'm1', 'leader', 'done'),
    ])
    const rows = nodes(value)
    expect(rows).toHaveLength(5)
    expect(rows.map(row => row.id)).toEqual([
      'progress:t1:1', 'progress:t1:2', 'request:r1:3', 'decision:r1:4', 'message:5',
    ])
    expect(rows.every(row => row.kind === 'team-marker')).toBe(true)
    expect(rows[0]?.anchorSeq).toBe(1)
    expect(rows[3]?.anchorSeq).toBe(4)
  })

  it('builds each row kind with the payload facts (brand stripped, request kind defaulted)', () => {
    const value = assembler([
      progress(1, 't1', 'in_progress', 'm1', 'Build', 'half way'),
      request(2, 'r1', 'm1', 'plan'),
      decision(3, 'r1', 'request_revision', 'tighten the scope'),
      message(4, 'leader', 'm1', 'report back'),
    ])
    expect(nodes(value).map(row => row.data)).toEqual([
      {
        type: 'progress', seq: 1, at: 100, taskId: 't1', subject: 'Build',
        status: 'in_progress', summary: 'half way', memberId: 'm1',
      },
      {
        type: 'request', seq: 2, at: 200, requestId: 'r1', memberId: 'm1',
        toolName: 'bash', reason: 'need to push', requestKind: 'plan',
      },
      {
        type: 'decision', seq: 3, at: 300, requestId: 'r1',
        decision: 'request_revision', reason: 'tighten the scope',
      },
      { type: 'message', seq: 4, at: 400, from: 'leader', to: 'm1', message: 'report back' },
    ])
    // The absent summary/reason stay absent, and the request kind defaults to tool.
    const bare = assembler([
      progress(1, 't2', 'pending', 'm2'),
      request(2, 'r2', 'm2'),
      decision(3, 'r2', 'allow_once'),
    ])
    expect(nodes(bare).map(row => row.data)).toEqual([
      { type: 'progress', seq: 1, at: 100, taskId: 't2', subject: 't2', status: 'pending', memberId: 'm2' },
      {
        type: 'request', seq: 2, at: 200, requestId: 'r2', memberId: 'm2',
        toolName: 'bash', reason: 'need to push', requestKind: 'tool',
      },
      { type: 'decision', seq: 3, at: 300, requestId: 'r2', decision: 'allow_once' },
    ])
  })

  it('renders nothing when the window carries no team event', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'team/member-bound', { memberId: 'm1', role: 'teammate' }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'c3', name: 'bash', arguments: '{}' }),
    ])
    expect(nodes(value)).toHaveLength(0)
  })

  it('replays deterministically: same log through replace or live append gives the same output', () => {
    const events = [
      progress(1, 't1', 'pending', 'm1'),
      message(2, 'leader', 'm1', 'go'),
      progress(3, 't1', 'completed', 'm1', 'Build', 'done'),
    ]
    const complete = nodes(assembler(events)).map(row => ({ key: row.key, id: row.id, anchorSeq: row.anchorSeq, data: row.data }))
    const live = assembler(events.slice(0, 2))
    for (const event of events.slice(2)) live.append(event)
    live.flush()
    expect(nodes(live).map(row => ({ key: row.key, id: row.id, anchorSeq: row.anchorSeq, data: row.data })))
      .toEqual(complete)
    // A second cold replace over the same log reproduces the snapshot byte for byte.
    expect(nodes(assembler(events)).map(row => ({ key: row.key, id: row.id, data: row.data })))
      .toEqual(complete.map(row => ({ key: row.key, id: row.id, data: row.data })))
  })

  it('prepends an older page: earlier rows join, existing rows keep key and data', () => {
    const events = [
      progress(1, 't1', 'pending', 'm1'),
      progress(2, 't1', 'in_progress', 'm1'),
      decision(3, 'r0', 'deny'),
    ]
    const value = assembler(events.slice(1), true)
    const before = nodes(value).map(row => ({ key: row.key, data: row.data }))
    value.prepend(events.slice(0, 1), false)
    value.flush()
    const after = nodes(value).map(row => ({ key: row.key, data: row.data }))
    expect(after).toHaveLength(3)
    expect(after.slice(1)).toEqual(before)
    expect(after[0]?.data).toEqual({
      type: 'progress', seq: 1, at: 100, taskId: 't1', subject: 't1', status: 'pending', memberId: 'm1',
    })
  })

  it('stays stable when a turn boundary re-resolves the window', () => {
    const events = [
      at(1, 'turn/start', { turn: 1 }),
      progress(2, 't1', 'pending', 'm1'),
      at(3, 'turn/end', { turn: 1 }),
    ]
    const first = assembler(events.slice(0, 2))
    first.append(events[2] as ConversationEventInput)
    first.flush()
    expect(nodes(first).map(row => row.id)).toEqual(['progress:t1:2'])
  })

  it('builds the node from State, and builds nothing before a start exists', () => {
    const match: ConversationMatch = {
      event: progress(4, 't1', 'in_progress', 'm1').event,
      view: undefined,
      role: 'start',
      location: { kind: 'unresolved' },
    }
    const reader: Parameters<typeof teamMarkerDefinition.start>[2] = { previous: () => undefined }
    const context: Parameters<typeof teamMarkerDefinition.start>[0] = {
      key: conversationContextKey('team-marker', 'progress:t1:4'),
      kind: 'team-marker',
      id: 'progress:t1:4',
      matches: [match],
      start: match,
      state: undefined,
      current: new Map(),
    }
    const state = teamMarkerDefinition.start(context, match, reader)
    expect(state).toEqual({
      type: 'progress', seq: 4, at: 400, taskId: 't1', subject: 't1',
      status: 'in_progress', memberId: 'm1',
    })
    // update re-derives from its match: idempotent for the same event, so a
    // replay can never drift from the start-built value.
    expect(teamMarkerDefinition.update({ ...context, state }, match)).toEqual(state)
    expect(teamMarkerDefinition.buildViewNode?.(context)).toBeNull()
    const node = teamMarkerDefinition.buildViewNode?.({ ...context, state })
    expect(node).toEqual({
      key: context.key,
      kind: 'team-marker',
      id: 'progress:t1:4',
      target: 'chat',
      anchorSeq: 4,
      location: { kind: 'unresolved' },
      visibility: 'visible',
      data: state,
    })
    expect(teamMarkerDefinition.buildViewNode?.({ ...context, state, start: undefined })).toBeNull()
  })

  it('refuses to fold an event the match cannot produce', () => {
    expect(() => teamMarkerData(at(1, 'turn/start', { turn: 1 }).event)).toThrow(/unmatched event type/)
  })
})

describe('D16 jump target resolution', () => {
  const view: TeamView = {
    teamId: 'team-1',
    leaderSessionId: 'leader-s',
    rosterMemberCount: 2,
    members: [
      {
        memberId: 'leader', name: 'Leader', role: 'leader', sessionIds: ['leader-s'],
        status: 'running', pendingControlCount: 0,
      },
      {
        memberId: 'm1', name: 'Alice', role: 'teammate', sessionIds: ['m1-s'],
        status: 'running', pendingControlCount: 1,
      },
      {
        memberId: 'm2', name: 'Bob', role: 'teammate', sessionIds: [],
        status: 'unbound', pendingControlCount: 0,
      },
    ],
    delegations: [],
    tasks: [],
    approvals: [
      { requestId: 'r1', memberId: 'm1', toolName: 'bash', reason: 'need to push', requestedAt: 100 },
      { requestId: 'r2', memberId: 'm2', toolName: 'bash', reason: 'need to pull', requestedAt: 200 },
    ],
    messages: [],
    messageCount: 0,
  }

  it('targets the assigned member session for progress and request rows', () => {
    expect(resolveTeamMarkerJump({
      type: 'progress', seq: 1, at: 100, taskId: 't1', subject: 's', status: 'pending', memberId: 'm1',
    }, view, 'leader-s')).toEqual({ sessionId: 'm1-s', ownSession: false })
    expect(resolveTeamMarkerJump({
      type: 'progress', seq: 1, at: 100, taskId: 't1', subject: 's', status: 'pending', memberId: 'm1',
    }, view, 'm1-s')).toEqual({ sessionId: 'm1-s', ownSession: true })
    expect(resolveTeamMarkerJump({
      type: 'request', seq: 2, at: 200, requestId: 'r1', memberId: 'm1',
      toolName: 'bash', reason: 'r', requestKind: 'tool',
    }, view, 'm1-s')).toEqual({ sessionId: 'm1-s', ownSession: true })
  })

  it('falls back to the row session when the member is unbound or the mirror is absent', () => {
    expect(resolveTeamMarkerJump({
      type: 'progress', seq: 1, at: 100, taskId: 't1', subject: 's', status: 'pending', memberId: 'm2',
    }, view, 'leader-s')).toEqual({ sessionId: 'leader-s', ownSession: true })
    expect(resolveTeamMarkerJump({
      type: 'progress', seq: 1, at: 100, taskId: 't1', subject: 's', status: 'pending', memberId: 'm1',
    }, undefined, 'leader-s')).toEqual({ sessionId: 'leader-s', ownSession: true })
  })

  it('pairs the decision through the mirror and renders inert when the pair is unknown or unbound', () => {
    expect(resolveTeamMarkerJump({
      type: 'decision', seq: 3, at: 300, requestId: 'r1', decision: 'deny',
    }, view, 'leader-s')).toEqual({ sessionId: 'm1-s', ownSession: false })
    expect(resolveTeamMarkerJump({
      type: 'decision', seq: 3, at: 300, requestId: 'r9', decision: 'deny',
    }, view, 'leader-s')).toEqual({ sessionId: '', ownSession: false })
    // The pair exists but its member carries no bound session: inert, same as unknown.
    expect(resolveTeamMarkerJump({
      type: 'decision', seq: 4, at: 400, requestId: 'r2', decision: 'deny',
    }, view, 'leader-s')).toEqual({ sessionId: '', ownSession: false })
    expect(resolveTeamMarkerJump({
      type: 'decision', seq: 3, at: 300, requestId: 'r1', decision: 'deny',
    }, undefined, 'leader-s')).toEqual({ sessionId: '', ownSession: false })
  })

  it('keeps the message on its recording session (the row session)', () => {
    expect(resolveTeamMarkerJump({
      type: 'message', seq: 4, at: 400, from: 'leader', to: 'm1', message: 'go',
    }, view, 'leader-s')).toEqual({ sessionId: 'leader-s', ownSession: true })
    expect(resolveTeamMarkerJump({
      type: 'message', seq: 4, at: 400, from: 'm1', to: 'leader', message: 'done',
    }, undefined, 'm1-s')).toEqual({ sessionId: 'm1-s', ownSession: true })
  })
})

describe('whole-card removal', () => {
  it('no longer contributes the team-panel renderer kind to the ChatNodeKind merge', () => {
    expectTypeOf<'team-panel'>().not.toExtend<ChatNodeKind>()
    expectTypeOf<'team-marker'>().toExtend<ChatNodeKind>()
    expect(teamMarkerDefinition.kind).toBe('team-marker')
    expect(teamMarkerDefinition.target).toBe('chat')
  })
})
