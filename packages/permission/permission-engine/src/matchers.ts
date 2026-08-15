/**
 * Engine-owned compiled matcher forms. The Definition fixes only the
 * {@link MatcherKind} discriminant on {@link RuleIR}; the compiled payload each
 * matcher evaluates lives here, in the provider that evaluates it.
 *
 * @module @deepseek-ai/dsh-permission-engine
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'

/**
 * A compiled command pattern (Bash / pwsh). `segments` is the specifier split
 * into literal/wildcard tokens; the matcher applies it to each subcommand of a
 * compound command after wrapper stripping and pwsh alias canonicalization.
 */
export interface CommandMatcher {
  readonly kind: 'command'
  /** The tool this applies to, e.g. `Bash` or `pwsh`. */
  readonly tool: string
  /** The specifier pattern, verbatim (e.g. `git push:*`). */
  readonly pattern: string
}

/** A compiled gitignore-style path pattern with a resolved anchor. */
export interface PathMatcher {
  readonly kind: 'path'
  /** The tool this applies to, e.g. `Read`, `Edit`, `Write`. */
  readonly tool: string
  /** The gitignore-style pattern, verbatim (for example an absolute `.env` glob). */
  readonly pattern: string
}

/** A compiled `mcp__server[__tool]` prefix matcher. */
export interface McpMatcher {
  readonly kind: 'mcp'
  /** The server segment (e.g. `postgres`), or `*` for all. */
  readonly server: string
  /** The tool segment, `*`, or undefined for whole-server. */
  readonly tool?: string
}

/** A compiled `Tool(param:value)` matcher over a top-level scalar field. */
export interface ParamMatcher {
  readonly kind: 'param'
  /** The tool this applies to. */
  readonly tool: string
  /** The top-level scalar parameter name. */
  readonly param: string
  /** The value pattern (`*` wildcard supported). */
  readonly value: string
}

/** The discriminated union of compiled matcher payloads. */
export type CompiledMatcher = CommandMatcher | PathMatcher | McpMatcher | ParamMatcher

/**
 * Whether a compiled matcher matches a tool call's arguments.
 * Implemented per matcher kind in `match-command`/`match-path`/`match-mcp`/
 * `match-param`; the engine dispatches on `matcher.kind`.
 *
 * @param matcher - the compiled matcher payload.
 * @param toolName - the invoked tool name.
 * @param args - the tool's JSON arguments.
 * @returns true when the matcher applies to this call.
 */
export type MatchFn = (matcher: CompiledMatcher, toolName: string, args: JsonValue) => boolean
