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
  PermissionContext,
  PermissionDecision,
  PermissionDecisionData,
  RuleKind,
  RuleLayer,
  ToolCallView,
} from './types.ts'

export type {
  PermissionMode,
  RuleLayer,
  RuleKind,
  MatcherKind,
  RuleIR,
  ToolCallView,
  CompiledPolicy,
  PathBases,
  PermissionContext,
  DenyCause,
  PermissionDecision,
  PermissionDecisionData,
} from './types.ts'

/** One authored rule string with the kind and layer it was declared under. */
export interface RuleSource {
  /** The authored rule string (e.g. `Bash(rm -rf *)`). */
  readonly raw: string
  /** Whether the rule allows, prompts, or denies. */
  readonly kind: RuleKind
  /** The layer the rule was declared in. */
  readonly layer: RuleLayer
}

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
