/**
 * Real-Loader composition proof for the `@deepseek-ai/dsh-permission` Service
 * Definition. The Definition itself ships no runtime row — the engine provider
 * row (`@deepseek-ai/dsh-permission-engine`) publishes `ctx.permission` — so
 * this suite boots that row through the real Loader and asserts the contract
 * the Definition fixes: `compile` + `evaluate` cover the allow/ask/deny three
 * state plus the mode fallback, `compile` reports parse diagnostics as
 * human-readable strings, and the `permission/decision` event the Definition
 * declares is a live member of the session log.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as PermissionEngine from '@deepseek-ai/dsh-permission-engine'
import type { PathBases, ToolCallView } from '@deepseek-ai/dsh-permission'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot a test-only cordis.yml carrying the engine provider row. */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-permission-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, ["- name: '@deepseek-ai/dsh-permission-engine'", ''].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-permission-engine', PermissionEngine],
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

const pathBases: PathBases = { settingsDir: '/repo', homeDir: '/home', cwd: '/repo' }

const pushCall: ToolCallView = { name: 'Bash', arguments: { command: 'git push origin main' } }
const rmCall: ToolCallView = { name: 'Bash', arguments: { command: 'rm -rf /var/data' } }

describe('dsh-permission Service Definition through a real Loader composition', () => {
  it('publishes ctx.permission when the provider row is composed', async () => {
    const ctx = await boot()
    expect(ctx.permission).toBeDefined()
    expect(typeof ctx.permission.compile).toBe('function')
    expect(typeof ctx.permission.evaluate).toBe('function')
  })

  it('evaluate allows a call matched by an allow rule, even in enforce mode', async () => {
    const ctx = await boot()
    const { policy, diagnostics } = ctx.permission.compile([
      { raw: 'Bash(git push:*)', kind: 'allow', layer: 'project' },
    ])
    expect(diagnostics).toEqual([])
    const decision = ctx.permission.evaluate(pushCall, { policy, mode: 'enforce', pathBases })
    expect(decision).toEqual({
      kind: 'allow',
      matchedRule: { kind: 'allow', layer: 'project', tool: 'Bash', matcher: 'command', raw: 'Bash(git push:*)' },
    })
  })

  it('evaluate asks for a call matched by an ask rule', async () => {
    const ctx = await boot()
    const { policy } = ctx.permission.compile([
      { raw: 'Bash(rm -rf *)', kind: 'ask', layer: 'project' },
    ])
    const decision = ctx.permission.evaluate(rmCall, { policy, mode: 'default', pathBases })
    expect(decision).toEqual({
      kind: 'ask',
      reason: 'requested by rule "Bash(rm -rf *)" (project)',
      matchedRule: { kind: 'ask', layer: 'project', tool: 'Bash', matcher: 'command', raw: 'Bash(rm -rf *)' },
    })
  })

  it('evaluate denies a matched deny rule over a matching allow', async () => {
    const ctx = await boot()
    const { policy } = ctx.permission.compile([
      { raw: 'Bash(*)', kind: 'allow', layer: 'teammate' },
      { raw: 'Bash(rm -rf *)', kind: 'deny', layer: 'managed' },
    ])
    const decision = ctx.permission.evaluate(rmCall, { policy, mode: 'default', pathBases })
    expect(decision).toEqual({
      kind: 'deny',
      reason: 'denied by rule "Bash(rm -rf *)" (managed)',
      matchedRule: { kind: 'deny', layer: 'managed', tool: 'Bash', matcher: 'command', raw: 'Bash(rm -rf *)' },
      cause: 'rule',
    })
  })

  it('enforce mode denies an unmatched call with the mode cause', async () => {
    const ctx = await boot()
    const { policy } = ctx.permission.compile([
      { raw: 'Bash(git push:*)', kind: 'allow', layer: 'project' },
    ])
    const decision = ctx.permission.evaluate(rmCall, { policy, mode: 'enforce', pathBases })
    expect(decision).toEqual({
      kind: 'deny',
      reason: 'no matching allow rule (enforce mode)',
      cause: 'mode',
    })
  })

  it('default mode allows an unmatched call without a matched rule', async () => {
    const ctx = await boot()
    const { policy } = ctx.permission.compile([
      { raw: 'Bash(git push:*)', kind: 'allow', layer: 'project' },
    ])
    const decision = ctx.permission.evaluate(rmCall, { policy, mode: 'default', pathBases })
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('compile reports a parse diagnostic as a human-readable string and drops the rule', async () => {
    const ctx = await boot()
    const { policy, diagnostics } = ctx.permission.compile([
      { raw: 'Bash(rm *', kind: 'deny', layer: 'managed' },
      { raw: 'Bash(git push:*)', kind: 'allow', layer: 'project' },
    ])
    expect(diagnostics).toEqual([
      "error: malformed rule 'Bash(rm *': unbalanced parentheses",
    ])
    // The malformed rule is dropped: the call falls through to the allow rule.
    const decision = ctx.permission.evaluate(
      { name: 'Bash', arguments: { command: 'rm leftover' } },
      { policy, mode: 'enforce', pathBases },
    )
    expect(decision).toEqual({ kind: 'deny', reason: 'no matching allow rule (enforce mode)', cause: 'mode' })
  })

  it('compile reports a primary content field param rule as a load-time warning and drops it', async () => {
    const ctx = await boot()
    const { policy, diagnostics } = ctx.permission.compile([
      { raw: 'Bash(command:rm *)', kind: 'allow', layer: 'project' },
    ])
    expect(diagnostics).toEqual([
      "warning: primary content field 'command' cannot be matched by a param:value rule; ignored",
    ])
    // The ignored rule is dropped: an otherwise-unmatched call falls through to the mode.
    const decision = ctx.permission.evaluate(
      { name: 'Bash', arguments: { command: 'rm leftover' } },
      { policy, mode: 'enforce', pathBases },
    )
    expect(decision).toEqual({ kind: 'deny', reason: 'no matching allow rule (enforce mode)', cause: 'mode' })
  })

  it('permission/decision is a live session-log event carrying the durable payload', async () => {
    const ctx = await boot()
    const { policy } = ctx.permission.compile([
      { raw: 'Bash(rm -rf *)', kind: 'deny', layer: 'managed' },
    ])
    const decision = ctx.permission.evaluate(rmCall, { policy, mode: 'enforce', pathBases })
    const session = Session.create(SessionId('permission-definition-audit'))
    session.append('permission/decision', {
      toolName: rmCall.name,
      decision: 'deny',
      mode: 'enforce',
      matchedRuleRaw: 'Bash(rm -rf *)',
      layer: 'managed',
      cause: 'rule',
    })
    const events = session.events.filter(event => event.type === 'permission/decision')
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toEqual({
      toolName: 'Bash',
      decision: 'deny',
      mode: 'enforce',
      matchedRuleRaw: 'Bash(rm -rf *)',
      layer: 'managed',
      cause: 'rule',
    })
    expect(decision.kind).toBe('deny')
  })
})
