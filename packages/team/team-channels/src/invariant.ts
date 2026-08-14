/**
 * No runtime invariant: validation is in event declarations.
 *
 * @module @deepseek-ai/dsh-team-channels
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-channels'

/** @see InvariantInstaller */
// No runtime invariant: validation is in event declarations.
const install: InvariantInstaller = () => {}

export const name = 'team-channels-invariant'
export const inject = ['invariants'] as const

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
