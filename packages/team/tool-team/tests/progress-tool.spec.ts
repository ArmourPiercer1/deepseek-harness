import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { TeamProgressStore } from '@deepseek-ai/dsh-team-channels'
import { registerProgressTool } from '../src/tool-progress.ts'

interface CapturedTool {
  execute(args: Record<string, unknown>, exec: Record<string, unknown>): Promise<Record<string, unknown>>
}

function captureTool() {
  const store = new TeamProgressStore()
  let captured: CapturedTool | undefined
  const ctx = { tools: { register: (tool: CapturedTool) => { captured = tool; return () => {} } } } as unknown as Context
  registerProgressTool(ctx, store)
  return { store, execute: captured!.execute.bind(captured!) }
}

function agent() {
  const events: { type: string; data: unknown }[] = []
  const append = vi.fn((type: string, data: unknown) => { events.push({ type, data }) })
  return { id: 'leader-1', session: { events, append } }
}

function exec(me = agent()) {
  return { agent: me, signal: new AbortController().signal }
}

describe('team_progress', () => {
  it('emits team/progress and updates the board', async () => {
    const { store, execute } = captureTool()
    const me = agent()
    const result = await execute(
      { action: 'update', task_id: 't1', subject: 'Do X', status: 'in_progress' },
      exec(me),
    )
    expect(result.message).toContain('updated')
    expect(me.session.append).toHaveBeenCalledWith('team/progress', expect.objectContaining({ taskId: 't1' }))
    expect(store.list('leader-1')).toHaveLength(1)
  })

  it('folds the durable log into the board on list', async () => {
    const { execute } = captureTool()
    const me = agent()
    // Simulate a cold resume: the session already carries a persisted event.
    me.session.events.push({
      type: 'team/progress',
      data: { taskId: 't1', subject: 'Do X', status: 'completed', memberId: 'backend' },
    })
    const result = await execute({ action: 'list' }, exec(me))
    const tasks = result.tasks as { status: string }[]
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.status).toBe('completed')
  })

  it('requires a subject for a new task', async () => {
    const { execute } = captureTool()
    const result = await execute({ action: 'update', task_id: 'new' }, exec())
    expect(result.message).toContain('subject is required')
  })
})
