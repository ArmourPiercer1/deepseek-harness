/**
 * team_control tool definition (leader-only).
 *
 * @module @deepseek-ai/dsh-tool-team
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TeamControlRegistry } from '@deepseek-ai/dsh-team-channels'

/**
 * Register the `team_control` tool.
 *
 * @param ctx - plugin context.
 * @param registry - the host-level control registry.
 * @returns disposer.
 */
export function registerControlTool(
  ctx: Context,
  registry: TeamControlRegistry,
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
        enum: ['allow_once', 'deny', 'escalate_to_user', 'approve_plan', 'request_revision'] as const,
        description: 'The decision for the request: "allow_once", "deny", "escalate_to_user", "approve_plan", or "request_revision".',
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
    // oxlint-disable-next-line typescript/require-await -- the tool seam requires a Promise return, but list/decide are synchronous
    async execute(args, exec) {
      const me = exec.agent
      if (!me) {
        return { message: 'Error: team_control requires a calling agent.' }
      }

      if (args.action === 'list') {
        const pending = registry.list(me.id)
        return {
          requests: pending.map(p => ({
            requestId: p.requestId,
            memberId: p.memberId as string,
            toolName: p.toolName,
            reason: p.reason,
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

      const decision = args.decision
      try {
        registry.decide(me.id, args.request_id, decision)
        me.session.append('team/control-decision', {
          requestId: args.request_id,
          decision,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
        })
        return { message: `Request "${args.request_id}" decided: ${args.decision}.` }
      } catch (e: unknown) {
        return { message: `Error: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }))
}
