/**
 * Proves the team tools register and run against their real services when
 * booted through the real Loader: `list_teammates` reads the registry, and
 * `team_progress` / `team_control` write durable events through the calling
 * agent's session.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TeamRegistry, { TeamMemberId } from '@deepseek-ai/dsh-team'
import * as TeamChannels from '@deepseek-ai/dsh-team-channels'
import * as ToolTeam from '@deepseek-ai/dsh-tool-team'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A minimal live Agent whose session carries the team tools' durable writes. */
function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('team-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

/** Boot the team tool composition through the real Loader. */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-team-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-team'",
    "- name: '@deepseek-ai/dsh-team-channels'",
    "- name: '@deepseek-ai/dsh-tool-team'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-team', TeamRegistry],
    ['@deepseek-ai/dsh-team-channels', TeamChannels],
    ['@deepseek-ai/dsh-tool-team', ToolTeam],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('tool-team real Loader composition through cordis.yml', () => {
  it('registers all five team tools', async () => {
    const ctx = await boot()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toEqual(expect.arrayContaining([
      'delegate_to_teammate', 'list_teammates', 'send_team_message', 'team_progress', 'team_control',
    ]))
  }, 30_000)

  it('list_teammates reads a registered teammate', async () => {
    const ctx = await boot()
    ctx.team.register([{
      id: TeamMemberId('backend'), role: 'teammate', name: 'Backend', description: 'server', prompt: 'You are backend.',
    }])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('list'),
      name: 'list_teammates',
      arguments: {},
      agent: agent(ctx),
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('Backend')
  }, 30_000)

  it('team_progress update appends a durable team/progress event', async () => {
    const ctx = await boot()
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('progress'),
      name: 'team_progress',
      arguments: { action: 'update', task_id: 't1', subject: 'Build', status: 'in_progress' },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(owner.session.events.some(e => e.type === 'team/progress')).toBe(true)
  }, 30_000)

  it('team_control lists and decides a pending request', async () => {
    const ctx = await boot()
    const owner = agent(ctx)
    const promise = ctx.teamControl.create(owner.id, {
      requestId: 'req-1', memberId: TeamMemberId('backend'), toolName: 'pwsh', reason: 'build',
    })

    const list = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('ctl-list'),
      name: 'team_control',
      arguments: { action: 'list' },
      agent: owner,
    })
    expect(list.isError).toBe(false)
    expect(resultText(list)).toContain('pwsh')

    const decide = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('ctl-decide'),
      name: 'team_control',
      arguments: { action: 'decide', request_id: 'req-1', decision: 'allow_once' },
      agent: owner,
    })
    expect(decide.isError).toBe(false)
    await expect(promise).resolves.toBe('allow_once')

    const planPromise = ctx.teamControl.create(owner.id, {
      requestId: 'req-plan', memberId: TeamMemberId('backend'), toolName: 'exit_plan_mode', reason: 'plan',
    })
    const decidePlan = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('ctl-decide-plan'),
      name: 'team_control',
      arguments: { action: 'decide', request_id: 'req-plan', decision: 'approve_plan' },
      agent: owner,
    })
    expect(decidePlan.isError).toBe(false)
    await expect(planPromise).resolves.toBe('approve_plan')

    const revPromise = ctx.teamControl.create(owner.id, {
      requestId: 'req-rev', memberId: TeamMemberId('backend'), toolName: 'exit_plan_mode', reason: 'plan',
    })
    const decideRev = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('ctl-decide-rev'),
      name: 'team_control',
      arguments: { action: 'decide', request_id: 'req-rev', decision: 'request_revision', reason: 'needs more steps' },
      agent: owner,
    })
    expect(decideRev.isError).toBe(false)
    await expect(revPromise).resolves.toBe('request_revision')
  }, 30_000)
})
