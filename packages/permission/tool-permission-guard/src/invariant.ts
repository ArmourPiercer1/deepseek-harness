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

/** @see InvariantInstaller */
// No runtime invariant: denial-to-audit relation is proven by the composition test.
const install: InvariantInstaller = () => {}

export const name = 'tool-permission-guard-invariant'
export const inject = ['invariants'] as const

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
