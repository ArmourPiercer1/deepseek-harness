import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import { installApprovalHook } from '../src/approval-setup.ts'

type Listener = (exec: { name: string; arguments: unknown; signal: AbortSignal }, next: () => Promise<unknown>) => Promise<unknown>

function bound(overrides: Partial<TeamMemberBoundData> = {}): TeamMemberBoundData {
  return { memberId: TeamMemberId('teammate-1'), role: 'teammate', ...overrides }
}

function makeChildCtx(header: { parentSession?: string } = { parentSession: 'leader-1' }) {
  let captured: Listener | undefined
  const on = vi.fn((_event: string, listener: Listener) => { captured = listener; return vi.fn() })
  const append = vi.fn()
  const child = {
    agent: { session: { header, append } },
    on,
  }
  return { child, append, listener: () => captured! }
}

function makeHostCtx(decision = 'allow_once') {
  const teamControl = {
    create: vi.fn().mockResolvedValue(decision),
    decide: vi.fn(),
    reconcilePending: vi.fn(),
  }
  const subagents = { reportFrom: vi.fn().mockResolvedValue('msg-1') }
  const get = (name: string) => (name === 'teamControl' ? teamControl : name === 'subagents' ? subagents : undefined)
  return { teamControl, subagents, ctx: { get } as unknown as Context }
}

/**
 * Host stand-in whose `create` returns a promise that stays pending until
 * something settles it, so tests can drive the abort path without a decision.
 */
function makePendingHost() {
  const teamControl = {
    create: vi.fn(),
    decide: vi.fn(),
    reconcilePending: vi.fn(),
  }
  let settle: ((decision: string) => void) | undefined
  teamControl.create.mockImplementation(() => new Promise((resolve) => {
    settle = resolve
  }))
  const subagents = { reportFrom: vi.fn().mockResolvedValue('msg-1') }
  const get = (name: string) => (name === 'teamControl' ? teamControl : name === 'subagents' ? subagents : undefined)
  return {
    teamControl,
    subagents,
    ctx: { get } as unknown as Context,
    settle: (decision: string) => { settle!(decision) },
  }
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

  it('allows execution when the leader approves plan', async () => {
    const { child, append, listener } = makeChildCtx()
    const host = makeHostCtx('approve_plan')
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const result = await listener()({ name: 'pwsh', arguments: { cmd: 'ls' }, signal: signal() }, next)

    expect(host.teamControl.create).toHaveBeenCalledTimes(1)
    expect(host.subagents.reportFrom).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledWith('team/control-request', expect.objectContaining({ toolName: 'pwsh' }))
    expect(result).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalled()
  })

  it('denies with revision request reason when the leader requests revision', async () => {
    const { child, listener } = makeChildCtx()
    const host = makeHostCtx('request_revision')
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const next = vi.fn()
    const result = await listener()({ name: 'pwsh', arguments: {}, signal: signal() }, next)
    const denied = result as { kind: string; reason: string }
    expect(denied.kind).toBe('deny')
    expect(denied.reason).toContain('leader requested revision: please revise plan')
    expect(next).not.toHaveBeenCalled()
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

  it('denies when the approval channel services are unavailable', async () => {
    const { child, listener } = makeChildCtx()
    const host = { ctx: { get: () => undefined } as unknown as Context }
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const next = vi.fn()
    const result = (await listener()({ name: 'pwsh', arguments: {}, signal: signal() }, next)) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('unavailable')
    expect(next).not.toHaveBeenCalled()
  })

  it('denies when the child has no leader session', async () => {
    const { child, listener } = makeChildCtx({})
    const host = makeHostCtx('allow_once')
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const next = vi.fn()
    const result = (await listener()({ name: 'pwsh', arguments: {}, signal: signal() }, next)) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('no leader')
    expect(host.teamControl.create).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('omits arguments from the request when they are not an object', async () => {
    const { child, append, listener } = makeChildCtx()
    const host = makeHostCtx('allow_once')
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const result = await listener()({ name: 'pwsh', arguments: 'ls', signal: signal() }, next)
    expect(result).toEqual({ kind: 'allow' })
    const recorded = append.mock.calls[0]![1] as Record<string, unknown>
    expect(recorded).not.toHaveProperty('arguments')
  })

  it('denies and settles the entry when the execution aborts while awaiting the leader', async () => {
    const { child, listener } = makeChildCtx()
    const host = makePendingHost()
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const controller = new AbortController()
    const next = vi.fn()
    const pending = listener()({ name: 'pwsh', arguments: {}, signal: controller.signal }, next)
    controller.abort()
    const result = (await pending) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('cancelled')
    expect(host.teamControl.reconcilePending).toHaveBeenCalledWith('leader-1', [
      expect.objectContaining({ toolName: 'pwsh' }),
    ])
    expect(host.teamControl.decide).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('settles the entry through the abort listener when the abort lands after the wait begins', async () => {
    const { child, listener } = makeChildCtx()
    const host = makePendingHost()
    let releaseReport: (() => void) | undefined
    host.subagents.reportFrom.mockImplementation(() => new Promise<void>((resolve) => {
      releaseReport = () => { resolve() }
    }))
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const controller = new AbortController()
    const next = vi.fn()
    const pending = listener()({ name: 'pwsh', arguments: {}, signal: controller.signal }, next)
    releaseReport!()
    // Let the listener pass reportFrom and register its abort listener.
    await new Promise((resolve) => { setImmediate(resolve) })
    controller.abort()
    const result = (await pending) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('cancelled')
    expect(host.teamControl.reconcilePending).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
  })

  it('denies immediately and settles the entry when the signal is already aborted', async () => {
    const { child, listener } = makeChildCtx()
    const host = makePendingHost()
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const controller = new AbortController()
    controller.abort()
    const next = vi.fn()
    const result = (await listener()({ name: 'pwsh', arguments: {}, signal: controller.signal }, next)) as { kind: string }
    expect(result.kind).toBe('deny')
    expect(host.teamControl.reconcilePending).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
  })

  it('still honours a leader decision that lands before the abort', async () => {
    const { child, listener } = makeChildCtx()
    const host = makePendingHost()
    installApprovalHook(child as unknown as Context, host.ctx, bound({ requiresApproval: ['pwsh'] }))
    const controller = new AbortController()
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const pending = listener()({ name: 'pwsh', arguments: {}, signal: controller.signal }, next)
    host.settle('allow_once')
    controller.abort()
    // The decision wins the race; a reconciliation racing the same abort is a
    // no-op in the real registry once the decision removed the entry.
    expect(await pending).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalled()
  })
})
