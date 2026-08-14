/**
 * Local filesystem team member definition loader.
 *
 * Discovers Markdown team member definitions from `$DSH_HOME/teammates/`
 * and `.dsh/teammates/`, parses them, validates, and registers them with
 * `ctx.team`.
 *
 * @module @deepseek-ai/dsh-team-local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { discoverTeamMembers, deduplicateDefinitions } from './discovery.ts'
import { validateTeamDefinitions } from './validation.ts'

export const name = 'team-local'
export const inject = ['team'] as const

export interface Config {
  /** DSH home path for global teammate definitions. Defaults to $DSH_HOME. */
  homePath: string
  /** Workspace path for project-level teammate definitions. */
  workspacePath: string
}

export const Config: z<Config> = z.object({
  homePath: z.string().default(''),
  workspacePath: z.string().default(''),
})

/**
 * Load team member definitions from the filesystem and register them.
 *
 * @param homePath - DSH home path.
 * @param workspacePath - workspace root path.
 */
async function loadDefinitions(ctx: Context, homePath: string, workspacePath: string): Promise<void> {
  const results = await discoverTeamMembers({
    homePath: homePath || process.env['DSH_HOME'] || '',
    ...(workspacePath ? { workspacePath } : {}),
  })
  const definitions = deduplicateDefinitions(results)
  if (definitions.length > 0) {
    validateTeamDefinitions(definitions)
    ctx.team.register(definitions)
  }
}

export function apply(ctx: Context, config: Config): void {
  // Load definitions asynchronously during plugin initialization.
  // The ctx.effect pattern ensures cleanup on HMR.
  ctx.effect(function* () {
    const controller = new AbortController()
    loadDefinitions(ctx, config.homePath, config.workspacePath).catch((e: unknown) => {
      if (!controller.signal.aborted) {
        ctx.logger?.('team-local')?.error?.('Failed to load team definitions:', e)
      }
    })
    yield () => { controller.abort() }
  }, 'team-local load')
}
