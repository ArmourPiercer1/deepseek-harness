import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { TeamOrchestrator } from '@deepseek-ai/dsh-team-runtime'
import { registerSendMessageTool } from '../src/tool-send-message.ts'

interface CapturedTool {
  execute(args: Record<string, unknown>, exec: Record<string, unknown>): Promise<{ status: string; message?: string }>
}

function teamStub() {
  return {
    get: (id: string) => {
      if (id === 'teammate-1' || id === 'teammate-2') return { id, name: `Teammate ${id}`, role: 'teammate' }
      if (id === 'leader') return { id: 'leader', name: 'Leader', role: 'leader' }
      return undefined
    },
    getLeader: () => ({ id: 'leader', name: 'Leader', role: 'leader' }),
  }
}

function orchestratorStub() {
  return {
    get: vi.fn((id: string) => (id === 'teammate-1'
      ? { childSessionId: 'child-1', status: 'running' }
      : undefined)),
  }
}

function agentStub(role: 'leader' | 'teammate') {
  const events = role === 'teammate'
    ? [{ type: 'team/member-bound', data: { memberId: 'teammate-1', role: 'teammate' } }]
    : []
  const append = vi.fn()
  return {
    id: role === 'teammate' ? 'teammate-session' : 'leader-session',
    session: { events, append },
  }
}

async function captureTool(overrides: { subagents?: Record<string, unknown> } = {}) {
  const subagents = {
    followup: vi.fn().mockResolvedValue('msg-1'),
    reportFrom: vi.fn().mockResolvedValue('msg-2'),
    ...overrides.subagents,
  }
  let captured: CapturedTool | undefined
  const ctx = {
    get: (name: string) => (name === 'team' ? teamStub() : name === 'subagents' ? subagents : undefined),
    tools: { register: (tool: CapturedTool) => { captured = tool; return () => {} } },
  } as unknown as Context

  registerSendMessageTool(ctx, orchestratorStub() as unknown as TeamOrchestrator)
  return { subagents, execute: captured!.execute.bind(captured!) }
}

function exec(role: 'leader' | 'teammate') {
  return { agent: agentStub(role), signal: new AbortController().signal }
}

describe('send_team_message', () => {
  it('routes a leader message to the teammate session via followup', async () => {
    const { subagents, execute } = await captureTool()
    const result = await execute({ target_id: 'teammate-1', message: 'do the thing' }, exec('leader'))

    expect(subagents.followup).toHaveBeenCalledTimes(1)
    expect(subagents.reportFrom).not.toHaveBeenCalled()
    expect(result.status).toBe('sent')
  })

  it('routes a teammate message to the leader via reportFrom (wakeup)', async () => {
    const { subagents, execute } = await captureTool()
    const result = await execute({ target_id: 'leader', message: 'done' }, exec('teammate'))

    expect(subagents.reportFrom).toHaveBeenCalledTimes(1)
    expect(subagents.followup).not.toHaveBeenCalled()
    expect(result.status).toBe('sent')
  })

  it('appends a team/message event to the calling session', async () => {
    const agent = agentStub('leader')
    const { execute } = await captureTool()
    await execute({ target_id: 'teammate-1', message: 'hi' }, { agent, signal: new AbortController().signal })

    expect(agent.session.append).toHaveBeenCalledTimes(1)
    const [type, data] = agent.session.append.mock.calls[0] as [string, { to: string; message: string }]
    expect(type).toBe('team/message')
    expect(data).toMatchObject({ to: 'teammate-1', message: 'hi' })
  })

  it('returns an error for an unknown target', async () => {
    const { execute } = await captureTool()
    const result = await execute({ target_id: 'nobody', message: 'hi' }, exec('leader'))
    expect(result.status).toBe('error')
  })

  it('returns an error when a leader messages a teammate with no active session', async () => {
    const { execute } = await captureTool()
    const result = await execute({ target_id: 'teammate-2', message: 'hi' }, exec('leader'))
    expect(result.status).toBe('error')
    expect(result.message).toContain('Delegate first')
  })
})
