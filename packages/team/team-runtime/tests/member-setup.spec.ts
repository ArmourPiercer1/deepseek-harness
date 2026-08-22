import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import { bindScopeParent, createScope } from '@deepseek-ai/dsh-scope'
import { installMemberComposition, teamMemberSetupContribution } from '../src/member-setup.ts'
import { getRecoveredRuleLayers } from '../src/rule-layers.ts'

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
  const on = vi.fn(() => vi.fn())
  const ctx = {
    agent: { session: { events, header } },
    tools: { guard },
    on,
  } as unknown as Context
  return { ctx, guard, disposeGuard, on }
}

/**
 * Host context stand-in exposing the `teamControl` registry via `get` and a
 * `permission` service (a hard injection of the plugin) with a resolving load.
 */
function hostCtxWith(teamControl?: unknown) {
  const get = (name: string) => (name === 'teamControl' ? teamControl : undefined)
  const permission = { loadRuleLayers: vi.fn().mockResolvedValue({ rules: [], managedPresent: false, projectPresent: false }) }
  return {
    ctx: { get, permission } as unknown as Context,
    permission,
  }
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

describe('teamMemberSetupContribution preset-generation scoping', () => {
  /**
   * Real scoped contexts: one standing composition ("team") and one other
   * ("aieo-team"), each with a child agent scope derived under it, plus an
   * orphan child with no scope parent. The child stand-in keeps the plain
   * object shape the other tests use while the scope tag comes from
   * `extend`-style prototype chaining over the minted scope contexts.
   */
  function scopedFixture() {
    const root = new CordisContext()
    const teamKey: object = { preset: 'team' }
    const otherKey: object = { preset: 'aieo-team' }
    const teamStanding = createScope(root, teamKey)
    createScope(root, otherKey)

    const ownChildKey: object = { agent: 'own' }
    bindScopeParent(ownChildKey, teamKey)
    const foreignChildKey: object = { agent: 'foreign' }
    bindScopeParent(foreignChildKey, otherKey)
    const orphanKey: object = { agent: 'orphan' }

    const teamRowCtx = teamStanding.ctx.extend({
      // A preset row reads `permission` through its hard injection; the plain
      // double keeps installRecoveredRules off the Cordis inject proxy.
      permission: { loadRuleLayers: vi.fn().mockResolvedValue({ rules: [], managedPresent: false, projectPresent: false }) },
    }) // a preset row context inherits the standing tag
    const child = (scopeCtx: Context, events: readonly { type: string; data: unknown }[]) => {
      const guard = vi.fn((_fn: unknown) => vi.fn())
      // `extend` defines own properties (the Context proxy rejects plain
      // assignment), shadowing the inherited scope tag with the child's own
      // agent/tools test doubles while preserving scopeOf resolution.
      const ctx = scopeCtx.extend({
        agent: { session: { events, header: {} } },
        tools: { guard },
        on: vi.fn(() => vi.fn()),
      })
      return { ctx, guard }
    }
    const memberBound = [{ type: 'team/member-bound', data: bound({ mcpServers: { servers: ['a'] } }) }]
    return {
      teamRowCtx,
      own: child(createScope(root, ownChildKey).ctx, memberBound),
      foreign: child(createScope(root, foreignChildKey).ctx, memberBound),
      orphan: child(createScope(root, orphanKey).ctx, memberBound),
    }
  }

  it('installs into a child derived under the registration’s own standing composition', () => {
    const f = scopedFixture()
    const dispose = teamMemberSetupContribution(f.teamRowCtx)(f.own.ctx)
    expect(f.own.guard).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('skips a child derived under a different standing composition', () => {
    const f = scopedFixture()
    const dispose = teamMemberSetupContribution(f.teamRowCtx)(f.foreign.ctx)
    expect(f.foreign.guard).not.toHaveBeenCalled()
    expect(() => { dispose() }).not.toThrow()
  })

  it('skips a child whose scope has no standing parent', () => {
    const f = scopedFixture()
    const dispose = teamMemberSetupContribution(f.teamRowCtx)(f.orphan.ctx)
    expect(f.orphan.guard).not.toHaveBeenCalled()
    expect(() => { dispose() }).not.toThrow()
  })

  it('keeps installing every team child when the row runs on the host plane (no scope tag)', () => {
    const f = scopedFixture()
    const dispose = teamMemberSetupContribution(hostCtx)(f.foreign.ctx)
    expect(f.foreign.guard).toHaveBeenCalledTimes(1)
    dispose()
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

describe('rule-layer recovery on setup', () => {
  const childSessionId = 'child-rules'
  const home = '/tmp/dsh-rule-home'
  const workspace = '/tmp/dsh-rule-ws'

  /** A child-context stand-in with a session id, header cwd, and an observable guard. */
  function ruleChild(overrides: Partial<TeamMemberBoundData> = {}) {
    const disposeGuard = vi.fn()
    const guard = vi.fn((_fn: unknown) => disposeGuard)
    const on = vi.fn(() => vi.fn())
    const ctx = {
      agent: {
        session: {
          id: childSessionId,
          events: [{ type: 'team/member-bound', data: bound(overrides) }],
          header: { cwd: workspace },
        },
      },
      tools: { guard },
      on,
    } as unknown as Context
    return { ctx, guard, on }
  }

  /** A permission-service stand-in mirroring the structural contract. */
  function permissionStub(loaded: {
    readonly rules: readonly { raw: string; kind: string; layer: string }[]
    readonly managedPresent: boolean
    readonly projectPresent: boolean
  } | Error) {
    return {
      loadRuleLayers: vi.fn().mockImplementation(() =>
        loaded instanceof Error ? Promise.reject(loaded) : Promise.resolve(loaded)),
    }
  }

  function permissionHost(permission: unknown) {
    const get = (_name: string) => undefined
    return { ctx: { get, permission } as unknown as Context, permission }
  }

  it('reconstructs the rule set from the durable snapshot plus a re-read of the file layers', async () => {
    vi.stubEnv('DSH_HOME', home)
    const loaded = {
      rules: [
        { raw: 'Bash(rm -rf *)', kind: 'deny', layer: 'managed' },
        { raw: 'Bash(git status:*)', kind: 'allow', layer: 'project' },
        { raw: 'Bash(git push:*)', kind: 'ask', layer: 'teammate' },
      ],
      managedPresent: true,
      projectPresent: true,
    }
    const permission = permissionStub(loaded)
    const host = permissionHost(permission)
    const child = ruleChild({
      rules: { ask: ['Bash(git push:*)'] },
      permissionMode: 'enforce',
      managedPresent: true,
    })

    const dispose = teamMemberSetupContribution(host.ctx)(child.ctx)

    expect(permission.loadRuleLayers).toHaveBeenCalledTimes(1)
    expect(permission.loadRuleLayers).toHaveBeenCalledWith({
      managedPath: join(home, 'permissions.yml'),
      projectPath: join(workspace, '.dsh', 'permissions.yml'),
      teammateRules: { ask: ['Bash(git push:*)'] },
      managedPresent: true,
    })
    const stored = getRecoveredRuleLayers(SessionId(childSessionId))
    expect(stored).toBeDefined()
    await expect(stored).resolves.toEqual(loaded)
    dispose()
    vi.unstubAllEnvs()
  })

  it('cold-resumes a pre-rules member-bound payload without a teammate snapshot', async () => {
    vi.stubEnv('DSH_HOME', home)
    const loaded = { rules: [], managedPresent: false, projectPresent: false }
    const permission = permissionStub(loaded)
    const host = permissionHost(permission)
    // A payload written before the rules fields existed: no rules, no managedPresent.
    const child = ruleChild()

    const dispose = teamMemberSetupContribution(host.ctx)(child.ctx)

    expect(permission.loadRuleLayers).toHaveBeenCalledTimes(1)
    expect(permission.loadRuleLayers).toHaveBeenCalledWith({
      managedPath: join(home, 'permissions.yml'),
      projectPath: join(workspace, '.dsh', 'permissions.yml'),
    })
    await expect(getRecoveredRuleLayers(SessionId(childSessionId))).resolves.toEqual(loaded)
    dispose()
    vi.unstubAllEnvs()
  })

  it('holds a lapsed-managed rejection on the store instead of letting it escape', async () => {
    vi.stubEnv('DSH_HOME', home)
    const lapse = new Error('managed rule file is missing; refusing to run a session that was bound under it')
    const permission = permissionStub(lapse)
    const host = permissionHost(permission)
    const child = ruleChild({ managedPresent: true })

    const dispose = teamMemberSetupContribution(host.ctx)(child.ctx)

    await expect(getRecoveredRuleLayers(SessionId(childSessionId))).rejects.toThrow(lapse.message)
    dispose()
    vi.unstubAllEnvs()
  })

  it('releases the rule state when the child disposes', async () => {
    vi.stubEnv('DSH_HOME', home)
    const permission = permissionStub({ rules: [], managedPresent: false, projectPresent: false })
    const host = permissionHost(permission)
    const child = ruleChild()

    const dispose = teamMemberSetupContribution(host.ctx)(child.ctx)
    expect(getRecoveredRuleLayers(SessionId(childSessionId))).toBeDefined()
    dispose()
    expect(getRecoveredRuleLayers(SessionId(childSessionId))).toBeUndefined()
    vi.unstubAllEnvs()
  })
})
