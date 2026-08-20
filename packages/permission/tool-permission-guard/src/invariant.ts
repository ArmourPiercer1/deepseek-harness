/**
 * No runtime invariant: the guard's deny relation is asserted by the consumer
 * composition test, which proves a denied call appends a paired
 * `permission/decision` event on the session stream.
 *
 * @module @deepseek-ai/dsh-tool-permission-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-permission-guard'

/**
 * @see InvariantInstaller
 * No runtime invariant: denial-to-audit relation is proven by the composition test.
 */
const install: InvariantInstaller = () => {}

/** Cordis companion plugin name. */
export const name = 'tool-permission-guard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Register this package's invariant companion.
 * @param ctx - the Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
