import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import { TeamOrchestrator } from '@deepseek-ai/dsh-team-runtime'
import { registerDelegateTool } from '../src/tool-delegate.ts'

type DelegateOutcome = { status: string; teammate_id: string; message?: string }

interface SubagentStubs {
  startContinuable: ReturnType<typeof vi.fn>
  followup: ReturnType<typeof vi.fn>
  interrupt: ReturnType<typeof vi.fn>
}

function member(overrides: Partial<TeamMemberDefinition> = {}): TeamMemberDefinition {
  return {
    id: TeamMemberId('B1'),
    role: 'teammate',
    name: 'Worker Bee',
    description: 'Does delegated work',
    prompt: 'Be a worker.',
    ...overrides,
  }
}

const leader = { id: 'leader-1' }

function defaultSubagents(): SubagentStubs {
  return {
    startContinuable: vi.fn().mockResolvedValue({ childId: 'child-fresh', messageId: 'msg-fresh' }),
    followup: vi.fn().mockResolvedValue('msg-delivered'),
    interrupt: vi.fn(),
  }
}

function makeCtx(members: TeamMemberDefinition[] = [member()], subagents: SubagentStubs = defaultSubagents()) {
  const team = {
    get: (id: TeamMemberId) => members.find(m => m.id === id),
    effectiveToolPolicy: () => ({}),
  }
  let registered: { execute(args: unknown, exec: unknown): Promise<unknown> } | undefined
  const ctx = {
    get: (name: string) => (name === 'team' ? team : name === 'subagents' ? subagents : undefined),
    tools: {
      register: (definition: { execute(args: unknown, exec: unknown): Promise<unknown> }) => {
        registered = definition
        return vi.fn()
      },
    },
  }
  const invoke = async (args: Record<string, unknown>): Promise<DelegateOutcome> => {
    if (!registered) throw new Error('delegate_to_teammate tool not registered')
    const exec = { agent: leader, signal: new AbortController().signal }
    return (await registered.execute(args, exec)) as DelegateOutcome
  }
  return { ctx: ctx as unknown as Context, subagents, invoke }
}

describe('registerDelegateTool shutdown action', () => {
  it('interrupts a running activation and disposes it', async () => {
    const { ctx, subagents, invoke } = makeCtx()
    const orch = new TeamOrchestrator()
    registerDelegateTool(ctx, orch)
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')

    const result = await invoke({ teammate_id: 'B1', prompt: 'stop', action: 'shutdown' })

    expect(result.status).toBe('shutdown')
    expect(result.message).toContain('may keep running briefly')
    expect(subagents.interrupt).toHaveBeenCalledTimes(1)
    expect(subagents.interrupt).toHaveBeenCalledWith(SessionId('child-1'), { kind: 'ancestor', agent: leader })
    expect(orch.get(memberId)?.status).toBe('disposed')
  })

  it('returns an informational result without interrupting when no activation exists', async () => {
    const { ctx, subagents, invoke } = makeCtx()
    const orch = new TeamOrchestrator()
    registerDelegateTool(ctx, orch)
    const memberId = TeamMemberId('B1')

    const result = await invoke({ teammate_id: 'B1', prompt: 'stop', action: 'shutdown' })

    expect(result.status).toBe('shutdown')
    expect(result.message).toContain('No active session')
    expect(subagents.interrupt).not.toHaveBeenCalled()
    expect(orch.get(memberId)).toBeUndefined()
  })

  it('disposes a settled activation without interrupting it', async () => {
    const { ctx, subagents, invoke } = makeCtx()
    const orch = new TeamOrchestrator()
    registerDelegateTool(ctx, orch)
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')
    orch.markSettled(memberId)

    const result = await invoke({ teammate_id: 'B1', prompt: 'stop', action: 'shutdown' })

    expect(result.status).toBe('shutdown')
    expect(result.message).toContain('shut down')
    expect(subagents.interrupt).not.toHaveBeenCalled()
    expect(orch.get(memberId)?.status).toBe('disposed')
  })

  it('keeps the activation running when the interrupt throws', async () => {
    const { ctx, subagents, invoke } = makeCtx()
    const orch = new TeamOrchestrator()
    registerDelegateTool(ctx, orch)
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')
    subagents.interrupt.mockImplementation(() => { throw new Error('unauthorized') })

    const result = await invoke({ teammate_id: 'B1', prompt: 'stop', action: 'shutdown' })

    expect(result.status).toBe('error')
    expect(result.message).toMatch(/^Interrupt failed: /)
    expect(orch.get(memberId)?.status).toBe('running')
  })
})

describe('registerDelegateTool run action context policy', () => {
  it('reuses the settled child session when contextPolicy is persistent', async () => {
    const { ctx, subagents, invoke } = makeCtx([member({ contextPolicy: 'persistent' })])
    const orch = new TeamOrchestrator()
    registerDelegateTool(ctx, orch)
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')
    orch.markSettled(memberId)

    const result = await invoke({ teammate_id: 'B1', prompt: 'keep going' })

    expect(result.status).toBe('dispatched')
    expect(result.message).toContain('Worker Bee')
    expect(result.message).toContain('existing session')
    expect(subagents.followup).toHaveBeenCalledTimes(1)
    const [parent, childId, content, options] = subagents.followup.mock.calls[0]! as [unknown, unknown, unknown, unknown]
    expect(parent).toBe(leader)
    expect(childId).toBe(SessionId('child-1'))
    expect(content).toEqual([{ type: 'text', text: 'keep going' }])
    expect(options).toMatchObject({ source: { kind: 'coordinator', form: 'relay', senderSessionId: 'leader-1' } })
    expect(subagents.startContinuable).not.toHaveBeenCalled()
    expect(orch.get(memberId)?.status).toBe('running')
    expect(orch.get(memberId)?.childSessionId).toBe('child-1')
  })

  it('reuses the settled child session when contextPolicy is undefined (default persistent)', async () => {
    const { ctx, subagents, invoke } = makeCtx()
    const orch = new TeamOrchestrator()
    registerDelegateTool(ctx, orch)
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')
    orch.markSettled(memberId)

    const result = await invoke({ teammate_id: 'B1', prompt: 'keep going' })

    expect(result.status).toBe('dispatched')
    expect(subagents.followup).toHaveBeenCalledTimes(1)
    expect(subagents.startContinuable).not.toHaveBeenCalled()
    expect(orch.get(memberId)?.status).toBe('running')
    expect(orch.get(memberId)?.childSessionId).toBe('child-1')
  })

  it('starts a fresh child session when contextPolicy is fresh_per_delegation', async () => {
    const { ctx, subagents, invoke } = makeCtx([member({ contextPolicy: 'fresh_per_delegation' })])
    const orch = new TeamOrchestrator()
    registerDelegateTool(ctx, orch)
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')
    orch.markSettled(memberId)

    const result = await invoke({ teammate_id: 'B1', prompt: 'start over' })

    expect(result.status).toBe('dispatched')
    expect(subagents.startContinuable).toHaveBeenCalledTimes(1)
    expect(subagents.followup).not.toHaveBeenCalled()
    expect(orch.get(memberId)?.status).toBe('running')
  })

  it('starts a fresh child session for a disposed activation even with persistent policy', async () => {
    const { ctx, subagents, invoke } = makeCtx()
    const orch = new TeamOrchestrator()
    registerDelegateTool(ctx, orch)
    const memberId = TeamMemberId('B1')
    orch.recordActivation(memberId, 'child-1')
    orch.markDisposed(memberId)

    const result = await invoke({ teammate_id: 'B1', prompt: 'start over' })

    expect(result.status).toBe('dispatched')
    expect(subagents.startContinuable).toHaveBeenCalledTimes(1)
    expect(subagents.followup).not.toHaveBeenCalled()
    expect(orch.get(memberId)?.status).toBe('running')
    expect(orch.get(memberId)?.childSessionId).toBe('child-fresh')
  })
})

describe('registerDelegateTool member-bound payload', () => {
  it('includes the skills allowlist in the member-bound payload when the member defines skills', async () => {
    const { ctx, subagents, invoke } = makeCtx([member({ skills: ['codebase-design', 'tdd'] })])
    const orch = new TeamOrchestrator()
    registerDelegateTool(ctx, orch)

    const result = await invoke({ teammate_id: 'B1', prompt: 'go' })

    expect(result.status).toBe('dispatched')
    expect(subagents.startContinuable).toHaveBeenCalledTimes(1)
    const [options] = subagents.startContinuable.mock.calls[0]! as [
      { delegationEvents: readonly { type: string; data: Record<string, unknown> }[] },
    ]
    expect(options.delegationEvents[0]).toMatchObject({
      type: 'team/member-bound',
      data: { skills: ['codebase-design', 'tdd'] },
    })
  })

  it('omits the skills key from the member-bound payload when the member defines no skills', async () => {
    const { ctx, subagents, invoke } = makeCtx()
    const orch = new TeamOrchestrator()
    registerDelegateTool(ctx, orch)

    const result = await invoke({ teammate_id: 'B1', prompt: 'go' })

    expect(result.status).toBe('dispatched')
    expect(subagents.startContinuable).toHaveBeenCalledTimes(1)
    const [options] = subagents.startContinuable.mock.calls[0]! as [
      { delegationEvents: readonly { type: string; data: Record<string, unknown> }[] },
    ]
    expect(options.delegationEvents[0]!.data.skills).toBeUndefined()
  })
})
