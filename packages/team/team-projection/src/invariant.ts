/**
 * Package invariant companion: every published snapshot's member ids are
 * unique, its roster count never exceeds the member set, and `unbound` rows
 * carry no sessions. Checked against the authoritative change feed — the
 * structural half of the frozen equality (members = enabled roster ∪ corpus
 * bindings), which is decidable without re-reading the roster filesystem.
 * The listener installs only while a team projection service is composed.
 *
 * @module @deepseek-ai/dsh-team-projection
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type TeamProjectionService from './index.ts'
import type { TeamProjectionListener } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-projection'

/** Cordis companion plugin name. */
export const name = 'team-projection-invariant'
/** Services required before the companion can reserve package ownership. */
export const inject = ['invariants'] as const

/** Assert the structural member relations of one published snapshot. */
function checkView(
  view: { members: readonly { memberId: string; sessionIds: readonly string[]; status: string }[] },
  fail: InvariantFailure,
): void {
  const ids = new Set(view.members.map(member => member.memberId))
  if (ids.size !== view.members.length) {
    fail('team projection members contain duplicate memberIds')
  }
  for (const member of view.members) {
    if (member.status === 'unbound' && member.sessionIds.length > 0) {
      fail(`team projection member "${member.memberId}" is unbound but carries sessions`)
    }
  }
}

/** Install the snapshot-membership checks into their child registration fiber. */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  // The checks observe the projection's own publications, so the listener
  // installs only while a team projection service is composed; a composition
  // without one publishes nothing to check.
  ctx.inject(['teamProjection'], (projectionCtx: Context) => {
    projectionCtx.effect(() => {
      const projection = projectionCtx.get('teamProjection') as TeamProjectionService
      return projection.onChanged(
        (_leaderSessionId: Parameters<TeamProjectionListener>[0], view: Parameters<TeamProjectionListener>[1]) => {
          // The roster half of the equality is re-derived from the view itself:
          // a roster id is indistinguishable here from a bound-only id without
          // re-reading the filesystem, so the check pins the structural half
          // (no duplicates, unbound ⟺ no sessions) plus the roster count.
          if (view.rosterMemberCount > view.members.length) {
            fail('team projection roster count exceeds the published member set')
          }
          checkView(view, fail)
        },
      )
    }, 'team-projection invariant listener')
  })
}

/**
 * Register the team-projection invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
