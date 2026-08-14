/**
 * Team member composition setup for continuable subagents.
 *
 * Installs per-member MCP guard, skill filter, and tool restrictions
 * on child agent contexts during initial creation and cold resume.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import { createMcpGuard } from './mcp-guard.ts'
import { installSkillFilter } from './skill-filter.ts'

/**
 * Install the team member composition on a child context based on
 * a {@link TeamMemberBoundData} policy snapshot.
 *
 * @param childCtx - the child's scoped context.
 * @param bound - the member-bound policy snapshot.
 * @returns disposer that removes all installed composition.
 */
export function installMemberComposition(
  childCtx: Context,
  bound: TeamMemberBoundData,
): () => void {
  const disposers: (() => void)[] = []

  // Install MCP guard if the member has an MCP policy
  if (bound.mcpServers && bound.mcpServers.servers.length > 0) {
    const guard = createMcpGuard(bound.mcpServers)
    disposers.push(childCtx.tools.guard(guard))
  }

  // Install skill filter if the member has a skill policy
  if (bound.skills && bound.skills.allow.length > 0) {
    disposers.push(installSkillFilter(childCtx, bound.skills))
  }

  return () => {
    for (const dispose of disposers) dispose()
  }
}
