/**
 * Model-facing team tools: delegate_to_teammate, list_teammates,
 * send_team_message, team_progress, team_control.
 *
 * @module @deepseek-ai/dsh-tool-team
 */

import type { Context } from '@deepseek-ai/cordis'
import { TeamOrchestrator } from '@deepseek-ai/dsh-team-runtime'
import { TeamProgressStore } from '@deepseek-ai/dsh-team-channels'
import { registerDelegateTool } from './tool-delegate.ts'
import { registerListTeammatesTool } from './tool-list-teammates.ts'
import { registerSendMessageTool } from './tool-send-message.ts'
import { registerProgressTool } from './tool-progress.ts'
import { registerControlTool } from './tool-control.ts'

export const name = 'tool-team'
export const inject = ['tools', 'team', 'teamControl']

export function apply(ctx: Context): void {
  const orchestrator = new TeamOrchestrator()
  const coordinator = ctx.teamControl
  const progressStore = new TeamProgressStore()

  registerDelegateTool(ctx, orchestrator)
  registerListTeammatesTool(ctx, orchestrator)
  registerSendMessageTool(ctx, orchestrator)
  registerProgressTool(ctx, progressStore)
  registerControlTool(ctx, coordinator)

  ctx.on('session/event', (session, event) => {
    if (event.type === 'tool/call') {
      const activation = orchestrator.findByChildSession(session.id)
      if (activation && activation.status === 'running') {
        orchestrator.updateActivity(activation.memberId, event.data.name)
      }
      return
    }
    if (event.type !== 'user/message') return
    const source: Record<string, unknown> = event.data.source as Record<string, unknown>
    if (source.kind !== 'subagent-settled') return
    const senderSessionId = source.senderSessionId
    if (typeof senderSessionId !== 'string') return
    const activation = orchestrator.findByChildSession(senderSessionId)
    if (activation && activation.status === 'running') {
      orchestrator.markSettled(activation.memberId)
    }
  })
}
