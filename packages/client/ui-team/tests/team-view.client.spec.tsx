// @vitest-environment jsdom
/**
 * Team conversation view entry: the frozen team-ness derivation over the
 * leader-keyed mirror, the zero state for a non-team session, the complete
 * four-section body for a team session (timeline, member groups, task
 * board, event stream — all live), the D9 bar-click / member-row /
 * feed-row session switch wiring, and the mirror-gap cold pull.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  ClientResult, TeamMessagePage, TeamMirror, TeamView as TeamWireView,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TeamView, type TeamViewProps } from '../src/client/TeamView.tsx'
import { resolveTeamView } from '../src/client/team-view-model.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn()
})
afterEach(() => {
  delete (Element.prototype as { setPointerCapture?: unknown }).setPointerCapture
})

const LEADER = 'team-leader' as SessionId
const MEMBER = 'team-member' as SessionId
const OUTSIDER = 'plain-session' as SessionId

function wireView(leader: string, delegations: TeamWireView['delegations'] = []): TeamWireView {
  return {
    teamId: leader,
    leaderSessionId: leader,
    rosterMemberCount: 2,
    members: [
      {
        memberId: 'leader', name: 'leader', role: 'leader', sessionIds: [leader],
        status: 'bound', pendingControlCount: 0,
      },
      {
        memberId: 'mate', name: 'mate', role: 'teammate', sessionIds: [MEMBER],
        status: 'running', pendingControlCount: 0,
      },
    ],
    delegations,
    tasks: [],
    approvals: [],
    messages: [],
    messageCount: 0,
  }
}

const LEADER_MIRROR: TeamMirror = { [LEADER]: wireView(LEADER) }
/** One settled delegation into the mate session, far enough in the past that a live clock never extends it. */
const ONE_DELEGATION = wireView(LEADER, [{
  memberId: 'mate',
  childSessionId: MEMBER,
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_090_000,
  inProgress: false,
}])
const DELEGATION_MIRROR: TeamMirror = { [LEADER]: ONE_DELEGATION }

describe('resolveTeamView (frozen team-ness derivation)', () => {
  it('resolves a session by its own leader key or any binding member row, and nothing otherwise', () => {
    expect(resolveTeamView(LEADER_MIRROR, LEADER)).toBe(LEADER_MIRROR[LEADER])
    expect(resolveTeamView(LEADER_MIRROR, MEMBER)).toBe(LEADER_MIRROR[LEADER])
    expect(resolveTeamView(LEADER_MIRROR, OUTSIDER)).toBeUndefined()
    expect(resolveTeamView({}, OUTSIDER)).toBeUndefined()
  })
})

/** An unprogrammed pagination stub fails loud so an accidental page call is visible. */
function unprogrammedPage(): TeamViewProps['pageTeamMessages'] {
  return vi.fn(async (): Promise<ClientResult<TeamMessagePage>> => ({
    ok: false,
    error: { code: 'internal', message: 'page not programmed', details: {} },
  }))
}

function viewProps(mirror: TeamMirror, sessionId: SessionId = LEADER): TeamViewProps {
  return {
    viewRequest: null,
    openView: () => {},
    completeViewRequest: () => {},
    sessionId,
    useSession: (() => undefined) as TeamViewProps['useSession'],
    useProjection: () => undefined,
    useInput: () => { throw new Error('unused') },
    inputActions: { setDraft: () => {}, submit: () => {} } as unknown as TeamViewProps['inputActions'],
    useSessions: () => { throw new Error('unused') },
    useWorkspaces: () => { throw new Error('unused') },
    useSessionPendingInteraction: () => { throw new Error('unused') },
    useConversation: () => { throw new Error('unused') },
    useChat: () => { throw new Error('unused') },
    useTrajectory: () => { throw new Error('unused') },
    useTeamMirror: selector => selector(mirror),
    ensureTeam: vi.fn(() => Promise.resolve()),
    pageTeamMessages: unprogrammedPage(),
    openSession: vi.fn(),
    t: makeTranslate(zh),
  }
}

describe('TeamView', () => {
  it('renders the one-line zero state for a non-team session and cold-pulls once', () => {
    const ensureTeam = vi.fn(() => Promise.resolve())
    const props = { ...viewProps({}, OUTSIDER), ensureTeam }
    render(<TeamView {...props} />)
    expect(screen.getByText('当前会话未加入任何团队')).toBeTruthy()
    expect(props.ensureTeam).toHaveBeenCalledTimes(1)
    expect(props.ensureTeam).toHaveBeenCalledWith(OUTSIDER)
  })

  it('renders all four sections live for a team session', () => {
    const leader = render(<TeamView {...viewProps(LEADER_MIRROR, LEADER)} />)
    expect(leader.container.querySelector('[data-team-view]')).toBeTruthy()
    expect(screen.queryByText('当前会话未加入任何团队')).toBeNull()
    expect(leader.container.querySelectorAll('[data-team-section]')).toHaveLength(4)
    // The timeline section is live: its heading and, with no delegations yet,
    // the one-line cold state (no lane matrix).
    expect(screen.getByText('时间线')).toBeTruthy()
    expect(screen.getByText('暂无委派记录')).toBeTruthy()
    expect(leader.container.querySelector('[data-team-section="timeline"] [data-team-timeline]')).toBeTruthy()
    // The member-group section is live: its heading and the group container rows.
    expect(screen.getByText('成员组')).toBeTruthy()
    expect(leader.container.querySelector('[data-team-section="members"] [data-team-members]')).toBeTruthy()
    expect(leader.container.querySelectorAll('[data-member-group-row]')).toHaveLength(2)
    // The task-board section is live: its heading and the one-line empty state.
    expect(screen.getByText('任务板')).toBeTruthy()
    expect(leader.container.querySelector('[data-team-section="tasks"] [data-tasks-empty]')).toBeTruthy()
    // The event-stream section is live: its heading and the one-line empty state.
    expect(screen.getByText('事件流')).toBeTruthy()
    expect(leader.container.querySelector('[data-team-section="events"] [data-feed-empty]')).toBeTruthy()
    leader.unmount()

    const member = render(<TeamView {...viewProps(LEADER_MIRROR, MEMBER)} />)
    expect(member.container.querySelector('[data-team-view]')).toBeTruthy()
    expect(member.container.querySelector('[data-team-section="timeline"]')).toBeTruthy()
    expect(member.container.querySelector('[data-team-section="members"] [data-team-members]')).toBeTruthy()
    expect(member.container.querySelector('[data-team-section="tasks"] [data-team-tasks]')).toBeTruthy()
    expect(member.container.querySelector('[data-team-section="events"] [data-team-feed]')).toBeTruthy()
  })

  it('switches to the member session when a timeline bar is clicked (D9)', () => {
    const openSession = vi.fn()
    const props = { ...viewProps(DELEGATION_MIRROR, LEADER), openSession }
    const view = render(<TeamView {...props} />)
    const bar = view.container.querySelector<HTMLElement>('[data-team-timeline-bar]')
    if (bar === null) throw new Error('the delegation bar did not render')
    fireEvent.pointerDown(bar, { button: 0, clientX: 5, pointerId: 1 })
    fireEvent.pointerUp(bar, { clientX: 5, pointerId: 1 })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith(MEMBER)
  })

  it('switches to the member session when a member instance row is clicked (D9)', () => {
    const openSession = vi.fn()
    const props = { ...viewProps(LEADER_MIRROR, LEADER), openSession }
    const view = render(<TeamView {...props} />)
    const instance = view.container.querySelector<HTMLButtonElement>('[data-member-instance][data-status="running"]')
    if (instance === null) throw new Error('the running member instance row did not render')
    fireEvent.click(instance)
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith(MEMBER)
  })

  it('switches back to the leader session when the leading leader row is clicked (D10)', () => {
    const openSession = vi.fn()
    const props = { ...viewProps(LEADER_MIRROR, MEMBER), openSession }
    const view = render(<TeamView {...props} />)
    const leader = view.container.querySelector<HTMLButtonElement>('[data-member-group-row][data-leader]')
    if (leader === null) throw new Error('the leading leader row did not render')
    fireEvent.click(leader)
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith(LEADER)
  })

  it('renders the task board and event stream from the view and switches sessions on feed-row click (D9)', () => {
    const openSession = vi.fn()
    const dataView = {
      ...wireView(LEADER),
      tasks: [{
        taskId: 't1', subject: 'Wire the mirror', status: 'in_progress' as const,
        summary: 'Half done', memberId: 'mate', seq: 1, at: 1000,
      }],
      approvals: [{
        requestId: 'r1', memberId: 'mate', toolName: 'write_file', reason: 'need write',
        requestedAt: 2000,
      }],
      messages: [{
        from: 'leader', to: 'mate', message: 'go ahead', at: 3000, seq: 1, sessionId: LEADER,
      }],
      messageCount: 1,
    }
    const props = { ...viewProps({ [LEADER]: dataView }, LEADER), openSession }
    const view = render(<TeamView {...props} />)
    // The task board renders the projection row: subject, status, assignee, summary.
    const taskSection = view.container.querySelector('[data-team-section="tasks"]')
    expect(taskSection?.querySelector('[data-task-subject]')?.textContent).toBe('Wire the mirror')
    expect(taskSection?.querySelector('[data-task-status-text]')?.textContent).toBe('进行中')
    expect(taskSection?.querySelector('[data-task-assignee]')?.textContent).toBe('负责人 mate')
    expect(taskSection?.querySelector('[data-task-summary]')?.textContent).toBe('Half done')
    // The event stream mixes both rows in ascending order: the approval at
    // 2000 ahead of the message at 3000.
    const feedRows = view.container.querySelectorAll<HTMLElement>('[data-feed-row]')
    expect(feedRows).toHaveLength(2)
    expect(feedRows[0]?.dataset.feedKind).toBe('approval')
    expect(feedRows[1]?.dataset.feedKind).toBe('message')
    expect(screen.getByText('等待裁决')).toBeTruthy()
    // The approval row opens the requesting member's session; the message
    // row opens the recording session.
    fireEvent.click(feedRows[0]!)
    expect(openSession).toHaveBeenLastCalledWith(MEMBER)
    fireEvent.click(feedRows[1]!)
    expect(openSession).toHaveBeenLastCalledWith(LEADER)
    expect(openSession).toHaveBeenCalledTimes(2)
  })

  it('stops cold-pulling once the mirror gains the session (landing frame wins)', () => {
    const ensureTeam = vi.fn(() => Promise.resolve())
    const view = render(<TeamView {...{ ...viewProps({}, LEADER), ensureTeam }} />)
    expect(ensureTeam).toHaveBeenCalledTimes(1)
    view.rerender(<TeamView {...{ ...viewProps(LEADER_MIRROR, LEADER), ensureTeam }} />)
    expect(view.container.querySelector('[data-team-view]')).toBeTruthy()
    expect(ensureTeam).toHaveBeenCalledTimes(1)
  })
})
