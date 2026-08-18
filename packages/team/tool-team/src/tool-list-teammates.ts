/**
 * list_teammates tool definition.
 *
 * @module @deepseek-ai/dsh-tool-team
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TeamOrchestrator } from '@deepseek-ai/dsh-team-runtime'

/**
 * Register the `list_teammates` tool.
 *
 * @param ctx - plugin context.
 * @param orchestrator - the session-scoped orchestrator.
 * @returns disposer.
 */
export function registerListTeammatesTool(
  ctx: Context,
  orchestrator: TeamOrchestrator,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'list_teammates',
    description: 'List all team members — the leader and every teammate — with their roles, capabilities, and current status.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          teammates: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                role: { type: 'string', required: true },
                description: { type: 'string', required: true },
                model: { type: 'string' },
                status: { type: 'string', required: true },
                last_activity: { type: 'string', description: 'ISO timestamp of the last known activity.' },
                last_action: { type: 'string', description: 'Description of the last action performed.' },
              },
            },
          },
        },
      },
      render(_args, value) {
        const lines = value.teammates.map(
          (t: {
            id: string
            name: string
            role: string
            status: string
            last_activity?: string
            last_action?: string
          }) => {
            let line = `- ${t.name} (${t.id}) [${t.role}] — ${t.status}`
            if (t.last_action) line += ` (last: ${t.last_action})`
            if (t.last_activity) line += ` at ${t.last_activity}`
            return line
          },
        )
        return [{ type: 'text', text: lines.join('\n') || 'No teammates configured.' }]
      },
    },
    // oxlint-disable-next-line typescript/require-await -- the tool seam requires a Promise return, but listing is synchronous
    async execute(_args, _exec) {
      const team = ctx.get('team')
      if (!team) {
        return { teammates: [] }
      }

      const members = team.list()
      const teammates = members
        .map((m) => {
          const activation = orchestrator.get(m.id)
          return {
            id: m.id,
            name: m.name,
            role: m.role,
            description: m.description,
            ...(m.model !== undefined ? { model: m.model } : {}),
            status: activation?.status ?? 'idle',
            ...(activation?.lastActivityAt !== undefined
              ? { last_activity: new Date(activation.lastActivityAt).toISOString() } : {}),
            ...(activation?.lastAction !== undefined
              ? { last_action: activation.lastAction } : {}),
          }
        })

      return { teammates }
    },
  }))
}
