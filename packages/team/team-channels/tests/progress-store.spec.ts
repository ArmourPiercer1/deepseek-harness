import { describe, expect, it } from 'vitest'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import { TeamProgressStore } from '../src/progress-store.ts'

const LEADER = 'leader-1'

describe('TeamProgressStore', () => {
  it('stores and retrieves entries per leader', () => {
    const store = new TeamProgressStore()
    store.update(LEADER, {
      taskId: 'task-1',
      subject: 'Build backend',
      status: 'in_progress',
      memberId: TeamMemberId('backend'),
    })
    expect(store.get(LEADER, 'task-1')).toBeDefined()
    expect(store.get(LEADER, 'task-1')!.subject).toBe('Build backend')
  })

  it('upserts by taskId (latest wins)', () => {
    const store = new TeamProgressStore()
    store.update(LEADER, {
      taskId: 'task-1',
      subject: 'Build backend',
      status: 'in_progress',
      memberId: TeamMemberId('backend'),
    })
    store.update(LEADER, {
      taskId: 'task-1',
      subject: 'Build backend',
      status: 'completed',
      summary: 'Done',
      memberId: TeamMemberId('backend'),
    })
    expect(store.get(LEADER, 'task-1')!.status).toBe('completed')
    expect(store.list(LEADER)).toHaveLength(1)
  })

  it('isolates boards by leader session id', () => {
    const store = new TeamProgressStore()
    store.update('leader-1', {
      taskId: 'a',
      subject: 'A',
      status: 'pending',
      memberId: TeamMemberId('x'),
    })
    store.update('leader-2', {
      taskId: 'b',
      subject: 'B',
      status: 'pending',
      memberId: TeamMemberId('y'),
    })
    expect(store.list('leader-1').map(e => e.taskId)).toEqual(['a'])
    expect(store.list('leader-2').map(e => e.taskId)).toEqual(['b'])
  })

  it('returns undefined for an unknown task', () => {
    const store = new TeamProgressStore()
    expect(store.get(LEADER, 'nonexistent')).toBeUndefined()
  })

  it('restores from session events with latest-wins folding', () => {
    const store = new TeamProgressStore()
    store.restore(LEADER, [
      { taskId: 't1', subject: 'A', status: 'pending', memberId: TeamMemberId('a') },
      { taskId: 't1', subject: 'A', status: 'completed', memberId: TeamMemberId('a') },
      { taskId: 't2', subject: 'B', status: 'in_progress', memberId: TeamMemberId('b') },
    ])
    expect(store.get(LEADER, 't1')!.status).toBe('completed')
    expect(store.get(LEADER, 't2')!.status).toBe('in_progress')
    expect(store.list(LEADER)).toHaveLength(2)
  })
})
