import { describe, expect, it } from 'vitest'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import { TeamControlCoordinator } from '../src/control-coordinator.ts'

describe('TeamControlCoordinator', () => {
  it('creates a pending request', () => {
    const coord = new TeamControlCoordinator()
    const data = {
      requestId: 'req-1',
      memberId: TeamMemberId('backend'),
      toolName: 'pwsh',
      reason: 'Need to run a build command',
    }
    const promise = coord.createRequest(data)
    expect(coord.listPending()).toHaveLength(1)
    expect(coord.listPending()[0]!.data.requestId).toBe('req-1')

    // Settle it
    coord.decide('req-1', 'allow_once')
    return expect(promise).resolves.toBe('allow_once')
  })

  it('throws on unknown request id', () => {
    const coord = new TeamControlCoordinator()
    expect(() => coord.decide('nonexistent', 'deny')).toThrow(/[Uu]nknown/)
  })

  it('removes request from pending after decision', () => {
    const coord = new TeamControlCoordinator()
    coord.createRequest({
      requestId: 'req-2',
      memberId: TeamMemberId('backend'),
      toolName: 'write',
      reason: 'Need to create a file',
    })
    coord.decide('req-2', 'deny')
    expect(coord.listPending()).toHaveLength(0)
  })

  it('sweeps expired requests with auto-deny', async () => {
    const coord = new TeamControlCoordinator()
    const promise = coord.createRequest({
      requestId: 'req-3',
      memberId: TeamMemberId('backend'),
      toolName: 'pwsh',
      reason: 'Expired',
    })
    // Sweep with a 0ms timeout (everything is expired)
    coord.sweep(Date.now() + 1, 0)
    expect(coord.listPending()).toHaveLength(0)
    await expect(promise).resolves.toBe('deny')
  })

  it('dispose auto-denies all pending', async () => {
    const coord = new TeamControlCoordinator()
    const p1 = coord.createRequest({
      requestId: 'r1',
      memberId: TeamMemberId('a'),
      toolName: 't1',
      reason: 'r',
    })
    const p2 = coord.createRequest({
      requestId: 'r2',
      memberId: TeamMemberId('b'),
      toolName: 't2',
      reason: 'r',
    })
    coord.dispose()
    await expect(p1).resolves.toBe('deny')
    await expect(p2).resolves.toBe('deny')
    expect(coord.listPending()).toHaveLength(0)
  })
})
