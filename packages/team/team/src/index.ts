/**
 * Team member registry Service.
 *
 * Provides `ctx.team` — the registry for team member definitions.
 * Service Providers (e.g. `dsh-team-local`) populate it via
 * {@link TeamRegistry.register}.
 *
 * @module @deepseek-ai/dsh-team
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { TeamMemberDefinition, TeamToolPolicy } from './types.ts'
import type { TeamMemberId } from './brand.ts'
import { DEFAULT_LEADER_TOOLS, TEAMMATE_DENIED_TOOLS } from './constants.ts'

// Re-export all public API
export { TeamMemberId } from './brand.ts'
export * from './types.ts'
export * from './constants.ts'
// Side-effect: register session event declarations
export type * from './events.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Team member definition registry. */
    team: TeamRegistry
  }
}

/**
 * Registry of team member definitions.
 *
 * Service Providers call {@link register} to populate the registry with
 * definitions. Consumers read definitions through {@link list},
 * {@link get}, etc.
 */
export default class TeamRegistry extends Service {
  private definitions: TeamMemberDefinition[] = []

  constructor(ctx: Context) {
    super(ctx, 'team')
  }

  /**
   * Register member definitions. Replaces any previously registered set.
   *
   * @param definitions - the complete set of definitions to register.
   */
  register(definitions: readonly TeamMemberDefinition[]): void {
    this.definitions = [...definitions]
  }

  /** List all loaded member definitions (leader + teammates). */
  list(): readonly TeamMemberDefinition[] {
    return this.definitions
  }

  /** Get one member by id. Returns `undefined` when the id is unknown. */
  get(id: TeamMemberId): TeamMemberDefinition | undefined {
    return this.definitions.find(d => d.id === id)
  }

  /**
   * Get the leader definition, or `undefined` when none is loaded. The leader
   * definition is metadata only: the root agent is composed by its own preset,
   * never by this registry, so no leader policy is applied at runtime.
   */
  getLeader(): TeamMemberDefinition | undefined {
    return this.definitions.find(d => d.role === 'leader')
  }

  /**
   * Resolve the effective {@link ToolRestriction} for a member.
   *
   * - **Leader**: `allow = DEFAULT_LEADER_TOOLS ∪ definition.tools.allow`;
   *   `deny = definition.tools.deny` (DEFAULT_LEADER_TOOLS never denied).
   * - **Teammate**: `allow`/`deny` from definition; `deny` always includes
   *   team control tools (`delegate_to_teammate`, `team_control`, `list_teammates`).
   *
   * @param member - the member definition to resolve.
   * @returns the resolved tool restriction.
   */
  effectiveToolPolicy(member: TeamMemberDefinition): ToolRestriction {
    return buildEffectiveToolPolicy(member)
  }
}

/**
 * Build the effective {@link ToolRestriction} for a team member.
 *
 * @param member - the member definition.
 * @returns the resolved tool restriction.
 */
export function buildEffectiveToolPolicy(member: TeamMemberDefinition): ToolRestriction {
  const definedTools: TeamToolPolicy = member.tools ?? {}

  if (member.role === 'leader') {
    const allow = definedTools.allow
      ? [...new Set([...DEFAULT_LEADER_TOOLS, ...definedTools.allow])]
      : undefined

    const defaultSet = new Set<string>(DEFAULT_LEADER_TOOLS)
    const deny = definedTools.deny
      ? definedTools.deny.filter(t => !defaultSet.has(t))
      : undefined

    const result: { allow?: readonly string[]; deny?: readonly string[] } = {}
    if (allow !== undefined) result.allow = allow
    if (deny !== undefined && deny.length > 0) result.deny = deny
    return result
  }

  // Teammate
  const deny = [...new Set([...TEAMMATE_DENIED_TOOLS, ...(definedTools.deny ?? [])])]
  const result: { allow?: readonly string[]; deny?: readonly string[] } = { deny }
  if (definedTools.allow !== undefined) result.allow = definedTools.allow
  return result
}
