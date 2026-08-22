/**
 * Proves teammate tool activity reaches the orchestrator through the real
 * Loader: a `tool/call` appended to the running teammate's child session
 * populates activity tracking, so a second `delegate_to_teammate` reports
 * `already_running` naming the tool the teammate last invoked. Activity from
 * a session that matches no activation is ignored.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId, MessageId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TeamRegistry, { TeamMemberId } from '@deepseek-ai/dsh-team'
import * as TeamChannels from '@deepseek-ai/dsh-team-channels'
import * as ToolTeam from '@deepseek-ai/dsh-tool-team'
import type {
  ContinuableStart,
  ContinuableStartSpec,
  SubagentFollowupOptions,
  SubagentReportOptions,
} from '@deepseek-ai/dsh-subagent'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Stand-in for the subagent seam: accepts every continuable start with the
 * same durable child identity so `delegate_to_teammate` can record an
 * activation without a continuation runtime.
 */
class StubSubagents extends Service {
  constructor(ctx: Context) {
    super(ctx, 'subagents')
  }

  /** Accept one initial delegation against the stub child. */
  async startContinuable(_spec: ContinuableStartSpec): Promise<ContinuableStart> {
    return { childId: SessionId('team-child-1'), messageId: MessageId('stub-initial') }
  }

  /** Accept one follow-up delivery without touching the child. */
  async followup(
    _parent: Agent,
    _childId: SessionId,
    _content: ContentBlock[],
    _options: SubagentFollowupOptions,
  ): Promise<MessageId> {
    return MessageId('stub-followup')
  }

  /** Accept one child report without touching the parent. */
  async reportFrom(
    _child: Agent,
    _content: ContentBlock[],
    _options: SubagentReportOptions,
  ): Promise<MessageId> {
    return MessageId('stub-report')
  }
}

/** A minimal live Agent whose session carries the team tools' durable writes. */
function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('team-activity-agent')
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

/** Boot the team tool composition with a live session store through the real Loader. */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-team-activity-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-session'",
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
    ['@deepseek-ai/dsh-session', SessionStore],
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
  await ctx.plugin(StubSubagents)
  return ctx
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('teammate tool activity through the real Loader composition', () => {
  it('already_running reports the tool the running teammate last invoked', async () => {
    const ctx = await boot()
    ctx.team.register([{
      id: TeamMemberId('backend'), role: 'teammate', name: 'Backend', description: 'server', prompt: 'You are backend.',
    }])
    const leader = agent(ctx)

    const first = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('delegate-run'),
      name: 'delegate_to_teammate',
      arguments: { teammate_id: 'backend', prompt: 'work' },
      agent: leader,
    })
    expect(first.isError).toBe(false)
    expect(resultText(first)).toContain('[dispatched]')

    const child = ctx.sessions.create(SessionId('team-child-1'), {
      meta: { parentSession: SessionId('team-activity-agent'), origin: 'subagent' },
    })
    child.append('tool/call', { turn: 1, step: 1, callId: CallId('call-1'), name: 'pwsh', arguments: '{}' })

    const second = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('delegate-rerun'),
      name: 'delegate_to_teammate',
      arguments: { teammate_id: 'backend', prompt: 'work again' },
      agent: leader,
    })
    expect(second.isError).toBe(false)
    const secondText = resultText(second)
    expect(secondText).toContain('[already_running]')
    expect(secondText).toContain('pwsh')
  }, 30_000)

  it('ignores tool activity from a session that matches no activation', async () => {
    const ctx = await boot()
    ctx.team.register([{
      id: TeamMemberId('backend'), role: 'teammate', name: 'Backend', description: 'server', prompt: 'You are backend.',
    }])
    const leader = agent(ctx)

    const first = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('delegate-run-2'),
      name: 'delegate_to_teammate',
      arguments: { teammate_id: 'backend', prompt: 'work' },
      agent: leader,
    })
    expect(first.isError).toBe(false)
    expect(resultText(first)).toContain('[dispatched]')

    const child = ctx.sessions.create(SessionId('team-child-1'), {
      meta: { parentSession: SessionId('team-activity-agent'), origin: 'subagent' },
    })
    child.append('tool/call', { turn: 1, step: 1, callId: CallId('call-2'), name: 'pwsh', arguments: '{}' })

    const stranger = ctx.sessions.create(SessionId('team-stranger'), {
      meta: { parentSession: SessionId('team-activity-agent'), origin: 'subagent' },
    })
    stranger.append('tool/call', { turn: 1, step: 1, callId: CallId('call-3'), name: 'Get-Process', arguments: '{}' })

    const second = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('delegate-rerun-2'),
      name: 'delegate_to_teammate',
      arguments: { teammate_id: 'backend', prompt: 'work again' },
      agent: leader,
    })
    expect(second.isError).toBe(false)
    const secondText = resultText(second)
    expect(secondText).toContain('[already_running]')
    expect(secondText).toContain('pwsh')
    expect(secondText).not.toContain('Get-Process')
  }, 30_000)
})
