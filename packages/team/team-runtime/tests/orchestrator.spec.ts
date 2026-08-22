import { describe, expect, it } from 'vitest'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import { TeamOrchestrator } from '../src/orchestrator.ts'

describe('TeamOrchestrator', () => {
  it('records a new activation', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    const activation = orch.recordActivation('leader-1', memberId, 'session-1')
    expect(activation.memberId).toBe('backend')
    expect(activation.childSessionId).toBe('session-1')
    expect(activation.status).toBe('running')
  })

  it('throws on duplicate in-flight activation', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    orch.recordActivation('leader-1', memberId, 'session-1')
    expect(() => orch.recordActivation('leader-1', memberId, 'session-2')).toThrow(/already.*in-flight/)
  })

  it('allows re-activation after settled', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    orch.recordActivation('leader-1', memberId, 'session-1')
    orch.markSettled('leader-1', memberId)
    const activation = orch.recordActivation('leader-1', memberId, 'session-2')
    expect(activation.childSessionId).toBe('session-2')
    expect(activation.status).toBe('running')
  })

  it('lists one leader’s activations only', () => {
    const orch = new TeamOrchestrator()
    orch.recordActivation('leader-1', TeamMemberId('a'), 'sa')
    orch.recordActivation('leader-2', TeamMemberId('b'), 'sb')
    expect(orch.list('leader-1')).toHaveLength(1)
    expect(orch.list('leader-1')[0]?.memberId).toBe('a')
    expect(orch.list('leader-2')).toHaveLength(1)
    expect(orch.list('leader-2')[0]?.memberId).toBe('b')
  })

  it('reports in-flight status correctly', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    expect(orch.isInFlight('leader-1', memberId)).toBe(false)
    orch.recordActivation('leader-1', memberId, 'session-1')
    expect(orch.isInFlight('leader-1', memberId)).toBe(true)
    expect(orch.isInFlight('leader-2', memberId)).toBe(false)
    orch.markSettled('leader-1', memberId)
    expect(orch.isInFlight('leader-1', memberId)).toBe(false)
  })

  it('finds activation by child session id', () => {
    const orch = new TeamOrchestrator()
    orch.recordActivation('leader-1', TeamMemberId('backend'), 'child-1')
    expect(orch.findByChildSession('leader-1', 'child-1')?.memberId).toBe('backend')
  })

  it('returns undefined for unknown child session id', () => {
    const orch = new TeamOrchestrator()
    expect(orch.findByChildSession('leader-1', 'nonexistent')).toBeUndefined()
  })

  it('keeps another leader’s activation invisible', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    orch.recordActivation('leader-1', memberId, 'child-1')
    expect(orch.get('leader-2', memberId)).toBeUndefined()
    expect(orch.findByChildSession('leader-2', 'child-1')).toBeUndefined()
    // Disposing under one leader leaves the other leader's record untouched.
    orch.markDisposed('leader-1', memberId)
    expect(orch.get('leader-1', memberId)?.status).toBe('disposed')
    orch.markDisposed('leader-2', memberId)
    expect(orch.get('leader-1', memberId)?.status).toBe('disposed')
  })

  it('allows the same member id under two leaders with distinct children', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    orch.recordActivation('leader-1', memberId, 'child-a')
    expect(() => orch.recordActivation('leader-2', memberId, 'child-b')).not.toThrow()
    expect(orch.get('leader-1', memberId)?.childSessionId).toBe('child-a')
    expect(orch.get('leader-2', memberId)?.childSessionId).toBe('child-b')
  })

  it('updates activity tracking fields', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    orch.recordActivation('leader-1', memberId, 'session-1')
    orch.updateActivity('leader-1', memberId, 'pwsh')
    expect(orch.get('leader-1', memberId)?.lastAction).toBe('pwsh')
    expect(orch.get('leader-1', memberId)?.lastActivityAt).toBeTypeOf('number')
    expect(orch.get('leader-1', memberId)?.lastActivityAt).toBeGreaterThan(0)
  })

  it('updateActivity is a no-op for unknown member', () => {
    const orch = new TeamOrchestrator()
    orch.updateActivity('leader-1', TeamMemberId('unknown'), 'test')
  })
})
