/**
 * Permission Service Definition types. Contains only types — no runtime code.
 *
 * The permission engine decides whether a tool call may be issued, returning a
 * {@link PermissionDecision}. Rules are authored as strings (see the permission
 * seam Agent Note) and parsed into the {@link RuleIR} the engine matches.
 *
 * @module @deepseek-ai/dsh-permission
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'

/**
 * Per-scope fallback for a tool call that matches no rule.
 * `enforce` denies the unmatched call (allowlist; the default for a controlled
 * teammate); `default` allows it (denylist; for the main agent). `readonly` and
 * `bypass` are reserved: the first-stage engine rejects them as unimplemented
 * rather than silently allowing a call.
 */
export type PermissionMode = 'enforce' | 'default' | 'readonly' | 'bypass'

/**
 * The source layer a rule came from. `managed` is an organization policy that a
 * lower layer cannot override; a `managed` deny is absolute in every mode.
 */
export type RuleLayer = 'managed' | 'project' | 'teammate'

/** Whether a rule allows, prompts for, or denies a matching tool call. */
export type RuleKind = 'allow' | 'ask' | 'deny'

/**
 * Which matcher a parsed rule dispatches to. The four kinds align with the
 * documented Claude Code behavior: a command matcher splits compound commands
 * and strips wrappers, a path matcher applies gitignore semantics, an mcp
 * matcher checks the `mcp__server[__tool]` prefix, and a param matcher checks a
 * top-level scalar input field.
 */
export type MatcherKind = 'command' | 'path' | 'mcp' | 'param'

/**
 * A parsed rule. `raw` is the authored string, retained for audit and
 * diagnostics; `matcher` carries the matcher-kind-specific compiled form the
 * engine evaluates. The matcher payload shape is owned by the engine provider;
 * the Definition fixes only its discriminant so consumers can read `kind`.
 */
export interface RuleIR {
  /** allow / ask / deny. */
  readonly kind: RuleKind
  /** The layer this rule was loaded from. */
  readonly layer: RuleLayer
  /** The tool name the rule targets (e.g. `Bash`, `Read`, `mcp__postgres`). */
  readonly tool: string
  /** Which matcher evaluates this rule. */
  readonly matcher: MatcherKind
  /** The authored rule string, verbatim. */
  readonly raw: string
}

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
 * The authored rule strings of one stance (allow / ask / deny), as declared in
 * a rule-layer file or a teammate definition's frontmatter. Absent arrays
 * declare no rules of that stance.
 */
export interface PermissionRules {
  /** The `deny` rule strings. */
  readonly deny?: readonly string[]
  /** The `ask` rule strings. */
  readonly ask?: readonly string[]
  /** The `allow` rule strings. */
  readonly allow?: readonly string[]
}

/**
 * The inputs to one {@link PermissionService.loadRuleLayers} call: the on-disk
 * rule-layer file paths plus the optional teammate rule snapshot to merge in.
 */
export interface LoadRuleLayersOptions {
  /** Path to the managed rule file; undefined when the scope has no resolvable home. */
  readonly managedPath?: string
  /** Path to the project rule file; undefined when the scope has no resolvable workspace. */
  readonly projectPath?: string
  /** The teammate inline rules (the live definition, or the durable snapshot on cold recovery). */
  readonly teammateRules?: PermissionRules
  /**
   * Whether the managed rule file was present when this scope was bound. When
   * `true` and the managed file is now missing, the load is refused: a lapsed
   * managed policy is not run against the recovered scope.
   */
  readonly managedPresent?: boolean
}

/**
 * The outcome of loading and merging the on-disk rule layers: the scope's full
 * layer-tagged rule source set plus each layer's presence.
 */
export interface LoadedRuleLayers {
  /** The merged, deduplicated rule sources (managed, project, and teammate). */
  readonly rules: RuleSource[]
  /** Whether the managed rule file was present. */
  readonly managedPresent: boolean
  /** Whether the project rule file was present. */
  readonly projectPresent: boolean
}

/**
 * The minimal view of a tool call the engine needs: the tool name and its
 * frozen JSON arguments. This is an owned, lossless-JSON value — never a live
 * `ToolExecution` — so `evaluate` stays a pure function of its inputs.
 */
export interface ToolCallView {
  /** The tool name being invoked. */
  readonly name: string
  /** The tool's JSON arguments, as logged. */
  readonly arguments: JsonValue
}

/**
 * An opaque, engine-compiled policy: the parsed and merged rule set for one
 * scope, ready to evaluate. The Definition fixes no internal shape — the engine
 * owns it — so a consumer holds it as a handle, compiling once at load and
 * evaluating per call. This keeps the compiled matcher payloads (which `RuleIR`
 * deliberately does not carry) inside the engine. The brand field is engine-set;
 * a consumer never constructs a policy itself.
 */
export interface CompiledPolicy {
  /** Nominal brand: the engine sets this on the compiled policy it owns. */
  readonly __compiledPolicy: true
}

/**
 * Resolution bases a path rule needs: the directory a `/`-anchored rule is
 * relative to, the home directory for `~`, and the current working directory
 * for a relative pattern. Consumers supply these from the loaded scope.
 */
export interface PathBases {
  /** Directory a `/`-anchored (settings-source-relative) pattern resolves against. */
  readonly settingsDir: string
  /** Home directory for a `~`-anchored pattern. */
  readonly homeDir: string
  /** Current working directory for a relative pattern. */
  readonly cwd: string
}

/**
 * The inputs a single {@link PermissionService.evaluate} call resolves against:
 * the compiled policy, the scope's permission mode, the path bases, and the
 * acting member id (absent for the main agent).
 */
export interface PermissionContext {
  /** The compiled policy for this scope. */
  readonly policy: CompiledPolicy
  /** The scope's permission mode. */
  readonly mode: PermissionMode
  /** Resolution bases for path-rule anchors. */
  readonly pathBases: PathBases
  /** The acting team member, when the call comes from a teammate. */
  readonly memberId?: string
}

/**
 * Why a `deny` was produced: a matched deny/enforce-fallback `rule`, the
 * `mode` fallback for an unmatched call, or `leader_unreachable` when a
 * teammate `ask` could not reach the leader to decide.
 */
export type DenyCause = 'rule' | 'mode' | 'leader_unreachable'

/**
 * The decision `evaluate` returns. `allow` runs the call; `deny` carries a
 * model-visible reason and its cause; `ask` requests confirmation through the
 * approval seam (main agent) or the leader rendezvous (teammate). `matchedRule`
 * is present when a rule — not the mode fallback — decided the outcome, and is
 * carried for the audit event, not for control flow.
 */
export type PermissionDecision =
  | { readonly kind: 'allow'; readonly matchedRule?: RuleIR }
  | { readonly kind: 'deny'; readonly reason: string; readonly matchedRule?: RuleIR; readonly cause?: DenyCause }
  | { readonly kind: 'ask'; readonly reason?: string; readonly matchedRule?: RuleIR }

/**
 * Durable audit record appended on every {@link PermissionService.evaluate}.
 * Its fields reconstruct the decision after the fact: what tool, what outcome,
 * which rule and layer decided it, which member acted, the active mode, and the
 * deny cause. Model-visible policy outcomes must be reconstructable from the
 * session log, so this event is the permission engine's half of that contract.
 */
export interface PermissionDecisionData {
  /** The tool name evaluated. */
  readonly toolName: string
  /** The outcome. */
  readonly decision: RuleKind
  /** The authored string of the rule that decided it, when a rule did. */
  readonly matchedRuleRaw?: string
  /** The layer of the deciding rule, when a rule decided it. */
  readonly layer?: RuleLayer
  /** The acting member, when the call came from a teammate. */
  readonly memberId?: string
  /** The permission mode in effect. */
  readonly mode: PermissionMode
  /** The deny cause, when the decision was a deny. */
  readonly cause?: DenyCause
}
