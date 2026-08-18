/**
 * Team member composition for continuable subagents.
 *
 * Installs per-member skill and MCP guards on child agent contexts during
 * initial creation and cold resume, driven by the durable `team/member-bound`
 * event.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TeamControlRequestData, TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import type { ContinuableSetupContribution } from '@deepseek-ai/dsh-subagent'
// Pull in the `teamControl` Context declaration for typed `ctx.get`.
import type {} from '@deepseek-ai/dsh-team-channels'
import { createMcpGuard } from './mcp-guard.ts'
import { createSkillGuard } from './skill-guard.ts'
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

  // Install skill guard if the member has a skills policy (empty denies all)
  if (bound.skills !== undefined) {
    disposers.push(childCtx.tools.guard(createSkillGuard(bound.skills)))
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

/** Read the persisted control requests logged by a child session, in order. */
function findControlRequests(events: readonly SessionEvent[]): TeamControlRequestData[] {
  const requests: TeamControlRequestData[] = []
  for (const event of events) {
    if (event.type === 'team/control-request') requests.push(event.data)
  }
  return requests
}

/**
 * A {@link ContinuableSetupContribution} that reads `team/member-bound` from a
 * continuable child's session and installs that member's composition (skill
 * guard, MCP guard, and any approval hook) on both fresh creation and cold
 * resume. Returns a no-op disposer for a non-team child.
 *
 * On cold resume, every `team/control-request` the child logged is reconciled
 * against the host registry under the leader session: a still-pending entry
 * belongs to a suspended execution that no longer exists, so it is settled
 * with a deny. Fresh creation carries no control-request events (the fork
 * seed replays the leader's log, which logs decisions, not requests), so the
 * reconciliation is a no-op there.
 *
 * @param ctx - the host context carrying `teamControl` and `subagents`.
 * @returns the setup contribution for a continuable child.
 */
export function teamMemberSetupContribution(ctx: Context): ContinuableSetupContribution {
  return (childCtx) => {
    const agent = childCtx.agent as Agent
    const bound = findMemberBound(agent.session.events)
    if (bound === undefined) return () => {}
    const leaderSessionId = agent.session.header.parentSession
    const registry = ctx.get('teamControl')
    if (leaderSessionId !== undefined && registry !== undefined) {
      const requests = findControlRequests(agent.session.events)
      if (requests.length > 0) registry.reconcilePending(leaderSessionId, requests)
    }
    const disposeComposition = installMemberComposition(childCtx, bound)
    const disposeApproval = installApprovalHook(childCtx, ctx, bound)
    return () => {
      disposeApproval()
      disposeComposition()
    }
  }
}
