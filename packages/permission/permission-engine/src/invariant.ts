/**
 * Runtime invariant installer for the permission engine. No runtime invariant
 * is registered here: the `permission/decision` event is appended by the
 * consumer that owns the session (the S5/S6 permission consumers), so the
 * decision/event relation is asserted at that consumer's commit point rather
 * than in this provider.
 *
 * @module @deepseek-ai/dsh-permission-engine
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-permission-engine'

/**
 * @see InvariantInstaller
 * No runtime invariant yet: the `permission/decision` event is appended by the
 * consumer that owns the session (guard/team), after the pure `evaluate` and
 * `toPermissionDecisionData` here. The relation is checked where it commits.
 */
const install: InvariantInstaller = () => {}

export const name = 'permission-engine-invariant'
export const inject = ['invariants'] as const

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
