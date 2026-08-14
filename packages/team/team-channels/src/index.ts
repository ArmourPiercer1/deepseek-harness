/**
 * Team messaging, progress tracking, and approval coordination.
 *
 * @module @deepseek-ai/dsh-team-channels
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export { TeamControlCoordinator } from './control-coordinator.ts'
export type { PendingControlRequest } from './control-coordinator.ts'
export { TeamProgressStore } from './progress-store.ts'

export const name = 'team-channels'
export const inject = ['team'] as const

export interface Config {
  /** Timeout for control requests before auto-deny (ms). */
  controlRequestTimeoutMs: number
}

export const Config: z<Config> = z.object({
  controlRequestTimeoutMs: z.natural().default(120_000),
})

export function apply(_ctx: Context, _config: Config): void {
  // Control coordinator and progress store are instantiated per-session
  // by the tool implementations that need them. This plugin just ensures
  // the team service is available.
}
