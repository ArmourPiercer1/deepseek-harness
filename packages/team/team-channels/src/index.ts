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
export const inject = []

/** Plugin configuration for team messaging, progress tracking, and control approval. */
export interface Config {
  /** Timeout for control requests before auto-deny (ms). */
  controlRequestTimeoutMs: number
}

export const Config: z<Config> = z.object({
  controlRequestTimeoutMs: z.natural().default(120_000),
})

export function apply(ctx: Context, config: Config): void {
  // One host-level registry shared by the leader's `team_control` tool and the
  // teammate-side approval hook installed by `dsh-team-runtime`.
  const registry = new TeamControlRegistry(ctx)

  // Periodic auto-deny of expired control requests. The sweep cadence is the
  // configured timeout clamped to 1-30 s, so the default 120000 keeps the
  // previous 30-second cadence.
  ctx.effect(() => {
    const intervalMs = Math.max(1_000, Math.min(30_000, config.controlRequestTimeoutMs))
    const timer = setInterval(() => { registry.sweep(Date.now(), config.controlRequestTimeoutMs) }, intervalMs)
    return () => { clearInterval(timer) }
  }, 'team-channels.controlSweep()')
}
