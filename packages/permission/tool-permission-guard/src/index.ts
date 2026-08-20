/**
 * Permission guard Consumer. A `tools/pre-execute` listener that applies
 * `ctx.permission.evaluate` for the main agent and single delegated subagents:
 * `allow` proceeds, `deny` blocks, `ask` routes to the approval seam. Each
 * decision is appended to the acting session's log as a `permission/decision`
 * audit event.
 *
 * The guard resolves `ctx.permission` per tool call, not at apply time: the
 * Loader activates composition rows in parallel, so an apply-time read could
 * observe the service before the engine row provides it and would leave the
 * guard inactive for the whole session. When the service is absent because no
 * engine row is composed, the guard delegates and the call proceeds unguarded
 * — the guard sits loose in the composition.
 *
 * @module @deepseek-ai/dsh-tool-permission-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  CompiledPolicy,
  PathBases,
  PermissionContext,
  PermissionDecision,
  RuleSource,
  ToolCallView,
} from '@deepseek-ai/dsh-permission'
import { appendPermissionDecision, toPermissionDecisionData } from '@deepseek-ai/dsh-permission-engine'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'

/** The guard's plugin config: the scope's mode, rules, and path bases. */
export interface Config {
  /** Permission mode for an unmatched call. */
  mode: 'enforce' | 'default'
  /** The authored rules, compiled once, lazily, on the first evaluated call. */
  rules: RuleSource[]
  /** Resolution bases for path-rule anchors. */
  pathBases: PathBases
}

/** @see Config */
export const Config: z<Config> = z.object({
  mode: z.union([z.const('enforce' as const), z.const('default' as const)]).default('default'),
  rules: z.array(z.object({
    raw: z.string(),
    kind: z.union([z.const('allow' as const), z.const('ask' as const), z.const('deny' as const)]),
    layer: z.union([z.const('managed' as const), z.const('project' as const), z.const('teammate' as const)]),
  })).default([]),
  pathBases: z.object({
    settingsDir: z.string(),
    homeDir: z.string(),
    cwd: z.string(),
  }).default({ settingsDir: '.', homeDir: '.', cwd: '.' }),
})

export const name = 'tool-permission-guard'
export const inject = []

/**
 * The severity prefix the engine provider stamps on its compile diagnostics
 * (`"${severity}: ${message}"`); an `error:` diagnostic names a rule the engine
 * dropped, everything else is a benign warning.
 */
const ERROR_DIAGNOSTIC = 'error: '

/**
 * Register the guard listener. Every tool call resolves `ctx.permission`; the
 * scope's rules compile once on the first call after the service is present,
 * surfacing any parse diagnostic to the logger so a dropped rule — in
 * particular a dropped deny — cannot vanish silently. Every decision is
 * audited to the acting session and mapped to a pre-execute decision.
 *
 * @param ctx - the context the guard listens on and reads `permission` from.
 * @param config - the scope's mode, rules, and path bases.
 */
export function apply(ctx: Context, config: Config): void {
  let compiled: { readonly policy: CompiledPolicy } | undefined
  ctx.effect(() => {
    return ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
      // Per-call resolution: an apply-time read could run before the engine
      // row provides the service (parallel row activation) and would disable
      // the guard for the whole session. Absence means no engine row is
      // composed — the guard stays loose and delegates.
      const permission = ctx.get('permission')
      if (permission === undefined) return next()

      if (compiled === undefined) {
        const { policy, diagnostics } = permission.compile(config.rules)
        for (const diagnostic of diagnostics) {
          if (diagnostic.startsWith(ERROR_DIAGNOSTIC)) ctx.logger.error(diagnostic)
          else ctx.logger.warn(diagnostic)
        }
        compiled = { policy }
      }
      const context: PermissionContext = {
        policy: compiled.policy,
        mode: config.mode,
        pathBases: config.pathBases,
      }
      const view: ToolCallView = { name: exec.name, arguments: exec.arguments as JsonValue }
      const decision: PermissionDecision = permission.evaluate(view, context)
      if (exec.agent !== undefined) {
        appendPermissionDecision(exec.agent.session, toPermissionDecisionData(view, context, decision))
      }
      if (decision.kind === 'allow') return next()
      if (decision.kind === 'ask') return { kind: 'ask', ...(decision.reason !== undefined ? { reason: decision.reason } : {}) }
      return { kind: 'deny', reason: decision.reason }
    })
  })
}
