import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import * as TeamChannels from '@deepseek-ai/dsh-team-channels'

describe('team-channels control-request sweep timer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-denies a request once the configured controlRequestTimeoutMs has elapsed', async () => {
    const ctx = new Context()
    await ctx.plugin(TeamChannels, { controlRequestTimeoutMs: 50 })
    const decision = ctx.teamControl.create('leader-1', {
      requestId: 'r1',
      memberId: TeamMemberId('t1'),
      toolName: 'pwsh',
      reason: 'test',
    })
    // A 50 ms timeout clamps the sweep interval to its 1_000 ms floor, so one
    // tick past the floor has already run a sweep with the 50 ms timeout.
    vi.advanceTimersByTime(1_100)
    await expect(decision).resolves.toBe('deny')
    await ctx.fiber.dispose()
  })

  it('stops auto-denying once the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(TeamChannels, { controlRequestTimeoutMs: 50 })
    const decision = ctx.teamControl.create('leader-1', {
      requestId: 'r1',
      memberId: TeamMemberId('t1'),
      toolName: 'pwsh',
      reason: 'test',
    })
    await ctx.fiber.dispose()
    vi.advanceTimersByTime(10_000)
    const winner = await Promise.race([decision, Promise.resolve('still-pending')])
    expect(winner).toBe('still-pending')
  })
})
