/**
 * Team runtime: orchestration, delegation, and per-member capability filtering.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { Context } from '@deepseek-ai/cordis'

export { TeamOrchestrator } from './orchestrator.ts'
export type { TeammateActivation, TeammateActivationStatus } from './orchestrator.ts'
export { createMcpGuard } from './mcp-guard.ts'
export type { McpGuardFn } from './mcp-guard.ts'
export { installSkillFilter } from './skill-filter.ts'
export { buildToolRestriction } from './tool-policy.ts'
export { installMemberComposition } from './member-setup.ts'

export const name = 'team-runtime'
export const inject = ['team', 'tools'] as const

export function apply(_ctx: Context): void {
  // Team tools are registered by dsh-tool-team (loaded after this via bundle ordering).
  // Validation of DEFAULT_LEADER_TOOLS availability is deferred to first delegation.
}
