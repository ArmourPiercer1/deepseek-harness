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
    description: 'List all available teammates with their roles, capabilities, and current status.',
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
              },
            },
          },
        },
      },
      render(_args, value) {
        const lines = value.teammates.map(
          (t: { id: string; name: string; role: string; status: string }) =>
            `- ${t.name} (${t.id}) [${t.role}] — ${t.status}`,
        )
        return [{ type: 'text', text: lines.join('\n') || 'No teammates configured.' }]
      },
    },
    async execute(_args, _exec) {
      const team = ctx.get('team')
      if (!team) {
        return { teammates: [] }
      }

      const members = team.list()
      const teammates = members
        .filter(m => m.role === 'teammate')
        .map(m => {
          const activation = orchestrator.get(m.id)
          return {
            id: m.id as string,
            name: m.name,
            role: m.role as string,
            description: m.description,
            ...(m.model !== undefined ? { model: m.model } : {}),
            status: activation?.status ?? 'idle',
          }
        })

      return { teammates }
    },
  }))
}
