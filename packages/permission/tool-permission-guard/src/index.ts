/**
 * Permission guard Consumer. A `tools/pre-execute` listener that applies
 * `ctx.permission.evaluate` for the main agent and single delegated subagents:
 * `allow` proceeds, `deny` blocks, `ask` routes to the approval seam. Each
 * decision is appended to the acting session's log as a `permission/decision`
 * audit event.
 *
 * @module @deepseek-ai/dsh-tool-permission-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  PermissionContext,
  PermissionDecision,
  PathBases,
  RuleKind,
  RuleLayer,
  ToolCallView,
} from '@deepseek-ai/dsh-permission'
import { appendPermissionDecision, toPermissionDecisionData } from '@deepseek-ai/dsh-permission-engine'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'

/** One authored rule with its kind and source layer. */
interface RuleSource {
  /** The authored rule string (e.g. `Bash(rm -rf *)`). */
  raw: string
  /** Whether the rule allows, prompts, or denies. */
  kind: RuleKind
  /** The layer the rule was declared in. */
  layer: RuleLayer
}

/** The guard's plugin config: the scope's mode, rules, and path bases. */
export interface Config {
  /** Permission mode for an unmatched call. */
  mode: 'enforce' | 'default'
  /** The authored rules, compiled once at apply. */
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
 * Register the guard listener. The scope's rules compile once at apply; each
 * tool call is evaluated against the compiled policy, audited to the acting
 * session, and mapped to a pre-execute decision.
 *
 * @param ctx - the context providing the optional `permission` service.
 * @param config - the scope's mode, rules, and path bases.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    const permission = ctx.get('permission')
    if (permission === undefined) return () => {}

    const { policy } = permission.compile(config.rules)
    const context: Omit<PermissionContext, 'memberId'> = {
      policy,
      mode: config.mode,
      pathBases: config.pathBases,
    }

    return ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
      const view: ToolCallView = { name: exec.name, arguments: exec.arguments as JsonValue }
      const decision: PermissionDecision = permission.evaluate(view, context)
      const agent = exec.agent
      if (agent !== undefined) {
        appendPermissionDecision(agent.session, toPermissionDecisionData(view, context, decision))
      }
      if (decision.kind === 'allow') return next()
      if (decision.kind === 'ask') return { kind: 'ask', ...(decision.reason !== undefined ? { reason: decision.reason } : {}) }
      return { kind: 'deny', reason: decision.reason }
    })
  })
}
