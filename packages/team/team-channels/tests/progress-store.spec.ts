import { describe, expect, it } from 'vitest'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import { TeamProgressStore } from '../src/progress-store.ts'

describe('TeamProgressStore', () => {
  it('stores and retrieves entries', () => {
    const store = new TeamProgressStore()
    store.update({
      taskId: 'task-1',
      subject: 'Build backend',
      status: 'in_progress',
      memberId: TeamMemberId('backend'),
    })
    expect(store.get('task-1')).toBeDefined()
    expect(store.get('task-1')!.subject).toBe('Build backend')
  })

  it('upserts by taskId (latest wins)', () => {
    const store = new TeamProgressStore()
    store.update({
      taskId: 'task-1',
      subject: 'Build backend',
      status: 'in_progress',
      memberId: TeamMemberId('backend'),
    })
    store.update({
      taskId: 'task-1',
      subject: 'Build backend',
      status: 'completed',
      summary: 'Done',
      memberId: TeamMemberId('backend'),
    })
    expect(store.get('task-1')!.status).toBe('completed')
    expect(store.list()).toHaveLength(1)
  })

  it('lists all entries', () => {
    const store = new TeamProgressStore()
    store.update({
      taskId: 'task-1',
      subject: 'A',
      status: 'pending',
      memberId: TeamMemberId('a'),
    })
    store.update({
      taskId: 'task-2',
      subject: 'B',
      status: 'pending',
      memberId: TeamMemberId('b'),
    })
    expect(store.list()).toHaveLength(2)
  })

  it('returns undefined for unknown task', () => {
    const store = new TeamProgressStore()
    expect(store.get('nonexistent')).toBeUndefined()
  })

  it('restores from session events', () => {
    const store = new TeamProgressStore()
    store.restore([
      { taskId: 't1', subject: 'A', status: 'pending', memberId: TeamMemberId('a') },
      { taskId: 't1', subject: 'A', status: 'completed', memberId: TeamMemberId('a') },
      { taskId: 't2', subject: 'B', status: 'in_progress', memberId: TeamMemberId('b') },
    ])
    expect(store.get('t1')!.status).toBe('completed')
    expect(store.get('t2')!.status).toBe('in_progress')
    expect(store.list()).toHaveLength(2)
  })
})
