/**
 * Team member composition for continuable subagents.
 *
 * Installs per-member MCP guard on child agent contexts during initial
 * creation and cold resume, driven by the durable `team/member-bound` event.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import type { ContinuableSetupContribution } from '@deepseek-ai/dsh-subagent'
import { createMcpGuard } from './mcp-guard.ts'
import { installApprovalHook } from './approval-setup.ts'

/**
 * Install the team member composition on a child context based on a
 * {@link TeamMemberBoundData} policy snapshot.
 *
 * @param childCtx - the child's scoped context.
 * @param bound - the member-bound policy snapshot.
 * @returns disposer that removes all installed composition.
 */
export function installMemberComposition(
  childCtx: Context,
  bound: TeamMemberBoundData,
): () => void {
  const disposers: (() => void)[] = []

  // Install MCP guard if the member has an MCP policy
  if (bound.mcpServers && bound.mcpServers.servers.length > 0) {
    disposers.push(childCtx.tools.guard(createMcpGuard(bound.mcpServers)))
  }

  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** Read the durable member binding from a child session's events, if present. */
function findMemberBound(events: readonly SessionEvent[]): TeamMemberBoundData | undefined {
  for (const event of events) {
    if (event.type === 'team/member-bound') return event.data
  }
  return undefined
}

/**
 * A {@link ContinuableSetupContribution} that reads `team/member-bound` from a
 * continuable child's session and installs that member's composition (MCP guard
 * plus any approval hook) on both fresh creation and cold resume. Returns a
 * no-op disposer for a non-team child.
 *
 * @param ctx - the host context carrying `teamControl` and `subagents`.
 */
export function teamMemberSetupContribution(ctx: Context): ContinuableSetupContribution {
  return (childCtx) => {
    const bound = findMemberBound((childCtx.agent as Agent).session.events)
    if (bound === undefined) return () => {}
    const disposeComposition = installMemberComposition(childCtx, bound)
    const disposeApproval = installApprovalHook(childCtx, ctx, bound)
    return () => {
      disposeApproval()
      disposeComposition()
    }
  }
}
