// @vitest-environment jsdom
/**
 * Task-board section: the projection's task list as rows of state dot,
 * subject, status label, assignee (the member name resolved through the
 * member rows, D19, with the raw-id fallback), and optional summary; the
 * four status labels, the absent-summary arm, the one-line empty state,
 * the non-interactive rows, and the en/zh dictionary pairing.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TeamView } from '@deepseek-ai/dsh-api-session-controller/client'
import { TeamTasks } from '../src/client/TeamTasks.tsx'
import { en, zh } from '../src/client/locales.ts'

const LEADER = 'leader-s'

type TaskRow = TeamView['tasks'][number]

function task(overrides: Partial<TaskRow> & Pick<TaskRow, 'taskId' | 'subject' | 'status'>): TaskRow {
  return { memberId: 'a', seq: 1, at: 1000, ...overrides }
}

function view(overrides: Partial<TeamView> = {}): TeamView {
  return {
    teamId: LEADER,
    leaderSessionId: LEADER,
    rosterMemberCount: 2,
    members: [
      {
        memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
        status: 'bound', pendingControlCount: 0,
      },
      {
        memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: ['a-s'],
        status: 'running', pendingControlCount: 0,
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

function makeProps(team: TeamView = view(), dict: Record<string, string> = zh): Parameters<typeof TeamTasks>[0] {
  return { view: team, t: makeTranslate(dict) }
}

afterEach(cleanup)

describe('TeamTasks', () => {
  it('renders one row per task: state dot, subject, status label, assignee name, summary', () => {
    const team = view({
      tasks: [task({
        taskId: 't1', subject: 'Wire the mirror', status: 'in_progress',
        summary: 'Half done', memberId: 'a',
      })],
    })
    const { container } = render(<TeamTasks {...makeProps(team)} />)
    expect(container.querySelector('[data-team-tasks]')).toBeTruthy()
    const row = container.querySelector<HTMLElement>('[data-task-row]')
    expect(row).toBeTruthy()
    expect(row?.dataset.taskStatus).toBe('in_progress')
    expect(row?.querySelector('[data-state]')).toBeTruthy()
    expect(container.querySelector('[data-task-subject]')?.textContent).toBe('Wire the mirror')
    expect(container.querySelector('[data-task-status-text]')?.textContent).toBe('进行中')
    expect(container.querySelector('[data-task-assignee]')?.textContent).toBe('负责人 Alpha')
    expect(container.querySelector('[data-task-summary]')?.textContent).toBe('Half done')
  })

  it('shows the four status labels for the four statuses', () => {
    const team = view({
      tasks: [
        task({ taskId: 't1', subject: 'A', status: 'pending' }),
        task({ taskId: 't2', subject: 'B', status: 'in_progress' }),
        task({ taskId: 't3', subject: 'C', status: 'completed' }),
        task({ taskId: 't4', subject: 'D', status: 'blocked' }),
      ],
    })
    const { container } = render(<TeamTasks {...makeProps(team)} />)
    const rows = container.querySelectorAll<HTMLElement>('[data-task-row]')
    expect(rows).toHaveLength(4)
    expect([...rows].map(row => row.querySelector('[data-task-status-text]')?.textContent)).toEqual([
      '待开始', '进行中', '已完成', '受阻',
    ])
  })

  it('omits the summary line when the task carries none', () => {
    const team = view({ tasks: [task({ taskId: 't1', subject: 'A', status: 'pending' })] })
    const { container } = render(<TeamTasks {...makeProps(team)} />)
    expect(container.querySelector('[data-task-summary]')).toBeNull()
  })

  it('falls back to the raw member id when no member row matches (D19 fallback)', () => {
    const team = view({
      tasks: [task({ taskId: 't1', subject: 'A', status: 'pending', memberId: 'ghost' })],
    })
    const { container } = render(<TeamTasks {...makeProps(team)} />)
    expect(container.querySelector('[data-task-assignee]')?.textContent).toBe('负责人 ghost')
  })

  it('renders the one-line empty state without any row', () => {
    const { container } = render(<TeamTasks {...makeProps()} />)
    expect(container.querySelector('[data-task-row]')).toBeNull()
    expect(screen.getByText('暂无任务进度')).toBeTruthy()
    expect(container.querySelector('[data-tasks-empty]')).toBeTruthy()
  })

  it('keeps the rows non-interactive (D9 names no task-row switch)', () => {
    const team = view({ tasks: [task({ taskId: 't1', subject: 'A', status: 'pending' })] })
    const { container } = render(<TeamTasks {...makeProps(team)} />)
    const row = container.querySelector('[data-task-row]')
    expect(row?.tagName).toBe('DIV')
    expect(container.querySelector('button, a')).toBeNull()
  })

  it('renders the English dictionary pairing', () => {
    const team = view({
      tasks: [task({
        taskId: 't1', subject: 'A', status: 'completed',
        summary: 'S', memberId: 'ghost',
      })],
    })
    const { container } = render(<TeamTasks {...makeProps(team, en)} />)
    expect(container.querySelector('[data-task-status-text]')?.textContent).toBe('Completed')
    expect(container.querySelector('[data-task-assignee]')?.textContent).toBe('Assignee ghost')
    const empty = render(<TeamTasks {...makeProps(view(), en)} />)
    expect(empty.container.querySelector('[data-tasks-empty]')?.textContent).toBe('No task progress yet')
    empty.unmount()
  })
})
