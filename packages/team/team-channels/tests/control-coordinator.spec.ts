import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import { TeamControlRegistry } from '../src/control-coordinator.ts'

/** A fresh registry on its own context, so service registration never collides. */
function makeRegistry(): TeamControlRegistry {
  return new TeamControlRegistry(new Context())
}

describe('TeamControlRegistry', () => {
  it('creates a pending request under a leader and settles it', () => {
    const registry = makeRegistry()
    const promise = registry.create('leader-1', {
      requestId: 'req-1',
      memberId: TeamMemberId('backend'),
      toolName: 'pwsh',
      reason: 'Need to run a build command',
    })
    expect(registry.list('leader-1')).toHaveLength(1)
    expect(registry.list('leader-1')[0]!.requestId).toBe('req-1')

    registry.decide('leader-1', 'req-1', 'allow_once')
    return expect(promise).resolves.toBe('allow_once')
  })

  it('settles a request with approve_plan and request_revision decisions', async () => {
    const registry = makeRegistry()
    const planPromise = registry.create('leader-1', {
      requestId: 'req-plan',
      memberId: TeamMemberId('backend'),
      toolName: 'exit_plan_mode',
      reason: 'Plan ready',
      kind: 'plan',
    })
    registry.decide('leader-1', 'req-plan', 'approve_plan')
    await expect(planPromise).resolves.toBe('approve_plan')

    const revPromise = registry.create('leader-1', {
      requestId: 'req-rev',
      memberId: TeamMemberId('backend'),
      toolName: 'exit_plan_mode',
      reason: 'Plan ready',
      kind: 'plan',
    })
    registry.decide('leader-1', 'req-rev', 'request_revision')
    await expect(revPromise).resolves.toBe('request_revision')
  })

  it('isolates pending requests by leader session id', () => {
    const registry = makeRegistry()
    void registry.create('leader-1', {
      requestId: 'req-a',
      memberId: TeamMemberId('a'),
      toolName: 't',
      reason: 'r',
    })
    void registry.create('leader-2', {
      requestId: 'req-b',
      memberId: TeamMemberId('b'),
      toolName: 't',
      reason: 'r',
    })
    expect(registry.list('leader-1').map(r => r.requestId)).toEqual(['req-a'])
    expect(registry.list('leader-2').map(r => r.requestId)).toEqual(['req-b'])
  })

  it('throws on unknown request id for a leader', () => {
    const registry = makeRegistry()
    expect(() => { registry.decide('leader-1', 'nonexistent', 'deny') }).toThrow(/[Uu]nknown/)
  })

  it('throws on an unknown request id under a leader that has other pending requests', () => {
    const registry = makeRegistry()
    void registry.create('leader-1', {
      requestId: 'other',
      memberId: TeamMemberId('a'),
      toolName: 't',
      reason: 'r',
    })
    expect(() => { registry.decide('leader-1', 'nonexistent', 'deny') }).toThrow(/[Uu]nknown/)
    expect(registry.list('leader-1').map(r => r.requestId)).toEqual(['other'])
  })

  it('removes the request after decision', () => {
    const registry = makeRegistry()
    void registry.create('leader-1', {
      requestId: 'req-2',
      memberId: TeamMemberId('backend'),
      toolName: 'write',
      reason: 'Need to create a file',
    })
    registry.decide('leader-1', 'req-2', 'deny')
    expect(registry.list('leader-1')).toHaveLength(0)
  })

  it('sweeps expired requests across leaders with auto-deny', async () => {
    const registry = makeRegistry()
    const promise = registry.create('leader-1', {
      requestId: 'req-3',
      memberId: TeamMemberId('backend'),
      toolName: 'pwsh',
      reason: 'Expired',
    })
    registry.sweep(Date.now() + 1, 0)
    expect(registry.list('leader-1')).toHaveLength(0)
    await expect(promise).resolves.toBe('deny')
  })

  it('sweeps only expired requests and keeps a leader with young ones', async () => {
    vi.useFakeTimers()
    try {
      const registry = makeRegistry()
      const expired = registry.create('leader-1', {
        requestId: 'old',
        memberId: TeamMemberId('backend'),
        toolName: 'pwsh',
        reason: 'Expired',
      })
      vi.advanceTimersByTime(500)
      const young = registry.create('leader-1', {
        requestId: 'new',
        memberId: TeamMemberId('backend'),
        toolName: 'pwsh',
        reason: 'Young',
      })
      registry.sweep(Date.now(), 400)
      expect(registry.list('leader-1').map(r => r.requestId)).toEqual(['new'])
      await expect(expired).resolves.toBe('deny')
      const winner = await Promise.race([young, Promise.resolve('still-pending')])
      expect(winner).toBe('still-pending')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the leader entry when other requests remain after a decision', async () => {
    const registry = makeRegistry()
    const first = registry.create('leader-1', {
      requestId: 'a',
      memberId: TeamMemberId('a'),
      toolName: 't',
      reason: 'r',
    })
    void registry.create('leader-1', {
      requestId: 'b',
      memberId: TeamMemberId('b'),
      toolName: 't',
      reason: 'r',
    })
    registry.decide('leader-1', 'a', 'allow_once')
    await expect(first).resolves.toBe('allow_once')
    expect(registry.list('leader-1').map(r => r.requestId)).toEqual(['b'])
  })

  it('tolerates disposing a leader with no pending requests', () => {
    const registry = makeRegistry()
    expect(() => { registry.dispose('leader-none') }).not.toThrow()
  })

  it('disposes one leader, auto-denying its pending requests only', async () => {
    const registry = makeRegistry()
    const p1 = registry.create('leader-1', {
      requestId: 'r1',
      memberId: TeamMemberId('a'),
      toolName: 't1',
      reason: 'r',
    })
    const p2 = registry.create('leader-2', {
      requestId: 'r2',
      memberId: TeamMemberId('b'),
      toolName: 't2',
      reason: 'r',
    })
    registry.dispose('leader-1')
    await expect(p1).resolves.toBe('deny')
    expect(registry.list('leader-1')).toHaveLength(0)
    expect(registry.list('leader-2')).toHaveLength(1)
    await expect(Promise.race([p2, Promise.resolve('still-pending')])).resolves.toBe('still-pending')
  })
})

describe('TeamControlRegistry.reconcilePending (cold resume)', () => {
  const request = (requestId: string) => ({
    requestId,
    memberId: TeamMemberId('backend'),
    toolName: 'pwsh',
    reason: 'r',
  })

  it('denies and removes the persisted requests that are still pending', async () => {
    const registry = makeRegistry()
    const p1 = registry.create('leader-1', request('r1'))
    void registry.create('leader-1', request('r2'))
    const denied = registry.reconcilePending('leader-1', [request('r1'), request('r2')])
    expect(denied).toEqual(['r1', 'r2'])
    expect(registry.list('leader-1')).toHaveLength(0)
    await expect(p1).resolves.toBe('deny')
  })

  it('ignores persisted requests with no live entry (decided or lost on restart)', async () => {
    const registry = makeRegistry()
    const live = registry.create('leader-1', request('live'))
    const denied = registry.reconcilePending('leader-1', [
      request('decided-earlier'),
      request('live'),
      request('lost-on-restart'),
    ])
    expect(denied).toEqual(['live'])
    expect(registry.list('leader-1')).toHaveLength(0)
    await expect(live).resolves.toBe('deny')
  })

  it('returns empty for an unknown leader and leaves other leaders untouched', async () => {
    const registry = makeRegistry()
    const other = registry.create('leader-2', request('r2'))
    expect(registry.reconcilePending('leader-1', [request('r1')])).toEqual([])
    expect(registry.list('leader-2')).toHaveLength(1)
    const winner = await Promise.race([other, Promise.resolve('still-pending')])
    expect(winner).toBe('still-pending')
  })

  it('leaves a concurrent pending request that is not in the persisted set', () => {
    const registry = makeRegistry()
    void registry.create('leader-1', request('orphan'))
    void registry.create('leader-1', request('fresh'))
    const denied = registry.reconcilePending('leader-1', [request('orphan')])
    expect(denied).toEqual(['orphan'])
    expect(registry.list('leader-1').map(r => r.requestId)).toEqual(['fresh'])
  })

  it('tolerates a concurrent decide on the same request', () => {
    const registry = makeRegistry()
    void registry.create('leader-1', request('r1'))
    registry.decide('leader-1', 'r1', 'allow_once')
    expect(registry.reconcilePending('leader-1', [request('r1')])).toEqual([])
    expect(registry.list('leader-1')).toHaveLength(0)
  })
})
