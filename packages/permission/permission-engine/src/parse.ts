/**
 * Rule-string parsing: turn an authored rule (`Tool` or `Tool(specifier)`) into
 * a {@link CompiledRule}. Aligns with Claude Code's permission rule syntax:
 * the dispatch picks a matcher kind from the tool family and the specifier
 * form, and a `param:value` specifier that targets a tool's primary content
 * field is ignored with a warning rather than silently accepted.
 *
 * @module @deepseek-ai/dsh-permission-engine
 */

import type { RuleKind, RuleLayer } from '@deepseek-ai/dsh-permission'
import type {
  CommandMatcher,
  CompiledMatcher,
  McpMatcher,
  ParamMatcher,
  PathMatcher,
} from './matchers.ts'

/**
 * A parse problem. Errors drop the rule; warnings (the documented primary
 * content-field case) also drop the rule but describe a benign ignore.
 */
export interface ParseDiagnostic {
  readonly severity: 'error' | 'warning'
  readonly message: string
}

/** A successfully parsed rule with its compiled matcher. */
export interface CompiledRule {
  /** allow / ask / deny. */
  readonly kind: RuleKind
  /** The layer the rule was authored for. */
  readonly layer: RuleLayer
  /** The normalized tool name the rule targets (e.g. `Bash`, `pwsh`, `Read`). */
  readonly tool: string
  /** The authored rule string, verbatim. */
  readonly raw: string
  /** The compiled matcher payload for this rule's kind. */
  readonly matcher: CompiledMatcher
}

/**
 * The outcome of parsing: the compiled rule when the rule is valid, plus any
 * error or warning diagnostics. A warning (primary content-field ignore) also
 * omits the rule.
 */
export interface ParseRuleResult {
  readonly rule?: CompiledRule
  readonly diagnostics: readonly ParseDiagnostic[]
}

/** `PowerShell` (matched case-insensitively) is an alias for the `pwsh` tool in rule syntax. */
const PWSH_ALIAS = 'powershell'

/**
 * Tools whose natural matcher is a command pattern (the `pwsh` alias folded
 * in). Family membership is case-insensitive: harness tool names are
 * lowercase while Claude Code-style rule spellings are capitalized, and both
 * must parse.
 */
const COMMAND_TOOLS: ReadonlySet<string> = new Set(['bash', 'pwsh'])

/** Tools whose natural matcher is a gitignore-style path pattern (case-insensitive membership). */
const PATH_TOOLS: ReadonlySet<string> = new Set([
  'read',
  'edit',
  'write',
  'grep',
  'glob',
  'notebookedit',
])

/**
 * Each tool's primary content field, keyed by the lowercase tool name. A
 * `param:value` specifier matching one of these cannot be enforced by a param
 * matcher (the field is the whole payload), so it is ignored with a warning
 * for Claude Code parity.
 */
const PRIMARY_CONTENT_FIELDS: Readonly<Record<string, string>> = {
  bash: 'command',
  pwsh: 'command',
  read: 'file_path',
  edit: 'file_path',
  write: 'file_path',
  grep: 'path',
  glob: 'path',
  notebookedit: 'notebook_path',
  webfetch: 'url',
}

/**
 * The `mcp__` prefix every MCP tool name carries.
 */
const MCP_PREFIX = 'mcp__'

/**
 * Whether a specifier has the `param:value` form: it contains a `:`, is not
 * anchored as a path (`//...`), and has a non-empty param name.
 *
 * @param specifier - the trimmed parenthesized specifier, or undefined for a bare tool.
 * @returns the split param and value, or undefined when the specifier is not parameter-shaped.
 */
function describeParam(specifier: string | undefined): { readonly param: string; readonly value: string } | undefined {
  if (specifier === undefined) return undefined
  if (specifier.startsWith('//')) return undefined
  const colon = specifier.indexOf(':')
  if (colon === -1) return undefined
  const param = specifier.slice(0, colon).trim()
  if (param === '') return undefined
  return { param, value: specifier.slice(colon + 1).trim() }
}

/**
 * Parse an `mcp__server[__tool]` tool name (including `*` wildcards) into its
 * compiled matcher. `mcp__server` yields a whole-server matcher; `mcp__*` (or a
 * bare `mcp__`) matches every server.
 *
 * @param tool - the normalized tool name, starting with `mcp__`.
 * @returns the compiled MCP matcher.
 */
function parseMcp(tool: string): McpMatcher {
  const rest = tool.slice(MCP_PREFIX.length)
  const sep = rest.indexOf('__')
  if (sep === -1) {
    return { kind: 'mcp', server: rest === '' ? '*' : rest }
  }
  const server = rest.slice(0, sep)
  const toolSegment = rest.slice(sep + 2)
  return toolSegment === '' ? { kind: 'mcp', server } : { kind: 'mcp', server, tool: toolSegment }
}

/**
 * Parse an authored rule string into a compiled rule. A bare `Tool` or
 * `Tool(*)` is a match-all for that tool; the matcher kind is chosen from the
 * tool family (mcp / command / path) and the specifier form (param:value vs a
 * plain pattern). Family detection is case-insensitive — `Write` and `write`
 * both parse as the path family, since harness tool names are lowercase while
 * Claude Code-style spellings are capitalized — except the `mcp__` prefix,
 * which stays exact. A malformed or unsupported rule yields an error
 * diagnostic and no rule; a `param:value` specifier on a primary content
 * field yields a warning and no rule.
 *
 * @param raw - the authored rule string (e.g. `Bash(git push:*)`).
 * @param kind - allow / ask / deny, threaded onto the compiled rule.
 * @param layer - managed / project / teammate, threaded onto the compiled rule.
 * @returns the compiled rule and diagnostics; an error or warning omits the rule.
 */
export function parseRule(raw: string, kind: RuleKind, layer: RuleLayer): ParseRuleResult {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { diagnostics: [{ severity: 'error', message: 'rule is empty' }] }
  }

  const open = trimmed.indexOf('(')
  let rawTool: string
  let specifier: string | undefined

  if (open === -1) {
    rawTool = trimmed
  } else {
    rawTool = trimmed.slice(0, open).trim()
    const close = trimmed.lastIndexOf(')')
    if (close === -1 || close < open || trimmed.slice(close + 1).trim() !== '') {
      return {
        diagnostics: [{ severity: 'error', message: `malformed rule '${raw}': unbalanced parentheses` }],
      }
    }
    specifier = trimmed.slice(open + 1, close).trim()
  }

  if (rawTool === '') {
    return { diagnostics: [{ severity: 'error', message: `malformed rule '${raw}': missing tool name` }] }
  }

  const lowerTool = rawTool.toLowerCase()
  const tool = lowerTool === PWSH_ALIAS ? 'pwsh' : rawTool

  if (tool.startsWith(MCP_PREFIX)) {
    if (specifier !== undefined && specifier !== '*') {
      return { diagnostics: [{ severity: 'error', message: `unsupported specifier for tool ${tool}` }] }
    }
    return { rule: { kind, layer, tool, raw, matcher: parseMcp(tool) }, diagnostics: [] }
  }

  // Family detection is case-insensitive (rule spellings are Claude
  // Code-style capitalized, harness tool names lowercase); the compiled
  // matcher keeps the authored name and the matchers compare case-insensitively.
  const matchName = tool.toLowerCase()
  const isCommand = COMMAND_TOOLS.has(matchName)
  const isPath = PATH_TOOLS.has(matchName)
  const param = describeParam(specifier)

  if (param !== undefined) {
    const primary = PRIMARY_CONTENT_FIELDS[matchName]
    if (primary !== undefined && param.param === primary) {
      return {
        diagnostics: [{
          severity: 'warning',
          message: `primary content field '${primary}' cannot be matched by a param:value rule; ignored`,
        }],
      }
    }
    if (isCommand) {
      const matcher: CommandMatcher = { kind: 'command', tool, pattern: specifier ?? '*' }
      return { rule: { kind, layer, tool, raw, matcher }, diagnostics: [] }
    }
    const matcher: ParamMatcher = { kind: 'param', tool, param: param.param, value: param.value }
    return { rule: { kind, layer, tool, raw, matcher }, diagnostics: [] }
  }

  if (isCommand) {
    const matcher: CommandMatcher = { kind: 'command', tool, pattern: specifier ?? '*' }
    return { rule: { kind, layer, tool, raw, matcher }, diagnostics: [] }
  }
  if (isPath) {
    const matcher: PathMatcher = { kind: 'path', tool, pattern: specifier ?? '*' }
    return { rule: { kind, layer, tool, raw, matcher }, diagnostics: [] }
  }

  return { diagnostics: [{ severity: 'error', message: `unsupported specifier for tool ${tool}` }] }
}
