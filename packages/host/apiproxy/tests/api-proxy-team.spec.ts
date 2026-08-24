/**
 * Team carrier paths of the host ApiProxy: the mux-open baseline baselines
 * every gate-passing live session, every committed snapshot pushes one whole
 * frame, a composition without the service pushes nothing, the unary answers
 * cold reads and the [S2] message page with loud validation errors (a
 * gate-failing or unknown leader maps to team-leader-unknown, never an empty
 * team), and the frame plus payload schemas accept and reject exactly the
 * wire contract.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import type { TeamView } from '@deepseek-ai/dsh-team-projection'
import { TeamProjectionError } from '@deepseek-ai/dsh-team-projection'
import type { MuxFrame } from '../src/api/index.ts'
import { RpcId } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { muxFrameSchema } from '../src/api/events.schema.ts'
import { teamProjectionRequestSchema } from '../src/api/team.schema.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'

const LEADER = brandSessionId('leader-team')
const PLAIN = brandSessionId('plain-session')

type TeamFrame = Extract<MuxFrame, { type: 'session/team' }>

/** A complete snapshot fixture. */
function teamView(over: Partial<TeamView> = {}): TeamView {
  return {
    teamId: String(LEADER),
    leaderSessionId: String(LEADER),
    rosterMemberCount: 1,
    members: [{
      memberId: 'captain', name: 'Captain', role: 'leader',
      sessionIds: [String(LEADER)], status: 'bound', pendingControlCount: 0,
    }],
    delegations: [],
    tasks: [],
    approvals: [],
    messages: [{ from: 'captain', to: 'backend', message: 'hi', at: 5, seq: 0, sessionId: String(LEADER) }],
    messageCount: 1,
    ...over,
  }
}

/**
 * A context with scripted session-store/persistence faces and a scripted team
 * projection service: `get` answers only the ids that pass the service's
 * team-ness gate (rejecting the rest with LEADER_UNKNOWN), `project` mirrors
 * it, and `onChanged` hands the test the push publisher.
 */
async function bench(options: {
  withService?: boolean
  gatePassing?: readonly SessionId[]
} = {}): Promise<{ ctx: Context; publish: (leader: SessionId, view: TeamView) => void }> {
  const ctx = new Context()
  const view = teamView()
  const sessions = new Map<SessionId, object>([
    [LEADER, { id: LEADER, seq: 0, header: { id: LEADER }, events: [] }],
    [PLAIN, { id: PLAIN, seq: 0, header: { id: PLAIN }, events: [] }],
  ])
  const listeners = new Set<(leaderSessionId: SessionId, view: TeamView) => void>()
  const gatePassingFor = (id: SessionId): boolean => options.gatePassing === undefined || options.gatePassing.includes(id)
  ctx.provide('sessions', {
    get: (id: SessionId) => sessions.get(id),
    list: () => [...sessions.values()],
  })
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([] as SessionHeader[]),
    inspect: (id: SessionId) => Promise.resolve({
      meta: { version: 0, id, createdAt: 1, cwd: '/w' },
      events: [
        { type: 'team/message', seq: 0, time: 5, data: { from: 'captain', to: 'backend', message: 'hi' } },
      ] as unknown as SessionEvent[],
    }),
    locate: () => undefined,
  })
  ctx.provide('sessionProjections', {
    snapshot: () => ({ values: {}, asOfSeq: 0 }),
    restore: () => ({ snapshot: { values: {}, asOfSeq: 0 } }),
    onChanged: () => () => {},
    register: () => () => {},
  })
  ctx.provide('userQuestions', { registerProvider: () => () => {} })
  if (options.withService !== false) {
    ctx.provide('teamProjection', {
      get: (id: SessionId) => gatePassingFor(id)
        ? Promise.resolve(view)
        : Promise.reject(new TeamProjectionError('LEADER_UNKNOWN', 'not a team session')),
      project: (id: SessionId, _signal?: AbortSignal, opts?: { messagesBefore?: { at: number; sessionId: string; seq: number } }) => {
        if (!gatePassingFor(id)) {
          return Promise.reject(new TeamProjectionError('LEADER_UNKNOWN', 'not a team session'))
        }
        if (opts?.messagesBefore === undefined) return Promise.resolve(view)
        return Promise.resolve({
          kind: 'message-page' as const,
          teamId: String(id),
          leaderSessionId: String(id),
          messages: [],
          messageCount: 1,
        })
      },
      onChanged: (listener: (leaderSessionId: SessionId, view: TeamView) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    })
  }
  return {
    ctx,
    publish: (leader, published) => {
      for (const listener of listeners) listener(leader, published)
    },
  }
}

const api = (ctx: Context) => createApiProxy(ctx, {
  defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp',
})

describe('session/team mux baseline and pushes', () => {
  it('baselines every gate-passing live session on open and stays absent for the rest', async () => {
    const { ctx, publish } = await bench({ gatePassing: [LEADER] })
    const abort = new AbortController()
    const stream = api(ctx).events.mux({ rpcId: RpcId('t-team-open'), payload: {} }, abort.signal)
    const seen: string[] = []
    const collected = (async () => {
      const frames: MuxFrame[] = []
      for await (const envelope of stream) {
        seen.push(envelope.payload.type)
        frames.push(envelope.payload)
        if (frames.filter(frame => frame.type === 'session/team').length >= 2) abort.abort()
      }
      return frames.filter((frame): frame is TeamFrame => frame.type === 'session/team')
    })()
    // The async baseline lands first; only then does the committed push arrive.
    await vi.waitFor(() => { expect(seen).toContain('session/team') })
    publish(LEADER, teamView({ messageCount: 2 }))
    const frames = await collected
    expect(frames.map(frame => frame.sessionId)).toEqual([LEADER, LEADER])
    expect(frames[0]?.team.teamId).toBe(String(LEADER))
    expect(frames.every(frame => frame.sessionId !== PLAIN)).toBe(true)
  })

  it('pushes one whole-snapshot frame per committed publication', async () => {
    const { ctx, publish } = await bench()
    const abort = new AbortController()
    const stream = api(ctx).events.mux({ rpcId: RpcId('t-team-push'), payload: {} }, abort.signal)
    const seen: string[] = []
    const collected = (async () => {
      const frames: MuxFrame[] = []
      for await (const envelope of stream) {
        seen.push(envelope.payload.type)
        frames.push(envelope.payload)
        if (frames.filter(frame => frame.type === 'session/team').length >= 4) abort.abort()
      }
      return frames.filter((frame): frame is TeamFrame => frame.type === 'session/team')
    })()
    // Two baselines (both sessions pass the gate) land before the publishes.
    await vi.waitFor(() => { expect(seen.filter(type => type === 'session/team').length).toBe(2) })
    publish(LEADER, teamView({ messageCount: 2 }))
    publish(LEADER, teamView({ messageCount: 3 }))
    const frames = await collected
    const counts = frames.map(frame => frame.team.messageCount)
    expect(counts).toContain(2)
    expect(counts).toContain(3)
  })

  it('emits no team frames at all without the service', async () => {
    const { ctx } = await bench({ withService: false })
    const abort = new AbortController()
    const stream = api(ctx).events.mux({ rpcId: RpcId('t-team-absent'), payload: {} }, abort.signal)
    const frames: MuxFrame[] = []
    const drained = (async () => {
      for await (const envelope of stream) {
        frames.push(envelope.payload)
        // Both listed sessions subscribe: the stream is provably live.
        if (frames.filter(frame => frame.type === 'session/subscribed').length >= 2) abort.abort()
      }
    })()
    await drained
    expect(frames.some(frame => frame.type === 'session/team')).toBe(false)
  })
})

describe('team.projection unary', () => {
  it('answers the snapshot form and the [S2] message page', async () => {
    const { ctx } = await bench()
    const proxy = api(ctx)
    const snapshot = await proxy.team.projection({ rpcId: RpcId('t-team-snap'), payload: { leaderSessionId: LEADER } })
    expect(snapshot.result).toMatchObject({ ok: true, value: { teamId: String(LEADER), messageCount: 1 } })

    const page = await proxy.team.projection({
      rpcId: RpcId('t-team-page'),
      payload: { leaderSessionId: LEADER, messagesBefore: { at: 5, sessionId: String(LEADER), seq: 0 }, limit: 1 },
    })
    expect(page.result).toMatchObject({ ok: true, value: { kind: 'message-page', messageCount: 1 } })
  })

  it('maps a gate-failing or unknown leader to team-leader-unknown, never an empty team', async () => {
    const { ctx } = await bench({ gatePassing: [] })
    const response = await api(ctx).team.projection({
      rpcId: RpcId('t-team-unknown'), payload: { leaderSessionId: brandSessionId('ghost') },
    })
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'team-leader-unknown', message: /not a team session/u, details: { leaderSessionId: 'ghost' } },
    })
  })

  it('maps an anchor naming no folded message to team-anchor-unknown', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { get: () => undefined, list: () => [] })
    ctx.provide('agents', { get: () => undefined })
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: {}, asOfSeq: 0 }),
      restore: () => ({ snapshot: { values: {}, asOfSeq: 0 } }),
      onChanged: () => () => {},
      register: () => () => {},
    })
    ctx.provide('userQuestions', { registerProvider: () => () => {} })
    ctx.provide('teamProjection', {
      get: () => Promise.resolve(teamView()),
      project: () => Promise.reject(new TeamProjectionError('ANCHOR_UNKNOWN', 'anchor names no message')),
      onChanged: () => () => {},
    })
    const response = await api(ctx).team.projection({
      rpcId: RpcId('t-team-anchor'),
      payload: { leaderSessionId: LEADER, messagesBefore: { at: 9, sessionId: String(LEADER), seq: 9 } },
    })
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'team-anchor-unknown', details: { leaderSessionId: String(LEADER) } },
    })
  })

  it('answers team-unavailable when the deployment composes no service', async () => {
    const { ctx } = await bench({ withService: false })
    const response = await api(ctx).team.projection({
      rpcId: RpcId('t-team-nosvc'), payload: { leaderSessionId: LEADER },
    })
    expect(response.result).toMatchObject({ ok: false, error: { code: 'team-unavailable' } })
  })

  it('folds a foreign failure into the internal error branch', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { get: () => undefined, list: () => [] })
    ctx.provide('agents', { get: () => undefined })
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: {}, asOfSeq: 0 }),
      restore: () => ({ snapshot: { values: {}, asOfSeq: 0 } }),
      onChanged: () => () => {},
      register: () => () => {},
    })
    ctx.provide('userQuestions', { registerProvider: () => () => {} })
    ctx.provide('teamProjection', {
      get: () => Promise.reject(new Error('boom')),
      project: () => Promise.reject(new Error('boom')),
      onChanged: () => () => {},
    })
    const response = await api(ctx).team.projection({
      rpcId: RpcId('t-team-crash'), payload: { leaderSessionId: LEADER },
    })
    expect(response.result).toMatchObject({ ok: false, error: { code: 'internal' } })
  })
})

describe('team wire schemas', () => {
  it('accepts the frame and both request forms, rejecting loud violations', () => {
    expect(muxFrameSchema.parse({ type: 'session/team', sessionId: 's', team: teamView() }))
      .toMatchObject({ type: 'session/team' })
    expect(() => muxFrameSchema.parse({
      type: 'session/team', sessionId: 's', team: { ...teamView(), rosterMemberCount: -1 },
    })).toThrow()
    expect(() => muxFrameSchema.parse({
      type: 'session/team', sessionId: 's', team: { ...teamView(), members: 'x' },
    })).toThrow()

    expect(teamProjectionRequestSchema.parse({ leaderSessionId: 's' })).toEqual({ leaderSessionId: 's' })
    const pageForm = teamProjectionRequestSchema.parse({
      leaderSessionId: 's', messagesBefore: { at: 1, sessionId: 's', seq: 2 }, limit: 3,
    })
    expect(pageForm).toMatchObject({ messagesBefore: { at: 1, seq: 2 }, limit: 3 })
    for (const invalid of [
      { leaderSessionId: 's', messagesBefore: { at: 1, sessionId: 's', seq: 2 }, limit: 0 },
      { leaderSessionId: 's', messagesBefore: { at: 1, sessionId: 's', seq: 2 }, limit: 501 },
      { leaderSessionId: 's', messagesBefore: { at: 1, sessionId: 's', seq: 2 }, limit: 1.5 },
      { leaderSessionId: 's', messagesBefore: { at: -1, sessionId: 's', seq: 2 } },
    ]) {
      expect(() => teamProjectionRequestSchema.parse(invalid)).toThrow()
    }
  })

  it('never lets a page payload parse as the snapshot form (no silent fallback)', () => {
    // The strict snapshot branch rejects the page field, so a complete page
    // payload reads only through the page branch…
    const pageForm = teamProjectionRequestSchema.parse({
      leaderSessionId: 's',
      messagesBefore: { at: 1, sessionId: 's', seq: 2 },
    })
    expect('messagesBefore' in (pageForm as Record<string, unknown>)).toBe(true)
    // …and a page payload with an incomplete page field is rejected outright,
    // never silently read as a snapshot.
    for (const partial of [
      { leaderSessionId: 's', messagesBefore: { at: 1, sessionId: 's' } },
      { leaderSessionId: 's', messagesBefore: { at: 1, seq: 2 } },
      { leaderSessionId: 's', messagesBefore: { sessionId: 's', seq: 2 } },
    ]) {
      expect(() => teamProjectionRequestSchema.parse(partial)).toThrow()
    }
  })

  it('routes the fetch carrier to the impl and answers a gateway without the domain', async () => {
    const { ctx } = await bench()
    const handler = toFetchHandler(api(ctx))
    const response = await handler.fetch(new Request('http://x/api/team.projection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 't-team-wire', method: 'team.projection',
        payload: { leaderSessionId: String(LEADER) },
      }),
    }))
    const body = await response.json() as { result: { ok: boolean; value?: { teamId: string } } }
    expect(body.result).toMatchObject({ ok: true, value: { teamId: String(LEADER) } })

    // The abstract client's team seat rides the same in-process carrier.
    const client = new InProcessApiClient(handler)
    const viaClient = await client.team?.projection({ leaderSessionId: LEADER })
    expect(viaClient?.result).toMatchObject({ ok: true, value: { teamId: String(LEADER) } })

    // The optional-member fallback: a scripted gateway with no team domain
    // still answers the wire with the explicit unavailable code.
    const withoutTeam = toFetchHandler({
      sessions: {}, subagents: {}, host: {}, workspace: {}, skills: {},
      agentPresets: {}, events: {}, goals: {}, settings: {}, credentials: {},
      llm: {}, downloads: {},
      respond: () => Promise.resolve({ accepted: false as const, reason: 'not-pending' as const }),
    } as never)
    const fallback = await withoutTeam.fetch(new Request('http://x/api/team.projection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 't-team-fallback', method: 'team.projection',
        payload: { leaderSessionId: 's' },
      }),
    }))
    const fallbackBody = await fallback.json() as { result: { ok: boolean; error?: { code: string } } }
    expect(fallbackBody.result).toMatchObject({ ok: false, error: { code: 'team-unavailable' } })
  })
})
