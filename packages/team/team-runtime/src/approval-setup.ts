/**
 * Teammate-side permission enforcement hook.
 *
 * Installs a scoped `tools/pre-execute` listener on a teammate's child context:
 * every tool call is evaluated by the `permission` service against the
 * member's recovered rule layers under the member's permission mode (default
 * `enforce`). An `allow` decision proceeds to the executor, a `deny` decision
 * blocks the call there with the engine's model-visible reason, and an `ask`
 * decision suspends the call and wakes the leader through the existing
 * control-request rendezvous. Every evaluation appends a
 * `permission/decision` audit event to the child session at its commit point,
 * and a leader-unreachable `ask` settles into an audited
 * `leader_unreachable` deny that states plainly it is not a final verdict.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { TeamControlRequestData, TeamMemberBoundData } from '@deepseek-ai/dsh-team'
// Pull in the `teamControl` / `subagents` / `permission` Context declarations for typed access.
import type {} from '@deepseek-ai/dsh-team-channels'
import type {} from '@deepseek-ai/dsh-subagent'
import type {
  CompiledPolicy,
  PermissionContext,
  PermissionDecision,
  PermissionMode,
  ToolCallView,
} from '@deepseek-ai/dsh-permission'
import { appendPermissionDecision, toPermissionDecisionData } from '@deepseek-ai/dsh-permission-engine'
import { assertNever } from '@deepseek-ai/dsh-llm'
import { getRecoveredRuleLayers } from './rule-layers.ts'

/**
 * The severity prefix the engine provider stamps on its compile diagnostics
 * (`"${severity}: ${message}"`); an `error:` diagnostic names a rule the
 * engine dropped, everything else is a benign warning.
 */
const ERROR_DIAGNOSTIC = 'error: '

/**
 * Suspend an `ask` decision at the leader rendezvous: log the control request,
 * create the pending entry, wake the leader, and race the leader's decision
 * against the execution abort. When the leader cannot be reached at all,
 * settle the `ask` as an audited `leader_unreachable` deny.
 *
 * @param ctx - the host context carrying `teamControl` and `subagents`.
 * @param child - the teammate child agent.
 * @param bound - the member-bound policy snapshot.
 * @param exec - the suspended tool execution.
 * @param view - the tool call view the engine evaluated.
 * @param context - the permission context the decision resolved under.
 * @param decision - the `ask` decision.
 * @param next - the executor continuation, resumed when the leader approves.
 * @returns the pre-execute decision the suspended call settles with.
 */
async function requestLeaderDecision(
  ctx: Context,
  child: Agent,
  bound: TeamMemberBoundData,
  exec: ToolExecution,
  view: ToolCallView,
  context: PermissionContext,
  decision: Extract<PermissionDecision, { readonly kind: 'ask' }>,
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  const registry = ctx.get('teamControl')
  const subagents = ctx.get('subagents')
  const leaderSessionId = child.session.header.parentSession
  const unavailable = (): PreToolDecision => {
    child.session.append('permission/decision', {
      ...toPermissionDecisionData(view, context, decision),
      decision: 'deny',
      cause: 'leader_unreachable',
    })
    return {
      kind: 'deny',
      reason: 'no leader is available to decide this approval request; this is not a final verdict — advance other work and retry the operation later',
    }
  }
  if (registry === undefined || subagents === undefined || leaderSessionId === undefined) {
    return unavailable()
  }

  const requestId = randomUUID()
  const requestData: TeamControlRequestData = {
    requestId,
    memberId: bound.memberId,
    toolName: exec.name,
    reason: decision.reason ?? `Teammate "${bound.memberId as string}" requests to run "${exec.name}"`,
    ...(typeof exec.arguments === 'object' && exec.arguments !== null
      ? { arguments: exec.arguments as Record<string, unknown> }
      : {}),
  }

  child.session.append('team/control-request', requestData)

  const decisionPromise = registry.create(leaderSessionId, requestData)

  // Wake the leader so it can review the request. On delivery failure, settle
  // this request with a deny and audit the leader-unreachable outcome.
  try {
    await subagents.reportFrom(
      child,
      [{
        type: 'text',
        text: `Teammate "${bound.memberId as string}" requests approval to run "${exec.name}" (request ${requestId}). Review with team_control.`,
      }],
      { delivery: 'next-step', signal: exec.signal },
    )
  } catch {
    registry.decide(leaderSessionId, requestId, 'deny')
    child.session.append('permission/decision', {
      ...toPermissionDecisionData(view, context, decision),
      decision: 'deny',
      cause: 'leader_unreachable',
    })
    return {
      kind: 'deny',
      reason: 'the leader could not be reached to decide this approval request; this is not a final verdict — advance other work and retry the operation later',
    }
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
    decisionPromise.then(value => ({ kind: 'decided' as const, value })),
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
}

/**
 * Install the scoped permission enforcement hook on a teammate's child
 * context. The hook is installed for every bound child: `permission` is a
 * hard injection of this plugin, so a live hook always has a live service.
 *
 * The member's policy compiles once, lazily, on the first evaluated call: the
 * recovered rule-layer load is awaited (a rejection settles into a fail-closed
 * deny and is logged where it surfaced), the rules compile with their parse
 * diagnostics sent to the logger, and the compiled policy is retained for the
 * child's lifetime.
 *
 * @param childCtx - the teammate's scoped child context.
 * @param ctx - the host context carrying the injected `permission` service and
 *   the optional `teamControl` / `subagents` rendezvous services.
 * @param bound - the member-bound policy snapshot.
 * @returns disposer removing the pre-execute listener.
 */
export function installApprovalHook(
  childCtx: Context,
  ctx: Context,
  bound: TeamMemberBoundData,
): () => void {
  const child = childCtx.agent as Agent
  const session = child.session
  const mode: PermissionMode = bound.permissionMode ?? 'enforce'
  let compiled: CompiledPolicy | undefined

  return childCtx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    const permission = ctx.permission
    const load = getRecoveredRuleLayers(session.id)
    if (load === undefined) {
      return { kind: 'deny', reason: 'no permission policy is installed for this teammate' }
    }
    let layers
    try {
      layers = await load
    } catch (error: unknown) {
      // A lapsed managed file or a malformed layer file: the policy cannot be
      // read, so the call fails closed. The setup-time swallow owns the
      // rejection's lifetime; log it where the call surfaced it. No audit:
      // no evaluation ran.
      ctx.logger.error(
        `team permission policy load failed for member "${bound.memberId as string}": ${error instanceof Error ? error.message : String(error)}`,
      )
      return { kind: 'deny', reason: 'the permission policy could not be read; the operation was not run and can be retried once the policy is fixed' }
    }
    if (compiled === undefined) {
      const { policy, diagnostics } = permission.compile(layers.rules)
      for (const diagnostic of diagnostics) {
        if (diagnostic.startsWith(ERROR_DIAGNOSTIC)) ctx.logger.error(diagnostic)
        else ctx.logger.warn(diagnostic)
      }
      compiled = policy
    }
    const context: PermissionContext = {
      policy: compiled,
      mode,
      pathBases: {
        // `/`-anchored teammate rules resolve against the workspace, the
        // scope's own settings context; `//` and `~` reach outside it.
        settingsDir: session.header.cwd ?? '',
        homeDir: process.env['DSH_HOME'] ?? '',
        cwd: session.header.cwd ?? '',
      },
      memberId: bound.memberId,
    }
    const view: ToolCallView = { name: exec.name, arguments: exec.arguments as JsonValue }
    const decision = permission.evaluate(view, context)
    appendPermissionDecision(session, toPermissionDecisionData(view, context, decision))

    if (decision.kind === 'allow') return next()
    if (decision.kind === 'deny') return { kind: 'deny', reason: decision.reason }
    return requestLeaderDecision(ctx, child, bound, exec, view, context, decision, next)
  })
}
