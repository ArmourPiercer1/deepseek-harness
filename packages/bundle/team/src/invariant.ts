/**
 * No runtime invariant: pure composition manifest.
 *
 * @module @deepseek-ai/dsh-bundle-team
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-bundle-team'

/** @see InvariantInstaller */
// No runtime invariant: pure composition manifest.
const install: InvariantInstaller = () => {}

export const name = 'bundle-team-invariant'
export const inject = ['invariants'] as const

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
