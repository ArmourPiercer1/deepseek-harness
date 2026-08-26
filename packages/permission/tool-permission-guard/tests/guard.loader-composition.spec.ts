/**
 * Real-Loader composition proof for the `@deepseek-ai/dsh-tool-permission-guard`
 * Consumer. The guard row is booted through the real Loader next to the engine
 * provider, the system prompt, and the tool registry, and every decision is
 * asserted THROUGH THE EXECUTOR — the deny path as the error result the model
 * receives, the allow path as the dispatched tool result, and the ask path as
 * the approval seam's resolution — with the `permission/decision` audit event
 * read back from the acting session's log each time.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Message } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import * as PermissionEngine from '@deepseek-ai/dsh-permission-engine'
import * as ToolPermissionGuard from '@deepseek-ai/dsh-tool-permission-guard'
import type { PermissionDecisionData } from '@deepseek-ai/dsh-permission'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A minimal live Agent whose session carries the guard's durable audit writes. */
function probeAgent(id: string): Agent {
  return { session: Session.create(SessionId(id)) } as unknown as Agent
}

/**
 * A probeAgent whose session sits inside an open turn: the approval seam's
 * audit pair (approval/asked + approval/decided) must be turn-enclosed.
 */
function turnAgent(id: string): Agent {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  return { session } as unknown as Agent
}

/** The probe tool under guard, counting its dispatches for the tests. */
function makeProbeTool(dispatches: string[]) {
  return defineTool({
    name: 'probe',
    description: 'probe tool for the permission guard composition tests',
    parameters: { action: { type: 'string' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      dispatches.push(args.action ?? '')
      return `executed ${args.action ?? ''}`
    },
  })
}

/**
 * Boot the guard composition through the real Loader.
 * @param configLines - YAML lines nested under the guard row's `config:` key.
 * @param options - which rows are composed besides system prompt, tools, and the guard.
 * @returns the booted context.
 */
async function boot(
  configLines: readonly string[],
  options: { engine?: boolean; approval?: boolean } = {},
): Promise<Context> {
  const { engine = true, approval = false } = options
  root = await mkdtemp(join(tmpdir(), 'dsh-guard-loader-'))
  const configPath = join(root, 'cordis.yml')
  const rows: string[] = []
  if (engine) rows.push("- name: '@deepseek-ai/dsh-permission-engine'")
  rows.push("- name: '@deepseek-ai/dsh-system-prompt'", "- name: '@deepseek-ai/dsh-tools'")
  if (approval) rows.push("- name: '@deepseek-ai/dsh-user-approval'")
  rows.push("- name: '@deepseek-ai/dsh-tool-permission-guard'")
  if (configLines.length > 0) rows.push('  config:', ...configLines)
  await writeFile(configPath, [...rows, ''].join('\n'))

  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-tool-permission-guard', ToolPermissionGuard],
  ])
  if (engine) modules.set('@deepseek-ai/dsh-permission-engine', PermissionEngine)
  if (approval) modules.set('@deepseek-ai/dsh-user-approval', ApprovalService)

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
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

const GUARD_CONFIG = [
  '    mode: enforce',
  '    rules:',
  "      - raw: 'probe(action:secret*)'",
  '        kind: deny',
  '        layer: project',
  "      - raw: 'probe(action:ok*)'",
  '        kind: allow',
  '        layer: managed',
] as const

/** The `permission/decision` payloads logged by the session, in order. */
function permissionDecisions(session: Session): PermissionDecisionData[] {
  const decisions: PermissionDecisionData[] = []
  for (const event of session.events) {
    if (event.type === 'permission/decision') decisions.push(event.data)
  }
  return decisions
}

function resultText(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('tool-permission-guard real Loader composition through cordis.yml', () => {
  it('denies a rule-matched call through the executor and appends the audit event', async () => {
    const ctx = await boot(GUARD_CONFIG)
    const dispatches: string[] = []
    ctx.tools.register(makeProbeTool(dispatches))
    const agent = probeAgent('guard-deny')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('deny-1'),
      name: 'probe', arguments: { action: 'secret-data' }, agent,
    })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toBe('Error: denied by rule "probe(action:secret*)" (project)')
    expect(dispatches).toEqual([])
    expect(permissionDecisions(agent.session)).toEqual([
      {
        toolName: 'probe', decision: 'deny', mode: 'enforce',
        matchedRuleRaw: 'probe(action:secret*)', layer: 'project', cause: 'rule',
      },
    ])
  }, 30_000)

  it('allows a rule-matched call through the executor and appends the audit event', async () => {
    const ctx = await boot(GUARD_CONFIG)
    const dispatches: string[] = []
    ctx.tools.register(makeProbeTool(dispatches))
    const agent = probeAgent('guard-allow')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('allow-1'),
      name: 'probe', arguments: { action: 'ok-1' }, agent,
    })

    expect(result.isError).toBe(false)
    expect(result.value).toBe('executed ok-1')
    expect(dispatches).toEqual(['ok-1'])
    expect(permissionDecisions(agent.session)).toEqual([
      {
        toolName: 'probe', decision: 'allow', mode: 'enforce',
        matchedRuleRaw: 'probe(action:ok*)', layer: 'managed',
      },
    ])
  }, 30_000)

  it('routes an ask to the approval seam and denies when no approval service is composed', async () => {
    const ctx = await boot([
      '    mode: default',
      '    rules:',
      "      - raw: 'probe(action:ask*)'",
      '        kind: ask',
      '        layer: project',
    ])
    const dispatches: string[] = []
    ctx.tools.register(makeProbeTool(dispatches))
    const agent = probeAgent('guard-ask-noseam')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('ask-1'),
      name: 'probe', arguments: { action: 'ask-me' }, agent,
    })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toBe('Error: requested by rule "probe(action:ask*)" (project)')
    expect(dispatches).toEqual([])
    expect(permissionDecisions(agent.session)).toEqual([
      {
        toolName: 'probe', decision: 'ask', mode: 'default',
        matchedRuleRaw: 'probe(action:ask*)', layer: 'project',
      },
    ])
  }, 30_000)

  it('dispatches the call when the approval answerer grants allowed-once', async () => {
    const ctx = await boot([
      '    mode: default',
      '    rules:',
      "      - raw: 'probe(action:ask*)'",
      '        kind: ask',
      '        layer: project',
    ], { approval: true })
    const dispatches: string[] = []
    ctx.tools.register(makeProbeTool(dispatches))
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const agent = turnAgent('guard-ask-granted')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('ask-2'),
      name: 'probe', arguments: { action: 'ask-me' }, agent,
    })

    expect(result.isError).toBe(false)
    expect(result.value).toBe('executed ask-me')
    expect(dispatches).toEqual(['ask-me'])
    expect(permissionDecisions(agent.session)).toEqual([
      {
        toolName: 'probe', decision: 'ask', mode: 'default',
        matchedRuleRaw: 'probe(action:ask*)', layer: 'project',
      },
    ])
  }, 30_000)

  it('denies with the user-rejection reason when the answerer rejects', async () => {
    const ctx = await boot([
      '    mode: default',
      '    rules:',
      "      - raw: 'probe(action:ask*)'",
      '        kind: ask',
      '        layer: project',
    ], { approval: true })
    const dispatches: string[] = []
    ctx.tools.register(makeProbeTool(dispatches))
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))
    const agent = turnAgent('guard-ask-rejected')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('ask-3'),
      name: 'probe', arguments: { action: 'ask-me' }, agent,
    })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toBe('Error: the user rejected tool "probe"')
    expect(dispatches).toEqual([])
  }, 30_000)

  it('denies an unmatched call in enforce mode with the mode cause', async () => {
    const ctx = await boot(['    mode: enforce'])
    const dispatches: string[] = []
    ctx.tools.register(makeProbeTool(dispatches))
    const agent = probeAgent('guard-enforce-fallback')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('mode-1'),
      name: 'probe', arguments: { action: 'unlisted' }, agent,
    })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toBe('Error: no matching allow rule (enforce mode)')
    expect(dispatches).toEqual([])
    expect(permissionDecisions(agent.session)).toEqual([
      { toolName: 'probe', decision: 'deny', mode: 'enforce', cause: 'mode' },
    ])
  }, 30_000)

  it('applies the mode config default and allows an unmatched call in default mode', async () => {
    // No `mode:` in the row config: the validated Config field's default ('default')
    // is the fallback, not a hardcode — and it allows the unmatched call.
    const ctx = await boot([
      '    rules:',
      "      - raw: 'probe(action:secret*)'",
      '        kind: deny',
      '        layer: project',
    ])
    const dispatches: string[] = []
    ctx.tools.register(makeProbeTool(dispatches))
    const agent = probeAgent('guard-mode-default')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('mode-2'),
      name: 'probe', arguments: { action: 'unlisted' }, agent,
    })

    expect(result.isError).toBe(false)
    expect(dispatches).toEqual(['unlisted'])
    expect(permissionDecisions(agent.session)).toEqual([
      { toolName: 'probe', decision: 'allow', mode: 'default' },
    ])
  }, 30_000)

  it('stays inactive without an engine row: the call proceeds and nothing is audited', async () => {
    const ctx = await boot([
      '    mode: enforce',
      '    rules:',
      "      - raw: 'probe(action:*)'",
      '        kind: deny',
      '        layer: managed',
    ], { engine: false })
    const dispatches: string[] = []
    ctx.tools.register(makeProbeTool(dispatches))
    const agent = probeAgent('guard-no-engine')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('loose-1'),
      name: 'probe', arguments: { action: 'anything' }, agent,
    })

    expect(result.isError).toBe(false)
    expect(dispatches).toEqual(['anything'])
    expect(permissionDecisions(agent.session)).toEqual([])
  }, 30_000)

  it('still denies without an agent but appends no audit event', async () => {
    const ctx = await boot(GUARD_CONFIG)
    const dispatches: string[] = []
    ctx.tools.register(makeProbeTool(dispatches))

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('noagent-1'),
      name: 'probe', arguments: { action: 'secret-data' },
    })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toBe('Error: denied by rule "probe(action:secret*)" (project)')
    expect(dispatches).toEqual([])
  }, 30_000)

  it('surfaces parse diagnostics to the logger when the first call compiles the rules', async () => {
    const ctx = await boot([
      '    mode: enforce',
      '    rules:',
      "      - raw: 'probe(action:secret*)'",
      '        kind: deny',
      '        layer: project',
      "      - raw: 'probe(action:broken'",
      '        kind: deny',
      '        layer: managed',
      "      - raw: 'Bash(command:rm *)'",
      '        kind: allow',
      '        layer: project',
    ])
    const messages: Message[] = []
    ctx.logger.exporter({ levels: { default: 3 }, export: message => messages.push(message) })
    const agent = probeAgent('guard-diagnostics')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('diag-1'),
      name: 'probe', arguments: { action: 'secret-data' }, agent,
    })

    // The valid deny still enforces while the broken rule is dropped with its diagnostic.
    expect(result.isError).toBe(true)
    expect(resultText(result)).toBe('Error: denied by rule "probe(action:secret*)" (project)')

    // A second call reuses the compiled policy: the diagnostics were logged
    // once at the first compile, not per call.
    const second = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('diag-2'),
      name: 'probe', arguments: { action: 'secret-data' }, agent,
    })
    expect(second.isError).toBe(true)

    const errorTexts = messages.filter(m => m.type === 'error').map(m => String(m.args[0]))
    const warnTexts = messages.filter(m => m.type === 'warn').map(m => String(m.args[0]))
    expect(errorTexts).toEqual(["error: malformed rule 'probe(action:broken': unbalanced parentheses"])
    expect(warnTexts).toEqual(["warning: primary content field 'command' cannot be matched by a param:value rule; ignored"])
  }, 30_000)
})
