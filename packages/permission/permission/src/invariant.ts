/**
 * No runtime invariant: abstract Service Definition.
 *
 * @module @deepseek-ai/dsh-permission
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-permission'

/** @see InvariantInstaller */
// No runtime invariant: abstract Service Definition.
const install: InvariantInstaller = () => {}

export const name = 'permission-invariant'
export const inject = ['invariants'] as const

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
