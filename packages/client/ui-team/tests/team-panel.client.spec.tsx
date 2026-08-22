// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ConversationEventRegistry, ConversationNodeAssembler, SlotRegistry,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ChatConversationViewNode, ConversationEventInput, ConversationMatch, ConversationNodeDefinition,
  ConversationViewDefinition, SessionId, SessionListState, SubagentCatalogSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { TeamProgressStatus } from '@deepseek-ai/dsh-team'
import { TeamPanel, type TeamPanelProps } from '../src/client/TeamPanel.tsx'
import { apply, inject } from '../src/client/index.ts'
import { TeamSettingsSection } from '../src/client/TeamSettingsSection.tsx'
import { zh } from '../src/client/locales.ts'
import {
  foldTeamBoard, teamPanelDefinition, type TeamPanelChatData,
} from '../src/client/team-definition.ts'
import { apply as applyNode } from '../src/index.ts'
import { apply as applyInvariant } from '../src/invariant.ts'
import type {} from '../src/client/index.ts'

afterEach(cleanup)

const PARENT_ID = 'leader' as SessionId
const ALICE_ID = 'alice-child' as SessionId
const BOB_ID = 'bob-child' as SessionId
const CAROL_ID = 'carol-child' as SessionId
const GUEST_ID = 'guest-child' as SessionId
const PLAIN_ID = 'plain-child' as SessionId

interface ChatSnapshot {
  readonly nodes: ReadonlyMap<string, ChatConversationViewNode>
}

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [teamPanelDefinition] }
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

function teamNode(value: ConversationNodeAssembler): ChatConversationViewNode | undefined {
  const snapshot = value.snapshot('chat') as ChatSnapshot
  return [...snapshot.nodes.values()][0]
}

function teamData(value: ConversationNodeAssembler): TeamPanelChatData | undefined {
  return teamNode(value)?.data as TeamPanelChatData | undefined
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

function delegateCall(seq: number, argumentsValue: string): ConversationEventInput {
  return at(seq, 'tool/call', {
    turn: 1, step: 1, callId: `call-${seq}`, name: 'delegate_to_teammate', arguments: argumentsValue,
  })
}

function completeEvents(): ConversationEventInput[] {
  return [
    at(1, 'turn/start', { turn: 1 }),
    progress(2, 't2', 'pending', 'm2'),
    delegateCall(3, JSON.stringify({ teammate_id: 'alice', prompt: 'research' })),
    progress(4, 't1', 'in_progress', 'm1', 'first', 'half way'),
    progress(5, 't1', 'completed', 'm1', 'first', 'done'),
    delegateCall(6, JSON.stringify({ teammate_id: 'alice', prompt: 'follow up' })),
    progress(7, 't2', 'in_progress', 'm2'),
    at(8, 'tool/call', {
      turn: 1, step: 1, callId: 'call-8', name: 'team_progress', arguments: '{}',
    }),
  ]
}

describe('team-panel Conversation Definition', () => {
  it('folds the latest event per taskId in first-seen order and collects delegate targets', () => {
    const value = assembler(completeEvents())
    expect(teamData(value)).toEqual({
      tasks: [
        { taskId: 't2', subject: 't2', status: 'in_progress', memberId: 'm2', seq: 7 },
        { taskId: 't1', subject: 'first', status: 'completed', memberId: 'm1', summary: 'done', seq: 5 },
      ],
      delegated: ['alice'],
    })
    const node = teamNode(value)
    expect(node?.kind).toBe('team-panel')
    expect(node?.id).toBe('board')
    expect(node?.anchorSeq).toBe(2)
  })

  it('produces the same final data and node identity through live append as complete replay', () => {
    const events = completeEvents()
    const value = assembler(events.slice(0, 4))
    for (const event of events.slice(4)) value.append(event)
    value.flush()
    const complete = teamNode(assembler(events))
    expect(teamNode(value)?.key).toBe(complete?.key)
    expect(teamData(value)).toEqual(teamData(assembler(events)))
  })

  it('prepends an older page, relocates the anchor, and preserves the node key', () => {
    const value = assembler(completeEvents().slice(2), true)
    const before = teamNode(value)
    expect(before?.anchorSeq).toBe(3)
    expect(teamData(value)?.tasks.map(task => task.taskId)).toEqual(['t1', 't2'])
    value.prepend(completeEvents().slice(0, 2), false)
    value.flush()
    const after = teamNode(value)
    expect(after?.key).toBe(before?.key)
    expect(after?.anchorSeq).toBe(2)
    expect(teamData(value)?.tasks.map(task => task.taskId)).toEqual(['t2', 't1'])
  })

  it('renders nothing when the window carries no team event', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'tool/call', { turn: 1, step: 1, callId: 'c2', name: 'team_progress', arguments: '{}' }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'c3', name: 'bash', arguments: '{}' }),
    ])
    expect((value.snapshot('chat') as ChatSnapshot).nodes.size).toBe(0)
  })

  it('ignores unparseable and malformed delegate arguments at the model JSON boundary', () => {
    const onlyInvalid = assembler([
      delegateCall(1, '{not json'),
      delegateCall(2, '42'),
      delegateCall(3, JSON.stringify({ prompt: 'missing id' })),
      delegateCall(4, JSON.stringify({ teammate_id: 42 })),
      delegateCall(5, JSON.stringify({ teammate_id: '' })),
    ])
    expect((onlyInvalid.snapshot('chat') as ChatSnapshot).nodes.size).toBe(0)

    const mixed = assembler([
      delegateCall(1, '{not json'),
      delegateCall(2, JSON.stringify({ teammate_id: 'alice', prompt: 'p' })),
    ])
    expect(teamData(mixed)?.delegated).toEqual(['alice'])
  })

  it('matches only team events and folds identically from start, update, and view build', () => {
    expect(teamPanelDefinition.match(at(1, 'turn/start', { turn: 1 }).event)).toBeNull()
    expect(teamPanelDefinition.match(progress(2, 't1', 'pending', 'm1').event)).toEqual({ id: 'board', role: 'update' })
    expect(teamPanelDefinition.match(delegateCall(3, JSON.stringify({ teammate_id: 'a' })).event)).toEqual({ id: 'board', role: 'update' })
    expect(teamPanelDefinition.match(at(
      4, 'tool/call', { turn: 1, step: 1, callId: 'c4', name: 'bash', arguments: '{}' },
    ).event)).toBeNull()

    const m1: ConversationMatch = {
      event: progress(2, 't1', 'in_progress', 'm1').event,
      view: undefined,
      role: 'update',
      location: { kind: 'unresolved' },
    }
    const m2: ConversationMatch = {
      event: delegateCall(3, JSON.stringify({ teammate_id: 'a' })).event,
      view: undefined,
      role: 'update',
      location: { kind: 'unresolved' },
    }
    const context: Parameters<typeof teamPanelDefinition.start>[0] = {
      key: 'team-panel:board', kind: 'team-panel', id: 'board',
      matches: [m1, m2], start: undefined, state: undefined, current: new Map(),
    }
    const reader: Parameters<typeof teamPanelDefinition.start>[2] = { previous: () => undefined }
    const expected = foldTeamBoard([m1, m2])
    expect(teamPanelDefinition.start(context, m1, reader)).toEqual(expected)
    expect(teamPanelDefinition.update({ ...context, state: expected }, m2)).toEqual(expected)
    const otherTool: ConversationMatch = {
      event: at(5, 'tool/call', {
        turn: 1, step: 1, callId: 'c5', name: 'bash', arguments: '{}',
      }).event,
      view: undefined,
      role: 'update',
      location: { kind: 'unresolved' },
    }
    expect(foldTeamBoard([otherTool])).toEqual({ tasks: [], delegated: [] })

    expect(teamPanelDefinition.buildViewNode?.({ ...context, matches: [] })).toBeNull()
    const malformed: ConversationMatch = {
      event: delegateCall(4, '{broken').event,
      view: undefined,
      role: 'update',
      location: { kind: 'unresolved' },
    }
    expect(teamPanelDefinition.buildViewNode?.({ ...context, matches: [malformed] })).toBeNull()
    const node = teamPanelDefinition.buildViewNode?.(context) as ChatConversationViewNode | null | undefined
    expect(node).not.toBeNull()
    expect(node?.anchorSeq).toBe(2)
    expect((node?.data as TeamPanelChatData).delegated).toEqual(['a'])
    expect(teamPanelDefinition.kind).toBe('team-panel')
    expect(teamPanelDefinition.target).toBe('chat')
  })
})

function panelNode(data: TeamPanelChatData): TeamPanelProps['node'] {
  return {
    key: '2:team-panelboard',
    kind: 'team-panel',
    id: 'board',
    target: 'chat',
    anchorSeq: 2,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data,
  }
}

type CatalogEntry = SubagentCatalogSnapshot['entries'][number]

function teamChild(id: SessionId, name: string, activity: 'running' | 'inactive'): CatalogEntry {
  return { kind: 'child', id, activity, hasChildren: false, mode: 'continuable', label: `team:${name}` }
}

const guestChild: CatalogEntry = {
  kind: 'child', id: GUEST_ID, activity: 'inactive', hasChildren: false, mode: 'one-shot', label: 'generic job',
}
const plainChild: CatalogEntry = {
  kind: 'child', id: PLAIN_ID, activity: 'inactive', hasChildren: false, mode: 'continuable', label: 'plain job',
}

/**
 * Address one catalog snapshot under the leader session id (the branded-key
 * literal widens to a string index, so the one cast lives here).
 * @param catalog - the parent-addressed catalog snapshot.
 * @returns the session-list subagentsByParent record.
 */
function subagents(catalog: SubagentCatalogSnapshot): SessionListState['subagentsByParent'] {
  return { [PARENT_ID]: catalog } as SessionListState['subagentsByParent']
}

function listState(overrides: Partial<SessionListState> = {}): SessionListState {
  return {
    ids: [PARENT_ID],
    byId: {
      [PARENT_ID]: { id: PARENT_ID, displayTitle: 'leader', running: true, blank: false, updatedAt: 0 },
    },
    current: PARENT_ID,
    phase: 'ready',
    subagentsByParent: subagents({
      entries: [
        teamChild(ALICE_ID, 'alice', 'running'),
        teamChild(BOB_ID, 'bob', 'inactive'),
        teamChild(CAROL_ID, 'carol', 'inactive'),
        guestChild,
        plainChild,
      ],
      parentAvailable: true,
      state: 'ready',
      error: null,
    }),
    jobsBySession: {},
    currentAddress: undefined,
    ...overrides,
  }
}

function panelProps(data: TeamPanelChatData, sessions: SessionListState = listState()): TeamPanelProps {
  return {
    node: panelNode(data),
    sessionId: PARENT_ID,
    useSessions: selector => selector(sessions),
    useSession: (() => undefined) as TeamPanelProps['useSession'],
    useProjection: () => undefined,
    useInput: () => { throw new Error('unused') },
    inputActions: { setDraft: () => {}, submit: () => {} } as unknown as TeamPanelProps['inputActions'],
    useWorkspaces: (() => undefined) as TeamPanelProps['useWorkspaces'],
    useTurnData: () => undefined,
    selectedCallId: undefined,
    cwd: undefined,
    openFile: () => {},
    inspectCall: () => {},
    forkAt: () => {},
    renderMessageImages: () => undefined,
    fileMentions: () => undefined,
    t: makeTranslate(zh),
  }
}

const boardData: TeamPanelChatData = {
  tasks: [
    { taskId: 't1', subject: '调研竞对', status: 'in_progress', memberId: 'alice', summary: '已完成一半', seq: 4 },
    { taskId: 't2', subject: '撰写报告', status: 'pending', memberId: 'bob', seq: 6 },
    { taskId: 't3', subject: '归档', status: 'completed', memberId: 'carol', seq: 8 },
  ],
  delegated: ['alice', 'bob'],
}

describe('TeamPanel', () => {
  it('renders teammate rows with window-level status beside the task board', () => {
    const view = render(<TeamPanel {...panelProps(boardData)} />)
    expect(screen.getByText('团队')).toBeTruthy()
    expect(screen.getByText('3 名队员')).toBeTruthy()
    expect(screen.getByText('3 项任务')).toBeTruthy()
    const rows = [...view.container.querySelectorAll('[data-member-status]')]
      .map(row => row.getAttribute('data-member-status'))
    expect(rows).toEqual(['running', 'settled', 'bound'])
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('运行中')).toBeTruthy()
    expect(screen.getByText('已交接')).toBeTruthy()
    expect(screen.getByText('已绑定')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-state="ongoing"]')).toHaveLength(2)
    expect(view.container.querySelectorAll('[data-state="done"]')).toHaveLength(2)
    expect(view.container.querySelectorAll('[data-state="warning"]')).toHaveLength(2)
    expect(view.container.querySelectorAll('[data-state="error"]')).toHaveLength(0)
    expect(screen.getByText('调研竞对')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('待开始')).toBeTruthy()
    expect(screen.getByText('已完成')).toBeTruthy()
    expect(screen.getByText('负责人 alice')).toBeTruthy()
    expect(screen.getByText('负责人 bob')).toBeTruthy()
    expect(screen.getByText('已完成一半')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-task-summary]')).toHaveLength(1)
  })

  it('shows group empty states while an absent catalog still renders the board', () => {
    const absent = render(<TeamPanel {...panelProps(boardData, listState({ subagentsByParent: {} }))} />)
    expect(absent.container.querySelector('[data-teammates-empty]')).toBeTruthy()
    expect(absent.container.querySelectorAll('[data-member-status]')).toHaveLength(0)
    expect(absent.container.querySelectorAll('[data-task-status]')).toHaveLength(3)
    absent.unmount()

    const guestOnly = render(<TeamPanel {...panelProps({ tasks: [], delegated: ['alice'] }, listState({
      subagentsByParent: subagents({
        entries: [guestChild],
        parentAvailable: true,
        state: 'ready',
        error: null,
      }),
    }))} />)
    expect(guestOnly.container.querySelector('[data-teammates-empty]')).toBeTruthy()
    expect(guestOnly.container.querySelector('[data-tasks-empty]')).toBeTruthy()
    expect(screen.getByText('0 名队员')).toBeTruthy()
    expect(screen.getByText('0 项任务')).toBeTruthy()
  })

  it('re-renders rows when node data or the catalog activity changes', () => {
    const view = render(<TeamPanel {...panelProps(boardData)} />)
    const blocked: TeamPanelChatData = {
      ...boardData,
      tasks: [
        boardData.tasks[0]!,
        { taskId: 't2', subject: '撰写报告', status: 'blocked', memberId: 'bob', summary: '缺少数据', seq: 6 },
        boardData.tasks[2]!,
      ],
    }
    view.rerender(<TeamPanel {...panelProps(blocked)} />)
    expect(screen.getByText('受阻')).toBeTruthy()
    expect(screen.getByText('缺少数据')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-state="error"]')).toHaveLength(1)

    const flipped = listState({
      subagentsByParent: subagents({
        entries: [
          teamChild(ALICE_ID, 'alice', 'running'),
          teamChild(BOB_ID, 'bob', 'inactive'),
          teamChild(CAROL_ID, 'carol', 'running'),
        ],
        parentAvailable: true,
        state: 'ready',
        error: null,
      }),
    })
    view.rerender(<TeamPanel {...panelProps(boardData, flipped)} />)
    expect(screen.getAllByText('运行中')).toHaveLength(2)
    expect(screen.getByText('已交接')).toBeTruthy()
  })
})

describe('TeamSettingsSection', () => {
  it('renders the read-only configuration instructions', () => {
    render(<TeamSettingsSection {...({ t: makeTranslate(zh) } as unknown as React.ComponentProps<typeof TeamSettingsSection>)} />)
    expect(screen.getByText('团队成员配置')).toBeTruthy()
    expect(screen.getByText('未配置团队成员')).toBeTruthy()
    expect(screen.getByText('全局：$DSH_HOME/teammates/*.md')).toBeTruthy()
  })
})

describe('plugin lifecycle', () => {
  it('registers and removes the definition, keyed renderer, and settings section with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin(ConversationEventRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.conversationEvents.entries().map(entry => entry.kind)).toEqual(['team-panel'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.chat.node')[0]?.options.key).toBe('team-panel')
    expect(ctx.slots.entries('settings.section')).toHaveLength(1)
    expect(ctx.slots.entries('settings.section')[0]?.options.id).toBe('team')
    expect(resolveSlotLabel(ctx.slots.entries('settings.section')[0]?.options.label)).toBeTypeOf('string')
    await fiber.dispose()
    expect(ctx.conversationEvents.entries()).toEqual([])
    expect(ctx.slots.entries('conversation.chat.node')).toEqual([])
    expect(ctx.slots.entries('settings.section')).toEqual([])

    const replacement = ctx.plugin({ inject: [...inject], apply })
    await replacement.await()
    expect(ctx.conversationEvents.entries().map(entry => entry.kind)).toEqual(['team-panel'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    await replacement.dispose()
  })

  it('keeps the node half inert and registers invariant ownership', async () => {
    applyNode()
    const registered: string[] = []
    const ctx = new Context()
    ctx.provide('invariants')
    ctx.set('invariants', {
      register: (pkg: string) => { registered.push(pkg); return () => {} },
    } as never)
    await applyInvariant(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-client-ui-team'])
  })
})
