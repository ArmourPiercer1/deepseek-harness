/**
 * Command tool-call matching (Bash / pwsh), per Claude Code's documented
 * semantics: split compound commands, strip common wrappers and env-var
 * assignments, canonicalize pwsh aliases, then apply a `*` wildcard pattern
 * with a trailing-space word-boundary rule.
 *
 * @module @deepseek-ai/dsh-permission-engine
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { CommandMatcher } from './matchers.ts'

/**
 * Compound-command separators, longest first so two-character operators win
 * over the single `&` / `|` they extend (`&&` before `&`, `||`/`|&` before `|`).
 * Newline also separates subcommands.
 */
const SPLIT_RE = /\r?\n|&&|\|\||\|&|;|\||&/

/** Pure wrappers stripped from the front of a subcommand without consuming an argument. */
const PURE_WRAPPERS = new Set(['time', 'nohup', 'command', 'builtin'])

/** pwsh aliases -> canonical cmdlet, matched case-insensitively on the leading command word. */
const PWSH_ALIASES: ReadonlyMap<string, string> = new Map([
  ['gci', 'Get-ChildItem'],
  ['ls', 'Get-ChildItem'],
  ['dir', 'Get-ChildItem'],
  ['rm', 'Remove-Item'],
  ['del', 'Remove-Item'],
  ['erase', 'Remove-Item'],
  ['cat', 'Get-Content'],
  ['type', 'Get-Content'],
  ['cp', 'Copy-Item'],
  ['copy', 'Copy-Item'],
  ['mv', 'Move-Item'],
  ['move', 'Move-Item'],
])

/** Matches the leading whitespace-delimited word and the rest of a string. */
const LEADING_WORD_RE = /^(\S+)((?:\s+.*)?)$/

/**
 * Strip leading wrappers and env-var assignments from a subcommand so the
 * remaining command is what the pattern must match. Removes each leading
 * `NAME=value` token, the pure wrappers `time`/`nohup`/`command`/`builtin`
 * (except `command -v`), `timeout` plus its duration argument, `stdbuf` and its
 * leading flags, `nice` (and an optional `-n N`), and a flag-less `xargs`.
 *
 * @param cmd - a single trimmed subcommand.
 * @returns the subcommand with leading wrappers removed.
 */
function stripWrappers(cmd: string): string {
  let rest = cmd.trim()
  while (rest) {
    const match = LEADING_WORD_RE.exec(rest)
    const head = match?.[1] ?? ''
    const tail = (match?.[2] ?? '').trim()

    // Leading safe env-var assignment like `NODE_ENV=test`.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head) && head.length > head.indexOf('=') + 1) {
      rest = tail
      continue
    }
    // `command -v` is a query, not a wrapper.
    if (head === 'command' && /^-v\b/.test(tail)) break
    if (PURE_WRAPPERS.has(head)) {
      rest = tail
      continue
    }
    if (head === 'timeout') {
      const after = tail.split(/\s+/)
      rest = after.slice(1).join(' ').trim()
      continue
    }
    if (head === 'stdbuf') {
      const after = tail.split(/\s+/)
      let idx = 0
      while (idx < after.length && after[idx]?.startsWith('-')) idx++
      rest = after.slice(idx).join(' ').trim()
      continue
    }
    if (head === 'nice') {
      const after = tail.split(/\s+/)
      const skip = after[0] === '-n' ? 2 : 0
      rest = after.slice(skip).join(' ').trim()
      continue
    }
    // Strip a bare `xargs` (no flags), keeping it when it carries options.
    if (head === 'xargs' && !tail.startsWith('-')) {
      rest = tail
      continue
    }
    break
  }
  return rest
}

/**
 * Replace the leading command word with its pwsh cmdlet when it is a known
 * alias. Applies only under pwsh and is case-insensitive.
 *
 * @param cmd - a subcommand (or the pattern) whose leading word may be an alias.
 * @returns the string with the leading alias canonicalized, unchanged otherwise.
 */
function canonicalizePwsh(cmd: string): string {
  const match = LEADING_WORD_RE.exec(cmd)
  if (match === null) return cmd
  const head = match[1]
  if (head === undefined) return cmd
  const cmdlet = PWSH_ALIASES.get(head.toLowerCase())
  if (cmdlet === undefined) return cmd
  return cmdlet + (match[2] ?? '')
}

/**
 * Whether a `*`-wildcard pattern matches a command. A trailing ` *` (space then
 * star) enforces a word boundary after the literal prefix; a trailing `:*` is
 * equivalent to a trailing ` *`, and is recognized only at the very end of the
 * pattern (a `:` elsewhere is literal). An exact pattern (no `*`) requires
 * full-string equality.
 *
 * @param pattern - the compiled specifier pattern.
 * @param command - a single stripped subcommand.
 * @param caseInsensitive - match case-insensitively (pwsh).
 * @returns true when the pattern matches the command.
 */
function matchPattern(pattern: string, command: string, caseInsensitive: boolean): boolean {
  let p = pattern
  // `ls:*` acts like `ls *`; the `:*` suffix is only recognized at the end.
  if (p.endsWith(':*')) p = p.slice(0, -2) + ' *'
  // Canonicalize a pwsh alias in the pattern so alias-authored rules also match.
  if (caseInsensitive) p = canonicalizePwsh(p)

  let re = '^'
  for (const ch of p) {
    if (ch === '*') re += '.*'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  re += '$'
  return new RegExp(re, caseInsensitive ? 'i' : '').test(command)
}

/**
 * Decide whether a {@link CommandMatcher} matches a command tool call.
 *
 * The command is read from `args.command` when `args` is a JSON object with a
 * string `command` field; anything else is a non-match. Returns true only when
 * the tool name matches `matcher.tool` (case-insensitively) and the pattern
 * matches at least one subcommand after compound-command splitting, wrapper
 * stripping, and (for pwsh) alias canonicalization.
 *
 * @param matcher - the compiled command matcher.
 * @param toolName - the invoked tool name.
 * @param args - the tool's JSON arguments.
 * @returns true when the matcher applies to this call.
 */
export function matchCommand(matcher: CommandMatcher, toolName: string, args: JsonValue): boolean {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return false
  const command = (args as Record<string, unknown>).command
  if (typeof command !== 'string') return false
  if (matcher.tool.toLowerCase() !== toolName.toLowerCase()) return false

  const caseInsensitive = matcher.tool.toLowerCase() === 'pwsh'
  const subcommands = command.split(SPLIT_RE)
  for (const sub of subcommands) {
    const trimmed = sub.trim()
    if (!trimmed) continue
    let candidate = stripWrappers(trimmed)
    if (caseInsensitive) candidate = canonicalizePwsh(candidate)
    if (matchPattern(matcher.pattern, candidate, caseInsensitive)) return true
  }
  return false
}
