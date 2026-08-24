/**
 * Local filesystem team member definition loader.
 *
 * Discovers Markdown team member definitions from `$DSH_HOME/teammates/`
 * and `.dsh/teammates/`, parses them, validates, and registers them with
 * `ctx.team`. Watches definition directories for changes and reloads
 * automatically with a debounce window.
 *
 * The workspace root tracks the live session: the initial resolution is the
 * configured `workspacePath`, then `$DSH_CWD`, then the process cwd; every
 * later `agent/created` whose session header carries a different cwd
 * re-resolves the workspace and reloads. A preset's standing mount is shared
 * by every session joined under it, so mount-time process state alone cannot
 * know which workspace's `.dsh/teammates/` to scan. A workspace that defines
 * its own members is self-contained; global home definitions apply only to
 * workspaces that define none of their own.
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
// Event-map augmentation for `agent/created`.
import type {} from '@deepseek-ai/dsh-agent'
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
export { deduplicateDefinitions, discoverTeamMembers } from './discovery.ts'

export const name = 'team-local'
export const inject = ['team']

/** Debounce window for definition-change and enablement-change reloads (ms). */
const RELOAD_DEBOUNCE_MS = 500

/** Plugin configuration controlling where local team member definitions are discovered and watched. */
export interface Config {
  /** DSH home path for global teammate definitions. Defaults to $DSH_HOME. */
  homePath: string
  /** Initial workspace path for project-level teammate definitions. Defaults to $DSH_CWD, then the process cwd. */
  workspacePath: string
}

export const Config: z<Config> = z.object({
  homePath: z.string().default(''),
  workspacePath: z.string().default(''),
})

/**
 * Resolve the DSH home path carrying global teammate definitions.
 *
 * @param homePath - configured home path; an empty value falls back to $DSH_HOME.
 * @returns the resolved home path, or an empty string when none applies.
 */
function resolveHomePath(homePath: string): string {
  return homePath || process.env['DSH_HOME'] || ''
}

/**
 * Resolve the initial workspace path before any session exists.
 *
 * @param workspacePath - configured workspace path.
 * @returns the configured path when non-empty, otherwise $DSH_CWD, otherwise the process cwd.
 */
function resolveInitialWorkspace(workspacePath: string): string {
  return workspacePath || process.env['DSH_CWD'] || process.cwd()
}

/**
 * Load team member definitions from the filesystem, drop the teammates
 * disabled for the workspace, register the remainder, then run the leader
 * tool diagnostic against the registered tools.
 *
 * A workspace that defines its own members under `.dsh/teammates/` is
 * self-contained: those definitions form the complete team for that
 * workspace, so global home definitions never merge into a project team.
 * Home definitions apply only to workspaces that define none of their own.
 *
 * @param ctx - plugin context.
 * @param homePath - resolved DSH home path.
 * @param workspacePath - resolved workspace root path.
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
  const options = signal !== undefined ? { signal } : {}
  const workspaceResults = workspacePath === ''
    ? []
    : await discoverTeamMembers({ homePath: '', workspacePath, ...options })
  const results = workspaceResults.length > 0
    ? workspaceResults
    : await discoverTeamMembers({ homePath, ...options })
  const definitions = deduplicateDefinitions(results)
  if (definitions.length > 0) {
    const enabled = filterDisabledTeammates(definitions, getEnablement(), workspacePath)
    validateTeamDefinitions(enabled)
    ctx.team.register(enabled)
    diagnoseLeaderTools(ctx)
  }
}

export function apply(ctx: Context, config: Config): void {
  const controller = new AbortController()
  const log = ctx.logger('team-local')
  let reloadTimer: ReturnType<typeof setTimeout> | undefined

  const homePath = resolveHomePath(config.homePath)
  // The workspace tracks the live session: mount-time state seeds it, and
  // every agent created under a different session cwd re-resolves it.
  let workspacePath = resolveInitialWorkspace(config.workspacePath)

  // Resolved enablement section: the live settings scope while a settings
  // service is mounted, the empty default otherwise.
  let enablement: () => TeamEnablementSettings = () => DEFAULT_TEAM_ENABLEMENT

  const load = (): void => {
    loadDefinitions(ctx, homePath, workspacePath, enablement, controller.signal).catch((e: unknown) => {
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

  // One watcher per teammate directory; workspace switches add directories
  // already observed by a session, so each directory is watched once.
  const watchers = new Map<string, FSWatcher>()
  const watchDir = (dir: string): void => {
    if (watchers.has(dir)) return
    try {
      const watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
        if (filename && filename.endsWith('.md')) {
          scheduleReload()
        }
      })
      watcher.on('error', () => {
        // Directory may not exist or become inaccessible — ignore
      })
      watchers.set(dir, watcher)
    } catch {
      // Directory does not exist yet — not an error
    }
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

  // A preset's standing mount outlives any one session: each agent created
  // under a new session cwd re-points the workspace scan at that session's
  // `.dsh/teammates/` and reloads. Agents without a session cwd (or under
  // the already-resolved workspace) leave the current set untouched.
  ctx.on('agent/created', ({ agent }) => {
    const cwd = agent.session.header.cwd
    if (cwd === undefined || cwd === '' || cwd === workspacePath) return
    log.info(`Session workspace changed to "${cwd}", reloading team definitions…`)
    workspacePath = cwd
    watchDir(join(cwd, '.dsh', 'teammates'))
    load()
  })

  // Initial load and watches
  if (homePath) watchDir(join(homePath, 'teammates'))
  watchDir(join(workspacePath, '.dsh', 'teammates'))
  load()

  ctx.effect(() => {
    return () => {
      controller.abort()
      if (reloadTimer !== undefined) clearTimeout(reloadTimer)
      for (const watcher of watchers.values()) watcher.close()
    }
  }, 'team-local load+watch')
}
