/**
 * Per-member skill catalog filter.
 *
 * Installs a system prompt section on the child agent context that
 * restricts which skills appear in the agent's available skill list.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { TeamSkillPolicy } from '@deepseek-ai/dsh-team'

/**
 * Install a scoped skill catalog filter on a child agent context.
 * Skills not in the allow list are excluded from the catalog prompt section.
 *
 * @param childCtx - the child's scoped context.
 * @param policy - the member's skill policy.
 * @returns disposer revoking the filter.
 */
export function installSkillFilter(
  _childCtx: Context,
  _policy: TeamSkillPolicy,
): () => void {
  // TODO: Integrate with ctx.skills once the skill catalog filtering API
  // is available. For now, skill filtering is deferred — all skills remain
  // visible to the member. The policy is recorded in team/member-bound for
  // future enforcement.
  return () => { /* no-op disposer */ }
}
