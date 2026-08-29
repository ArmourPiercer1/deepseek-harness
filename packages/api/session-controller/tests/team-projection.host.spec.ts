/**
 * Host team projection: the `team.projection` Remote answers cold reads and
 * older-message pages from the optional team-projection service with stable
 * wire codes (a missing service is team-unavailable, a gate-failing leader
 * is team-leader-unknown, never an empty team), and the control stream
 * baselines every gate-passing live session right after the baseline frame
 * and pushes one whole frame per committed snapshot.
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { TeamProjectionError } from '@deepseek-ai/dsh-team-projection'
import type { TeamMessagePage, TeamView } from '@deepseek-ai/dsh-team-projection/types'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { SessionControlController } from '../src/control.ts'
import type { SessionControlFrame } from '../src/types.ts'
import { SessionTeamController } from '../src/team.ts'

const LEADER = SessionId('leader-team')
const PLAIN = SessionId('plain-session')

/** A complete snapshot fixture. */
function teamView(over: Partial<TeamView> = {}): TeamView {
  return {
    teamId: LEADER,
    leaderSessionId: LEADER,
    rosterMemberCount: 2,
    members: [
      { memberId: 'leader', name: 'leader', role: 'leader', sessionIds: [LEADER], status: 'bound', pendingControlCount: 0 },
      { memberId: 'mate', name: 'mate', role: 'teammate', sessionIds: [PLAIN], status: 'running', pendingControlCount: 0 },
    ],
    delegations: [],
    tasks: [],
    approvals: [],
    messages: [],
    messageCount: 0,
    ...over,
  }
}

type TeamAnswer = (leaderSessionId: string) => Promise<TeamView | TeamMessagePage> | TeamView | TeamMessagePage

interface TeamProjectionStub {
  readonly calls: { leaderSessionId: string; options?: { messagesBefore?: unknown; limit?: number } }[]
  project(
    leaderSessionId: string,
    signal?: AbortSignal,
    options?: { messagesBefore?: unknown; limit?: number },
  ): Promise<TeamView | TeamMessagePage>
  get(leaderSessionId: string, signal?: AbortSignal): Promise<TeamView>
  onChanged(listener: (leaderSessionId: string, view: TeamView) => void): () => void
  publish(leaderSessionId: string, view: TeamView): void
  respond(next: TeamAnswer): void
}

/** Programmable team-projection double: gate-passes `LEADER`, rejects everything else. */
function teamProjectionStub(): TeamProjectionStub {
  const calls: TeamProjectionStub['calls'] = []
  const listeners = new Set<(leaderSessionId: string, view: TeamView) => void>()
  let answer: TeamAnswer = leaderSessionId => leaderSessionId === LEADER
    ? teamView()
    : Promise.reject(new TeamProjectionError('LEADER_UNKNOWN', 'no team fact for this session'))
  return {
    calls,
    async project(leaderSessionId, signal, options) {
      calls.push({ leaderSessionId, ...(options === undefined ? {} : { options }) })
      if (signal?.aborted === true) throw new Error('aborted')
      const value = answer(leaderSessionId)
      return value instanceof Promise ? value : Promise.resolve(value)
    },
    async get(leaderSessionId) {
      calls.push({ leaderSessionId })
      const value = answer(leaderSessionId)
      return Promise.resolve(value) as Promise<TeamView>
    },
    onChanged(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    publish(leaderSessionId, view) {
      for (const listener of [...listeners]) listener(leaderSessionId, view)
    },
    respond(next) {
      answer = next
    },
  }
}

async function expectFailure(promise: Promise<unknown>): Promise<{ code: string; message: string; details: object }> {
  const error = await promise.catch((value: unknown) => value)
  expect(error).toBeInstanceOf(TypertRemoteFailure)
  return (error as TypertRemoteFailure).failure
}

describe('SessionTeamController', () => {
  it('answers a snapshot when the projection service is composed', async () => {
    const ctx = new Context()
    const stub = teamProjectionStub()
    ctx.provide('teamProjection', stub)
    const controller = new SessionTeamController(ctx)

    const result = await controller.projection({ leaderSessionId: LEADER }, new AbortController().signal)

    expect(result).toEqual(teamView())
    expect(stub.calls).toEqual([{ leaderSessionId: LEADER }])
  })

  it('passes the page form through, with the limit only when the caller sets one', async () => {
    const ctx = new Context()
    const page: TeamMessagePage = { kind: 'message-page', teamId: LEADER, leaderSessionId: LEADER, messages: [], messageCount: 0 }
    const stub = teamProjectionStub()
    stub.respond(() => page)
    ctx.provide('teamProjection', stub)
    const controller = new SessionTeamController(ctx)
    const signal = new AbortController().signal
    const anchor = { at: 2, sessionId: PLAIN, seq: 1 }

    await controller.projection({ leaderSessionId: LEADER, messagesBefore: anchor, limit: 200 }, signal)
    expect(stub.calls).toEqual([{ leaderSessionId: LEADER, options: { messagesBefore: anchor, limit: 200 } }])

    stub.calls.length = 0
    await controller.projection({ leaderSessionId: LEADER, messagesBefore: anchor }, signal)
    expect(stub.calls[0]).toMatchObject({ leaderSessionId: LEADER, options: { messagesBefore: anchor } })
    expect(stub.calls[0]?.options?.limit).toBeUndefined()
  })

  it.each([
    ['LEADER_UNKNOWN', 'team-leader-unknown'],
    ['ANCHOR_UNKNOWN', 'team-anchor-unknown'],
    ['INVALID_LIMIT', 'bad-request'],
  ] as const)('maps %s to the %s wire code', async (foldCode, wireCode) => {
    const ctx = new Context()
    const stub = teamProjectionStub()
    stub.respond(() => Promise.reject(new TeamProjectionError(foldCode, 'fold rejected the request')))
    ctx.provide('teamProjection', stub)
    const controller = new SessionTeamController(ctx)

    const failure = await expectFailure(controller.projection({ leaderSessionId: LEADER }, new AbortController().signal))

    expect(failure.code).toBe(wireCode)
    expect(failure.message).toBe('fold rejected the request')
    expect(failure.details).toEqual({ leaderSessionId: LEADER })
  })

  it('answers team-unavailable when the service is not composed', async () => {
    const ctx = new Context()
    const controller = new SessionTeamController(ctx)

    const failure = await expectFailure(controller.projection({ leaderSessionId: LEADER }, new AbortController().signal))

    expect(failure.code).toBe('team-unavailable')
    expect(failure.details).toEqual({})
  })

  it('settles an in-flight call as cancelled when the caller aborts', async () => {
    const ctx = new Context()
    const stub = teamProjectionStub()
    const abort = new AbortController()
    // The fold is still reading when the caller aborts: the service rejects
    // on the aborted signal and the controller maps it.
    stub.respond(() => new Promise<TeamView>((_resolve, reject) => {
      abort.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    ctx.provide('teamProjection', stub)
    const controller = new SessionTeamController(ctx)
    const inFlight = controller.projection({ leaderSessionId: LEADER }, abort.signal)
    abort.abort()

    const failure = await expectFailure(inFlight)

    expect(failure.code).toBe('cancelled')
  })

  it('maps an unexpected fold error to internal', async () => {
    const ctx = new Context()
    const stub = teamProjectionStub()
    stub.respond(() => Promise.reject(new Error('fold broke')))
    ctx.provide('teamProjection', stub)
    const controller = new SessionTeamController(ctx)

    const failure = await expectFailure(controller.projection({ leaderSessionId: LEADER }, new AbortController().signal))

    expect(failure.code).toBe('internal')
    expect(failure.message).toContain('fold broke')
  })
})

describe('Session control team frames', () => {
  async function harness(withService: boolean): Promise<{
    stub: TeamProjectionStub | undefined
    control: SessionControlController
  }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    ctx.sessions.create(LEADER)
    ctx.sessions.create(PLAIN)
    const stub = withService ? teamProjectionStub() : undefined
    if (stub !== undefined) ctx.provide('teamProjection', stub)
    const control = new SessionControlController(ctx)
    // Let the optional-service inject wiring settle.
    await new Promise(resolve => setTimeout(resolve, 0))
    return { stub, control }
  }

  it('baselines every gate-passing live session right after the baseline frame', async () => {
    const { stub, control } = await harness(true)
    expect(stub).toBeDefined()
    const abort = new AbortController()
    const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done || first.value.type !== 'baseline') throw new Error('missing control baseline')

    // The gate-passing leader rides in; the rejected session stays absent.
    const second = await iterator.next()
    expect(second.value).toMatchObject({ type: 'team', sessionId: LEADER })
    abort.abort()
    await iterator.next()

    expect(stub?.calls.map(call => call.leaderSessionId)).toEqual([LEADER, PLAIN])
  })

  it('stays silent without the service and keeps the stream alive', async () => {
    const { control } = await harness(false)
    const abort = new AbortController()
    const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done || first.value.type !== 'baseline') throw new Error('missing control baseline')

    // The async baseline pass settles without pushing; the stream still ends
    // cleanly on abort.
    await new Promise(resolve => setTimeout(resolve, 10))
    abort.abort()
    const frames: SessionControlFrame[] = [first.value]
    for (let step = await iterator.next(); !step.done; step = await iterator.next()) frames.push(step.value)

    expect(frames.filter(frame => frame.type === 'team')).toHaveLength(0)
  })

  it('pushes one whole frame per committed snapshot on the change feed', async () => {
    const { stub, control } = await harness(true)
    expect(stub).toBeDefined()
    const abort = new AbortController()
    const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done || first.value.type !== 'baseline') throw new Error('missing control baseline')
    const baselineFrame = await iterator.next()
    expect(baselineFrame.value).toMatchObject({ type: 'team', sessionId: LEADER })

    const updated = teamView({ rosterMemberCount: 3 })
    stub?.publish(LEADER, updated)
    const live = await iterator.next()
    abort.abort()
    await iterator.next()

    expect(live.value).toEqual({ type: 'team', sessionId: LEADER, team: updated })
  })
})
