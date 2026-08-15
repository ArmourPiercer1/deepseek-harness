/**
 * Layered rule adjudication. Given a parsed, merged, layer-tagged rule set and
 * a tool call, `resolveDecision` applies Claude Code's ordered policy — deny,
 * then ask, then allow, then a mode fallback — and returns the {@link
 * PermissionDecision} for the call. Matching itself is delegated to the four
 * matchers through {@link matchesRule}.
 *
 * @module @deepseek-ai/dsh-permission-engine
 */

import type { PermissionDecision, PermissionMode, RuleIR, ToolCallView } from '@deepseek-ai/dsh-permission'
import type { CompiledMatcher } from './matchers.ts'
import type { CompiledRule } from './parse.ts'
import { matchCommand } from './match-command.ts'
import { matchPath, type PathMatchBases } from './match-path.ts'
import { matchMcp } from './match-mcp.ts'
import { matchParam } from './match-param.ts'

/**
 * Whether a compiled matcher applies to a tool call, dispatching on matcher
 * kind. Path matching needs the resolution bases; the other matchers decide on
 * the tool name and arguments alone.
 *
 * @param matcher - the compiled matcher payload to evaluate.
 * @param call - the tool call being checked.
 * @param pathBases - resolution bases for a path matcher's anchors.
 * @returns true when the matcher applies to the call.
 */
export function matchesRule(matcher: CompiledMatcher, call: ToolCallView, pathBases: PathMatchBases): boolean {
  switch (matcher.kind) {
    case 'command':
      return matchCommand(matcher, call.name, call.arguments)
    case 'path':
      return matchPath(matcher, call.name, call.arguments, pathBases)
    case 'mcp':
      return matchMcp(matcher, call.name, call.arguments)
    case 'param':
      return matchParam(matcher, call.name, call.arguments)
    default:
      throw new Error('unknown matcher kind')
  }
}

/** The inputs a single adjudication resolves against. */
export interface ResolveInput {
  /** The tool call being checked. */
  readonly call: ToolCallView
  /** The merged, deduplicated rule set, each tagged with its source layer. */
  readonly rules: readonly CompiledRule[]
  /** The scope's permission mode. */
  readonly mode: PermissionMode
  /** Resolution bases for path-matcher anchors. */
  readonly pathBases: PathMatchBases
}

/**
 * The {@link RuleIR} form of a compiled rule, used on a decision's
 * `matchedRule`. A {@link CompiledRule} structurally satisfies {@link RuleIR}
 * except that its `matcher` is the compiled object rather than the kind string,
 * so only the discriminant is projected here.
 *
 * @param r - the compiled rule that decided the outcome.
 * @returns the rule in its audit-facing IR form.
 */
export function toRuleIR(r: CompiledRule): RuleIR {
  return { kind: r.kind, layer: r.layer, tool: r.tool, matcher: r.matcher.kind, raw: r.raw }
}

/**
 * Resolve a tool call against a rule set under an ordered policy: a matching
 * deny wins over everything, then a matching ask, then a matching allow; with
 * no match, the mode decides (`enforce` denies, `default` allows, and the
 * reserved `readonly` / `bypass` modes are rejected).
 *
 * @param input - the call, rule set, mode, and path bases to resolve.
 * @returns the decision for the call. `matchedRule` is present only when a
 * rule, not the mode fallback, decided the outcome.
 */
export function resolveDecision(input: ResolveInput): PermissionDecision {
  const { call, rules, mode, pathBases } = input

  for (const rule of rules) {
    if (rule.kind === 'deny' && matchesRule(rule.matcher, call, pathBases)) {
      return {
        kind: 'deny',
        reason: `denied by rule "${rule.raw}" (${rule.layer})`,
        matchedRule: toRuleIR(rule),
        cause: 'rule',
      }
    }
  }
  for (const rule of rules) {
    if (rule.kind === 'ask' && matchesRule(rule.matcher, call, pathBases)) {
      return { kind: 'ask', reason: `requested by rule "${rule.raw}" (${rule.layer})`, matchedRule: toRuleIR(rule) }
    }
  }
  for (const rule of rules) {
    if (rule.kind === 'allow' && matchesRule(rule.matcher, call, pathBases)) {
      return { kind: 'allow', matchedRule: toRuleIR(rule) }
    }
  }

  switch (mode) {
    case 'enforce':
      return { kind: 'deny', reason: 'no matching allow rule (enforce mode)', cause: 'mode' }
    case 'default':
      return { kind: 'allow' }
    case 'readonly':
    case 'bypass':
      throw new Error(`permission mode "${mode}" is not implemented`)
  }
}
