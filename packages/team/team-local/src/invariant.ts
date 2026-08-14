/**
 * No runtime invariant: validation happens at discovery time.
 *
 * @module @deepseek-ai/dsh-team-local
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-local'

/** @see InvariantInstaller */
// No runtime invariant: validation happens at discovery time.
const install: InvariantInstaller = () => {}

export const name = 'team-local-invariant'
export const inject = ['invariants'] as const

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
