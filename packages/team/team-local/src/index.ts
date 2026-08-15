/**
 * Local filesystem team member definition loader.
 *
 * Discovers Markdown team member definitions from `$DSH_HOME/teammates/`
 * and `.dsh/teammates/`, parses them, validates, and registers them with
 * `ctx.team`. Watches definition directories for changes and reloads
 * automatically with a debounce window.
 *
 * @module @deepseek-ai/dsh-team-local
 */

import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { discoverTeamMembers, deduplicateDefinitions } from './discovery.ts'
import { validateTeamDefinitions } from './validation.ts'

export const name = 'team-local'
export const inject = ['team'] as const

/** Debounce window for file-change reloads (ms). */
const RELOAD_DEBOUNCE_MS = 500

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
 * @param ctx - plugin context.
 * @param homePath - DSH home path.
 * @param workspacePath - workspace root path.
 * @param signal - abort signal for cancellation.
 */
async function loadDefinitions(
  ctx: Context,
  homePath: string,
  workspacePath: string,
  signal?: AbortSignal,
): Promise<void> {
  const results = await discoverTeamMembers({
    homePath: homePath || process.env['DSH_HOME'] || '',
    ...(workspacePath ? { workspacePath } : {}),
    ...(signal !== undefined ? { signal } : {}),
  })
  const definitions = deduplicateDefinitions(results)
  if (definitions.length > 0) {
    validateTeamDefinitions(definitions)
    ctx.team.register(definitions)
  }
}

/**
 * Resolve the teammate directories that should be watched.
 *
 * @param homePath - DSH home path.
 * @param workspacePath - workspace root path.
 * @returns directories to watch.
 */
function resolveWatchDirs(homePath: string, workspacePath: string): string[] {
  const dirs: string[] = []
  const resolvedHome = homePath || process.env['DSH_HOME'] || ''
  if (resolvedHome) dirs.push(join(resolvedHome, 'teammates'))
  if (workspacePath) dirs.push(join(workspacePath, '.dsh', 'teammates'))
  return dirs
}

export function apply(ctx: Context, config: Config): void {
  // Load definitions asynchronously during plugin initialization,
  // then watch the definition directories for changes and reload.
  ctx.effect(function* () {
    const controller = new AbortController()
    const log = ctx.logger('team-local')

    // Initial load
    loadDefinitions(ctx, config.homePath, config.workspacePath, controller.signal).catch((e: unknown) => {
      if (!controller.signal.aborted) {
        log.error('Failed to load team definitions:', e)
      }
    })

    // Watch definition directories for changes
    const watchers: FSWatcher[] = []
    let reloadTimer: ReturnType<typeof setTimeout> | undefined

    const scheduleReload = (): void => {
      if (controller.signal.aborted) return
      if (reloadTimer !== undefined) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => {
        reloadTimer = undefined
        if (controller.signal.aborted) return
        log.info('Teammate definition change detected, reloading…')
        loadDefinitions(ctx, config.homePath, config.workspacePath, controller.signal).catch((e: unknown) => {
          if (!controller.signal.aborted) {
            log.error('Failed to reload team definitions:', e)
          }
        })
      }, RELOAD_DEBOUNCE_MS)
    }

    for (const dir of resolveWatchDirs(config.homePath, config.workspacePath)) {
      try {
        const watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
          if (filename && filename.endsWith('.md')) {
            scheduleReload()
          }
        })
        watcher.on('error', () => {
          // Directory may not exist or become inaccessible — ignore
        })
        watchers.push(watcher)
      } catch {
        // Directory does not exist yet — not an error
      }
    }

    yield () => {
      controller.abort()
      if (reloadTimer !== undefined) clearTimeout(reloadTimer)
      for (const watcher of watchers) watcher.close()
    }
  }, 'team-local load+watch')
}
