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
import type { TeamMemberBoundData, TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { TeamOrchestrator } from '@deepseek-ai/dsh-team-runtime'

/** Read the durable member binding from an agent's own session, if present. */
function memberBindingOf(agent: Agent): TeamMemberBoundData | undefined {
  for (const event of agent.session.events) {
    if (event.type === 'team/member-bound') return event.data
  }
  return undefined
}

/** One completed `send_team_message` delivery: a direct send, a leader relay, or an error. */
type TeamMessageDelivery =
  | { readonly status: 'sent'; readonly message: string }
  | { readonly status: 'relayed'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

/**
 * Deliver one team message from the calling member to the target.
 *
 * Picks the transport from the roles: the leader follows up on the target
 * teammate's session, a teammate reports to its direct parent, and a teammate
 * addressing a peer reports to the leader with a wakeup so the leader forwards
 * the message. This is the single point where a team message meets its
 * transport, so a future structured cross-member queue replaces only this
 * function.
 *
 * @param subagents - subagent runtime providing the followup and reportFrom transports.
 * @param orchestrator - the session-scoped orchestrator resolving teammate sessions.
 * @param me - the calling agent.
 * @param senderIsTeammate - whether the caller is bound to a teammate.
 * @param target - the resolved target member definition.
 * @param message - the message content to deliver.
 * @param signal - caller cancellation forwarded to the transport.
 * @returns the delivery outcome; an error outcome when the target has no session.
 * @throws when the transport rejects the delivery.
 */
async function deliverTeamMessage(
  subagents: SubagentRuntime,
  orchestrator: TeamOrchestrator,
  me: Agent,
  senderIsTeammate: boolean,
  target: TeamMemberDefinition,
  message: string,
  signal: AbortSignal,
): Promise<TeamMessageDelivery> {
  if (senderIsTeammate && target.role === 'teammate') {
    // Teammate → peer: a teammate cannot address peers directly, so the
    // report wakes the leader, which forwards the message.
    await subagents.reportFrom(
      me,
      [{ type: 'text', text: `[Message to ${target.name}]: ${message}` }],
      { delivery: 'wakeup', signal },
    )
    return { status: 'relayed', message: `Message to ${target.name} relayed to leader for forwarding.` }
  }
  if (senderIsTeammate) {
    // Teammate → leader: report into the direct parent's next turn.
    await subagents.reportFrom(me, [{ type: 'text', text: message }], { delivery: 'wakeup', signal })
    return { status: 'sent', message: `Message delivered to ${target.name}.` }
  }
  // Leader → teammate: deliver the next turn to the teammate's session.
  // followup cold-resumes settled and disposed children from their
  // persisted sessions, so only a never-delegated teammate is unreachable.
  const activation = orchestrator.get(target.id)
  if (!activation) {
    return { status: 'error', message: `No active session for "${target.id}". Delegate first.` }
  }
  await subagents.followup(me, SessionId(activation.childSessionId), [{ type: 'text', text: message }], {
    source: { kind: 'coordinator' as const, form: 'relay' as const, senderSessionId: me.id },
    signal,
  })
  if (activation.status !== 'running') {
    orchestrator.recordActivation(target.id, activation.childSessionId)
  }
  return { status: 'sent', message: `Message delivered to ${target.name}.` }
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

      const binding = memberBindingOf(me)
      const senderIsTeammate = binding?.role === 'teammate'

      let delivery: TeamMessageDelivery
      try {
        delivery = await deliverTeamMessage(subagents, orchestrator, me, senderIsTeammate, target, args.message, exec.signal)
      } catch (e: unknown) {
        delivery = { status: 'error', message: `Delivery failed: ${e instanceof Error ? e.message : String(e)}` }
      }
      if (delivery.status === 'error') return delivery

      const fromId = binding?.memberId ?? team.getLeader()?.id ?? TeamMemberId('leader')
      me.session.append('team/message', { from: fromId, to: targetId, message: args.message })

      return delivery
    },
  }))
}
