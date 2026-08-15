/**
 * send_team_message tool definition.
 *
 * @module @deepseek-ai/dsh-tool-team
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import type { TeamOrchestrator } from '@deepseek-ai/dsh-team-runtime'

/** Read the durable member binding from an agent's own session, if present. */
function memberBindingOf(agent: Agent): TeamMemberBoundData | undefined {
  for (const event of agent.session.events) {
    if (event.type === 'team/member-bound') return event.data
  }
  return undefined
}

/**
 * Register the `send_team_message` tool.
 *
 * @param ctx - plugin context.
 * @param orchestrator - the session-scoped orchestrator resolving teammate sessions.
 * @returns disposer.
 */
export function registerSendMessageTool(
  ctx: Context,
  orchestrator: TeamOrchestrator,
): () => void {
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
    async execute(args, exec) {
      const team = ctx.get('team')
      if (!team) {
        return { status: 'error', message: 'Team plugin not loaded' }
      }
      const subagents = ctx.get('subagents')
      if (!subagents) {
        return { status: 'error', message: 'Subagent capability not available' }
      }
      const me = exec.agent
      if (!me) {
        return { status: 'error', message: 'send_team_message requires a calling agent' }
      }

      const targetId = TeamMemberId(args.target_id)
      const target = team.get(targetId)
      if (!target) {
        return { status: 'error', message: `Unknown team member: "${args.target_id}"` }
      }

      const content = [{ type: 'text' as const, text: args.message }]
      const binding = memberBindingOf(me)
      const amTeammate = binding?.role === 'teammate'

      try {
        if (amTeammate) {
          // Teammate → leader: report into the direct parent's next turn.
          await subagents.reportFrom(me, content, { delivery: 'wakeup', signal: exec.signal })
        } else {
          // Leader → teammate: deliver the next turn to the teammate's active session.
          const activation = orchestrator.get(targetId)
          if (!activation || activation.status === 'disposed') {
            return {
              status: 'error',
              message: `No active session for "${args.target_id}". Delegate first.`,
            }
          }
          await subagents.followup(me, SessionId(activation.childSessionId), content, {
            source: { kind: 'coordinator' as const, form: 'relay' as const, senderSessionId: me.id },
            signal: exec.signal,
          })
        }
      } catch (e: unknown) {
        return {
          status: 'error',
          message: `Delivery failed: ${e instanceof Error ? e.message : String(e)}`,
        }
      }

      const fromId = binding?.memberId ?? team.getLeader()?.id ?? TeamMemberId('leader')
      me.session.append('team/message', { from: fromId, to: targetId, message: args.message })

      return { status: 'sent', message: `Message delivered to ${target.name}.` }
    },
  }))
}
