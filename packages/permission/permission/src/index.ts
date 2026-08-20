/**
 * Permission Service Definition: the `evaluate` contract, the `permission`
 * service declaration, and the `permission/decision` audit event.
 *
 * This package publishes a service, so its row belongs in the host composition.
 * The engine provider (`@deepseek-ai/dsh-permission-engine`) implements
 * `evaluate`; consumers (`@deepseek-ai/dsh-tool-permission-guard` and the team
 * plugin) read `ctx.permission`.
 *
 * @module @deepseek-ai/dsh-permission
 */

import type {} from '@deepseek-ai/dsh-session/types'
import type {
  CompiledPolicy,
  LoadRuleLayersOptions,
  LoadedRuleLayers,
  PermissionContext,
  PermissionDecision,
  PermissionDecisionData,
  RuleSource,
  ToolCallView,
} from './types.ts'

export type {
  PermissionMode,
  RuleLayer,
  RuleKind,
  MatcherKind,
  RuleIR,
  RuleSource,
  PermissionRules,
  LoadRuleLayersOptions,
  LoadedRuleLayers,
  ToolCallView,
  CompiledPolicy,
  PathBases,
  PermissionContext,
  DenyCause,
  PermissionDecision,
  PermissionDecisionData,
} from './types.ts'

/**
 * The permission engine. Consumers `compile` a scope's authored rules once at
 * load into an opaque {@link CompiledPolicy}, then `evaluate` each tool call
 * against it. Both are pure: neither appends the audit event or runs the
 * approval flow — a consumer appends `permission/decision` at its commit point
 * and routes an `ask` to the approval seam or the leader rendezvous.
 */
export interface PermissionService {
  /**
   * Compile a scope's authored rules into an opaque policy.
   * @param rules - the authored rule strings with their kinds and layers.
   * @returns the compiled policy, plus any parse diagnostics as human-readable strings.
   */
  compile(rules: readonly RuleSource[]): { readonly policy: CompiledPolicy; readonly diagnostics: readonly string[] }
  /**
   * Decide whether a tool call may be issued.
   * @param call - the tool name and JSON arguments to decide.
   * @param context - the compiled policy, mode, path bases, and acting member.
   * @returns the allow/ask/deny decision, with the matched rule when a rule decided it.
   */
  evaluate(call: ToolCallView, context: PermissionContext): PermissionDecision
  /**
   * Load the managed and project rule layers from disk (read-only), merge them
   * with the optional teammate inline rules, and return the scope's full
   * layer-tagged rule source set. A missing managed file is refused (not
   * skipped) when the options record that the scope was bound with it present.
   * @param options - the layer file paths and the optional teammate snapshot.
   * @returns the merged rule sources plus each layer's presence.
   * @throws when the managed file is missing but was present at bind time, or a
   *   layer file cannot be read or is outside the supported rule-file format.
   */
  loadRuleLayers(options: LoadRuleLayersOptions): Promise<LoadedRuleLayers>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The permission engine; present when a provider row is composed. */
    permission: PermissionService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Audit record of one permission decision. Appended by the engine after it
     * commits the decision, so the session log reconstructs which tool call was
     * allowed, prompted, or denied, under which rule, layer, member, and mode.
     * @param data - the evaluated tool, outcome, deciding rule and layer, member, mode, and deny cause.
     */
    'permission/decision': PermissionDecisionData
  }
}
