/**
 * No runtime invariant: abstract Service Definition.
 *
 * @module @deepseek-ai/dsh-permission
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-permission'

/**
 * @see InvariantInstaller
 * No runtime invariant: abstract Service Definition.
 */
const install: InvariantInstaller = () => {}

/** Cordis companion plugin name. */
export const name = 'permission-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Register this package's invariant companion.
 * @param ctx - the Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
