/**
 * team_control tool definition (leader-only).
 *
 * @module @deepseek-ai/dsh-tool-team
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TeamControlDecision } from '@deepseek-ai/dsh-team'
import { TeamControlCoordinator } from '@deepseek-ai/dsh-team-channels'

/**
 * Register the `team_control` tool.
 *
 * @param ctx - plugin context.
 * @param coordinator - the control coordinator.
 * @returns disposer.
 */
export function registerControlTool(
  ctx: Context,
  coordinator: TeamControlCoordinator,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'team_control',
    description: 'Review and decide on pending teammate permission requests. Only the leader may use this tool.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['list', 'decide'] as const,
        description: 'List pending requests or decide one.',
      },
      request_id: {
        type: 'string',
        description: 'Required for decide.',
      },
      decision: {
        type: 'string',
        enum: ['allow_once', 'deny', 'escalate_to_user'] as const,
        description: 'The decision for the request.',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for the decision.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requests: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                requestId: { type: 'string', required: true },
                memberId: { type: 'string', required: true },
                toolName: { type: 'string', required: true },
                reason: { type: 'string', required: true },
              },
            },
          },
          message: { type: 'string' },
        },
      },
      render(_args, value) {
        if (value.requests && value.requests.length > 0) {
          const lines = value.requests.map(
            (r: { requestId: string; memberId: string; toolName: string; reason: string }) =>
              `[${r.requestId}] ${r.memberId} wants to use "${r.toolName}": ${r.reason}`,
          )
          return [{ type: 'text', text: lines.join('\n') }]
        }
        return [{ type: 'text', text: value.message ?? 'No pending requests.' }]
      },
    },
    async execute(args, _exec) {
      if (args.action === 'list') {
        const pending = coordinator.listPending()
        return {
          requests: pending.map(p => ({
            requestId: p.data.requestId,
            memberId: p.data.memberId as string,
            toolName: p.data.toolName,
            reason: p.data.reason,
          })),
        }
      }

      // Decide
      if (!args.request_id) {
        return { message: 'Error: request_id is required for decide.' }
      }
      if (!args.decision) {
        return { message: 'Error: decision is required for decide.' }
      }

      try {
        coordinator.decide(args.request_id, args.decision as TeamControlDecision)
        return { message: `Request "${args.request_id}" decided: ${args.decision}.` }
      } catch (e: unknown) {
        return { message: `Error: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }))
}
