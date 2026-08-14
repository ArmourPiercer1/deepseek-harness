/**
 * Model-facing team tools: delegate_to_teammate, list_teammates,
 * send_team_message, team_progress, team_control.
 *
 * @module @deepseek-ai/dsh-tool-team
 */

import type { Context } from '@deepseek-ai/cordis'
import { TeamOrchestrator } from '@deepseek-ai/dsh-team-runtime'
import { TeamControlCoordinator, TeamProgressStore } from '@deepseek-ai/dsh-team-channels'
import { registerDelegateTool } from './tool-delegate.ts'
import { registerListTeammatesTool } from './tool-list-teammates.ts'
import { registerSendMessageTool } from './tool-send-message.ts'
import { registerProgressTool } from './tool-progress.ts'
import { registerControlTool } from './tool-control.ts'

export const name = 'tool-team'
export const inject = ['tools', 'team'] as const

export function apply(ctx: Context): void {
  const orchestrator = new TeamOrchestrator()
  const coordinator = new TeamControlCoordinator()
  const progressStore = new TeamProgressStore()

  registerDelegateTool(ctx, orchestrator)
  registerListTeammatesTool(ctx, orchestrator)
  registerSendMessageTool(ctx)
  registerProgressTool(ctx, progressStore)
  registerControlTool(ctx, coordinator)
}
