/**
 * Unit tests for the teammate permission enforcement hook.
 *
 * The hook is the enforcement point: every bound child's tool call is
 * evaluated by the `permission` service (stubbed here; the real engine runs
 * in the loader-composition spec), the decision is audited to the child
 * session, and `ask` settles at the leader rendezvous (stubbed registry and
 * report). Denial paths are tested through the returned pre-execute decision,
 * i.e. the executor's outcome.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import type { LoadedRuleLayers, PermissionDecision } from '@deepseek-ai/dsh-permission'
import { installApprovalHook } from '../src/approval-setup.ts'
import { setRecoveredRuleLayers } from '../src/rule-layers.ts'

type Listener = (
  exec: { name: string; arguments: unknown; signal: AbortSignal },
  next: () => Promise<unknown>,
) => Promise<unknown>

const CHILD_ID = SessionId('child-1')

function bound(overrides: Partial<TeamMemberBoundData> = {}): TeamMemberBoundData {
  return { memberId: TeamMemberId('teammate-1'), role: 'teammate', ...overrides }
}

function makeChildCtx(
  header: { parentSession?: string; cwd?: string } = { parentSession: 'leader-1' },
  id: string = 'child-1',
) {
  let captured: Listener | undefined
  const on = vi.fn((_event: string, listener: Listener) => { captured = listener; return vi.fn() })
  const events: Array<{ type: string; data: Record<string, unknown> }> = []
  const child = {
    agent: {
      session: {
        id: SessionId(id),
        header,
        events,
        append: (type: string, data: Record<string, unknown>) => { events.push({ type, data }) },
      },
    },
    on,
  }
  return { child, events, listener: () => captured! }
}

const LAYERS: LoadedRuleLayers = { rules: [], managedPresent: false, projectPresent: false }

/**
 * Record the recovered rule state for the default child id. A rejecting load
 * gets a swallow here so the test that does not await it stays quiet; the
 * load-rejection test awaits it through the hook itself.
 */
function withLayers(promise: Promise<LoadedRuleLayers> = Promise.resolve(LAYERS)): void {
  promise.catch(() => undefined)
  setRecoveredRuleLayers(CHILD_ID, promise)
}

function enforceDeny(_view: { name: string }): PermissionDecision {
  return { kind: 'deny', reason: 'no matching allow rule (enforce mode)', cause: 'mode' }
}

const ask = (): PermissionDecision => ({
  kind: 'ask',
  reason: 'requested by rule "probe" (teammate)',
  matchedRule: { kind: 'ask', layer: 'teammate', tool: 'probe', matcher: 'param', raw: 'probe' },
})

function makeHostCtx(options: {
  evaluate?: (view: { name: string }) => PermissionDecision
  diagnostics?: string[]
  permission?: { compile: ReturnType<typeof vi.fn>; evaluate: ReturnType<typeof vi.fn> }
} = {}) {
  const evaluate = options.evaluate ?? (view => enforceDeny(view))
  const permission = options.permission ?? {
    compile: vi.fn().mockReturnValue({ policy: { __compiledPolicy: true }, diagnostics: options.diagnostics ?? [] }),
    evaluate: vi.fn(evaluate),
  }
  const teamControl = {
    create: vi.fn().mockResolvedValue('allow_once'),
    decide: vi.fn(),
    reconcilePending: vi.fn(),
  }
  const subagents = { reportFrom: vi.fn().mockResolvedValue('msg-1') }
  const get = (name: string) => (name === 'teamControl' ? teamControl : name === 'subagents' ? subagents : undefined)
  const logger = { error: vi.fn(), warn: vi.fn() }
  return {
    permission,
    teamControl,
    subagents,
    logger,
    ctx: { get, permission, logger } as unknown as Context,
  }
}

/** A host whose `create` stays pending until `settle` lands a decision. */
function makePendingHost(options: { evaluate?: (view: { name: string }) => PermissionDecision } = {}) {
  const teamControl = { create: vi.fn(), decide: vi.fn(), reconcilePending: vi.fn() }
  let settleImpl: ((decision: string) => void) | undefined
  teamControl.create.mockImplementation(() => new Promise((resolve) => {
    settleImpl = resolve
  }))
  const subagents = { reportFrom: vi.fn().mockResolvedValue('msg-1') }
  const get = (name: string) => (name === 'teamControl' ? teamControl : name === 'subagents' ? subagents : undefined)
  const logger = { error: vi.fn(), warn: vi.fn() }
  const permission = {
    compile: vi.fn().mockReturnValue({ policy: { __compiledPolicy: true }, diagnostics: [] }),
    evaluate: vi.fn(options.evaluate ?? (view => enforceDeny(view))),
  }
  return {
    permission,
    teamControl,
    subagents,
    logger,
    ctx: { get, permission, logger } as unknown as Context,
    // The hook reaches `create` through async awaits, so wait the entry into
    // existence before settling it.
    async settle(decision: string) {
      await vi.waitFor(() => expect(teamControl.create).toHaveBeenCalledTimes(1))
      settleImpl!(decision)
    },
  }
}

const signal = () => new AbortController().signal
const exec = (name: string, arguments_?: unknown) => ({
  name,
  arguments: arguments_ ?? {},
  signal: signal(),
})
const audits = (events: Array<{ type: string; data: Record<string, unknown> }>) =>
  events.filter(event => event.type === 'permission/decision').map(event => event.data)

describe('installApprovalHook — evaluation at the executor', () => {
  it('installs the hook for every bound child, without a requiresApproval list', () => {
    withLayers()
    const { child } = makeChildCtx()
    const host = makeHostCtx()
    const dispose = installApprovalHook(child as unknown as Context, host.ctx, bound())
    expect(child.on).toHaveBeenCalledTimes(1)
    expect(child.on.mock.calls[0]![0]).toBe('tools/pre-execute')
    expect(() => { dispose() }).not.toThrow()
  })

  it('denies an unmatched call in enforce mode (the default) and audits the mode cause', async () => {
    withLayers()
    const { child, events, listener } = makeChildCtx()
    const host = makeHostCtx()
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn()
    const result = (await listener()(exec('probe'), next)) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toBe('no matching allow rule (enforce mode)')
    expect(next).not.toHaveBeenCalled()
    expect(audits(events)).toEqual([
      { toolName: 'probe', decision: 'deny', mode: 'enforce', memberId: 'teammate-1', cause: 'mode' },
    ])
  })

  it('delegates an allowed call to next() and audits the allow with its rule', async () => {
    withLayers()
    const { child, events, listener } = makeChildCtx()
    const host = makeHostCtx({
      evaluate: () => ({
        kind: 'allow',
        matchedRule: { kind: 'allow', layer: 'teammate', tool: 'probe', matcher: 'param', raw: 'probe' },
      }),
    })
    installApprovalHook(child as unknown as Context, host.ctx, bound({ permissionMode: 'default' }))
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const result = await listener()(exec('probe'), next)
    expect(result).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(audits(events)).toEqual([
      {
        toolName: 'probe',
        decision: 'allow',
        mode: 'default',
        memberId: 'teammate-1',
        matchedRuleRaw: 'probe',
        layer: 'teammate',
      },
    ])
  })

  it('relays a managed-layer rule deny and audits its layer', async () => {
    withLayers()
    const { child, events, listener } = makeChildCtx()
    const host = makeHostCtx({
      evaluate: () => ({
        kind: 'deny',
        reason: 'denied by rule "probe" (managed)',
        matchedRule: { kind: 'deny', layer: 'managed', tool: 'probe', matcher: 'param', raw: 'probe' },
        cause: 'rule',
      }),
    })
    installApprovalHook(child as unknown as Context, host.ctx, bound({ permissionMode: 'default' }))
    const next = vi.fn()
    const result = (await listener()(exec('probe'), next)) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toBe('denied by rule "probe" (managed)')
    expect(next).not.toHaveBeenCalled()
    expect(audits(events)).toEqual([
      {
        toolName: 'probe',
        decision: 'deny',
        mode: 'default',
        memberId: 'teammate-1',
        matchedRuleRaw: 'probe',
        layer: 'managed',
        cause: 'rule',
      },
    ])
  })

  it('denies without auditing when the session has no rule state', async () => {
    const { child, events, listener } = makeChildCtx({ parentSession: 'leader-1' }, 'child-orphan')
    const host = makeHostCtx()
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn()
    const result = (await listener()(exec('probe'), next)) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('no permission policy is installed')
    expect(next).not.toHaveBeenCalled()
    expect(audits(events)).toEqual([])
    expect(host.permission.evaluate).not.toHaveBeenCalled()
  })

  it('denies and logs without auditing when the rule-layer load rejects', async () => {
    withLayers(Promise.reject(new Error('managed rule file is missing; refusing to run a session that was bound under it')))
    const { child, events, listener } = makeChildCtx()
    const host = makeHostCtx()
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn()
    const result = (await listener()(exec('probe'), next)) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('could not be read')
    expect(next).not.toHaveBeenCalled()
    expect(host.permission.evaluate).not.toHaveBeenCalled()
    expect(audits(events)).toEqual([])
    expect(host.logger.error).toHaveBeenCalledTimes(1)
    expect(host.logger.error.mock.calls[0]![0]).toContain('managed rule file is missing')
  })

  it('sends error-prefixed compile diagnostics to error and the rest to warn', async () => {
    withLayers()
    const { child, listener } = makeChildCtx()
    const host = makeHostCtx({ diagnostics: ['error: rule "Bash(broken" was dropped', 'note: a benign warning'] })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    await listener()(exec('probe'), next)
    expect((host.permission.compile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    expect(host.logger.error).toHaveBeenCalledWith('error: rule "Bash(broken" was dropped')
    expect(host.logger.warn).toHaveBeenCalledWith('note: a benign warning')
  })

  it('compiles the policy once across calls', async () => {
    withLayers()
    const { child, listener } = makeChildCtx()
    const host = makeHostCtx()
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn()
    await listener()(exec('probe'), next)
    await listener()(exec('probe'), next)
    expect((host.permission.compile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })
})

describe('installApprovalHook — ask at the leader rendezvous', () => {
  it('suspends an ask, wakes the leader, and resumes the executor on allow_once', async () => {
    withLayers()
    const { child, events, listener } = makeChildCtx()
    const host = makeHostCtx({ evaluate: () => ask() })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const result = await listener()(exec('probe', { note: 'x' }), next)
    expect(result).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(host.teamControl.create).toHaveBeenCalledTimes(1)
    expect(host.subagents.reportFrom).toHaveBeenCalledTimes(1)
    const wakeContent = host.subagents.reportFrom.mock.calls[0]![1] as { text: string }[]
    expect(wakeContent[0]?.text)
      .toBe('Teammate "teammate-1" requests approval to run "probe" (request '
        + host.teamControl.create.mock.calls[0]![1].requestId + '). Review with team_control.')
    expect(events.filter(event => event.type === 'team/control-request')).toHaveLength(1)
    const request = events.find(event => event.type === 'team/control-request')!.data as Record<string, unknown>
    expect(request).toMatchObject({ toolName: 'probe', reason: 'requested by rule "probe" (teammate)', arguments: { note: 'x' } })
    expect(audits(events)).toEqual([
      {
        toolName: 'probe',
        decision: 'ask',
        mode: 'enforce',
        memberId: 'teammate-1',
        matchedRuleRaw: 'probe',
        layer: 'teammate',
      },
    ])
  })

  it('allows execution when the leader approves the plan', async () => {
    withLayers()
    const { child, listener } = makeChildCtx()
    const host = makePendingHost({ evaluate: () => ask() })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const pending = listener()(exec('probe'), next)
    await host.settle('approve_plan')
    expect(await pending).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('denies when the leader denies', async () => {
    withLayers()
    const { child, listener } = makeChildCtx()
    const host = makePendingHost({ evaluate: () => ask() })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn()
    const pending = listener()(exec('probe'), next)
    await host.settle('deny')
    const result = (await pending) as { kind: string; reason: string }
    expect(result.reason).toBe('leader denied this tool')
    expect(next).not.toHaveBeenCalled()
  })

  it('denies with the revision reason when the leader requests revision', async () => {
    withLayers()
    const { child, listener } = makeChildCtx()
    const host = makePendingHost({ evaluate: () => ask() })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn()
    const pending = listener()(exec('probe'), next)
    await host.settle('request_revision')
    const result = (await pending) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toBe('leader requested revision: please revise plan')
    expect(next).not.toHaveBeenCalled()
  })

  it('routes the user escalation when the leader escalates', async () => {
    withLayers()
    const { child, listener } = makeChildCtx()
    const host = makePendingHost({ evaluate: () => ask() })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn()
    const pending = listener()(exec('probe'), next)
    await host.settle('escalate_to_user')
    const result = (await pending) as { kind: string; reason: string }
    expect(result.kind).toBe('ask')
    expect(result.reason).toContain('escalated')
    expect(next).not.toHaveBeenCalled()
  })

  it('audits a leader_unreachable deny when the child has no leader session', async () => {
    withLayers()
    const { child, events, listener } = makeChildCtx({})
    const host = makeHostCtx({ evaluate: () => ask() })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn()
    const result = (await listener()(exec('probe'), next)) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('not a final verdict')
    expect(host.teamControl.create).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    // The evaluate audit (ask) plus the leader-unreachable settlement (deny).
    expect(audits(events)).toEqual([
      {
        toolName: 'probe',
        decision: 'ask',
        mode: 'enforce',
        memberId: 'teammate-1',
        matchedRuleRaw: 'probe',
        layer: 'teammate',
      },
      {
        toolName: 'probe',
        decision: 'deny',
        mode: 'enforce',
        memberId: 'teammate-1',
        matchedRuleRaw: 'probe',
        layer: 'teammate',
        cause: 'leader_unreachable',
      },
    ])
  })

  it('audits a leader_unreachable deny and settles the entry when waking the leader fails', async () => {
    withLayers()
    const { child, events, listener } = makeChildCtx()
    const host = makeHostCtx({ evaluate: () => ask() })
    host.subagents.reportFrom.mockRejectedValue(new Error('parent gone'))
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn()
    const result = (await listener()(exec('probe'), next)) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('not a final verdict')
    expect(host.teamControl.decide).toHaveBeenCalledWith('leader-1', expect.any(String), 'deny')
    expect(next).not.toHaveBeenCalled()
    expect(audits(events)).toHaveLength(2)
    expect(audits(events)[0]).toMatchObject({ decision: 'ask' })
    expect(audits(events)[1]).toMatchObject({ decision: 'deny', cause: 'leader_unreachable' })
  })

  it('audits a leader_unreachable deny when the rendezvous services are unavailable', async () => {
    withLayers()
    const { child, events, listener } = makeChildCtx()
    const host = makeHostCtx({ evaluate: () => ask() })
    const noServices = { ctx: { get: () => undefined, permission: host.permission, logger: host.logger } as unknown as Context }
    installApprovalHook(child as unknown as Context, noServices.ctx, bound())
    const next = vi.fn()
    const result = (await listener()(exec('probe'), next)) as { kind: string }
    expect(result.kind).toBe('deny')
    expect(next).not.toHaveBeenCalled()
    expect(audits(events)).toHaveLength(2)
    expect(audits(events)[0]).toMatchObject({ decision: 'ask' })
    expect(audits(events)[1]).toMatchObject({ decision: 'deny', cause: 'leader_unreachable' })
  })

  it('omits arguments from the request when they are not an object', async () => {
    withLayers()
    const { child, events, listener } = makeChildCtx()
    const host = makeHostCtx({ evaluate: () => ask() })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const result = await listener()({ name: 'probe', arguments: 'plain', signal: signal() }, next)
    expect(result).toEqual({ kind: 'allow' })
    const request = events.find(event => event.type === 'team/control-request')!.data as Record<string, unknown>
    expect(request).not.toHaveProperty('arguments')
  })
})

describe('installApprovalHook — abort race', () => {
  it('denies and settles the entry when the execution aborts while awaiting the leader', async () => {
    withLayers()
    const { child, listener } = makeChildCtx()
    const host = makePendingHost({ evaluate: () => ask() })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const controller = new AbortController()
    const next = vi.fn()
    const pending = listener()({ name: 'probe', arguments: {}, signal: controller.signal }, next)
    controller.abort()
    const result = (await pending) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('cancelled')
    expect(host.teamControl.reconcilePending).toHaveBeenCalledWith('leader-1', [
      expect.objectContaining({ toolName: 'probe' }),
    ])
    expect(host.teamControl.decide).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('settles the entry through the abort listener when the abort lands after the wait begins', async () => {
    withLayers()
    const { child, listener } = makeChildCtx()
    const host = makePendingHost({ evaluate: () => ask() })
    // The wakeup completes on a later tick, so the abort listener registers
    // after reportFrom has been issued but before this test's abort lands.
    host.subagents.reportFrom.mockImplementation(() => new Promise<void>((resolve) => {
      setImmediate(resolve)
    }))
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const controller = new AbortController()
    const next = vi.fn()
    const pending = listener()({ name: 'probe', arguments: {}, signal: controller.signal }, next)
    await vi.waitFor(() => expect(host.subagents.reportFrom).toHaveBeenCalledTimes(1))
    // Let the wakeup settle and the abort listener register.
    await new Promise((resolve) => { setImmediate(resolve) })
    controller.abort()
    const result = (await pending) as { kind: string; reason: string }
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('cancelled')
    expect(host.teamControl.reconcilePending).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
  })

  it('denies immediately and settles the entry when the signal is already aborted', async () => {
    withLayers()
    const { child, listener } = makeChildCtx()
    const host = makePendingHost({ evaluate: () => ask() })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const controller = new AbortController()
    controller.abort()
    const next = vi.fn()
    const result = (await listener()({ name: 'probe', arguments: {}, signal: controller.signal }, next)) as { kind: string }
    expect(result.kind).toBe('deny')
    expect(host.teamControl.reconcilePending).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
  })

  it('still honours a leader decision that lands before the abort', async () => {
    withLayers()
    const { child, listener } = makeChildCtx()
    const host = makePendingHost({ evaluate: () => ask() })
    installApprovalHook(child as unknown as Context, host.ctx, bound())
    const controller = new AbortController()
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const pending = listener()({ name: 'probe', arguments: {}, signal: controller.signal }, next)
    await host.settle('allow_once')
    controller.abort()
    // The decision wins the race; a reconciliation racing the same abort is a
    // no-op in the real registry once the decision removed the entry.
    expect(await pending).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalled()
  })
})
