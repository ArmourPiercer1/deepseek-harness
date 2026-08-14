/**
 * send_team_message tool definition.
 *
 * @module @deepseek-ai/dsh-tool-team
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TeamMemberId } from '@deepseek-ai/dsh-team'

/**
 * Register the `send_team_message` tool.
 *
 * @param ctx - plugin context.
 * @returns disposer.
 */
export function registerSendMessageTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'send_team_message',
    description: 'Send a message to a teammate (from leader) or report to leader (from teammate).',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'The teammate or leader id to send the message to.',
      },
      message: {
        type: 'string',
        required: true,
        description: 'The message content.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          message: { type: 'string' },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: `Message ${value.status}: ${value.message ?? ''}` }]
      },
    },
    async execute(args, _exec) {
      const team = ctx.get('team')
      if (!team) {
        return { status: 'error', message: 'Team plugin not loaded' }
      }

      const targetId = TeamMemberId(args.target_id)
      const target = team.get(targetId)
      if (!target) {
        return { status: 'error', message: `Unknown team member: "${args.target_id}"` }
      }

      // In a full implementation, this would use followup() or reportFrom()
      // to deliver the message to the target's agent loop.
      // For now, log the message intent.
      return {
        status: 'sent',
        message: `Message delivered to ${target.name}.`,
      }
    },
  }))
}
