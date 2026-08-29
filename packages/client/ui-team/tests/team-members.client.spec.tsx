// @vitest-environment jsdom
/**
 * Team member-group section: the `Name · N 活跃` container rows, the fixed
 * leading leader row (including the roster-absent fallback), the three-state
 * instance rows with the action placeholder and the waiting badge, the
 * unbound no-instances note, the D9 click-to-switch (leader row and per
 * instance), the D7 current-session highlight, the non-interactive
 * non-leader rows, and the en/zh dictionary pairing.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TeamView } from '@deepseek-ai/dsh-api-session-controller/client'
import { TeamMembers } from '../src/client/TeamMembers.tsx'
import { en, zh } from '../src/client/locales.ts'

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

function makeProps(
  team: TeamView = view(),
  currentSessionId: string = LEADER,
  onSelectSession: (sessionId: string) => void = vi.fn(),
  dict: Record<string, string> = zh,
): Parameters<typeof TeamMembers>[0] {
  return { view: team, currentSessionId, onSelectSession, t: makeTranslate(dict) }
}

function groupRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-member-group-row]')]
}

function leaderRow(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[data-member-group-row][data-leader]')
  if (button === null) throw new Error('the leading leader row did not render')
  return button
}

afterEach(cleanup)

describe('TeamMembers', () => {
  it('renders one group per member with the container row label, leader first', () => {
    const { container } = render(<TeamMembers {...makeProps()} />)
    expect(container.querySelector('[data-team-members]')).toBeTruthy()
    expect(groupRows(container).map(row => row.textContent)).toEqual([
      'Lead · 0 活跃',
      'Alpha · 1 活跃',
      'Beta · 0 活跃',
    ])
    expect(groupRows(container)[0]?.tagName).toBe('BUTTON')
  })

  it('switches back to the leader session when the leading row is clicked (D10)', () => {
    const openSession = vi.fn()
    const { container } = render(<TeamMembers {...makeProps(view(), SA, openSession)} />)
    fireEvent.click(leaderRow(container))
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith(LEADER)
  })

  it('keeps the leading row when the member rows lack a leader (roster-absent fallback)', () => {
    const openSession = vi.fn()
    const team = view({
      members: [
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [SA],
          status: 'bound', pendingControlCount: 0,
        },
      ],
    })
    const { container } = render(<TeamMembers {...makeProps(team, SA, openSession)} />)
    expect(leaderRow(container).textContent).toBe('领导者 · 0 活跃')
    expect(screen.getByText('尚无实例')).toBeTruthy()
    fireEvent.click(leaderRow(container))
    expect(openSession).toHaveBeenCalledWith(LEADER)
  })

  it('shows the three-state instance labels and the state dots', () => {
    const team = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'settled', pendingControlCount: 0,
        },
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [SA],
          status: 'bound', pendingControlCount: 0,
        },
        {
          memberId: 'b', name: 'Beta', role: 'teammate', sessionIds: [SB],
          status: 'running', pendingControlCount: 0,
        },
      ],
    })
    const { container } = render(<TeamMembers {...makeProps(team)} />)
    expect(screen.getByText('已结算')).toBeTruthy()
    expect(screen.getByText('已绑定')).toBeTruthy()
    expect(screen.getByText('运行中')).toBeTruthy()
    const byStatus = (status: string): HTMLElement | null =>
      container.querySelector(`[data-member-instance][data-status="${status}"]`)
    expect(byStatus('bound')?.querySelector('[data-member-status-text]')?.textContent).toBe('已绑定')
    expect(byStatus('running')?.querySelector('[data-member-status-text]')?.textContent).toBe('运行中')
    expect(byStatus('settled')?.querySelector('[data-member-status-text]')?.textContent).toBe('已结算')
  })

  it('lists an unbound member as a container row with the no-instances note', () => {
    const { container } = render(<TeamMembers {...makeProps()} />)
    expect(screen.getByText('Beta · 0 活跃')).toBeTruthy()
    expect(screen.getByText('尚无实例')).toBeTruthy()
    const beta = container.querySelectorAll<HTMLElement>('[data-member-group]')[2]
    expect(beta?.querySelector('[data-member-instance]')).toBeNull()
  })

  it('shows the current action and falls back to the action placeholder', () => {
    const team = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'bound', pendingControlCount: 0,
        },
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [SA],
          status: 'bound', currentAction: 'Bash', pendingControlCount: 0,
        },
      ],
    })
    const { container } = render(<TeamMembers {...makeProps(team)} />)
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getByText('暂无动作')).toBeTruthy()
    const leaderInstance = container.querySelector<HTMLElement>('[data-member-group] [data-member-instance]')
    expect(leaderInstance?.querySelector('[data-member-action]')?.textContent).toBe('暂无动作')
  })

  it('badges the waiting instances with the pending control-request count', () => {
    const team = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'bound', pendingControlCount: 0,
        },
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [SA],
          status: 'running', pendingControlCount: 2,
        },
      ],
    })
    const { container } = render(<TeamMembers {...makeProps(team)} />)
    expect(screen.getByText('2 项待裁决')).toBeTruthy()
    expect(container.querySelectorAll('[data-member-waiting]')).toHaveLength(1)
    const plain = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'bound', pendingControlCount: 0,
        },
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [SA],
          status: 'bound', pendingControlCount: 0,
        },
      ],
    })
    const plainRender = render(<TeamMembers {...makeProps(plain)} />)
    expect(plainRender.container.querySelectorAll('[data-member-waiting]')).toHaveLength(0)
    plainRender.unmount()
  })

  it('switches to the instance session on click, per instance for a multi-instance member (D9)', () => {
    const openSession = vi.fn()
    const team = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'bound', pendingControlCount: 0,
        },
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: ['sa1'],
          status: 'running', pendingControlCount: 0,
        },
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: ['sa2'],
          status: 'running', pendingControlCount: 0,
        },
      ],
    })
    const { container } = render(<TeamMembers {...makeProps(team, LEADER, openSession)} />)
    const instances = container.querySelectorAll<HTMLButtonElement>('[data-member-instance]')
    expect(instances).toHaveLength(3)
    fireEvent.click(instances[0]!)
    expect(openSession).toHaveBeenLastCalledWith(LEADER)
    fireEvent.click(instances[1]!)
    expect(openSession).toHaveBeenLastCalledWith('sa1')
    fireEvent.click(instances[2]!)
    expect(openSession).toHaveBeenLastCalledWith('sa2')
    expect(container.querySelector('[data-member-group-row]')?.textContent).toBe('Lead · 0 活跃')
    const alphaGroup = container.querySelectorAll<HTMLElement>('[data-member-group]')[1]
    expect(alphaGroup?.querySelector('[data-member-group-row]')?.textContent).toBe('Alpha · 2 活跃')
  })

  it('highlights the current session\'s group and instance rows only (D7)', () => {
    const { container } = render(<TeamMembers {...makeProps(view(), SA)} />)
    const groups = container.querySelectorAll<HTMLElement>('[data-member-group]')
    expect(groups[1]?.dataset.current).toBe('true')
    expect(groups[0]?.dataset.current).toBeUndefined()
    expect(groups[2]?.dataset.current).toBeUndefined()
    const rows = container.querySelectorAll<HTMLElement>('[data-member-instance]')
    expect(rows[0]?.dataset.current).toBeUndefined()
    expect(rows[1]?.dataset.current).toBe('true')

    const leaderView = render(<TeamMembers {...makeProps(view(), LEADER)} />)
    const leaderGroups = leaderView.container.querySelectorAll<HTMLElement>('[data-member-group]')
    expect(leaderGroups[0]?.dataset.current).toBe('true')
    expect(leaderGroups[1]?.dataset.current).toBeUndefined()
    const leaderRows = leaderView.container.querySelectorAll<HTMLElement>('[data-member-instance]')
    expect(leaderRows[0]?.dataset.current).toBe('true')
    expect(leaderRows[1]?.dataset.current).toBeUndefined()
    leaderView.unmount()
  })

  it('keeps the non-leader container rows non-interactive', () => {
    const openSession = vi.fn()
    const { container } = render(<TeamMembers {...makeProps(view(), SA, openSession)} />)
    const rows = groupRows(container)
    expect(rows[1]?.tagName).toBe('DIV')
    expect(rows[2]?.tagName).toBe('DIV')
    fireEvent.click(rows[1]!)
    expect(openSession).not.toHaveBeenCalled()
  })

  it('renders a session-less instance row as a disabled, inert row', () => {
    const openSession = vi.fn()
    const team = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'bound', pendingControlCount: 0,
        },
        {
          memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [],
          status: 'bound', pendingControlCount: 0,
        },
      ],
    })
    const { container } = render(<TeamMembers {...makeProps(team, LEADER, openSession)} />)
    const instances = container.querySelectorAll<HTMLButtonElement>('[data-member-instance]')
    expect(instances).toHaveLength(2)
    expect(instances[0]?.disabled).toBe(false)
    const sessionless = instances[1]!
    expect(sessionless.disabled).toBe(true)
    fireEvent.click(sessionless)
    expect(openSession).not.toHaveBeenCalled()
  })

  it('renders the English dictionary pairing', () => {
    const { container } = render(<TeamMembers {...makeProps(view(), LEADER, vi.fn(), en)} />)
    expect(groupRows(container).map(row => row.textContent)).toEqual([
      'Lead · 0 active',
      'Alpha · 1 active',
      'Beta · 0 active',
    ])
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getByText('1 pending')).toBeTruthy()
    expect(screen.getByText('No instances yet')).toBeTruthy()
    expect(container.querySelector('[data-member-instance][data-status="settled"]')).toBeNull()
  })
})
