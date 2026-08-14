/**
 * Tool policy resolution for team members.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import { DEFAULT_LEADER_TOOLS, TEAMMATE_DENIED_TOOLS } from '@deepseek-ai/dsh-team'

/**
 * Build the effective {@link ToolRestriction} for a member.
 *
 * - **Leader**: `allow = DEFAULT_LEADER_TOOLS ∪ definition.tools.allow`;
 *   `deny = definition.tools.deny` (DEFAULT_LEADER_TOOLS never denied).
 * - **Teammate**: `allow`/`deny` from definition;
 *   `deny` always includes team control tools.
 *
 * @param member - the member definition.
 * @returns the resolved tool restriction.
 */
export function buildToolRestriction(member: TeamMemberDefinition): ToolRestriction {
  if (member.role === 'leader') {
    return buildLeaderToolRestriction(member)
  }
  return buildTeammateToolRestriction(member)
}

function buildLeaderToolRestriction(member: TeamMemberDefinition): ToolRestriction {
  const definedAllow = member.tools?.allow
  const definedDeny = member.tools?.deny

  // Leader always gets DEFAULT_LEADER_TOOLS merged into allow
  const allow = definedAllow
    ? [...new Set([...DEFAULT_LEADER_TOOLS, ...definedAllow])]
    : undefined

  // Leader cannot deny DEFAULT_LEADER_TOOLS
  const defaultSet = new Set<string>(DEFAULT_LEADER_TOOLS)
  const deny = definedDeny
    ? definedDeny.filter(t => !defaultSet.has(t))
    : undefined

  const result: { allow?: readonly string[]; deny?: readonly string[] } = {}
  if (allow !== undefined) result.allow = allow
  if (deny !== undefined && deny.length > 0) result.deny = deny
  return result
}

function buildTeammateToolRestriction(member: TeamMemberDefinition): ToolRestriction {
  const definedAllow = member.tools?.allow
  const definedDeny = member.tools?.deny

  // Teammate always has team control tools denied
  const deny = [...new Set([...TEAMMATE_DENIED_TOOLS, ...(definedDeny ?? [])])]

  const result: { allow?: readonly string[]; deny?: readonly string[] } = { deny }
  if (definedAllow !== undefined) result.allow = definedAllow
  return result
}
