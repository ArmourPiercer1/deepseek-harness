/**
 * No runtime invariant: tool validation is at registration.
 *
 * @module @deepseek-ai/dsh-tool-team
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-team'

/** @see InvariantInstaller */
// No runtime invariant: tool validation is at registration.
const install: InvariantInstaller = () => {}

export const name = 'tool-team-invariant'
export const inject = ['invariants'] as const

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
