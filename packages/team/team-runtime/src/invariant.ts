/**
 * No runtime invariant: DEFAULT_LEADER_TOOLS validation is deferred to first delegation.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-runtime'

/** @see InvariantInstaller */
// No runtime invariant: DEFAULT_LEADER_TOOLS validation is deferred to first delegation.
const install: InvariantInstaller = () => {}

export const name = 'team-runtime-invariant'
export const inject = ['invariants'] as const

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
