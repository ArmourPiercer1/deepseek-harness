/**
 * No runtime invariant: per-member composition (MCP guard + approval hook) is
 * installed per continuable child by the setup contribution; its behavior is
 * pinned by member-setup/approval-setup unit tests rather than a log relation.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-runtime'

/** @see InvariantInstaller */
// No runtime invariant: per-child composition has no cross-event log relation to assert.
const install: InvariantInstaller = () => {}

export const name = 'team-runtime-invariant'
export const inject = ['invariants'] as const

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
