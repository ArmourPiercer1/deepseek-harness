/**
 * Unit suite for the `@deepseek-ai/dsh-tool-permission-guard` Consumer's own
 * lifecycle semantics — the parts a REAL-Loader composition cannot isolate:
 * per-call resolution of `ctx.permission` (mount-order independent), HMR-safety
 * disposal of the listener, the real-load-path export shape, delegation of the
 * allow path to downstream listeners, and the Definition-conformant decision
 * edge shapes (an ask without a reason) the guard must map faithfully.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as PermissionEngine from '@deepseek-ai/dsh-permission-engine'
import * as ToolPermissionGuard from '@deepseek-ai/dsh-tool-permission-guard'
import type { Config as GuardConfig } from '@deepseek-ai/dsh-tool-permission-guard'
import type { PermissionDecisionData } from '@deepseek-ai/dsh-permission'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

const GUARD_CONFIG: GuardConfig = {
  mode: 'enforce',
  rules: [{ raw: 'probe(action:secret*)', kind: 'deny', layer: 'project' }],
  pathBases: { settingsDir: '.', homeDir: '.', cwd: '.' },
}

/** System prompt + tool registry + the probe tool, without the engine row. */
async function bootRuntime(): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(defineTool({
    name: 'probe',
    description: 'probe tool for the guard unit tests',
    parameters: { action: { type: 'string' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) { return `executed ${args.action ?? ''}` },
  }))
  return ctx
}

function probeAgent(id: string): Agent {
  return { session: Session.create(SessionId(id)) } as unknown as Agent
}

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

describe('tool-permission-guard lifecycle', () => {
  it('resolves ctx.permission per call: a guard mounted before the engine activates once the service appears', async () => {
    const ctx = await bootRuntime()
    const fiber = await ctx.plugin(ToolPermissionGuard, GUARD_CONFIG)

    // The engine is not composed yet: the guard delegates and the call proceeds.
    const before = await ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('order-1'),
      name: 'probe', arguments: { action: 'secret-data' },
    })
    expect(before.isError).toBe(false)

    // The engine row appears (any activation order the Loader may produce):
    // the same call is now denied — an apply-time resolution would have stayed
    // inactive forever.
    await ctx.plugin(PermissionEngine)
    const after = await ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('order-2'),
      name: 'probe', arguments: { action: 'secret-data' },
    })
    expect(after.isError).toBe(true)
    expect(resultText(after)).toBe('Error: denied by rule "probe(action:secret*)" (project)')
    await fiber.dispose()
  }, 30_000)

  it('removes its pre-execute listener when the fiber is disposed (HMR safety)', async () => {
    const ctx = await bootRuntime()
    const engine = await ctx.plugin(PermissionEngine)
    const fiber = await ctx.plugin(ToolPermissionGuard, GUARD_CONFIG)

    const denied = await ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('hmr-1'),
      name: 'probe', arguments: { action: 'secret-data' },
    })
    expect(denied.isError).toBe(true)

    await fiber.dispose()
    const afterDispose = await ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('hmr-2'),
      name: 'probe', arguments: { action: 'secret-data' },
    })
    expect(afterDispose.isError).toBe(false)
    await engine.dispose()
  }, 30_000)

  it('delegates the allow path through next() so downstream listeners can still deny', async () => {
    const ctx = await bootRuntime()
    await ctx.plugin(PermissionEngine)
    const fiber = await ctx.plugin(ToolPermissionGuard, {
      mode: 'default',
      rules: [],
      pathBases: { settingsDir: '.', homeDir: '.', cwd: '.' },
    })
    // Registered after the guard: only runs when the guard delegates.
    ctx.on('tools/pre-execute', async (_exec, _next) => ({ kind: 'deny', reason: 'downstream policy' }))

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('delegate-1'),
      name: 'probe', arguments: { action: 'anything' },
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toBe('Error: downstream policy')
    await fiber.dispose()
  }, 30_000)

  it('maps an ask without a reason to the approval seam default message', async () => {
    const ctx = await bootRuntime()
    ctx.provide('permission', {
      compile: () => ({ policy: { __compiledPolicy: true }, diagnostics: [] }),
      evaluate: () => ({ kind: 'ask' } as const),
    })
    const fiber = await ctx.plugin(ToolPermissionGuard, GUARD_CONFIG)

    const agent = probeAgent('guard-edge-ask')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('edge-ask-1'),
      name: 'probe', arguments: { action: 'anything' }, agent,
    })

    // No approval service is composed: the seam's default denial, not the rule's.
    expect(result.isError).toBe(true)
    expect(resultText(result)).toBe('Error: tool "probe" requires approval (not yet supported)')
    expect(permissionDecisions(agent.session)).toEqual([
      { toolName: 'probe', decision: 'ask', mode: 'enforce' },
    ])
    await fiber.dispose()
  }, 30_000)

  it('maps a rule-less deny with a custom reason and no cause into the audit payload', async () => {
    const ctx = await bootRuntime()
    ctx.provide('permission', {
      compile: () => ({ policy: { __compiledPolicy: true }, diagnostics: [] }),
      evaluate: () => ({ kind: 'deny', reason: 'custom policy denied' } as const),
    })
    const fiber = await ctx.plugin(ToolPermissionGuard, GUARD_CONFIG)

    const agent = probeAgent('guard-edge-deny')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('edge-deny-1'),
      name: 'probe', arguments: { action: 'anything' }, agent,
    })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toBe('Error: custom policy denied')
    // No matched rule and no cause on the decision: the audit payload omits both.
    expect(permissionDecisions(agent.session)).toEqual([
      { toolName: 'probe', decision: 'deny', mode: 'enforce' },
    ])
    await fiber.dispose()
  }, 30_000)

  it('has no default export and keeps name/inject/Config/apply through unwrapExports', () => {
    expect('default' in ToolPermissionGuard).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(ToolPermissionGuard) as Record<string, unknown>
    expect(unwrapped).toBe(ToolPermissionGuard)
    expect(unwrapped.name).toBe('tool-permission-guard')
    expect(unwrapped.inject).toEqual([])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })
})
