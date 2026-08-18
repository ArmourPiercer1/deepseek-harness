/**
 * Team runtime: orchestration, delegation, and per-member capability filtering.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import { teamMemberSetupContribution } from './member-setup.ts'

export { TeamOrchestrator } from './orchestrator.ts'
export type { TeammateActivation, TeammateActivationStatus } from './orchestrator.ts'
export { createMcpGuard } from './mcp-guard.ts'
export type { McpGuardFn } from './mcp-guard.ts'
export { createSkillGuard } from './skill-guard.ts'
export { installApprovalHook } from './approval-setup.ts'
export { installMemberComposition, teamMemberSetupContribution } from './member-setup.ts'

export const name = 'team-runtime'
export const inject = ['team', 'tools', 'subagents']

export function apply(ctx: Context): void {
  // Install per-member composition (skill guard, MCP guard + approval hook)
  // into every continuable child that carries a `team/member-bound` event, on
  // both fresh creation and cold resume. The contribution is a no-op for
  // non-team children.
  ctx.effect(
    () => ctx.subagents.registerContinuableSetup(teamMemberSetupContribution(ctx)),
    'team-runtime.continuableSetup()',
  )
}
