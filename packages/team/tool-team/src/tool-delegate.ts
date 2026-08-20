/**
 * delegate_to_teammate tool definition.
 *
 * @module @deepseek-ai/dsh-tool-team
 */

import { access } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import { TeamOrchestrator, resolveRuleLayerPaths } from '@deepseek-ai/dsh-team-runtime'

/**
 * Whether a path exists, treating every read failure (including permission
 * errors) as absence.
 *
 * @param path - the path to probe.
 * @returns true when the path exists and is accessible.
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Absence (or an inaccessible file) reads as "no managed policy here".
    return false
  }
}

/**
 * Deliver one prompt to a durable child session as a follow-up turn under
 * coordinator relay attribution.
 *
 * @param subagents - the subagent service providing followup.
 * @param parent - the calling agent authorizing the delivery.
 * @param childSessionId - the durable child session id to wake.
 * @param prompt - the task text to deliver.
 * @param signal - caller cancellation, owning the operation until inbox acceptance.
 * @returns the accepted message's inbox id.
 * @throws when the message is not admitted.
 */
async function deliverFollowup(
  subagents: SubagentRuntime,
  parent: Agent,
  childSessionId: string,
  prompt: string,
  signal: AbortSignal,
): Promise<unknown> {
  return subagents.followup(parent, SessionId(childSessionId), [{ type: 'text' as const, text: prompt }], {
    source: { kind: 'coordinator' as const, form: 'relay' as const, senderSessionId: parent.id },
    signal,
  })
}

/**
 * Register the `delegate_to_teammate` tool.
 *
 * @param ctx - plugin context.
 * @param orchestrator - the session-scoped orchestrator.
 * @returns disposer.
 */
export function registerDelegateTool(
  ctx: Context,
  orchestrator: TeamOrchestrator,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'delegate_to_teammate',
    description: 'Delegate a task to a teammate. The teammate works in the background and reports back when done. Only the leader may use this tool.',
    parameters: {
      teammate_id: {
        type: 'string' as const,
        required: true as const,
        description: 'The teammate id from list_teammates.',
      },
      prompt: {
        type: 'string' as const,
        required: true as const,
        description: 'The complete task description for the teammate. Be specific and include all necessary context.',
      },
      action: {
        type: 'string' as const,
        description: 'Action: "run" starts a new delegation (default), "follow_up" sends additional instructions to an existing teammate session, "shutdown" stops the teammate.',
        enum: ['run', 'follow_up', 'shutdown'] as const,
      },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          status: { type: 'string' as const, required: true as const, description: 'Dispatch status.' },
          teammate_id: { type: 'string' as const, required: true as const },
          message: { type: 'string' as const },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: `[${value.status}] ${value.teammate_id}: ${value.message ?? ''}` }]
      },
    },
    async execute(args, exec) {
      const memberId = TeamMemberId(args.teammate_id)
      const action = args.action ?? 'run'
      const me = exec.agent
      if (!me) {
        return { status: 'error', teammate_id: args.teammate_id, message: 'delegate_to_teammate requires a calling agent' }
      }

      const team = ctx.get('team')
      if (!team) {
        return { status: 'error', teammate_id: args.teammate_id, message: 'Team plugin not loaded' }
      }

      const member = team.get(memberId)
      if (!member) {
        return { status: 'error', teammate_id: args.teammate_id, message: `Unknown teammate: "${args.teammate_id}"` }
      }

      if (member.role === 'leader') {
        return {
          status: 'error',
          teammate_id: args.teammate_id,
          message: 'The leader is the current agent; delegate to a teammate instead.',
        }
      }

      if (action === 'shutdown') {
        const activation = orchestrator.get(memberId)
        if (!activation || activation.status === 'disposed') {
          return {
            status: 'shutdown',
            teammate_id: args.teammate_id,
            message: `No active session for "${args.teammate_id}" to shut down.`,
          }
        }

        let interrupted = false
        if (activation.status === 'running') {
          const subagents = ctx.get('subagents')
          if (!subagents) {
            return { status: 'error', teammate_id: args.teammate_id, message: 'Subagent capability not available' }
          }
          try {
            subagents.interrupt(SessionId(activation.childSessionId), { kind: 'ancestor', agent: me })
            interrupted = true
          } catch (e: unknown) {
            return {
              status: 'error',
              teammate_id: args.teammate_id,
              message: `Interrupt failed: ${e instanceof Error ? e.message : String(e)}`,
            }
          }
        }

        orchestrator.markDisposed(memberId)
        return {
          status: 'shutdown',
          teammate_id: args.teammate_id,
          message: interrupted
            ? `Stop signal sent to "${args.teammate_id}"; the teammate may keep running briefly.`
            : `Teammate "${args.teammate_id}" shut down.`,
        }
      }

      if (action === 'follow_up') {
        const activation = orchestrator.get(memberId)
        if (!activation || activation.status === 'disposed') {
          return {
            status: 'error',
            teammate_id: args.teammate_id,
            message: `No active session for "${args.teammate_id}". Use action "run" to start a new delegation.`,
          }
        }

        const subagents = ctx.get('subagents')
        if (!subagents) {
          return { status: 'error', teammate_id: args.teammate_id, message: 'Subagent capability not available' }
        }

        try {
          await deliverFollowup(subagents, me, activation.childSessionId, args.prompt, exec.signal)

          if (activation.status === 'settled') {
            orchestrator.recordActivation(memberId, activation.childSessionId)
          }

          return {
            status: 'delivered',
            teammate_id: args.teammate_id,
            message: `Follow-up delivered to "${args.teammate_id}".`,
          }
        } catch (e: unknown) {
          return {
            status: 'error',
            teammate_id: args.teammate_id,
            message: `Follow-up failed: ${e instanceof Error ? e.message : String(e)}`,
          }
        }
      }

      // Check if already in-flight
      const running = orchestrator.get(memberId)
      if (running?.status === 'running') {
        const info = running.lastActivityAt
          ? ` Last activity: ${running.lastAction ?? 'unknown'} at ${new Date(running.lastActivityAt).toISOString()}.`
          : ''
        return {
          status: 'already_running',
          teammate_id: args.teammate_id,
          message: `Teammate "${args.teammate_id}" is currently running.${info} Use action "follow_up" to send additional instructions, or "shutdown" to stop.`,
        }
      }

      // persistent (the default) reuses a settled child session instead of
      // starting a fresh one.
      const policy = member.contextPolicy ?? 'persistent'
      if (policy === 'persistent') {
        const activation = orchestrator.get(memberId)
        if (activation && activation.status === 'settled') {
          const subagents = ctx.get('subagents')
          if (!subagents) {
            return { status: 'error', teammate_id: args.teammate_id, message: 'Subagent capability not available' }
          }

          try {
            await deliverFollowup(subagents, me, activation.childSessionId, args.prompt, exec.signal)

            orchestrator.recordActivation(memberId, activation.childSessionId)

            return {
              status: 'dispatched',
              teammate_id: args.teammate_id,
              message: `Task delegated to "${member.name}", continuing its existing session. They will report back when done.`,
            }
          } catch (e: unknown) {
            return {
              status: 'error',
              teammate_id: args.teammate_id,
              message: `Follow-up failed: ${e instanceof Error ? e.message : String(e)}`,
            }
          }
        }
      }

      // Start delegation via subagent
      const subagents = ctx.get('subagents')
      if (!subagents) {
        return { status: 'error', teammate_id: args.teammate_id, message: 'Subagent capability not available' }
      }

      try {
        const toolRestriction = team.effectiveToolPolicy(member)
        // Record whether the managed rule file was present at bind time, so a
        // cold resume can detect its later disappearance and fail closed. A
        // plain existence probe (not a load): parse problems surface where the
        // policy is actually read, not at delegation time.
        const managedPath = resolveRuleLayerPaths(undefined, me.session.header.cwd).managedPath
        const managedPresent = managedPath === undefined ? undefined : await pathExists(managedPath)
        const bound: TeamMemberBoundData = {
          memberId: member.id,
          role: member.role,
          ...(member.provider !== undefined ? { provider: member.provider } : {}),
          ...(member.model !== undefined ? { model: member.model } : {}),
          ...(member.maxTokens !== undefined ? { maxTokens: member.maxTokens } : {}),
          ...(member.tools !== undefined ? { tools: member.tools } : {}),
          ...(member.requiresApproval !== undefined ? { requiresApproval: member.requiresApproval } : {}),
          ...(member.skills !== undefined ? { skills: member.skills } : {}),
          ...(member.mcpServers !== undefined ? { mcpServers: member.mcpServers } : {}),
          ...(member.permissions !== undefined ? { rules: member.permissions } : {}),
          ...(member.permissionMode !== undefined ? { permissionMode: member.permissionMode } : {}),
          ...(managedPresent !== undefined ? { managedPresent } : {}),
          ...(member.contextPolicy !== undefined ? { contextPolicy: member.contextPolicy } : {}),
        }

        const result = await subagents.startContinuable({
          provider: 'spawn',
          label: `team:${member.name}`,
          signal: exec.signal,
          delegationEvents: [{ type: 'team/member-bound', data: bound }],
          request: {
            prompt: [{ type: 'text' as const, text: args.prompt }],
            parent: me,
            persona: member.prompt,
            toolFilter: toolRestriction,
            agentOptions: {
              ...(member.provider ? { provider: member.provider } : {}),
              ...(member.model ? { model: member.model } : {}),
              ...(member.maxTokens ? { maxTokens: member.maxTokens } : {}),
            },
          },
        })

        orchestrator.recordActivation(memberId, result.childId as string)

        return {
          status: 'dispatched',
          teammate_id: args.teammate_id,
          message: `Task delegated to "${member.name}". They will report back when done.`,
        }
      } catch (e: unknown) {
        return {
          status: 'error',
          teammate_id: args.teammate_id,
          message: `Delegation failed: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    },
    presentCall: args => ({
      card: 'generic' as const,
      title: `Delegate to ${args.teammate_id}`,
      kind: 'other' as const,
      rawInput: args.prompt,
    }),
  }))
}
