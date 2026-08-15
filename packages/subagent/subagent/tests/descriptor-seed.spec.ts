/**
 * Unit coverage for the continuable seed builder's delegation-events extension:
 * plugin-seeded events land after the descriptor (and any fork seed) in the
 * child's own suffix, contiguous from zero, and a non-JSON payload fails loud.
 */

import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { seedDescriptorTurn } from '../src/descriptor-seed.ts'
import { snapshotSubagentDescriptor } from '../src/descriptor.ts'
import type { DelegationEventAppend } from '../src/types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'test/delegation': { value: string }
  }
}

/** A valid continuable descriptor, detached through the seam's own snapshotter. */
function descriptor() {
  return snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: 'child' })
}

/** One element of a fork seed: a detached, log-only parent event. */
function forkSeed(): ReturnType<typeof Session.create>['events'] {
  const parent = Session.create(SessionId('parent'))
  parent.append('turn/start', { turn: 0 })
  return [...parent.events]
}

describe('seedDescriptorTurn delegation events', () => {
  it('produces a fresh child with only the descriptor when no delegation events are given', () => {
    const events = seedDescriptorTurn(SessionId('s'), undefined, descriptor())
    expect(events.map(e => e.type)).toEqual(['subagent/descriptor'])
    expect(events[0]!.seq).toBe(0)
  })

  it('appends delegation events after the descriptor, contiguous from zero', () => {
    const delegation: DelegationEventAppend[] = [
      { type: 'test/delegation', data: { value: 'a' } },
      { type: 'test/delegation', data: { value: 'b' } },
    ]
    const events = seedDescriptorTurn(SessionId('s'), undefined, descriptor(), delegation)
    expect(events.map(e => e.type)).toEqual(['subagent/descriptor', 'test/delegation', 'test/delegation'])
    expect(events.map(e => e.seq)).toEqual([0, 1, 2])
    expect(events[1]!.data).toEqual({ value: 'a' })
    expect(events[2]!.data).toEqual({ value: 'b' })
  })

  it('places delegation events after a fork seed, in the child suffix that cold resume folds', () => {
    const seed = forkSeed()
    const delegation: DelegationEventAppend[] = [
      { type: 'test/delegation', data: { value: 'own' } },
    ]
    const events = seedDescriptorTurn(SessionId('child'), seed, descriptor(), delegation)
    // The child's own suffix — what cold resume folds from `seedLength` — holds
    // the descriptor and the delegation event; the leading `session/end-seed`
    // marker closes the inherited prefix.
    const suffix = events.slice(seed.length)
    expect(suffix.map(e => e.type)).toEqual(['session/end-seed', 'subagent/descriptor', 'test/delegation'])
    expect(suffix.at(-1)!.data).toEqual({ value: 'own' })
  })

  it('rejects a non-JSON delegation payload at the append site (fail loud)', () => {
    const bad = [{ type: 'test/delegation', data: { value: 1n as unknown as string } }] as DelegationEventAppend[]
    expect(() => seedDescriptorTurn(SessionId('s'), undefined, descriptor(), bad)).toThrow(/non-JSON-serializable/)
  })
})
