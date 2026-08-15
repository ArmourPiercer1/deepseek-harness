import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { McpMatcher } from './matchers.ts'

/** The `mcp__` prefix every MCP tool name carries. */
const PREFIX = 'mcp__'

/**
 * Whether an MCP tool name `mcp__<server>[__<tool>]` matches a compiled
 * `mcp__server[__tool]` rule. Replicates Claude Code's MCP rule semantics:
 * `server === '*'` matches any server, a matcher without a `tool` (or with
 * `tool === '*'`) matches any tool of its server, and any other `tool` must
 * equal the parsed tool exactly. Matching is on the tool name alone; `args`
 * is ignored.
 *
 * @param matcher - the compiled MCP matcher payload.
 * @param toolName - the invoked tool name.
 * @param args - the tool's JSON arguments (unused; MCP matches on the name).
 * @returns true when the matcher applies to this tool name.
 */
export function matchMcp(matcher: McpMatcher, toolName: string, _args: JsonValue): boolean {
  if (!toolName.startsWith(PREFIX)) return false

  const rest = toolName.slice(PREFIX.length)
  const sep = rest.indexOf('__')
  const server = sep === -1 ? rest : rest.slice(0, sep)
  const tool = sep === -1 ? '' : rest.slice(sep + 2)

  if (matcher.server !== '*' && matcher.server !== server) return false
  if (matcher.tool === undefined || matcher.tool === '*') return true
  return matcher.tool === tool
}
