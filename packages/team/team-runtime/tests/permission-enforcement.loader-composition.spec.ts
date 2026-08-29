/**
 * Real-Loader composition proof for the teammate permission enforcement hook:
 * the team runtime, the spawn provider, the permission engine, and the leader
 * tools boot together through the test-only `cordis.yml`, a real leader agent
 * (scripted by the keyless `m3-mock` adapter) delegates to a real teammate
 * child, and every tool call the child makes is adjudicated at the executor.
 *
 * - an enforce-mode teammate (no declared mode) with no matching rule is
 *   denied by the mode fallback at the executor — the tool stays in the
 *   child's schema; the denial is the tool result, audited as
 *   `permission/decision`;
 * - a teammate `ask` rule suspends the call at the leader rendezvous: the
 *   leader decides `allow_once` through the real `team_control` tool and the
 *   suspended call then runs;
 * - a managed `deny` rule (the `$DSH_HOME` file layer) pierces the teammate's
 *   `allow` rule and the `default` mode.
 *
 * Only the model is mocked; the composition, the continuation materialization,
 * the executor, the rule layers, and the rendezvous are all the shipped code.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { ToolCallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawnInProcess from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TeamRegistry from '@deepseek-ai/dsh-team'
import * as TeamLocal from '@deepseek-ai/dsh-team-local'
import * as TeamChannels from '@deepseek-ai/dsh-team-channels'
import * as TeamRuntime from '@deepseek-ai/dsh-team-runtime'
import * as PermissionEngine from '@deepseek-ai/dsh-permission-engine'
import * as ToolTeam from '@deepseek-ai/dsh-tool-team'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'

const MOCK_ROUTE = { provider: 'm3-mock', model: 'm3-mock' }
const TASK_PROMPT = 'M3_TASK: call the probe tool with the note m3.'
const SCENARIO = (memberId: string): string => `M3_SCENARIO: delegate the probe task to ${memberId}.`

const MEMBER_DEFS: Record<string, string> = {
  'm3-leader.md': [
    '---',
    'schemaVersion: 1',
    'id: leader-a',
    'role: leader',
    'name: M3 Leader',
    'description: M3 composition test leader.',
    'provider: m3-mock',
    'model: m3-mock',
    '---',
    '',
    'You are the leader. Delegate the probe task and review approval requests.',
    '',
  ].join('\n'),
  'worker-enforce.md': [
    '---',
    'schemaVersion: 1',
    'id: worker-enforce',
    'role: teammate',
    'name: Enforce Worker',
    'description: M3 worker without a declared mode (the enforce default).',
    'provider: m3-mock',
    'model: m3-mock',
    '---',
    '',
    'You are a worker. Call the probe tool.',
    '',
  ].join('\n'),
  'worker-ask.md': [
    '---',
    'schemaVersion: 1',
    'id: worker-ask',
    'role: teammate',
    'name: Ask Worker',
    'description: M3 worker whose probe calls ask the leader.',
    'provider: m3-mock',
    'model: m3-mock',
    'permissionMode: default',
    'permissions:',
    '  ask:',
    '    - probe(note:*)',
    '---',
    '',
    'You are a worker. Call the probe tool.',
    '',
  ].join('\n'),
  'worker-managed.md': [
    '---',
    'schemaVersion: 1',
    'id: worker-managed',
    'role: teammate',
    'name: Managed Worker',
    'description: M3 worker with a probe allow rule under default mode.',
    'provider: m3-mock',
    'model: m3-mock',
    'permissionMode: default',
    'permissions:',
    '  allow:',
    '    - probe(note:*)',
    '---',
    '',
    'You are a worker. Call the probe tool.',
    '',
  ].join('\n'),
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.unstubAllEnvs()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Poll `condition` until true or the budget expires. */
async function waitFor(
  label: string,
  budgetMs: number,
  condition: () => Promise<boolean> | boolean,
  diagnose?: () => string,
): Promise<void> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (await condition()) return
    if (Date.now() >= deadline) {
      throw new Error(`permission-enforcement: timed out waiting for ${label}\n${diagnose?.() ?? ''}`)
    }
    await new Promise((resolve) => { setTimeout(resolve, 100) })
  }
}

/** One session's log as compact type + data lines (all event data is JSON-valid). */
function dumpEvents(agent: Agent): string {
  const lines = agent.session.events
    .map(event => `${event.type} ${JSON.stringify(event.data).slice(0, 300)}`)
  return lines.slice(-40).join('\n')
}

/** The events of one session, narrowed to one type. */
function eventsOfType<E extends SessionEvent['type']>(
  events: readonly SessionEvent[],
  type: E,
): Extract<SessionEvent, { type: E }>[] {
  return events.filter((event): event is Extract<SessionEvent, { type: E }> => event.type === type)
}

/** Generate the test-only cordis.yml: the full team + permission stack. */
function compositionYml(sessionsDir: string, home: string, workspace: string): string {
  return [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-loop'",
    "- name: '@deepseek-ai/dsh-subagent'",
    "- name: '@deepseek-ai/dsh-subagent-spawn-in-process'",
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `    root: '${sessionsDir}'`,
    '    compression: none',
    "- name: '@deepseek-ai/dsh-team'",
    "- name: '@deepseek-ai/dsh-team-local'",
    '  config:',
    `    homePath: '${home}'`,
    `    workspacePath: '${workspace}'`,
    "- name: '@deepseek-ai/dsh-team-runtime'",
    "- name: '@deepseek-ai/dsh-team-channels'",
    "- name: '@deepseek-ai/dsh-tool-team'",
    "- name: '@deepseek-ai/dsh-permission-engine'",
    '- name: m3-mock-llm',
    '- name: m3-probe-tool',
    '',
  ].join('\n')
}

interface BootResult {
  ctx: Context
  home: string
  workspace: string
}

/** Boot the team + permission composition through the real Loader. */
async function boot(managedRules?: string): Promise<BootResult> {
  root = await mkdtemp(join(tmpdir(), 'dsh-team-m3-'))
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  const sessionsDir = join(root, 'sessions')
  await mkdir(join(home, 'teammates'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await mkdir(sessionsDir, { recursive: true })
  for (const [file, content] of Object.entries(MEMBER_DEFS)) {
    await writeFile(join(home, 'teammates', file), content)
  }
  if (managedRules !== undefined) {
    await writeFile(join(home, 'permissions.yml'), managedRules)
  }
  vi.stubEnv('DSH_HOME', home)

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, compositionYml(sessionsDir, home, workspace))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@deepseek-ai/dsh-subagent-spawn-in-process', SubagentSpawnInProcess],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-team', TeamRegistry],
    ['@deepseek-ai/dsh-team-local', TeamLocal],
    ['@deepseek-ai/dsh-team-channels', TeamChannels],
    ['@deepseek-ai/dsh-team-runtime', TeamRuntime],
    ['@deepseek-ai/dsh-tool-team', ToolTeam],
    ['@deepseek-ai/dsh-permission-engine', PermissionEngine],
    ['m3-mock-llm', MockLlmPlugin],
    ['m3-probe-tool', ProbeToolPlugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const module = modules.get(specifier)
      if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return module
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, home, workspace }
}

/** Create the real leader agent and wait for the team registry to list it. */
async function createLeader(ctx: Context, workspace: string): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId: SessionId('m3-leader-session'),
    meta: { cwd: workspace },
    agentOptions: MOCK_ROUTE,
  })
  const leader = handle.agent
  await waitFor('the team registry to list the worker set', 25_000, () => {
    const listed = ctx.team.list().map(member => String(member.id))
    return ['leader-a', 'worker-enforce', 'worker-ask', 'worker-managed'].every(id => listed.includes(id))
  })
  return leader
}

/** Resolve the first agent created with the leader as its direct parent. */
function observeChild(ctx: Context, leader: Agent): Promise<Agent> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/created', (payload) => {
      const { agent } = payload
      if (agent.session.header.parentSession === leader.id) {
        dispose()
        resolve(agent)
      }
    })
  })
}

/** Drive one leader task (fire-and-forget; the scenario waits on session logs). */
function drive(leader: Agent, text: string): void {
  leader.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** The `permission/decision` audit payloads logged by one child session. */
function auditsOf(child: Agent): Extract<SessionEvent, { type: 'permission/decision' }>['data'][] {
  return eventsOfType(child.session.events, 'permission/decision').map(event => event.data)
}

/**
 * The rendered text of the child's `probe` tool result, when settled: the
 * `tool/call` is paired with the nested `tool-result` block by `callId`.
 */
function probeResultText(child: Agent): string {
  for (const call of eventsOfType(child.session.events, 'tool/call')) {
    if (call.data.name !== 'probe') continue
    for (const event of eventsOfType(child.session.events, 'tool/result')) {
      for (const block of event.data.message.content) {
        if (block.type !== 'tool-result' || block.toolCallId !== call.data.callId) continue
        return block.content
          .filter(inner => inner.type === 'text')
          .map(inner => inner.text ?? '')
          .join('')
      }
    }
  }
  return ''
}

// --- The scripted model ------------------------------------------------------

/** One visible message, structurally read for the scripted decisions. */
interface HistoryMessage {
  readonly role: string
  readonly content: readonly {
    readonly type: string
    readonly text?: string
    readonly name?: string
    readonly id?: string
    readonly arguments?: string
    readonly toolCallId?: string
    readonly isError?: boolean
  }[]
  readonly source?: { readonly kind: string }
}

function historyOf(options: GenerateOptions): readonly HistoryMessage[] {
  return options.messages
}

function textOf(message: HistoryMessage): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('')
}

function historyHasMarker(messages: readonly HistoryMessage[], marker: string): boolean {
  return messages.some(message => message.role === 'user'
    && message.source?.kind !== 'tool'
    && textOf(message).includes(marker))
}

/** The newest tool call whose result has been delivered. */
function lastCompletedToolCall(messages: readonly HistoryMessage[]): {
  name: string
  isError: boolean
} | undefined {
  const answered = new Set<string>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool-result' && block.toolCallId !== undefined) answered.add(block.toolCallId)
    }
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message === undefined) continue
    if (message.role !== 'assistant') continue
    for (let j = message.content.length - 1; j >= 0; j -= 1) {
      const block = message.content[j]
      if (block === undefined) continue
      if (block.type !== 'tool-call' || block.id === undefined || !answered.has(block.id)) continue
      const result = messages
        .flatMap(m => m.content)
        .find(candidate => candidate.type === 'tool-result' && candidate.toolCallId === block.id)
      return { name: block.name ?? '', isError: result?.isError === true }
    }
  }
  return undefined
}

/** Every approval request the leader has not decided yet, newest first. */
function pendingApprovals(messages: readonly HistoryMessage[]): { requestId: string }[] {
  const pending: { requestId: string }[] = []
  const decided = (requestId: string): boolean => messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === 'team_control'
      && (() => {
        try {
          return (JSON.parse(block.arguments ?? '{}') as { request_id?: unknown }).request_id === requestId
        } catch {
          return false
        }
      })()))
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message === undefined) continue
    if (message.role !== 'user' || message.source?.kind === 'tool') continue
    const match = /requests approval to run "([^"]+)" \(request ([0-9a-f-]+)\)/.exec(textOf(message))
    if (match === null || match[2] === undefined) continue
    if (decided(match[2])) continue
    pending.push({ requestId: match[2] })
  }
  return pending
}

function delegatedTo(messages: readonly HistoryMessage[], memberId: string): boolean {
  return messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === 'delegate_to_teammate'
      && (() => {
        try {
          return (JSON.parse(block.arguments ?? '{}') as { teammate_id?: unknown }).teammate_id === memberId
        } catch {
          return false
        }
      })()))
}

function callOrdinal(messages: readonly HistoryMessage[], tool: string): number {
  let n = 0
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      if (block.type === 'tool-call' && block.name === tool) n += 1
    }
  }
  return n + 1
}

/** Script one response from the visible history (deterministic, keyless). */
function script(options: GenerateOptions): StreamChunk[] {
  const messages = historyOf(options)
  const toolResponse = (tool: string, args: Record<string, unknown>): StreamChunk[] =>
    toolCallChunks(`m3-${tool}-${callOrdinal(messages, tool)}`, tool, args)

  if (historyHasMarker(messages, 'M3_SCENARIO')) {
    const pending = pendingApprovals(messages)
    const firstPending = pending[0]
    if (firstPending !== undefined) {
      return toolResponse('team_control', {
        action: 'decide',
        request_id: firstPending.requestId,
        decision: 'allow_once',
      })
    }
    const match = /M3_SCENARIO: delegate the probe task to (\S+)\./.exec(
      messages.flatMap(message => message.content)
        .filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join(''),
    )
    const memberId = match?.[1]
    if (memberId !== undefined && !delegatedTo(messages, memberId)) {
      return toolResponse('delegate_to_teammate', {
        teammate_id: memberId,
        action: 'run',
        prompt: TASK_PROMPT,
      })
    }
    return textChunks('Leader done.')
  }

  if (historyHasMarker(messages, TASK_PROMPT)) {
    const lastCall = lastCompletedToolCall(messages)
    if (lastCall?.name === 'probe') return textChunks('Worker settled.')
    return toolResponse('probe', { note: 'm3' })
  }

  return textChunks('No action.')
}

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 7, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallChunks(rawCallId: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  const callId = ToolCallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 11, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** Keyless scripted adapter for the `m3-mock` route. */
class M3MockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    for (const chunk of script(options)) yield chunk
  }
}

/** Test-only plugin registering the `m3-mock` LLM route. */
const MockLlmPlugin = {
  name: 'm3-mock-llm',
  inject: ['llm'],
  apply(ctx: Context): void {
    ctx.llm.registerAdapter(['m3-mock'], new M3MockAdapter())
  },
}

/** Test-only plugin registering the `probe` tool every child may attempt. */
const ProbeToolPlugin = {
  name: 'm3-probe-tool',
  inject: ['tools'],
  apply(ctx: Context): void {
    ctx.effect(
      () => ctx.tools.register(defineTool({
        name: 'probe',
        description: 'Echo probe used by the M3 permission tests.',
        parameters: {
          note: {
            type: 'string' as const,
            required: true as const,
            description: 'A note to echo back.',
          },
        },
        output: {
          schema: {
            type: 'object' as const,
            additionalProperties: false as const,
            properties: {
              text: { type: 'string' as const, required: true as const },
            },
          },
          render(_args: unknown, value: { text: string }) {
            return [{ type: 'text' as const, text: value.text }]
          },
        },
        async execute(args: { note: string }) {
          return { text: `probe ok: ${args.note}` }
        },
      })),
      'm3-probe-tool.register()',
    )
  },
}

// --- The scenarios -----------------------------------------------------------

describe('teammate permission enforcement through a real Loader composition', () => {
  it('denies an unmatched call of an enforce-mode teammate at the executor, audited, with the tool still in the schema', async () => {
    const { ctx, workspace } = await boot()
    const leader = await createLeader(ctx, workspace)
    const childPromise = observeChild(ctx, leader)
    drive(leader, SCENARIO('worker-enforce'))

    const child = await childPromise
    await waitFor('the settled probe denial in the child log', 45_000,
      () => probeResultText(child) !== '',
      () => `LEADER:\n${dumpEvents(leader)}\nCHILD:\n${dumpEvents(child)}`)

    const audits = auditsOf(child)
    expect(audits).toHaveLength(1)
    expect(audits[0]!).toEqual({
      toolName: 'probe',
      decision: 'deny',
      mode: 'enforce',
      memberId: 'worker-enforce',
      cause: 'mode',
    })
    // The call reached the executor and settled denied there: the tool result
    // carries the engine's mode-fallback reason.
    expect(probeResultText(child)).toContain('no matching allow rule (enforce mode)')
    // Not schema absence: the tool is still offered to the child.
    expect(child.ctx.tools.schemas(child).map(schema => schema.name)).toContain('probe')
  }, 90_000)

  it('suspends an ask at the leader rendezvous, and the leader-approved call then runs', async () => {
    const { ctx, workspace } = await boot()
    const leader = await createLeader(ctx, workspace)
    const childPromise = observeChild(ctx, leader)
    drive(leader, SCENARIO('worker-ask'))

    const child = await childPromise
    await waitFor('the probe to run after the leader decision', 45_000,
      () => probeResultText(child).includes('probe ok'),
      () => `LEADER:\n${dumpEvents(leader)}\nCHILD:\n${dumpEvents(child)}`)

    const audits = auditsOf(child)
    expect(audits).toHaveLength(1)
    expect(audits[0]!).toEqual({
      toolName: 'probe',
      decision: 'ask',
      mode: 'default',
      memberId: 'worker-ask',
      matchedRuleRaw: 'probe(note:*)',
      layer: 'teammate',
    })
    // The rendezvous left its durable trail: the request on the child, the
    // leader's decision on the leader.
    const requests = eventsOfType(child.session.events, 'team/control-request')
    expect(requests).toHaveLength(1)
    expect(requests[0]!.data).toMatchObject({
      memberId: 'worker-ask',
      toolName: 'probe',
      reason: 'requested by rule "probe(note:*)" (teammate)',
    })
    const decisions = eventsOfType(leader.session.events, 'team/control-decision')
    expect(decisions).toHaveLength(1)
    expect(decisions[0]!.data).toMatchObject({ decision: 'allow_once', requestId: requests[0]!.data.requestId })
    // The approved call ran to success.
    expect(probeResultText(child)).toContain('probe ok: m3')
  }, 90_000)

  it('lets a managed deny rule pierce a teammate allow rule under default mode', async () => {
    const { ctx, workspace } = await boot([
      'permissions:',
      '  deny:',
      '    - probe(note:*)',
      '',
    ].join('\n'))
    const leader = await createLeader(ctx, workspace)
    const childPromise = observeChild(ctx, leader)
    drive(leader, SCENARIO('worker-managed'))

    const child = await childPromise
    await waitFor('the settled probe denial in the child log', 45_000,
      () => probeResultText(child) !== '',
      () => `LEADER:\n${dumpEvents(leader)}\nCHILD:\n${dumpEvents(child)}`)

    const audits = auditsOf(child)
    expect(audits).toHaveLength(1)
    expect(audits[0]!).toEqual({
      toolName: 'probe',
      decision: 'deny',
      mode: 'default',
      memberId: 'worker-managed',
      matchedRuleRaw: 'probe(note:*)',
      layer: 'managed',
      cause: 'rule',
    })
    expect(probeResultText(child)).toContain('denied by rule "probe(note:*)" (managed)')
    expect(child.ctx.tools.schemas(child).map(schema => schema.name)).toContain('probe')
  }, 90_000)
})
