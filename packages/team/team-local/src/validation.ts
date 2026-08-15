/**
 * Cross-definition validation for team member definitions.
 *
 * @module @deepseek-ai/dsh-team-local
 */

import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import { TEAMMATE_DENIED_TOOLS } from '@deepseek-ai/dsh-team'

/**
 * Cross-validate a set of team member definitions.
 *
 * @param definitions - all loaded definitions.
 * @throws when duplicate ids exist, no leader is defined, multiple leaders
 *   exist, or a member's `requiresApproval` names a denied or disallowed tool.
 */
export function validateTeamDefinitions(
  definitions: readonly TeamMemberDefinition[],
): void {
  // Check duplicate ids
  const ids = new Set<string>()
  for (const def of definitions) {
    if (ids.has(def.id)) {
      throw new Error(`Duplicate team member id: "${def.id}"`)
    }
    ids.add(def.id)
  }

  // Check leader count
  const leaders = definitions.filter(d => d.role === 'leader')
  if (leaders.length === 0) {
    throw new Error('No leader definition found. Exactly one team member must have role: "leader".')
  }
  if (leaders.length > 1) {
    throw new Error(
      `Multiple leader definitions found: ${leaders.map(l => `"${l.id}"`).join(', ')}. Exactly one leader is required.`,
    )
  }

  // requiresApproval must name only tools the member may actually run: a denied
  // tool is rejected before approval, and an allow-listed member cannot be
  // approved for a tool outside its allow list.
  for (const def of definitions) {
    if (def.requiresApproval === undefined || def.requiresApproval.length === 0) continue
    const deny = new Set<string>([
      ...(def.tools?.deny ?? []),
      ...(def.role === 'teammate' ? TEAMMATE_DENIED_TOOLS : []),
    ])
    const allow = def.tools?.allow
    for (const tool of def.requiresApproval) {
      if (deny.has(tool)) {
        throw new Error(`requiresApproval names a denied tool "${tool}" on member "${def.id}"`)
      }
      if (allow !== undefined && !allow.includes(tool)) {
        throw new Error(`requiresApproval names tool "${tool}" not in member "${def.id}" allow list`)
      }
    }
  }
}
