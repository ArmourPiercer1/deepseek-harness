/**
 * Durable permission audit: map a {@link PermissionDecision} plus its inputs
 * into the {@link PermissionDecisionData} the session log stores, and append
 * it as the `permission/decision` event.
 *
 * `evaluate` is a pure function with no session, so appending the audit event
 * is the consumer's job: it calls {@link toPermissionDecisionData} after
 * evaluating and {@link appendPermissionDecision} at its commit point. These
 * helpers are the engine's half of the "model-visible policy is reconstructable
 * from the log" contract.
 *
 * @module @deepseek-ai/dsh-permission-engine
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type {
  PermissionContext,
  PermissionDecision,
  PermissionDecisionData,
  ToolCallView,
} from '@deepseek-ai/dsh-permission'

/**
 * Build the durable audit payload from a decision and the inputs that produced
 * it. The outcome, tool, and mode are always present; the acting member, the
 * deciding rule's raw string and layer, and the deny cause are present only
 * when they apply. Optional fields are omitted (not set to `undefined`) to
 * satisfy `exactOptionalPropertyTypes`.
 *
 * @param call - the tool call that was decided.
 * @param context - the mode and acting member the decision resolved under.
 * @param decision - the decision `evaluate` returned.
 * @returns the audit record to append to the session log.
 */
export function toPermissionDecisionData(
  call: ToolCallView,
  context: PermissionContext,
  decision: PermissionDecision,
): PermissionDecisionData {
  const matched = decision.matchedRule
  return {
    toolName: call.name,
    decision: decision.kind,
    mode: context.mode,
    ...(context.memberId !== undefined ? { memberId: context.memberId } : {}),
    ...(matched !== undefined ? { matchedRuleRaw: matched.raw, layer: matched.layer } : {}),
    ...(decision.kind === 'deny' && decision.cause !== undefined ? { cause: decision.cause } : {}),
  }
}

/**
 * Append a permission decision audit event to a session. Consumers call this
 * at their commit point, after the decision is made, so the log reconstructs
 * which call was allowed, prompted, or denied and under which rule, layer,
 * member, and mode.
 *
 * @param session - the session whose log receives the event.
 * @param data - the audit payload from {@link toPermissionDecisionData}.
 */
export function appendPermissionDecision(session: Session, data: PermissionDecisionData): void {
  session.append('permission/decision', data)
}
