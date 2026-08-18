/**
 * Local filesystem team member definition loader.
 *
 * Discovers Markdown team member definitions from `$DSH_HOME/teammates/`
 * and `.dsh/teammates/`, parses them, validates, and registers them with
 * `ctx.team`. Watches definition directories for changes and reloads
 * automatically with a debounce window.
 *
 * Per-workspace teammate enablement persists in the `team-enablement`
 * settings namespace (see `enablement.ts`): disabled teammates are filtered
 * before registration, and a committed settings change triggers a reload, so
 * enabling and disabling takes effect without a restart.
 *
 * @module @deepseek-ai/dsh-team-local
 */

import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { discoverTeamMembers, deduplicateDefinitions } from './discovery.ts'
import { diagnoseLeaderTools } from './diagnostic.ts'
import { validateTeamDefinitions } from './validation.ts'
import {
  DEFAULT_TEAM_ENABLEMENT,
  TEAM_ENABLEMENT_SETTINGS_NAMESPACE,
  TeamEnablementSettingsSchema,
  filterDisabledTeammates,
  type TeamEnablementSettings,
} from './enablement.ts'

export {
  DEFAULT_TEAM_ENABLEMENT,
  TEAM_ENABLEMENT_SETTINGS_NAMESPACE,
  TeamEnablementSettingsSchema,
  filterDisabledTeammates,
  isTeammateEnabled,
} from './enablement.ts'
export type { TeamEnablementSettings } from './enablement.ts'

export const name = 'team-local'
export const inject = ['team']

/** Debounce window for definition-change and enablement-change reloads (ms). */
const RELOAD_DEBOUNCE_MS = 500

/** Plugin configuration controlling where local team member definitions are discovered and watched. */
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
 * Load team member definitions from the filesystem, drop the teammates
 * disabled for the workspace, register the remainder, then run the leader
 * tool diagnostic against the registered tools.
 *
 * @param ctx - plugin context.
 * @param homePath - DSH home path.
 * @param workspacePath - workspace root path.
 * @param getEnablement - source of the resolved `team-enablement` section.
 * @param signal - abort signal for cancellation.
 */
async function loadDefinitions(
  ctx: Context,
  homePath: string,
  workspacePath: string,
  getEnablement: () => TeamEnablementSettings,
  signal?: AbortSignal,
): Promise<void> {
  const results = await discoverTeamMembers({
    homePath: homePath || process.env['DSH_HOME'] || '',
    ...(workspacePath ? { workspacePath } : {}),
    ...(signal !== undefined ? { signal } : {}),
  })
  const definitions = deduplicateDefinitions(results)
  if (definitions.length > 0) {
    const enabled = filterDisabledTeammates(definitions, getEnablement(), workspacePath)
    validateTeamDefinitions(enabled)
    ctx.team.register(enabled)
    diagnoseLeaderTools(ctx)
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
  const controller = new AbortController()
  const log = ctx.logger('team-local')
  let reloadTimer: ReturnType<typeof setTimeout> | undefined

  // Resolved enablement section: the live settings scope while a settings
  // service is mounted, the empty default otherwise.
  let enablement: () => TeamEnablementSettings = () => DEFAULT_TEAM_ENABLEMENT

  const load = (): void => {
    loadDefinitions(ctx, config.homePath, config.workspacePath, enablement, controller.signal).catch((e: unknown) => {
      if (!controller.signal.aborted) {
        log.error('Failed to load team definitions:', e)
      }
    })
  }

  // Debounce every reload trigger — a watched .md change or a committed
  // enablement change — into one re-scan.
  const scheduleReload = (): void => {
    if (controller.signal.aborted) return
    if (reloadTimer !== undefined) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined
      if (controller.signal.aborted) return
      log.info('Teammate definition or enablement change detected, reloading…')
      load()
    }, RELOAD_DEBOUNCE_MS)
  }

  installSettingsSection(ctx, TEAM_ENABLEMENT_SETTINGS_NAMESPACE, TeamEnablementSettingsSchema, {}, {
    setSource: (source) => {
      enablement = source
    },
    // Mounting loads the persisted section; detaching falls back to all
    // enabled. Both make the registered set stale, so both reload.
    onChange: () => {
      scheduleReload()
    },
  })

  // A committed change to the enablement section makes the registered set
  // stale; reload through the shared debounce.
  ctx.on('settings/updated', (ns) => {
    if (ns === TEAM_ENABLEMENT_SETTINGS_NAMESPACE) scheduleReload()
  })

  // Initial load
  load()

  // Watch definition directories for changes
  const watchers: FSWatcher[] = []
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

  ctx.effect(() => {
    return () => {
      controller.abort()
      if (reloadTimer !== undefined) clearTimeout(reloadTimer)
      for (const watcher of watchers) watcher.close()
    }
  }, 'team-local load+watch')
}
