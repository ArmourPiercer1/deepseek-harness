/**
 * Startup diagnostic for leader tool coverage.
 *
 * @module @deepseek-ai/dsh-team-local
 */

import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_LEADER_TOOLS } from '@deepseek-ai/dsh-team'
// Type-only: makes `ctx.get('tools')` resolve to the ToolRuntime
// augmentation. The seam stays optional at runtime — a composition without
// the tools service is compared as an empty registry.
import type {} from '@deepseek-ai/dsh-tools'

/**
 * Warn when a registered leader expects default tools the composition has
 * not registered.
 *
 * The leader definition is metadata only: the root agent is composed by its
 * own preset, so nothing else verifies that the preset actually provides
 * `DEFAULT_LEADER_TOOLS`. This check runs after each successful definition
 * load, names every missing tool in one warning, and never rejects or
 * delays loading.
 *
 * @param ctx - plugin context with `ctx.team` populated.
 * @returns the default leader tool names missing from the registry, or an
 *   empty array when no leader is registered or every default is present.
 */
export function diagnoseLeaderTools(ctx: Context): string[] {
  const leader = ctx.team.getLeader()
  if (leader === undefined) return []

  const registered = new Set(
    (ctx.get('tools')?.schemas() ?? []).map(schema => schema.name),
  )
  const missing = DEFAULT_LEADER_TOOLS.filter(tool => !registered.has(tool))
  if (missing.length > 0) {
    ctx.logger('team-local').warn(
      `leader "${leader.id}": ${missing.length} default leader tools not registered: ${missing.join(', ')}`,
    )
  }
  return missing
}
