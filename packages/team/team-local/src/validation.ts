/**
 * Cross-definition validation for team member definitions.
 *
 * @module @deepseek-ai/dsh-team-local
 */

import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'

/**
 * Cross-validate a set of team member definitions.
 *
 * @param definitions - all loaded definitions.
 * @throws when duplicate ids exist, no leader is defined, or multiple leaders exist.
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
}
