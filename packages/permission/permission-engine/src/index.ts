/**
 * Permission engine provider. Assembles rule parsing, the four matchers, and
 * layered adjudication into the `ctx.permission` service.
 *
 * {@link PermissionEngine.compile} parses authored rules into an opaque
 * {@link CompiledPolicy}; {@link PermissionEngine.evaluate} resolves a tool call
 * against a policy. Both stay pure — a consumer appends the `permission/decision`
 * audit event at its commit point via {@link appendPermissionDecision}.
 * {@link PermissionEngine.loadRuleLayers} loads the managed/project rule files
 * (read-only) and merges them with the teammate inline rules; it is the
 * cold-recovery re-read, and it fails loud on a lapsed managed file.
 *
 * @module @deepseek-ai/dsh-permission-engine
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  CompiledPolicy,
  LoadedRuleLayers,
  LoadRuleLayersOptions,
  PermissionContext,
  PermissionDecision,
  PermissionMode,
  PermissionService,
  RuleSource,
  ToolCallView,
} from '@deepseek-ai/dsh-permission'
import type { PathMatchBases } from './match-path.ts'
import { parseRule, type CompiledRule } from './parse.ts'
import { loadRuleLayers } from './load.ts'
import { resolveDecision } from './resolve.ts'

export type {
  CommandMatcher,
  PathMatcher,
  McpMatcher,
  ParamMatcher,
  CompiledMatcher,
  MatchFn,
} from './matchers.ts'
export { parseRule } from './parse.ts'
export type { CompiledRule, ParseDiagnostic, ParseRuleResult } from './parse.ts'
export { matchesRule, resolveDecision, toRuleIR } from './resolve.ts'
export type { ResolveInput } from './resolve.ts'
export type { PathMatchBases } from './match-path.ts'
export type { RuleIR, RuleKind, RuleLayer, MatcherKind, PermissionMode } from '@deepseek-ai/dsh-permission'
export {
  ManagedRulesMissingError,
  RuleFileError,
  loadRuleLayers,
  mergeRuleSources,
  parseRuleFileText,
  readRuleLayer,
} from './load.ts'
export type { RuleLayerLoad, RuleLayerRules } from './load.ts'
export { appendPermissionDecision, toPermissionDecisionData } from './audit.ts'

export type {
  CompiledPolicy,
  LoadedRuleLayers,
  LoadRuleLayersOptions,
  PermissionContext,
  PermissionDecision,
  PermissionDecisionData,
  PermissionRules,
  PermissionService,
  RuleSource,
  ToolCallView,
} from '@deepseek-ai/dsh-permission'

/**
 * Resolve a tool call against an already-compiled rule set under the engine's
 * ordered policy (deny > ask > allow, then the mode fallback). This is the pure
 * decision core; {@link PermissionEngine.compile} produces the compiled rules,
 * and {@link PermissionEngine.evaluate} is the service-level wrapper.
 *
 * @param call - the tool name and JSON arguments to decide.
 * @param rules - the compiled, merged, layer-tagged rule set to match.
 * @param mode - the scope's permission mode for the unmatched fallback.
 * @param pathBases - resolution bases for path-matcher anchors.
 * @returns the allow/ask/deny decision for the call.
 */
export function evaluatePermission(
  call: ToolCallView,
  rules: readonly CompiledRule[],
  mode: PermissionMode,
  pathBases: PathMatchBases,
): PermissionDecision {
  return resolveDecision({ call, rules, mode, pathBases })
}

/** The engine-owned compiled policy: the parsed rule set for one scope. */
interface CompiledPolicyImpl extends CompiledPolicy {
  /** The parsed, compiled, layer-tagged rules. */
  readonly rules: readonly CompiledRule[]
}

/** Plugin config. Currently empty; later stages may add provider options. */
export type Config = Readonly<Record<string, never>>

/** @see Config */
export const Config = z.object({}) as unknown as z<Config>

export const name = 'permission-engine'
export const inject = []

/**
 * Register {@link PermissionEngine} as `ctx.permission`. Consumers compile a
 * scope's rules once with {@link PermissionService.compile}, then decide each
 * call with {@link PermissionService.evaluate}; both stay pure — the consumer
 * appends the `permission/decision` audit event at its commit point.
 *
 * @param ctx - the host context to register the service on.
 */
export function apply(ctx: Context): void {
  ctx.plugin(PermissionEngine)
}

/**
 * The `ctx.permission` service: compiles authored rules into an opaque policy
 * and evaluates tool calls against it.
 */
export class PermissionEngine extends Service implements PermissionService {
  constructor(ctx: Context) {
    super(ctx, 'permission')
  }

  /**
   * @param rules - the authored rule strings with their kinds and layers.
   * @returns the compiled policy plus any parse diagnostics (fail-loud problems
   * and benign ignores, each as a human-readable string).
   */
  compile(rules: readonly RuleSource[]): { readonly policy: CompiledPolicy; readonly diagnostics: readonly string[] } {
    const diagnostics: string[] = []
    const compiled: CompiledRule[] = []
    for (const source of rules) {
      const result = parseRule(source.raw, source.kind, source.layer)
      for (const d of result.diagnostics) diagnostics.push(`${d.severity}: ${d.message}`)
      if (result.rule !== undefined) compiled.push(result.rule)
    }
    return { policy: { __compiledPolicy: true, rules: compiled } as CompiledPolicyImpl, diagnostics }
  }

  /**
   * @param call - the tool name and JSON arguments to decide.
   * @param context - the compiled policy, mode, path bases, and acting member.
   * @returns the allow/ask/deny decision.
   */
  evaluate(call: ToolCallView, context: PermissionContext): PermissionDecision {
    const policy = context.policy as CompiledPolicyImpl
    return resolveDecision({
      call,
      rules: policy.rules,
      mode: context.mode,
      pathBases: context.pathBases,
    })
  }

  /**
   * Load the managed/project rule files (read-only) and merge them with the
   * optional teammate inline rules. Fails loud on a lapsed managed file or a
   * malformed layer file — never on a silently skipped layer.
   *
   * @param options - the layer file paths and the optional teammate snapshot.
   * @returns the merged rule sources plus each layer's presence.
   * @throws {ManagedRulesMissingError} when the managed file a bound scope expected is missing.
   * @throws {RuleFileError} when a present layer file cannot be read or parsed.
   */
  loadRuleLayers(options: LoadRuleLayersOptions): Promise<LoadedRuleLayers> {
    return loadRuleLayers(options)
  }
}
