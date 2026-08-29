// @vitest-environment jsdom
/**
 * Resident team dock (D11–D13): the collapsed D23 readout (zero-count
 * segments omitted), the expandable compact member status and task rows,
 * the jump-entry tab activation, the non-team-session absence with the
 * mirror-gap cold pull, and the en/zh dictionary pairing.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TeamMirror, TeamView } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TeamDock, TeamDockPanel, type TeamDockProps } from '../src/client/TeamDock.tsx'
import { en, zh } from '../src/client/locales.ts'

const LEADER = 'leader-s' as SessionId
const MEMBER = 'mate-s' as SessionId
const OUTSIDER = 'plain-s' as SessionId

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
        memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [MEMBER],
        status: 'running', pendingControlCount: 2,
      },
      {
        memberId: 'b', name: 'Beta', role: 'teammate', sessionIds: [],
        status: 'unbound', pendingControlCount: 0,
      },
    ],
    delegations: [],
    tasks: [
      { taskId: 't1', subject: 'Wire the mirror', status: 'in_progress', memberId: 'a', seq: 1, at: 1000 },
      { taskId: 't2', subject: 'Ship the dock', status: 'completed', memberId: 'lead', seq: 2, at: 2000 },
    ],
    approvals: [],
    messages: [],
    messageCount: 0,
    ...overrides,
  }
}

const MIRROR: TeamMirror = { [LEADER]: view() }

function panelProps(
  team: TeamView = MIRROR[LEADER]!,
  openTeamTab: () => void = vi.fn(),
  dict: Record<string, string> = zh,
): Parameters<typeof TeamDockPanel>[0] {
  return { view: team, openTeamTab, t: makeTranslate(dict) }
}

function dockProps(
  mirror: TeamMirror,
  sessionId: SessionId,
  overrides: {
    openTeamTab?: () => void
    ensureTeam?: (id: SessionId) => Promise<void>
    dict?: Record<string, string>
  } = {},
): TeamDockProps {
  return {
    sessionId,
    useTeamMirror: (selector: (mirror: TeamMirror) => TeamView | undefined) => selector(mirror),
    ensureTeam: overrides.ensureTeam ?? vi.fn(() => Promise.resolve()),
    openTeamTab: overrides.openTeamTab ?? vi.fn(),
    t: makeTranslate(overrides.dict ?? zh),
  } as unknown as TeamDockProps
}

afterEach(cleanup)

describe('TeamDockPanel', () => {
  it('renders the collapsed D23 readout with both counts on one line', () => {
    const { container } = render(<TeamDockPanel {...panelProps()} />)
    const root = container.querySelector('[data-team-dock]')
    expect(root).toBeTruthy()
    // Collapsed by default: the expanded body is absent.
    expect(container.querySelector('[data-team-dock-expanded]')).toBeNull()
    expect(screen.getByText('团队')).toBeTruthy()
    // N = the running rows' bound sessions (1), M = the pending sum (2); the
    // D12 leading separator after the title renders with the readout.
    expect(container.querySelector('[data-dock-readout]')?.textContent)
      .toBe('1 运行中\u2002·\u20022 待裁决')
    expect(container.querySelector('[data-dock-sep]')?.textContent).toBe('\u2002·\u2002')
    // The jump entry's accessible name derives from its content, keeping the
    // D12 resident readout exposed to assistive tech (no aria-label override).
    expect(screen.getByRole('button', { name: /团队.*1 运行中.*2 待裁决/ })).toBeTruthy()
  })

  it('omits the zero-count readout segments and keeps a bare title when both are zero', () => {
    const idle = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'bound', pendingControlCount: 0,
        },
      ],
      tasks: [],
    })
    const { container } = render(<TeamDockPanel {...panelProps(idle)} />)
    expect(container.querySelector('[data-dock-readout]')).toBeNull()
    // No surviving segment: the leading separator is omitted with it.
    expect(container.querySelector('[data-dock-sep]')).toBeNull()
    expect(container.querySelector('[data-dock-title]')?.textContent).toBe('团队')

    const pendingOnly = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'bound', pendingControlCount: 3,
        },
      ],
      tasks: [],
    })
    const pendingRender = render(<TeamDockPanel {...panelProps(pendingOnly)} />)
    expect(pendingRender.container.querySelector('[data-dock-readout]')?.textContent).toBe('3 待裁决')
    expect(pendingRender.container.querySelector('[data-dock-sep]')?.textContent).toBe('\u2002·\u2002')
    pendingRender.unmount()

    const runningOnly = view({
      members: [
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [MEMBER],
          status: 'running', pendingControlCount: 0,
        },
      ],
      tasks: [],
    })
    const runningRender = render(<TeamDockPanel {...panelProps(runningOnly)} />)
    expect(runningRender.container.querySelector('[data-dock-readout]')?.textContent).toBe('1 运行中')
    expect(runningRender.container.querySelector('[data-dock-sep]')?.textContent).toBe('\u2002·\u2002')
    runningRender.unmount()
  })

  it('toggles the expanded body on the chevron and flips aria-expanded', () => {
    const { container } = render(<TeamDockPanel {...panelProps()} />)
    const toggle = container.querySelector<HTMLButtonElement>('[data-team-dock-toggle]')
    if (toggle === null) throw new Error('the chevron did not render')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-team-dock-expanded]')).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-team-dock-expanded]')).toBeNull()
  })

  it('lists the member status rows (name + dot) and the task rows when expanded', () => {
    const { container } = render(<TeamDockPanel {...panelProps()} />)
    fireEvent.click(container.querySelector<HTMLElement>('[data-team-dock-toggle]')!)
    // Member rows: bound + running rows in members order, unbound skipped.
    const members = container.querySelectorAll<HTMLElement>('[data-dock-member]')
    expect(members).toHaveLength(2)
    expect(members[0]?.textContent).toBe('Lead')
    expect(members[0]?.dataset.memberStatus).toBe('bound')
    expect(members[1]?.textContent).toBe('Alpha')
    expect(members[1]?.dataset.memberStatus).toBe('running')
    // The state dot is aria-hidden and paired with the status in the row label.
    expect(members[0]?.getAttribute('aria-label')).toBe('Lead 已绑定')
    expect(members[1]?.getAttribute('aria-label')).toBe('Alpha 运行中')
    // Task rows: subject plus the status label, in projection order.
    const tasks = container.querySelectorAll<HTMLElement>('[data-dock-task]')
    expect(tasks).toHaveLength(2)
    expect(tasks[0]?.textContent).toBe('Wire the mirror进行中')
    expect(tasks[0]?.dataset.taskStatus).toBe('in_progress')
    expect(tasks[1]?.textContent).toBe('Ship the dock已完成')
    expect(tasks[1]?.dataset.taskStatus).toBe('completed')
  })

  it('covers the remaining dot states: settled member, pending and blocked tasks', () => {
    const team = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'settled', pendingControlCount: 0,
        },
      ],
      tasks: [
        { taskId: 't1', subject: 'Next step', status: 'pending', memberId: 'lead', seq: 1, at: 1000 },
        { taskId: 't2', subject: 'Stuck step', status: 'blocked', memberId: 'lead', seq: 2, at: 2000 },
      ],
    })
    const { container } = render(<TeamDockPanel {...panelProps(team)} />)
    expect(container.querySelector('[data-dock-readout]')).toBeNull()
    fireEvent.click(container.querySelector<HTMLElement>('[data-team-dock-toggle]')!)
    const member = container.querySelector<HTMLElement>('[data-dock-member]')
    expect(member?.dataset.memberStatus).toBe('settled')
    expect(member?.getAttribute('aria-label')).toBe('Lead 已结算')
    const tasks = container.querySelectorAll<HTMLElement>('[data-dock-task]')
    expect(tasks[0]?.textContent).toBe('Next step待开始')
    expect(tasks[0]?.dataset.taskStatus).toBe('pending')
    expect(tasks[1]?.textContent).toBe('Stuck step受阻')
    expect(tasks[1]?.dataset.taskStatus).toBe('blocked')
  })

  it('shows the one-line empty notes while the team carries no member status or task', () => {
    const empty = view({
      members: [
        {
          memberId: 'b', name: 'Beta', role: 'teammate', sessionIds: [],
          status: 'unbound', pendingControlCount: 0,
        },
      ],
      tasks: [],
    })
    const { container } = render(<TeamDockPanel {...panelProps(empty)} />)
    expect(container.querySelector('[data-dock-readout]')).toBeNull()
    fireEvent.click(container.querySelector<HTMLElement>('[data-team-dock-toggle]')!)
    expect(screen.getByText('暂无成员状态')).toBeTruthy()
    expect(screen.getByText('暂无任务进度')).toBeTruthy()
  })

  it('activates the team tab when the jump entry is clicked, without toggling the expansion (D13)', () => {
    const openTeamTab = vi.fn()
    const { container } = render(<TeamDockPanel {...panelProps(view(), openTeamTab)} />)
    const jump = container.querySelector<HTMLElement>('[data-team-dock-jump]')
    if (jump === null) throw new Error('the jump entry did not render')
    // The jump intent rides the title tooltip; the accessible name stays the
    // readout content (no aria-label override).
    expect(jump.getAttribute('title')).toBe('打开团队标签页')
    expect(jump.getAttribute('aria-label')).toBeNull()
    fireEvent.click(jump)
    expect(openTeamTab).toHaveBeenCalledTimes(1)
    // The jump entry is the anchor, not the collapse control.
    expect(container.querySelector('[data-team-dock-expanded]')).toBeNull()
  })

  it('renders the English dictionary pairing', () => {
    const { container } = render(<TeamDockPanel {...panelProps(view(), vi.fn(), en)} />)
    expect(container.querySelector('[data-dock-title]')?.textContent).toBe('Team')
    expect(container.querySelector('[data-dock-readout]')?.textContent)
      .toBe('1 running\u2002·\u20022 pending')
    fireEvent.click(container.querySelector<HTMLElement>('[data-team-dock-toggle]')!)
    expect(container.querySelectorAll('[data-dock-member]')).toHaveLength(2)
    expect(screen.queryByText('No task progress yet')).toBeNull()
    expect(screen.getByText('In progress')).toBeTruthy()
  })
})

describe('TeamDock', () => {
  it('renders nothing for a non-team session and cold-pulls the mirror gap once per mount', () => {
    const ensureTeam = vi.fn(() => Promise.resolve())
    const view = render(<TeamDock {...dockProps({}, OUTSIDER, { ensureTeam })} />)
    expect(view.container.querySelector('[data-team-dock]')).toBeNull()
    expect(ensureTeam).toHaveBeenCalledTimes(1)
    expect(ensureTeam).toHaveBeenCalledWith(OUTSIDER)
    // While the mirror stays empty, re-renders must not re-fire the pull
    // (the single-flight cold read is per mount, not per render).
    view.rerender(<TeamDock {...dockProps({}, OUTSIDER, { ensureTeam })} />)
    expect(ensureTeam).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('renders the panel for the member session resolved through the binding (no cold pull)', () => {
    const ensureTeam = vi.fn(() => Promise.resolve())
    const { container } = render(<TeamDock {...dockProps(MIRROR, MEMBER, { ensureTeam })} />)
    expect(container.querySelector('[data-team-dock]')).toBeTruthy()
    expect(container.querySelector('[data-dock-readout]')?.textContent)
      .toBe('1 运行中\u2002·\u20022 待裁决')
    expect(ensureTeam).not.toHaveBeenCalled()
  })

  it('appears when the cold pull lands and stops pulling once the mirror gains the session', () => {
    const ensureTeam = vi.fn(() => Promise.resolve())
    const view0 = render(<TeamDock {...dockProps({}, LEADER, { ensureTeam })} />)
    expect(ensureTeam).toHaveBeenCalledTimes(1)
    view0.rerender(<TeamDock {...dockProps(MIRROR, LEADER, { ensureTeam })} />)
    expect(view0.container.querySelector('[data-team-dock]')).toBeTruthy()
    expect(ensureTeam).toHaveBeenCalledTimes(1)
    view0.unmount()
  })

  it('threads the jump callback through the adapter to the jump entry (D13)', () => {
    const openTeamTab = vi.fn()
    const { container } = render(<TeamDock {...dockProps(MIRROR, LEADER, { openTeamTab })} />)
    fireEvent.click(container.querySelector<HTMLElement>('[data-team-dock-jump]')!)
    expect(openTeamTab).toHaveBeenCalledTimes(1)
  })
})
