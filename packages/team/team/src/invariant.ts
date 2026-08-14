/**
 * No runtime invariant: abstract Service Definition.
 *
 * @module @deepseek-ai/dsh-team
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team'

/** @see InvariantInstaller */
// No runtime invariant: abstract Service Definition.
const install: InvariantInstaller = () => {}

export const name = 'team-invariant'
export const inject = ['invariants'] as const

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
