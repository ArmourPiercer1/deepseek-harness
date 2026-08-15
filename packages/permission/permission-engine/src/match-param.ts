import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ParamMatcher } from './matchers.ts'

/**
 * Whether a `Tool(param:value)` rule matches a tool call over a top-level
 * scalar argument field, replicating Claude Code's parameter-matching
 * semantics. The caller guarantees the rule was never built for a primary
 * content field (`command`, `file_path`, `path`, `notebook_path`, `url`),
 * which are rejected at parse time; matching here assumes the field is an
 * ordinary parameter.
 *
 * @param matcher - the compiled param matcher payload.
 * @param toolName - the invoked tool name.
 * @param args - the tool's JSON arguments.
 * @returns true when the matcher applies to this call.
 */
export function matchParam(matcher: ParamMatcher, toolName: string, args: JsonValue): boolean {
  if (matcher.tool !== toolName) return false

  if (args === null || typeof args !== 'object' || Array.isArray(args)) return false
  if (!Object.hasOwn(args, matcher.param)) return false

  const value = args[matcher.param]
  if (value === undefined || (value !== null && typeof value === 'object')) return false

  return valueMatches(matcher.value, scalarToString(value))
}

/** The literal string form of a scalar JSON value. */
function scalarToString(value: string | number | boolean | null): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  return value
}

/** Whether a pattern (`*` wildcard) matches a string exactly. */
function valueMatches(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) return pattern === value
  const segments = pattern.split('*')
  const lastIndex = segments.length - 1
  let rest = value
  for (const [i, segment] of segments.entries()) {
    if (i === 0) {
      if (!rest.startsWith(segment)) return false
      rest = rest.slice(segment.length)
    } else if (i === lastIndex) {
      return rest.endsWith(segment)
    } else {
      const index = rest.indexOf(segment)
      if (index === -1) return false
      rest = rest.slice(index + segment.length)
    }
  }
  return true
}
