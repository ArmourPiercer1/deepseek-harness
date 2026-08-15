import { describe, expect, it } from 'vitest'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import { TeamOrchestrator } from '@deepseek-ai/dsh-team-runtime'

describe('team settlement and delegate semantics', () => {
  it('markSettled transitions running to settled', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-session-1')
    expect(orch.isInFlight(memberId)).toBe(true)
    orch.markSettled(memberId)
    expect(orch.isInFlight(memberId)).toBe(false)
    expect(orch.get(memberId)?.status).toBe('settled')
  })

  it('settled teammate allows new run delegation', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')
    orch.markSettled(memberId)
    // Should not throw — settled allows re-activation
    const activation = orch.recordActivation(memberId, 'child-2')
    expect(activation.status).toBe('running')
    expect(activation.childSessionId).toBe('child-2')
  })

  it('findByChildSession enables settlement callback pattern', () => {
    const orch = new TeamOrchestrator()
    orch.recordActivation(TeamMemberId('B1'), 'child-session-abc')
    orch.recordActivation(TeamMemberId('B2'), 'child-session-def')

    // Simulate settlement callback matching
    const activation = orch.findByChildSession('child-session-abc')
    expect(activation).toBeDefined()
    expect(activation!.memberId).toBe('B1')
    if (activation && activation.status === 'running') {
      orch.markSettled(activation.memberId)
    }
    expect(orch.isInFlight(TeamMemberId('B1'))).toBe(false)
    expect(orch.isInFlight(TeamMemberId('B2'))).toBe(true) // B2 unaffected
  })

  it('settlement of unknown child session is a no-op', () => {
    const orch = new TeamOrchestrator()
    orch.recordActivation(TeamMemberId('B1'), 'child-1')
    const activation = orch.findByChildSession('unknown-child')
    expect(activation).toBeUndefined()
    // No crash, B1 still running
    expect(orch.isInFlight(TeamMemberId('B1'))).toBe(true)
  })

  it('follow_up on settled teammate re-records activation', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')
    orch.markSettled(memberId)
    expect(orch.get(memberId)?.status).toBe('settled')
    // follow_up cold-resume re-records as running
    orch.recordActivation(memberId, 'child-1')
    expect(orch.get(memberId)?.status).toBe('running')
  })

  it('follow_up on disposed teammate cannot proceed', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')
    orch.markDisposed(memberId)
    expect(orch.get(memberId)?.status).toBe('disposed')
    // A disposed teammate should not be re-activated via follow_up
    // (the tool checks status !== 'disposed' before calling followup)
  })

  it('already_running error includes activity info when available', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')
    orch.updateActivity(memberId, 'pwsh')
    const activation = orch.get(memberId)!
    expect(activation.lastAction).toBe('pwsh')
    expect(activation.lastActivityAt).toBeTypeOf('number')
    // The tool would use these fields to build an informative error message
  })

  it('list shows correct status transitions', () => {
    const orch = new TeamOrchestrator()
    const memberId = TeamMemberId('B1')

    // idle (no activation)
    expect(orch.get(memberId)).toBeUndefined()

    // running
    orch.recordActivation(memberId, 'child-1')
    expect(orch.get(memberId)?.status).toBe('running')

    // settled
    orch.markSettled(memberId)
    expect(orch.get(memberId)?.status).toBe('settled')

    // running again (re-delegation)
    orch.recordActivation(memberId, 'child-2')
    expect(orch.get(memberId)?.status).toBe('running')

    // disposed
    orch.markDisposed(memberId)
    expect(orch.get(memberId)?.status).toBe('disposed')
  })
})
