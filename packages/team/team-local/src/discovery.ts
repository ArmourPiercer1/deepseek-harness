/**
 * Filesystem discovery of team member Markdown definitions.
 *
 * @module @deepseek-ai/dsh-team-local
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import { parseTeamMemberMarkdown } from './parser.ts'
import type { ParseResult } from './parser.ts'

/** Options for team member filesystem discovery. */
export interface DiscoveryOptions {
  /** DSH home path ($DSH_HOME). */
  readonly homePath: string
  /** Workspace root path. */
  readonly workspacePath?: string
  /** Abort signal. */
  readonly signal?: AbortSignal
}

/**
 * Scan configured directories for `.md` teammate definitions.
 *
 * Scan order: `$DSH_HOME/teammates/` first, then `.dsh/teammates/` in the
 * workspace. When both contain a file with the same member id, the workspace
 * definition takes precedence (last wins).
 *
 * @param options - discovery options.
 * @returns all discovered parse results in stable order.
 */
export async function discoverTeamMembers(
  options: DiscoveryOptions,
): Promise<readonly ParseResult[]> {
  const results: ParseResult[] = []
  const dirs: string[] = []

  if (options.homePath) {
    dirs.push(join(options.homePath, 'teammates'))
  }
  if (options.workspacePath) {
    dirs.push(join(options.workspacePath, '.dsh', 'teammates'))
  }

  for (const dir of dirs) {
    options.signal?.throwIfAborted()
    try {
      const entries = await readdir(dir)
      const mdFiles = entries.filter(e => e.endsWith('.md')).sort()
      for (const file of mdFiles) {
        options.signal?.throwIfAborted()
        const filePath = join(dir, file)
        const content = await readFile(filePath, 'utf-8')
        results.push(parseTeamMemberMarkdown(content, filePath))
      }
    } catch (e: unknown) {
      // Directory not found is not an error — skip silently
      if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw e
    }
  }

  return results
}

/**
 * Deduplicate definitions by id. When the same id appears in multiple files,
 * the last one wins (workspace overrides home).
 *
 * @param results - parse results to deduplicate.
 * @returns deduplicated definitions (only those with successful parses).
 */
export function deduplicateDefinitions(
  results: readonly ParseResult[],
): readonly TeamMemberDefinition[] {
  const byId = new Map<string, TeamMemberDefinition>()
  for (const result of results) {
    if (result.definition) {
      byId.set(result.definition.id, result.definition)
    }
  }
  return [...byId.values()]
}
