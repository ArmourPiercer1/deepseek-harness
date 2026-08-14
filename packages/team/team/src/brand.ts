/**
 * Branded id for team member definitions. Cross-boundary identity across
 * leader delegation, session events, and control requests.
 *
 * @module @deepseek-ai/dsh-team
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Nominal team member id — structurally a string, branded at compile time. */
export type TeamMemberId = Branded<'TeamMemberId'>

/** Construct a {@link TeamMemberId} from a plain string. Zero runtime cost. */
export function TeamMemberId(id: string): TeamMemberId {
  return id as TeamMemberId
}
