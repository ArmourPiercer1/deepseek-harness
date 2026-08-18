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
function childCtx(events: readonly { type: string; data: unknown }[], header: { parentSession?: string } = {}) {
  const disposeGuard = vi.fn()
  const guard = vi.fn((_fn: unknown) => disposeGuard)
  const ctx = { agent: { session: { events, header } }, tools: { guard } } as unknown as Context
  return { ctx, guard, disposeGuard }
}

/** Host context stand-in exposing an optional `teamControl` registry via `get`. */
function hostCtxWith(teamControl?: unknown) {
  const get = (name: string) => (name === 'teamControl' ? teamControl : undefined)
  return { ctx: { get } as unknown as Context }
}

const hostCtx = hostCtxWith().ctx

/** The tool guard signature `ctx.tools.guard` accepts, for inspecting installs. */
type ToolGuardLike = (exec: { readonly name: string; readonly arguments?: unknown }) => string | undefined

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

  it('cold-resumes a pre-skills member-bound payload without error and without installing a guard', () => {
    const oldPayload: TeamMemberBoundData = { memberId: TeamMemberId('teammate-1'), role: 'teammate' }
    expect(oldPayload.skills).toBeUndefined()
    const child = childCtx([{ type: 'team/member-bound', data: oldPayload }])
    expect(() => {
      const dispose = teamMemberSetupContribution(hostCtx)(child.ctx)
      dispose()
    }).not.toThrow()
    expect(child.guard).not.toHaveBeenCalled()
  })

  it('cold-resumes a skills member-bound payload and reinstalls the skill guard', () => {
    const child = childCtx([
      { type: 'team/member-bound', data: bound({ skills: ['lit-review'] }) },
    ])
    expect(() => {
      const dispose = teamMemberSetupContribution(hostCtx)(child.ctx)
      const guard = child.guard.mock.calls[0]![0] as ToolGuardLike
      expect(guard({ name: 'skill', arguments: { name: 'lit-review' } })).toBeUndefined()
      expect(guard({ name: 'skill', arguments: { name: 'other-skill' } }))
        .toContain('other-skill')
      dispose()
      expect(child.disposeGuard).toHaveBeenCalledTimes(1)
    }).not.toThrow()
    expect(child.guard).toHaveBeenCalledTimes(1)
  })
})

describe('teamMemberSetupContribution cold-resume reconciliation', () => {
  const controlRequest = (requestId: string) => ({
    requestId,
    memberId: TeamMemberId('teammate-1'),
    toolName: 'pwsh',
    reason: 'Need to run a build command',
  })

  it('reconciles every persisted control request under the leader session', () => {
    const reconcilePending = vi.fn()
    const host = hostCtxWith({ reconcilePending })
    const child = childCtx(
      [
        { type: 'team/member-bound', data: bound() },
        { type: 'team/control-request', data: controlRequest('req-1') },
        { type: 'team/control-request', data: controlRequest('req-2') },
      ],
      { parentSession: 'leader-1' },
    )
    teamMemberSetupContribution(host.ctx)(child.ctx)
    expect(reconcilePending).toHaveBeenCalledTimes(1)
    expect(reconcilePending).toHaveBeenCalledWith('leader-1', [
      controlRequest('req-1'),
      controlRequest('req-2'),
    ])
  })

  it('does not reconcile when the child logged no control requests', () => {
    const reconcilePending = vi.fn()
    const host = hostCtxWith({ reconcilePending })
    const child = childCtx(
      [
        { type: 'team/progress', data: { taskId: 't1', subject: 's', status: 'pending', memberId: TeamMemberId('teammate-1') } },
        { type: 'team/member-bound', data: bound() },
      ],
      { parentSession: 'leader-1' },
    )
    teamMemberSetupContribution(host.ctx)(child.ctx)
    expect(reconcilePending).not.toHaveBeenCalled()
  })

  it('does not reconcile without a leader session id', () => {
    const reconcilePending = vi.fn()
    const host = hostCtxWith({ reconcilePending })
    const child = childCtx([
      { type: 'team/member-bound', data: bound() },
      { type: 'team/control-request', data: controlRequest('req-1') },
    ])
    teamMemberSetupContribution(host.ctx)(child.ctx)
    expect(reconcilePending).not.toHaveBeenCalled()
  })

  it('skips reconciliation without error when the registry is unavailable', () => {
    const child = childCtx(
      [
        { type: 'team/member-bound', data: bound() },
        { type: 'team/control-request', data: controlRequest('req-1') },
      ],
      { parentSession: 'leader-1' },
    )
    expect(() => {
      const dispose = teamMemberSetupContribution(hostCtx)(child.ctx)
      dispose()
    }).not.toThrow()
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

  it('installs a skill guard for a skills policy that denies unauthorized skills', () => {
    const child = childCtx([])
    const dispose = installMemberComposition(child.ctx, bound({ skills: ['lit-review'] }))
    expect(child.guard).toHaveBeenCalledTimes(1)
    const guard = child.guard.mock.calls[0]![0] as ToolGuardLike
    expect(guard({ name: 'skill', arguments: { name: 'lit-review' } })).toBeUndefined()
    expect(guard({ name: 'skill', arguments: { name: 'other-skill' } }))
      .toBe('Skill "other-skill" is not authorized for this team member')
    expect(guard({ name: 'read' })).toBeUndefined()
    dispose()
    expect(child.disposeGuard).toHaveBeenCalledTimes(1)
  })

  it('installs no skill guard when the member has no skills policy', () => {
    const child = childCtx([])
    const dispose = installMemberComposition(child.ctx, bound({ mcpServers: { servers: ['a'] } }))
    expect(child.guard).toHaveBeenCalledTimes(1)
    const guard = child.guard.mock.calls[0]![0] as ToolGuardLike
    // The single installed guard is the MCP guard: skill calls pass through.
    expect(guard({ name: 'skill', arguments: { name: 'any-skill' } })).toBeUndefined()
    dispose()
    expect(child.disposeGuard).toHaveBeenCalledTimes(1)
  })

  it('installs both guards and disposes both when skills and mcpServers policies are set', () => {
    const child = childCtx([])
    const dispose = installMemberComposition(child.ctx, bound({ skills: ['s1'], mcpServers: { servers: ['a'] } }))
    expect(child.guard).toHaveBeenCalledTimes(2)
    dispose()
    expect(child.disposeGuard).toHaveBeenCalledTimes(2)
  })
})
