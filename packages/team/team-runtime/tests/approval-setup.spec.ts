import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import { installApprovalHook } from '../src/approval-setup.ts'

type Listener = (exec: { name: string; arguments: unknown; signal: AbortSignal }, next: () => Promise<unknown>) => Promise<unknown>

function bound(overrides: Partial<TeamMemberBoundData> = {}): TeamMemberBoundData {
  return { memberId: TeamMemberId('teammate-1'), role: 'teammate', ...overrides }
}

function makeChildCtx() {
  let captured: Listener | undefined
  const on = vi.fn((_event: string, listener: Listener) => { captured = listener; return vi.fn() })
  const append = vi.fn()
  const child = {
    agent: { session: { header: { parentSession: 'leader-1' }, append } },
    on,
  }
  return { child, append, listener: () => captured! }
}

function makeHostCtx(decision = 'allow_once') {
  const teamControl = {
    create: vi.fn().mockResolvedValue(decision),
    decide: vi.fn(),
  }
  const subagents = { reportFrom: vi.fn().mockResolvedValue('msg-1') }
  const get = (name: string) => (name === 'teamControl' ? teamControl : name === 'subagents' ? subagents : undefined)
  return { teamControl, subagents, ctx: { get } as unknown as Context }
}

const signal = () => new AbortController().signal

describe('installApprovalHook', () => {
  it('returns a no-op disposer when requiresApproval is empty', () => {
    const { child } = makeChildCtx()
    const dispose = installApprovalHook(child as unknown as Context, {} as Context, bound({ requiresApproval: [] }))
    expect(child.on).not.toHaveBeenCalled()
    expect(() => { dispose() }).not.toThrow()
  })

  it('delegates a non-gated tool to next()', async () => {
    const { child, listener } = makeChildCtx()
    const host = makeHostCtx()
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const result = await listener()({ name: 'read', arguments: {}, signal: signal() }, next)
    expect(result).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalled()
    expect(host.teamControl.create).not.toHaveBeenCalled()
  })

  it('suspends a gated tool, wakes the leader, and resolves allow_once via next()', async () => {
    const { child, append, listener } = makeChildCtx()
    const host = makeHostCtx('allow_once')
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const result = await listener()({ name: 'pwsh', arguments: { cmd: 'ls' }, signal: signal() }, next)

    expect(host.teamControl.create).toHaveBeenCalledTimes(1)
    expect(host.subagents.reportFrom).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledWith('team/control-request', expect.objectContaining({ toolName: 'pwsh' }))
    expect(result).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalled()
  })

  it('denies when the leader denies', async () => {
    const { child, listener } = makeChildCtx()
    const host = makeHostCtx('deny')
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const next = vi.fn()
    const result = await listener()({ name: 'pwsh', arguments: {}, signal: signal() }, next)
    const denied = result as { kind: string; reason: string }
    expect(denied.kind).toBe('deny')
    expect(denied.reason).toContain('denied')
    expect(next).not.toHaveBeenCalled()
  })

  it('escalates to the user when the leader escalates', async () => {
    const { child, listener } = makeChildCtx()
    const host = makeHostCtx('escalate_to_user')
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const next = vi.fn()
    const result = await listener()({ name: 'pwsh', arguments: {}, signal: signal() }, next)
    const ask = result as { kind: string; reason: string }
    expect(ask.kind).toBe('ask')
    expect(ask.reason).toContain('escalated')
    expect(next).not.toHaveBeenCalled()
  })

  it('denies when waking the leader fails', async () => {
    const { child, listener } = makeChildCtx()
    const host = makeHostCtx('allow_once')
    host.subagents.reportFrom.mockRejectedValue(new Error('parent gone'))
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const next = vi.fn()
    const result = await listener()({ name: 'pwsh', arguments: {}, signal: signal() }, next)
    const failed = result as { kind: string; reason: string }
    expect(failed.kind).toBe('deny')
    expect(failed.reason).toContain('could not reach')
    expect(host.teamControl.decide).toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })
})
