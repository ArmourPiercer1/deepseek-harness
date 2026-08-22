import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import { TeamOrchestrator } from '@deepseek-ai/dsh-team-runtime'
import { registerSendMessageTool } from '../src/tool-send-message.ts'

interface CapturedTool {
  execute(args: Record<string, unknown>, exec: Record<string, unknown>): Promise<{ status: string; message?: string }>
}

const teammateId = TeamMemberId('teammate-1')

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

async function captureTool(orchestrator = new TeamOrchestrator(), subagentOverrides: Record<string, unknown> = {}) {
  const subagents = {
    followup: vi.fn().mockResolvedValue('msg-1'),
    reportFrom: vi.fn().mockResolvedValue('msg-2'),
    ...subagentOverrides,
  }
  let captured: CapturedTool | undefined
  const ctx = {
    get: (name: string) => (name === 'team' ? teamStub() : name === 'subagents' ? subagents : undefined),
    tools: { register: (tool: CapturedTool) => { captured = tool; return () => {} } },
  } as unknown as Context

  registerSendMessageTool(ctx, orchestrator)
  return { subagents, orchestrator, execute: captured!.execute.bind(captured!) }
}

function exec(role: 'leader' | 'teammate') {
  return { agent: agentStub(role), signal: new AbortController().signal }
}

function recordedFollowup(subagents: { followup: ReturnType<typeof vi.fn> }) {
  return subagents.followup.mock.calls[0]! as [unknown, unknown, unknown, unknown]
}

describe('send_team_message', () => {
  it('delivers a leader message to a running teammate session via followup', async () => {
    const orchestrator = new TeamOrchestrator()
    orchestrator.recordActivation('leader-session', teammateId, 'child-1')
    const { subagents, execute } = await captureTool(orchestrator)
    const caller = exec('leader')

    const result = await execute({ target_id: 'teammate-1', message: 'do the thing' }, caller)

    expect(subagents.followup).toHaveBeenCalledTimes(1)
    const [parent, childId, content, options] = recordedFollowup(subagents)
    expect(parent).toBe(caller.agent)
    expect(childId).toBe(SessionId('child-1'))
    expect(content).toEqual([{ type: 'text', text: 'do the thing' }])
    expect(options).toMatchObject({ source: { kind: 'coordinator', form: 'relay', senderSessionId: 'leader-session' } })
    expect(subagents.reportFrom).not.toHaveBeenCalled()
    expect(result.status).toBe('sent')
    expect(result.message).toBe('Message delivered to Teammate teammate-1.')
    expect(orchestrator.get('leader-session', teammateId)?.status).toBe('running')
  })

  it('cold-resumes a settled teammate via followup and re-records the activation as running', async () => {
    const orchestrator = new TeamOrchestrator()
    orchestrator.recordActivation('leader-session', teammateId, 'child-1')
    orchestrator.markSettled('leader-session', teammateId)
    const { subagents, execute } = await captureTool(orchestrator)
    const caller = exec('leader')

    const result = await execute({ target_id: 'teammate-1', message: 'pick up where you left off' }, caller)

    expect(subagents.followup).toHaveBeenCalledTimes(1)
    const [parent, childId] = recordedFollowup(subagents)
    expect(parent).toBe(caller.agent)
    expect(childId).toBe(SessionId('child-1'))
    expect(subagents.reportFrom).not.toHaveBeenCalled()
    expect(result.status).toBe('sent')
    expect(orchestrator.get('leader-session', teammateId)?.status).toBe('running')
    expect(orchestrator.get('leader-session', teammateId)?.childSessionId).toBe('child-1')
  })

  it('cold-resumes a disposed teammate via followup and re-records the activation as running', async () => {
    const orchestrator = new TeamOrchestrator()
    orchestrator.recordActivation('leader-session', teammateId, 'child-1')
    orchestrator.markDisposed('leader-session', teammateId)
    const { subagents, execute } = await captureTool(orchestrator)
    const caller = exec('leader')

    const result = await execute({ target_id: 'teammate-1', message: 'the shutdown was a false alarm' }, caller)

    expect(subagents.followup).toHaveBeenCalledTimes(1)
    const [parent, childId] = recordedFollowup(subagents)
    expect(parent).toBe(caller.agent)
    expect(childId).toBe(SessionId('child-1'))
    expect(subagents.reportFrom).not.toHaveBeenCalled()
    expect(result.status).toBe('sent')
    expect(orchestrator.get('leader-session', teammateId)?.status).toBe('running')
  })

  it('keeps a settled activation settled when followup fails', async () => {
    const orchestrator = new TeamOrchestrator()
    orchestrator.recordActivation('leader-session', teammateId, 'child-1')
    orchestrator.markSettled('leader-session', teammateId)
    const { execute } = await captureTool(orchestrator, {
      followup: vi.fn().mockRejectedValue(new Error('inbox closed')),
    })

    const result = await execute({ target_id: 'teammate-1', message: 'hi' }, exec('leader'))

    expect(result.status).toBe('error')
    expect(result.message).toContain('Delivery failed')
    expect(orchestrator.get('leader-session', teammateId)?.status).toBe('settled')
  })

  it('returns an error when a leader messages a never-delegated teammate', async () => {
    const orchestrator = new TeamOrchestrator()
    const { subagents, execute } = await captureTool(orchestrator)

    const result = await execute({ target_id: 'teammate-2', message: 'hi' }, exec('leader'))

    expect(result.status).toBe('error')
    expect(result.message).toBe('No active session for "teammate-2". Delegate first.')
    expect(subagents.followup).not.toHaveBeenCalled()
    expect(subagents.reportFrom).not.toHaveBeenCalled()
    expect(orchestrator.get('leader-session', TeamMemberId('teammate-2'))).toBeUndefined()
  })

  it('routes a teammate message to the leader via reportFrom (wakeup)', async () => {
    const { subagents, execute } = await captureTool()
    const result = await execute({ target_id: 'leader', message: 'done' }, exec('teammate'))

    expect(subagents.reportFrom).toHaveBeenCalledTimes(1)
    expect(subagents.followup).not.toHaveBeenCalled()
    expect(result.status).toBe('sent')
  })

  it('relays a teammate message to a peer through a leader wakeup report', async () => {
    const { subagents, execute } = await captureTool()
    const caller = exec('teammate')

    const result = await execute({ target_id: 'teammate-2', message: 'review the draft' }, caller)

    expect(subagents.reportFrom).toHaveBeenCalledTimes(1)
    const [child, content, options] = subagents.reportFrom.mock.calls[0] as [
      unknown,
      { type: string; text: string }[],
      { delivery: string; signal: AbortSignal },
    ]
    expect(child).toBe(caller.agent)
    expect(content).toEqual([{ type: 'text', text: '[Message to Teammate teammate-2]: review the draft' }])
    expect(options).toMatchObject({ delivery: 'wakeup' })
    expect(subagents.followup).not.toHaveBeenCalled()
    expect(result.status).toBe('relayed')
    expect(result.message).toBe('Message to Teammate teammate-2 relayed to leader for forwarding.')
    expect(caller.agent.session.append).toHaveBeenCalledTimes(1)
    const [type, data] = caller.agent.session.append.mock.calls[0] as [string, { from: string; to: string; message: string }]
    expect(type).toBe('team/message')
    expect(data).toEqual({ from: 'teammate-1', to: 'teammate-2', message: 'review the draft' })
  })

  it('appends a team/message event to the calling session', async () => {
    const orchestrator = new TeamOrchestrator()
    orchestrator.recordActivation('leader-session', teammateId, 'child-1')
    const agent = agentStub('leader')
    const { execute } = await captureTool(orchestrator)
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
})
