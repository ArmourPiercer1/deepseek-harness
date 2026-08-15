import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import { installMemberComposition, teamMemberSetupContribution } from '../src/member-setup.ts'

function bound(overrides: Partial<TeamMemberBoundData> = {}): TeamMemberBoundData {
  return {
    memberId: TeamMemberId('teammate-1'),
    role: 'teammate',
    ...overrides,
  }
}

/** A child-context stand-in carrying a session event list and an observable guard. */
function childCtx(events: readonly { type: string; data: unknown }[]) {
  const disposeGuard = vi.fn()
  const guard = vi.fn(() => disposeGuard)
  const ctx = { agent: { session: { events } }, tools: { guard } } as unknown as Context
  return { ctx, guard, disposeGuard }
}

/** Host context stand-in; unused by the non-approval paths tested here. */
const hostCtx = {} as Context

describe('teamMemberSetupContribution', () => {
  it('is a no-op for a non-team child (no team/member-bound event)', () => {
    const child = childCtx([])
    const dispose = teamMemberSetupContribution(hostCtx)(child.ctx)
    expect(child.guard).not.toHaveBeenCalled()
    expect(() => { dispose() }).not.toThrow()
  })

  it('installs the MCP guard from the member-bound event and removes it on dispose', () => {
    const child = childCtx([
      { type: 'team/member-bound', data: bound({ mcpServers: { servers: ['postgres-mcp'] } }) },
    ])
    const dispose = teamMemberSetupContribution(hostCtx)(child.ctx)
    expect(child.guard).toHaveBeenCalledTimes(1)
    expect(child.disposeGuard).not.toHaveBeenCalled()
    dispose()
    expect(child.disposeGuard).toHaveBeenCalledTimes(1)
  })

  it('installs nothing when the member has no mcpServers policy', () => {
    const child = childCtx([{ type: 'team/member-bound', data: bound() }])
    const dispose = teamMemberSetupContribution(hostCtx)(child.ctx)
    expect(child.guard).not.toHaveBeenCalled()
    expect(() => { dispose() }).not.toThrow()
  })
})

describe('installMemberComposition', () => {
  it('installs no guard when mcpServers is absent', () => {
    const child = childCtx([])
    const dispose = installMemberComposition(child.ctx, bound())
    expect(child.guard).not.toHaveBeenCalled()
    expect(() => { dispose() }).not.toThrow()
  })

  it('installs no guard when the mcpServers allowlist is empty', () => {
    const child = childCtx([])
    const dispose = installMemberComposition(child.ctx, bound({ mcpServers: { servers: [] } }))
    expect(child.guard).not.toHaveBeenCalled()
    expect(() => { dispose() }).not.toThrow()
  })

  it('installs and removes exactly one guard for a non-empty allowlist', () => {
    const child = childCtx([])
    const dispose = installMemberComposition(child.ctx, bound({ mcpServers: { servers: ['a', 'b'] } }))
    expect(child.guard).toHaveBeenCalledTimes(1)
    dispose()
    expect(child.disposeGuard).toHaveBeenCalledTimes(1)
  })
})
