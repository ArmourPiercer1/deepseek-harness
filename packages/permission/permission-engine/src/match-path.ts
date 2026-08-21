/**
 * Pure gitignore-style path-rule matching for {@link PathMatcher}. This module
 * only decides whether a resolved input path matches a resolved pattern under
 * gitignore glob semantics; it performs no filesystem access. The caller
 * supplies already-resolved bases and owns the allow-vs-deny single-segment
 * depth asymmetry and symlink dual-path logic.
 *
 * @module @deepseek-ai/dsh-permission-engine
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { PathMatcher } from './matchers.ts'

/**
 * Base directories for resolving a {@link PathMatcher}'s anchors. Callers pass
 * these in already-resolved; this module never reads the filesystem.
 */
export interface PathMatchBases {
  /** Absolute directory the rule's settings source lives in (for `/path`). */
  readonly settingsDir: string
  /** Absolute base directory for `~/path` anchors. */
  readonly homeDir: string
  /** Absolute base directory for relative and `./path` anchors. */
  readonly cwd: string
}

/** Tool-argument fields, in precedence order, that may hold the file path. */
const PATH_ARG_KEYS = ['file_path', 'path', 'target_path', 'notebook_path'] as const

/**
 * Whether a {@link PathMatcher} matches a tool call's extracted file path.
 *
 * The file path is read from `args` as the first string among `file_path`,
 * `path`, `target_path`, `notebook_path`, then resolved to an absolute POSIX
 * path: an already-absolute input keeps its form, and a relative input joins
 * the scope's session cwd (`bases.cwd`), mirroring how the pattern's own
 * relative/`./` anchor resolves. Matching applies only when `toolName` equals
 * `matcher.tool` case-insensitively (harness tool names are lowercase; rule
 * spellings may be capitalized). The pattern's anchor resolves against `bases`
 * (`//` root, `~` home, `/` settings, relative/`./` cwd), and the resolved
 * pattern and input path are compared under gitignore rules: `*` matches
 * within one segment, `**` across segments, and a bare name matches at any
 * depth.
 *
 * @param matcher - the compiled path matcher.
 * @param toolName - the invoked tool name.
 * @param args - the tool's JSON arguments.
 * @param bases - resolution bases for the pattern's anchors and relative inputs.
 * @returns true when the input path matches the resolved pattern.
 */
export function matchPath(
  matcher: PathMatcher,
  toolName: string,
  args: JsonValue,
  bases: PathMatchBases,
): boolean {
  if (toolName.toLowerCase() !== matcher.tool.toLowerCase()) return false
  const raw = extractPath(args)
  if (raw === null) return false
  const input = toPosix(raw)
  const absolute = input.startsWith('/') ? input : joinPosix(toPosix(bases.cwd), input)
  return matchSegments(
    toSegments(resolvePattern(matcher.pattern, bases)),
    toSegments(absolute),
  )
}

/** Return the first string path field in `args`, or null when absent. */
function extractPath(args: JsonValue): string | null {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null
  for (const key of PATH_ARG_KEYS) {
    const value = args[key]
    if (typeof value === 'string') return value
  }
  return null
}

/** Resolve the pattern's anchor against `bases` and return the POSIX path. */
function resolvePattern(pattern: string, bases: PathMatchBases): string {
  let base: string
  let spec: string
  if (pattern.startsWith('//')) {
    base = '/'
    spec = pattern.slice(2)
  } else if (pattern.startsWith('~/')) {
    base = toPosix(bases.homeDir)
    spec = pattern.slice(2)
  } else if (pattern === '~') {
    base = toPosix(bases.homeDir)
    spec = ''
  } else if (pattern.startsWith('/')) {
    base = toPosix(bases.settingsDir)
    spec = pattern.slice(1)
  } else if (pattern.startsWith('./')) {
    base = toPosix(bases.cwd)
    spec = pattern.slice(2)
  } else {
    base = toPosix(bases.cwd)
    spec = pattern
  }
  spec = toPosix(spec)
  // gitignore: a bare name (no directory component) matches at any depth.
  const rel = spec !== '' && !spec.includes('/') ? `**/${spec}` : spec
  return joinPosix(base, rel)
}

/** Join a POSIX base directory and relative path, avoiding double slashes. */
function joinPosix(base: string, rel: string): string {
  if (rel === '') return base
  if (base === '') return rel
  const prefix = base === '/' ? '' : base.replace(/\/+$/, '')
  return `${prefix}/${rel.replace(/^\/+/, '')}`
}

/**
 * Normalize a platform path to POSIX form: backslashes become forward slashes
 * and a drive letter is lowercased and prefixed with `/` (`C:\a\b` -> `/c/a/b`).
 */
function toPosix(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const drive = /^([A-Za-z]):(\/.*)?$/.exec(slashed)
  if (drive !== null) {
    const letter = drive[1] ?? ''
    return `/${letter.toLowerCase()}${drive[2] ?? ''}`
  }
  return slashed
}

/** Split a normalized POSIX path into non-empty segments. */
function toSegments(path: string): string[] {
  return path.split('/').filter(segment => segment !== '')
}

/** Whether a single glob segment matches under `*` (within-segment wildcard). */
function starMatch(pattern: string, value: string): boolean {
  const pc = pattern[0]
  if (pc === undefined) return value === ''
  if (pc === '*') {
    if (starMatch(pattern.slice(1), value)) return true
    return value !== '' && starMatch(pattern, value.slice(1))
  }
  const vc = value[0]
  return vc !== undefined && pc === vc && starMatch(pattern.slice(1), value.slice(1))
}

/** Whether pattern segments match input segments under gitignore `**`/`*` rules. */
function matchSegments(pattern: readonly string[], input: readonly string[]): boolean {
  const head = pattern[0]
  if (head === undefined) return input.length === 0
  if (head === '**') {
    // `**` matches zero or more input segments.
    if (matchSegments(pattern.slice(1), input)) return true
    return input.length > 0 && matchSegments(pattern, input.slice(1))
  }
  const first = input[0]
  if (first === undefined) return false
  return starMatch(head, first) && matchSegments(pattern.slice(1), input.slice(1))
}
