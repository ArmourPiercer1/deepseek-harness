// @vitest-environment jsdom
/**
 * Inline team marker row (D14–D16): one compact single line per event kind —
 * progress (subject plus the four-state chip), request (member · tool, the
 * reason, the waiting chip; the plan kind carries its own label), decision
 * (the five-value result plus the optional reason), and message (sender →
 * recipient plus the content). Every row shows the event time, the type
 * marker, and the truncated summary with the full text in the row's title;
 * member names resolve through the authoritative mirror with the raw-id
 * fallback. The click anchors the row in its own session's flow (scroll to
 * center) or switches sessions (D16); a decision whose request the mirror
 * cannot pair renders inert and never opens a session. Includes the en/zh
 * dictionary pairing.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TeamMirror, TeamView } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TeamMarker, type TeamMarkerProps } from '../src/client/TeamMarker.tsx'
import type { TeamMarkerChatData } from '../src/client/team-marker-definition.ts'
import { formatTeamClock } from '../src/client/team-timeline-model.ts'
import { en, zh } from '../src/client/locales.ts'

const LEADER = 'leader-s' as SessionId
const MEMBER = 'm1-s' as SessionId
const AT = 1_700_000_000_000

function view(overrides: Partial<TeamView> = {}): TeamView {
  return {
    teamId: LEADER,
    leaderSessionId: LEADER,
    rosterMemberCount: 3,
    members: [
      {
        memberId: 'leader', name: 'Leader', role: 'leader', sessionIds: [LEADER],
        status: 'bound', pendingControlCount: 0,
      },
      {
        memberId: 'm1', name: 'Alice', role: 'teammate', sessionIds: [MEMBER],
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
    ],
    messages: [],
    messageCount: 0,
    ...overrides,
  }
}

const MIRROR: TeamMirror = { [LEADER]: view() }
const EMPTY_MIRROR: TeamMirror = {}

function markerProps(
  data: TeamMarkerChatData,
  sessionId: SessionId,
  mirror: TeamMirror = MIRROR,
  overrides: { openSession?: (id: string) => void; dict?: Record<string, string> } = {},
): TeamMarkerProps {
  return {
    node: {
      key: `11:team-marker${data.seq}`,
      kind: 'team-marker',
      id: `id-${data.seq}`,
      target: 'chat',
      anchorSeq: data.seq,
      location: { kind: 'unresolved' },
      visibility: 'visible',
      data,
    },
    sessionId,
    useTeamMirror: (selector: (m: TeamMirror) => TeamView | undefined) => selector(mirror),
    openSession: overrides.openSession ?? vi.fn(),
    t: makeTranslate(overrides.dict ?? zh),
  } as unknown as TeamMarkerProps
}

/** Read the row's visible segments off the rendered DOM. */
function segments(container: HTMLElement) {
  const row = container.querySelector('[data-team-marker]')
  if (row === null) throw new Error('no marker row rendered')
  const state = row.querySelector('[data-marker-state]')
  return {
    row,
    time: row.querySelector('[data-marker-time]')?.textContent,
    label: row.querySelector('[data-marker-label]')?.textContent,
    actor: row.querySelector('[data-marker-actor]')?.textContent ?? null,
    summary: row.querySelector('[data-marker-summary]')?.textContent,
    stateText: state?.textContent ?? null,
    pending: state?.getAttribute('data-pending') ?? null,
  }
}

/** jsdom ships no scrollIntoView; the anchor click needs the spy target. */
function mockScroll() {
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = (): void => {}
  }
  return vi.spyOn(Element.prototype, 'scrollIntoView')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('progress rows', () => {
  const STATUS: Array<['pending' | 'in_progress' | 'completed' | 'blocked', string]> = [
    ['pending', '待开始'],
    ['in_progress', '进行中'],
    ['completed', '已完成'],
    ['blocked', '受阻'],
  ]

  it('renders subject plus the status chip, the member name off the mirror, and the full text in the title', () => {
    const data: TeamMarkerChatData = {
      type: 'progress', seq: 1, at: AT, taskId: 't1', subject: '调研竞对',
      status: 'in_progress', summary: '已完成一半', memberId: 'm1',
    }
    const { container } = render(<TeamMarker {...markerProps(data, MEMBER)} />)
    const s = segments(container)
    expect(s.row.getAttribute('data-marker-type')).toBe('progress')
    expect(s.time).toBe(formatTeamClock(AT))
    expect(s.label).toBe('进度')
    expect(s.actor).toBe('Alice')
    expect(s.summary).toBe('调研竞对')
    expect(s.stateText).toBe('进行中')
    expect(s.pending).toBe('false')
    // The truncated summary keeps the full text in the row's title.
    expect(s.row.getAttribute('title')).toBe('调研竞对 — 已完成一半')
  })

  it.each(STATUS)('labels every progress status (%s)', (status, label) => {
    const data: TeamMarkerChatData = {
      type: 'progress', seq: 2, at: AT, taskId: 't2', subject: 's', status, memberId: 'm1',
    }
    const { container } = render(<TeamMarker {...markerProps(data, MEMBER)} />)
    expect(segments(container).stateText).toBe(label)
  })

  it('keeps the title bare when the event carried no summary', () => {
    const data: TeamMarkerChatData = {
      type: 'progress', seq: 3, at: AT, taskId: 't3', subject: '归档', status: 'pending', memberId: 'm1',
    }
    const { container } = render(<TeamMarker {...markerProps(data, MEMBER)} />)
    expect(segments(container).row.getAttribute('title')).toBe('归档')
  })
})

describe('request rows', () => {
  it('renders member · tool, the reason, and the waiting chip for a tool request', () => {
    const data: TeamMarkerChatData = {
      type: 'request', seq: 4, at: AT, requestId: 'r1', memberId: 'm1',
      toolName: 'bash', reason: '需要推送到远端', requestKind: 'tool',
    }
    const { container } = render(<TeamMarker {...markerProps(data, MEMBER)} />)
    const s = segments(container)
    expect(s.row.getAttribute('data-marker-type')).toBe('request')
    expect(s.label).toBe('审批')
    expect(s.actor).toBe('Alice · bash')
    expect(s.summary).toBe('需要推送到远端')
    expect(s.stateText).toBe('等待裁决')
    expect(s.pending).toBe('true')
    expect(s.row.getAttribute('title')).toBe('bash · 需要推送到远端')
  })

  it('labels a plan request with the plan-approval marker', () => {
    const data: TeamMarkerChatData = {
      type: 'request', seq: 5, at: AT, requestId: 'r2', memberId: 'm1',
      toolName: 'plan', reason: 'r', requestKind: 'plan',
    }
    const { container } = render(<TeamMarker {...markerProps(data, MEMBER)} />)
    expect(segments(container).label).toBe('计划审批')
  })
})

describe('decision rows', () => {
  const DECISIONS: Array<[['allow_once', 'deny', 'escalate_to_user', 'approve_plan', 'request_revision'][number], string]> = [
    ['allow_once', '单次允许'],
    ['deny', '拒绝'],
    ['escalate_to_user', '升级给用户'],
    ['approve_plan', '批准计划'],
    ['request_revision', '要求修订'],
  ]

  it('renders the five-value result with the reason, no actor segment', () => {
    const data: TeamMarkerChatData = {
      type: 'decision', seq: 6, at: AT, requestId: 'r1',
      decision: 'request_revision', reason: '范围收窄一点',
    }
    const { container } = render(<TeamMarker {...markerProps(data, LEADER)} />)
    const s = segments(container)
    expect(s.row.getAttribute('data-marker-type')).toBe('decision')
    expect(s.label).toBe('裁决')
    expect(s.actor).toBeNull()
    expect(s.summary).toBe('范围收窄一点')
    expect(s.stateText).toBe('要求修订')
    expect(s.pending).toBe('false')
    expect(s.row.getAttribute('title')).toBe('范围收窄一点')
  })

  it.each(DECISIONS)('labels every decision value (%s)', (decision, label) => {
    const data: TeamMarkerChatData = {
      type: 'decision', seq: 7, at: AT, requestId: 'r1', decision,
    }
    const { container } = render(<TeamMarker {...markerProps(data, LEADER)} />)
    const s = segments(container)
    expect(s.stateText).toBe(label)
    // A reason-less decision shows an empty summary and an empty title.
    expect(s.summary).toBe('')
    expect(s.row.getAttribute('title')).toBe('')
  })
})

describe('message rows', () => {
  it('renders sender → recipient plus the content, without a state chip', () => {
    const data: TeamMarkerChatData = {
      type: 'message', seq: 8, at: AT, from: 'm1', to: 'leader', message: '进度已同步',
    }
    const { container } = render(<TeamMarker {...markerProps(data, MEMBER)} />)
    const s = segments(container)
    expect(s.row.getAttribute('data-marker-type')).toBe('message')
    expect(s.label).toBe('消息')
    expect(s.actor).toBe('Alice → Leader')
    expect(s.summary).toBe('进度已同步')
    expect(s.stateText).toBeNull()
    expect(s.row.getAttribute('title')).toBe('进度已同步')
  })
})

describe('mirror resolution and inert rows', () => {
  it('falls back to the raw member id when the mirror view is absent or the member unknown', () => {
    const absent: TeamMarkerChatData = {
      type: 'progress', seq: 9, at: AT, taskId: 't', subject: 's', status: 'pending', memberId: 'm1',
    }
    const noView = render(<TeamMarker {...markerProps(absent, MEMBER, EMPTY_MIRROR)} />)
    expect(segments(noView.container).actor).toBe('m1')
    noView.unmount()

    const ghost: TeamMarkerChatData = {
      type: 'progress', seq: 10, at: AT, taskId: 't', subject: 's', status: 'pending', memberId: 'ghost',
    }
    const unknown = render(<TeamMarker {...markerProps(ghost, MEMBER)} />)
    expect(segments(unknown.container).actor).toBe('ghost')
  })

  it('renders a decision inert — disabled and never opening a session — when the mirror cannot pair the request', () => {
    const unknownPair: TeamMarkerChatData = {
      type: 'decision', seq: 11, at: AT, requestId: 'r9', decision: 'deny',
    }
    const openSession = vi.fn()
    const withPair = render(<TeamMarker {...markerProps(unknownPair, LEADER, MIRROR, { openSession })} />)
    const inert = segments(withPair.container)
    expect(inert.row.hasAttribute('disabled')).toBe(true)
    fireEvent.click(inert.row)
    expect(openSession).not.toHaveBeenCalled()
    withPair.unmount()

    const noMirror = render(<TeamMarker {...markerProps(unknownPair, LEADER, EMPTY_MIRROR, { openSession })} />)
    expect(segments(noMirror.container).row.hasAttribute('disabled')).toBe(true)
  })
})

describe('D16 click', () => {
  it('anchors the row in its own session: scroll the flow seat to center, no session switch', () => {
    const data: TeamMarkerChatData = {
      type: 'progress', seq: 12, at: AT, taskId: 't', subject: 's', status: 'in_progress', memberId: 'm1',
    }
    const openSession = vi.fn()
    const scroll = mockScroll()
    const { container } = render(
      <div data-chat-anchor-key="seat-12">
        <TeamMarker {...markerProps(data, MEMBER, MIRROR, { openSession })} />
      </div>,
    )
    fireEvent.click(segments(container).row)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ block: 'center' })
    expect(openSession).not.toHaveBeenCalled()
  })

  it('scrolls nothing (and switches nothing) when no flow seat wraps the row', () => {
    const data: TeamMarkerChatData = {
      type: 'message', seq: 13, at: AT, from: 'm1', to: 'leader', message: 'hi',
    }
    const openSession = vi.fn()
    const scroll = mockScroll()
    const { container } = render(<TeamMarker {...markerProps(data, MEMBER, MIRROR, { openSession })} />)
    fireEvent.click(segments(container).row)
    expect(scroll).not.toHaveBeenCalled()
    expect(openSession).not.toHaveBeenCalled()
  })

  it('switches to the related session for a cross-session target (the decision pairs to the request member)', () => {
    const data: TeamMarkerChatData = {
      type: 'decision', seq: 14, at: AT, requestId: 'r1', decision: 'deny',
    }
    const openSession = vi.fn()
    const scroll = mockScroll()
    const { container } = render(<TeamMarker {...markerProps(data, LEADER, MIRROR, { openSession })} />)
    fireEvent.click(segments(container).row)
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith('m1-s')
    expect(scroll).not.toHaveBeenCalled()
  })
})

describe('locale pairing', () => {
  it('renders the en dictionary for the row labels and states', () => {
    const data: TeamMarkerChatData = {
      type: 'request', seq: 15, at: AT, requestId: 'r1', memberId: 'm1',
      toolName: 'bash', reason: 'need to push', requestKind: 'tool',
    }
    const { container } = render(<TeamMarker {...markerProps(data, MEMBER, MIRROR, { dict: en })} />)
    const s = segments(container)
    expect(s.label).toBe('Approval')
    expect(s.stateText).toBe('Pending decision')

    const decision: TeamMarkerChatData = { type: 'decision', seq: 16, at: AT, requestId: 'r1', decision: 'deny' }
    const decided = render(<TeamMarker {...markerProps(decision, LEADER, MIRROR, { dict: en })} />)
    expect(segments(decided.container).label).toBe('Decision')
    expect(segments(decided.container).stateText).toBe('Denied')
    decided.unmount()

    const message: TeamMarkerChatData = { type: 'message', seq: 17, at: AT, from: 'm1', to: 'leader', message: 'done' }
    const sent = render(<TeamMarker {...markerProps(message, MEMBER, MIRROR, { dict: en })} />)
    expect(segments(sent.container).label).toBe('Message')
    expect(segments(sent.container).actor).toBe('Alice → Leader')
  })
})
