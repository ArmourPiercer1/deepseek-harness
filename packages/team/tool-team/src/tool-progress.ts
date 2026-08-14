/**
 * team_progress tool definition.
 *
 * @module @deepseek-ai/dsh-tool-team
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamProgressStatus } from '@deepseek-ai/dsh-team'
import { TeamProgressStore } from '@deepseek-ai/dsh-team-channels'

/**
 * Register the `team_progress` tool.
 *
 * @param ctx - plugin context.
 * @param store - the progress store.
 * @returns disposer.
 */
export function registerProgressTool(
  ctx: Context,
  store: TeamProgressStore,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'team_progress',
    description: 'Read or update the team task progress board.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['list', 'update'] as const,
        description: 'List all tasks or update one.',
      },
      task_id: {
        type: 'string',
        description: 'Required for update.',
      },
      subject: {
        type: 'string',
        description: 'Short task subject.',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'blocked'] as const,
        description: 'Task status.',
      },
      summary: {
        type: 'string',
        description: 'Optional summary or blocker description.',
      },
      teammate_id: {
        type: 'string',
        description: 'Assigned teammate id.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                taskId: { type: 'string', required: true },
                subject: { type: 'string', required: true },
                status: { type: 'string', required: true },
                summary: { type: 'string' },
                memberId: { type: 'string', required: true },
              },
            },
          },
          message: { type: 'string' },
        },
      },
      render(_args, value) {
        if (value.tasks && value.tasks.length > 0) {
          const lines = value.tasks.map(
            (t: { taskId: string; subject: string; status: string; memberId: string }) =>
              `[${t.status}] ${t.taskId}: ${t.subject} (${t.memberId})`,
          )
          return [{ type: 'text', text: lines.join('\n') }]
        }
        return [{ type: 'text', text: value.message ?? 'No tasks.' }]
      },
    },
    async execute(args, _exec) {
      if (args.action === 'list') {
        return { tasks: [...store.list()] }
      }

      // Update
      if (!args.task_id) {
        return { message: 'Error: task_id is required for update.' }
      }
      if (!args.subject && !store.get(args.task_id)) {
        return { message: 'Error: subject is required for new tasks.' }
      }

      const existing = store.get(args.task_id)
      const summary = args.summary ?? existing?.summary
      store.update({
        taskId: args.task_id,
        subject: args.subject ?? existing?.subject ?? args.task_id,
        status: (args.status as TeamProgressStatus) ?? existing?.status ?? 'pending',
        ...(summary !== undefined ? { summary } : {}),
        memberId: TeamMemberId(args.teammate_id ?? (existing?.memberId as string) ?? 'leader'),
      })

      return { message: `Task "${args.task_id}" updated.` }
    },
  }))
}
