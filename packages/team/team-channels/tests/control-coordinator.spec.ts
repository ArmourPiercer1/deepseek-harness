import { describe, expect, it } from 'vitest'
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
