import { describe, expect, it } from 'vitest'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import { TeamOrchestrator } from '../src/orchestrator.ts'

describe('TeamOrchestrator', () => {
  it('records a new activation', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    const activation = orch.recordActivation(memberId, 'session-1')
    expect(activation.memberId).toBe('backend')
    expect(activation.childSessionId).toBe('session-1')
    expect(activation.status).toBe('running')
  })

  it('throws on duplicate in-flight activation', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    orch.recordActivation(memberId, 'session-1')
    expect(() => orch.recordActivation(memberId, 'session-2')).toThrow(/already.*in-flight/)
  })

  it('allows re-activation after settled', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    orch.recordActivation(memberId, 'session-1')
    orch.markSettled(memberId)
    const activation = orch.recordActivation(memberId, 'session-2')
    expect(activation.childSessionId).toBe('session-2')
    expect(activation.status).toBe('running')
  })

  it('lists all activations', () => {
    const orch = new TeamOrchestrator()
    orch.recordActivation(TeamMemberId('a'), 'sa')
    orch.recordActivation(TeamMemberId('b'), 'sb')
    expect(orch.list()).toHaveLength(2)
  })

  it('reports in-flight status correctly', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('backend')
    expect(orch.isInFlight(memberId)).toBe(false)
    orch.recordActivation(memberId, 'session-1')
    expect(orch.isInFlight(memberId)).toBe(true)
    orch.markSettled(memberId)
    expect(orch.isInFlight(memberId)).toBe(false)
  })
})
