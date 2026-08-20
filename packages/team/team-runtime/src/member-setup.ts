/**
 * Team member composition for continuable subagents.
 *
 * Installs per-member skill and MCP guards on child agent contexts during
 * initial creation and cold resume, driven by the durable `team/member-bound`
 * event, and starts the rule-layer recovery load whose result the
 * enforcement point consumes.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TeamControlRequestData, TeamMemberBoundData } from '@deepseek-ai/dsh-team'
import type { ContinuableSetupContribution } from '@deepseek-ai/dsh-subagent'
// Pull in the `teamControl` / `permission` Context declarations.
import type {} from '@deepseek-ai/dsh-team-channels'
import type {} from '@deepseek-ai/dsh-permission'
import { createMcpGuard } from './mcp-guard.ts'
import { createSkillGuard } from './skill-guard.ts'
import { installApprovalHook } from './approval-setup.ts'
import {
  releaseRecoveredRuleLayers,
  resolveRuleLayerPaths,
  setRecoveredRuleLayers,
} from './rule-layers.ts'

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
 * Start the rule-layer recovery load for one team child session and record it
 * for the enforcement point. The teammate inline rules come from the durable
 * member binding (the snapshot taken at bind time); the managed and project
 * file layers are always re-read from disk, so an in-flight recovered session
 * is constrained by the organization's current policy. A lapsed managed file
 * rejects the load rather than being skipped. `permission` is a hard
 * injection of this plugin, so a live member setup always has the service.
 *
 * @param ctx - the host context carrying the injected `permission` service.
 * @param child - the team child agent.
 * @param bound - the member-bound policy snapshot.
 * @returns disposer releasing the session's rule state.
 */
function installRecoveredRules(ctx: Context, child: Agent, bound: TeamMemberBoundData): () => void {
  const session = child.session
  const options = {
    ...resolveRuleLayerPaths(undefined, session.header.cwd),
    ...(bound.rules !== undefined ? { teammateRules: bound.rules } : {}),
    ...(bound.managedPresent !== undefined ? { managedPresent: bound.managedPresent } : {}),
  }
  const load = ctx.permission.loadRuleLayers(options)
  // The load may reject before the enforcement point awaits it (a lapsed
  // managed file, a malformed layer file); this attachment consumes that
  // rejection until the stored promise is read, so it never surfaces as an
  // unhandled rejection.
  load.catch(() => undefined)
  setRecoveredRuleLayers(session.id, load)
  return () => {
    releaseRecoveredRuleLayers(session.id)
  }
}

/**
 * A {@link ContinuableSetupContribution} that reads `team/member-bound` from a
 * continuable child's session and installs that member's composition (skill
 * guard, MCP guard, and any approval hook) on both fresh creation and cold
 * resume, and starts the rule-layer recovery load. Returns a no-op disposer
 * for a non-team child.
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
    const disposeRules = installRecoveredRules(ctx, agent, bound)
    return () => {
      disposeRules()
      disposeApproval()
      disposeComposition()
    }
  }
}
