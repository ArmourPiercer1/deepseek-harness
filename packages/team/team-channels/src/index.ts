/**
 * Team messaging, progress tracking, and approval coordination.
 *
 * @module @deepseek-ai/dsh-team-channels
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TeamControlRegistry } from './control-coordinator.ts'

export { TeamControlRegistry } from './control-coordinator.ts'
export { TeamProgressStore } from './progress-store.ts'

export const name = 'team-channels'
export const inject = [] as const

export interface Config {
  /** Timeout for control requests before auto-deny (ms). */
  controlRequestTimeoutMs: number
}

export const Config: z<Config> = z.object({
  controlRequestTimeoutMs: z.natural().default(120_000),
})

export function apply(ctx: Context, _config: Config): void {
  // One host-level registry shared by the leader's `team_control` tool and the
  // teammate-side approval hook installed by `dsh-team-runtime`.
  ctx.plugin(TeamControlRegistry)
}
