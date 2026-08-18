/**
 * Teammate-side approval hook.
 *
 * Installs a scoped `tools/pre-execute` listener on a teammate's child context
 * that suspends any `requiresApproval` tool, wakes the leader, and resumes or
 * denies based on the leader's decision.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { TeamControlRequestData, TeamMemberBoundData } from '@deepseek-ai/dsh-team'
// Pull in the `teamControl` / `subagents` Context declarations for typed `ctx.get`.
import type {} from '@deepseek-ai/dsh-team-channels'
import type {} from '@deepseek-ai/dsh-subagent'
import { assertNever } from '@deepseek-ai/dsh-llm'

/**
 * Install a scoped approval hook on a teammate's child context.
 *
 * The suspended wait can only end in a settlement: the leader's decision,
 * the registry's timeout sweep, a failed leader wakeup, or the execution
 * abort — each path returns a deny or ask decision and leaves no pending
 * request behind.
 *
 * @param childCtx - the teammate's scoped child context.
 * @param ctx - the host context carrying `teamControl` and `subagents`.
 * @param bound - the member-bound policy snapshot.
 * @returns disposer removing the pre-execute listener.
 */
export function installApprovalHook(
  childCtx: Context,
  ctx: Context,
  bound: TeamMemberBoundData,
): () => void {
  const approval = bound.requiresApproval
  if (approval === undefined || approval.length === 0) return () => {}

  const gated = new Set<string>(approval)
  const child = childCtx.agent as Agent

  return childCtx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    if (!gated.has(exec.name)) return next()

    const registry = ctx.get('teamControl')
    const subagents = ctx.get('subagents')
    if (registry === undefined || subagents === undefined) {
      return { kind: 'deny', reason: 'team approval channel unavailable' }
    }

    const leaderSessionId = child.session.header.parentSession
    if (leaderSessionId === undefined) {
      return { kind: 'deny', reason: 'no leader session to approve this tool' }
    }

    const requestId = randomUUID()
    const requestData: TeamControlRequestData = {
      requestId,
      memberId: bound.memberId,
      toolName: exec.name,
      reason: `Teammate "${bound.memberId as string}" requests to run "${exec.name}"`,
      ...(typeof exec.arguments === 'object' && exec.arguments !== null
        ? { arguments: exec.arguments as Record<string, unknown> }
        : {}),
    }

    child.session.append('team/control-request', requestData)

    const decision = registry.create(leaderSessionId, requestData)

    // Wake the leader so it can review the request. On delivery failure, settle
    // this request with a deny instead of leaving the tool suspended.
    try {
      await subagents.reportFrom(
        child,
        [{
          type: 'text',
          text: `Teammate "${bound.memberId as string}" requests approval to run "${exec.name}" (request ${requestId}). Review with team_control.`,
        }],
        { delivery: 'wakeup', signal: exec.signal },
      )
    } catch {
      registry.decide(leaderSessionId, requestId, 'deny')
      return { kind: 'deny', reason: 'could not reach the leader for approval' }
    }

    // Execution cancellation is a denial path of its own: settle the entry
    // with a deny the moment the abort lands so neither the sweep nor a later
    // cold resume has to reconcile an orphaned request. A leader decision
    // landing in the same tick already removed the entry, making the
    // reconciliation a no-op.
    let onAbort: (() => void) | undefined
    const aborted = new Promise<true>((resolve) => {
      if (exec.signal.aborted) {
        registry.reconcilePending(leaderSessionId, [requestData])
        resolve(true)
        return
      }
      onAbort = () => {
        registry.reconcilePending(leaderSessionId, [requestData])
        resolve(true)
      }
      exec.signal.addEventListener('abort', onAbort, { once: true })
    })
    const outcome = await Promise.race([
      decision.then(value => ({ kind: 'decided' as const, value })),
      aborted.then(() => ({ kind: 'aborted' as const })),
    ])
    if (onAbort !== undefined) exec.signal.removeEventListener('abort', onAbort)
    if (outcome.kind === 'aborted') {
      return { kind: 'deny', reason: 'execution cancelled before the leader decided' }
    }
    switch (outcome.value) {
      case 'allow_once':
      case 'approve_plan':
        return next()
      case 'request_revision':
        return { kind: 'deny', reason: 'leader requested revision: please revise plan' }
      case 'deny':
        return { kind: 'deny', reason: 'leader denied this tool' }
      case 'escalate_to_user':
        return { kind: 'ask', reason: 'leader escalated this request to the user' }
      /* v8 ignore next -- closed union exhaustiveness */
      default:
        return assertNever(outcome.value, 'team approval decision')
    }
  })
}
