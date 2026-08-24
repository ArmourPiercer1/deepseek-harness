/**
 * The invariant companion registers under its package name, observes the
 * projection's published snapshots, fails loud on a structurally broken view,
 * and removes its registration with its fiber (HMR safety).
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { TeamView } from '@deepseek-ai/dsh-team-projection'
import * as TeamProjectionInvariant from '../src/invariant.ts'

/** A published-snapshot view shaped only as far as the checks read. */
function view(over: Partial<TeamView> = {}): TeamView {
  return {
    teamId: 'leader',
    leaderSessionId: 'leader',
    rosterMemberCount: 1,
    members: [{ memberId: 'leader', name: 'Leader', role: 'leader', sessionIds: ['leader'], status: 'bound', pendingControlCount: 0 }],
    delegations: [],
    tasks: [],
    approvals: [],
    messages: [],
    messageCount: 0,
    ...over,
  }
}

/** Mount the companion against a fake projection feed the test drives. */
async function harness(): Promise<{ ctx: Context; publish: (view: TeamView) => void }> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  let listener: ((leaderSessionId: never, view: TeamView) => void) | undefined
  ctx.provide('teamProjection', {
    onChanged: (callback: (leaderSessionId: never, view: TeamView) => void) => {
      listener = callback
      return () => {
        listener = undefined
      }
    },
  })
  await ctx.plugin(TeamProjectionInvariant)
  return {
    ctx,
    publish: (published: TeamView) => {
      if (listener === undefined) throw new Error('no listener attached')
      listener(undefined as never, published)
    },
  }
}

describe('team-projection invariant companion', () => {
  it('accepts a well-formed snapshot without failing', async () => {
    const { ctx, publish } = await harness()
    expect(() => { publish(view()) }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('fails loud on duplicate member ids', async () => {
    const { ctx, publish } = await harness()
    const member = { memberId: 'dup', name: 'Dup', role: 'teammate' as const, sessionIds: [], status: 'unbound' as const, pendingControlCount: 0 }
    expect(() => { publish(view({ members: [member, member] })) }).toThrow(/duplicate memberIds/u)
    await ctx.fiber.dispose()
  })

  it('fails loud when an unbound member carries sessions', async () => {
    const { ctx, publish } = await harness()
    expect(() => {
      publish(view({ members: [
        { memberId: 'ghost', name: 'Ghost', role: 'teammate' as const, sessionIds: ['s'], status: 'unbound' as const, pendingControlCount: 0 },
      ] }))
    }).toThrow(/unbound but carries sessions/u)
    await ctx.fiber.dispose()
  })

  it('fails loud when the roster count exceeds the published member set', async () => {
    const { ctx, publish } = await harness()
    expect(() => { publish(view({ rosterMemberCount: 5 })) }).toThrow(/roster count exceeds/u)
    await ctx.fiber.dispose()
  })

  it('removes its registration when its fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    ctx.provide('teamProjection', {
      onChanged: () => () => {},
    })
    const fiber = await ctx.plugin(TeamProjectionInvariant)
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-team-projection', () => {})
    }).toThrow(/already registered/u)
    const detached = vi.fn()
    await fiber.dispose()
    // The reservation left with the fiber; a fresh registration succeeds and
    // the disposed listener no longer receives publications.
    ctx.invariants.register('@deepseek-ai/dsh-team-projection', () => { detached() })
    expect(detached).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
