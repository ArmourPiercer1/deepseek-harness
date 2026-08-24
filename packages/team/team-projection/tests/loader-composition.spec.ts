/**
 * Real-Loader composition of the team projection: the service boots through a
 * test cordis.yml, folds cold from persistence fixtures, publishes one
 * snapshot per committed leader state (coalesced), overlays running flips from
 * agent/status, and its teardown removes every listener (HMR safety).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionEventMap, SessionHeader } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import TeamProjectionService from '@deepseek-ai/dsh-team-projection'
import type { TeamView } from '@deepseek-ai/dsh-team-projection'

let root: string | undefined
let context: Context | undefined
let workspace = ''
let previousHome: string | undefined

const LEADER = SessionId('leader-session')
const CHILD = SessionId('child-session')

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  workspace = ''
  if (previousHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = previousHome
  previousHome = undefined
})

const BACKEND_ROSTER = [
  '---',
  'schemaVersion: 1',
  'id: backend',
  'role: teammate',
  'name: Backend',
  'description: serves',
  '---',
  'You serve.',
  '',
].join('\n')

/** Create the rostered workspace plus an empty harness home, and pin $DSH_HOME to it. */
async function sandbox(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-team-projection-'))
  workspace = join(root, 'workspace')
  await mkdir(join(workspace, '.dsh', 'teammates'), { recursive: true })
  await mkdir(join(root, 'home'), { recursive: true })
  await writeFile(join(workspace, '.dsh', 'teammates', 'captain.md'), [
    '---',
    'schemaVersion: 1',
    'id: captain',
    'role: leader',
    'name: Captain',
    'description: leads',
    '---',
    'You lead.',
    '',
  ].join('\n'))
  await writeFile(join(workspace, '.dsh', 'teammates', 'backend.md'), BACKEND_ROSTER)
  previousHome = process.env['DSH_HOME']
  process.env['DSH_HOME'] = join(root, 'home')
  return root
}

/** Boot the projection composition through the real Loader with a rostered workspace. */
async function boot(): Promise<Context> {
  const dir = await sandbox()
  const configPath = join(dir, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-team-projection'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(dir).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-team-projection', TeamProjectionService],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

/** A live leader session in the booted store. */
function leaderSession(ctx: Context): Session {
  const existing = ctx.sessions.get(LEADER)
  if (existing !== undefined) return existing
  return ctx.sessions.create(LEADER, { meta: { cwd: workspace } })
}

/** A live team child session bound to a member. */
function childSession(ctx: Context, memberId: string): Session {
  const existing = ctx.sessions.get(CHILD)
  if (existing !== undefined) return existing
  const session = ctx.sessions.create(CHILD, {
    meta: { cwd: workspace, parentSession: LEADER, origin: 'subagent' as const },
  })
  session.append('team/member-bound', { memberId: memberId as never, role: 'teammate' })
  return session
}

/** Append one leader team/message event. */
function say(session: Session, from: string, to: string, text: string): void {
  session.append('team/message', { from: from as never, to: to as never, message: text })
}

/**
 * Scripted subagent boundary: the real corpus ladder needs a durable
 * continuable descriptor these sessions never carry, so the test lists the
 * team child directly plus one non-team row (mocking an external service).
 */
function provideSubagents(ctx: Context): void {
  ctx.provide('subagents', {
    listChildren: (parent: SessionId) => {
      if (parent !== LEADER) return Promise.resolve([])
      return Promise.resolve([
        {
          kind: 'child' as const,
          id: CHILD,
          mode: 'continuable' as const,
          label: 'team:Backend',
          activity: 'inactive' as const,
          hasChildren: false,
        },
        {
          // A plain one-shot child of the same leader: not a team child.
          kind: 'child' as const,
          id: SessionId('one-shot-child'),
          mode: 'one-shot' as const,
          activity: 'inactive' as const,
          hasChildren: false,
        },
      ])
    },
  })
}

/** In-memory persistence double over prepared logs (an external backend for the fold). */
function providePersistence(ctx: Context, logs: Map<SessionId, { meta: SessionHeader; events: SessionEvent[] }>): void {
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([...logs.values()].map(entry => entry.meta)),
    inspect: (id: SessionId) => {
      const entry = logs.get(id)
      if (entry === undefined) return Promise.reject(new Error(`no such session ${String(id)}`))
      return Promise.resolve(entry)
    },
    locate: () => undefined,
  })
}

/** A published-snapshot collector over the change feed. */
function collector(): { views: Map<string, TeamView> } {
  return { views: new Map<string, TeamView>() }
}

/** A scripted live agent over one session; the test drives its status field. */
function makeAgent(ctx: Context, session: Session, status: Agent['status']): Agent {
  return {
    id: session.id, options: {}, session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status, ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as Agent
}

/** Flip the scripted agent's live status and emit the transition on ctx. */
function flipAgent(ctx: Context, agent: Agent, status: Agent['status']): void {
  // The declared field is readonly; the test drives the live flip through a
  // widened view of its own fixture.
  ;(agent as { status: Agent['status'] }).status = status
  ctx.emit('agent/status', { agent, status })
}

describe('team projection real Loader composition', () => {
  it('provides ctx.teamProjection and folds the roster join live', async () => {
    const ctx = await boot()
    const session = leaderSession(ctx)
    session.append('tool/call', {
      turn: 1, step: 1, callId: 'c1', name: 'delegate_to_teammate',
      arguments: JSON.stringify({ teammate_id: 'backend', prompt: 'go' }),
    } as never)
    const view = await ctx.teamProjection.get(LEADER)
    expect(view.teamId).toBe('leader-session')
    expect(view.rosterMemberCount).toBe(2)
    expect(view.members.map(member => member.memberId)).toEqual(['captain', 'backend'])
    expect(view.members[1]).toMatchObject({ name: 'Backend', status: 'unbound', sessionIds: [] })
    expect(view.delegations).toEqual([
      { memberId: 'backend', childSessionId: '', startedAt: session.events[0]?.time, inProgress: true },
    ])
  }, 30_000)

  it('rebuilds cold from persistence when the leader was never live', async () => {
    const ctx = await boot()
    const header: SessionHeader = { version: 0, id: LEADER, createdAt: 1, cwd: workspace }
    const events = [
      { type: 'team/message', seq: 0, time: 5, data: { from: 'captain', to: 'backend', message: 'hello' } },
    ] as unknown as SessionEvent[]
    providePersistence(ctx, new Map([[LEADER, { meta: header, events }]]))

    const view = await ctx.teamProjection.get(LEADER)
    expect(view.messages).toHaveLength(1)
    expect(view.messages[0]).toMatchObject({ message: 'hello', sessionId: 'leader-session' })
  }, 30_000)

  it('rejects an unknown leader loudly rather than answering an empty team', async () => {
    const ctx = await boot()
    await expect(ctx.teamProjection.get(SessionId('never-created'))).rejects.toThrow(/neither live nor persisted/u)
  }, 30_000)

  it('publishes one coalesced snapshot per committed leader state and pages older messages', async () => {
    const ctx = await boot()
    leaderSession(ctx)
    const child = childSession(ctx, 'backend')
    provideSubagents(ctx)
    let publications = 0
    const published = collector()
    const dispose = ctx.teamProjection.onChanged((leaderId, view) => {
      publications += 1
      published.views.set(String(leaderId), view)
    })
    // The child's bind event schedules one deferred rebuild; let it land.
    await vi.waitFor(() => { expect(publications).toBe(1) })

    const session = ctx.sessions.get(LEADER)
    if (session === undefined) throw new Error('leader missing')
    // Irrelevant families on either side publish nothing further: a plain turn
    // marker on the leader, and a non-team event on the child.
    session.append('turn/start', { turn: 2 })
    child.append('turn/start', { turn: 1 })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(publications).toBe(1)

    say(session, 'captain', 'backend', 'one')
    await vi.waitFor(() => { expect(publications).toBe(2) })
    say(session, 'backend', 'captain', 'two')
    say(session, 'backend', 'captain', 'three')
    await vi.waitFor(() => {
      expect(published.views.get('leader-session')?.messages.map(message => message.message))
        .toEqual(['one', 'two', 'three'])
    })
    // Whole-snapshot last-wins: one leader key, never per-event deltas.
    expect(published.views.size).toBe(1)
    expect(published.views.get('leader-session')?.members.find(member => member.memberId === 'backend'))
      .toMatchObject({ status: 'bound', sessionIds: ['child-session'] })
    dispose()
  }, 30_000)

  it('ignores plain non-team session lifecycle, folds a team child creation', async () => {
    const ctx = await boot()
    leaderSession(ctx)
    const published = collector()
    ctx.teamProjection.onChanged((leaderId, view) => {
      published.views.set(String(leaderId), view)
    })
    // A plain session (no subagent origin) on the same store publishes nothing
    // on either lifecycle edge; the store boundary is driven directly.
    const plain = ctx.sessions.create(SessionId('plain-session'), { meta: { cwd: join(root as string, 'elsewhere') } })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(published.views.size).toBe(0)
    ctx.emit('session/disposed', plain)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(published.views.size).toBe(0)
    // A team child creation (subagent origin under the leader) republishes:
    // the directory listing is what passes the leader's team-ness gate.
    provideSubagents(ctx)
    childSession(ctx, 'backend')
    await vi.waitFor(() => { expect(published.views.has('leader-session')).toBe(true) })
    expect(plain.header.origin).toBeUndefined()
  }, 30_000)

  it('folds an empty team when a team child log becomes unreadable', async () => {
    const ctx = await boot()
    leaderSession(ctx)
    provideSubagents(ctx)
    // The persistence double rejects every inspect: the live leader serves,
    // the cold child read fails, and the fold continues without the child.
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([] as SessionHeader[]),
      inspect: () => Promise.reject(new Error('storage unreadable')),
      locate: () => undefined,
    })
    const view = await ctx.teamProjection.get(LEADER)
    expect(view.members.find(member => member.memberId === 'backend')).toMatchObject({ status: 'unbound' })
    expect(view.messages).toEqual([])
  }, 30_000)

  it('rethrows a read failure observed under a cancelled signal', async () => {
    const ctx = await boot()
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([] as SessionHeader[]),
      inspect: () => Promise.reject(new Error('storage unreadable')),
      locate: () => undefined,
    })
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(ctx.teamProjection.get(LEADER, cancelled.signal)).rejects.toThrow(/storage unreadable/u)
  }, 30_000)

  it('falls back to the harness home roster for a cwd-less cold leader', async () => {
    const ctx = await boot()
    // A header without cwd scans only $DSH_HOME/teammates — the sandbox home
    // defines none, so the fold answers the leader fallback row alone. The one
    // progress event is the team fact that passes the gate for a fact-only log.
    const header: SessionHeader = { version: 0, id: LEADER, createdAt: 1 }
    const events = [
      { type: 'team/progress', seq: 0, time: 5, data: { taskId: 't', subject: 'S', status: 'pending', memberId: 'captain' } },
    ] as unknown as SessionEvent[]
    providePersistence(ctx, new Map([[LEADER, { meta: header, events }]]))
    const view = await ctx.teamProjection.get(LEADER)
    expect(view.rosterMemberCount).toBe(0)
    expect(view.members).toHaveLength(1)
    expect(view.members[0]).toMatchObject({ memberId: 'leader', role: 'leader', sessionIds: ['leader-session'] })
  }, 30_000)

  it('applies the team-enablement section when a settings service is composed', async () => {
    const ctx = await boot()
    ctx.provide('settings', {
      get: (ns: unknown) => String(ns) === 'team-enablement'
        ? { [workspace]: { backend: false } }
        : undefined,
    })
    const session = leaderSession(ctx)
    // The message is the leader's team fact: the gate must pass on a fact-only log.
    say(session, 'captain', 'backend', 'go')
    // A live signal rides the roster scan (the undefined-signal shape is the
    // default of every other test).
    const view = await ctx.teamProjection.get(LEADER, new AbortController().signal)
    // A disabled teammate leaves the enabled roster entirely.
    expect(view.rosterMemberCount).toBe(1)
    expect(view.members.map(member => member.memberId)).toEqual(['captain'])
  }, 30_000)

  it('treats an unregistered enablement section as nothing disabled', async () => {
    const ctx = await boot()
    ctx.provide('settings', { get: () => undefined })
    const session = leaderSession(ctx)
    // The message is the leader's team fact: the gate must pass on a fact-only log.
    say(session, 'captain', 'backend', 'go')
    const view = await ctx.teamProjection.get(LEADER)
    expect(view.rosterMemberCount).toBe(2)
    expect(view.members.map(member => member.memberId)).toEqual(['captain', 'backend'])
  }, 30_000)

  it('overlays the running state from agent/status flips of an active leader', async () => {
    const ctx = await boot()
    leaderSession(ctx)
    childSession(ctx, 'backend')
    provideSubagents(ctx)
    const child = ctx.sessions.get(CHILD) as Session
    const agent = makeAgent(ctx, child, 'idle')
    ctx.agents.register(agent)
    const published = collector()
    ctx.teamProjection.onChanged((leaderId, view) => {
      published.views.set(String(leaderId), view)
    })
    // The bind event's deferred fold publishes the first snapshot, which is
    // what makes the leader active for the status trigger.
    await vi.waitFor(() => { expect(published.views.has('leader-session')).toBe(true) })
    flipAgent(ctx, agent, 'running')
    await vi.waitFor(() => {
      expect(published.views.get('leader-session')?.members.find(member => member.memberId === 'backend')?.status)
        .toBe('running')
    })
  }, 30_000)

  it('recomputes only the flip owner leader on agent/status; a non-team flip folds nothing', async () => {
    const ctx = await boot()
    leaderSession(ctx)
    childSession(ctx, 'backend')
    let listChildrenCalls = 0
    ctx.provide('subagents', {
      listChildren: (parent: SessionId) => {
        listChildrenCalls += 1
        return Promise.resolve(parent === LEADER
          ? [{
            kind: 'child' as const, id: CHILD, mode: 'continuable' as const,
            label: 'team:Backend', activity: 'inactive' as const, hasChildren: false,
          }]
          : [])
      },
    })
    const published = collector()
    let leaderPublications = 0
    ctx.teamProjection.onChanged((leaderId, view) => {
      if (String(leaderId) === 'leader-session') leaderPublications += 1
      published.views.set(String(leaderId), view)
    })
    // The bind event's deferred fold publishes the first snapshot and activates the leader.
    await vi.waitFor(() => { expect(leaderPublications).toBe(1) })

    // A flip of the bound child's agent recomputes exactly its leader.
    const child = ctx.sessions.get(CHILD) as Session
    const childAgent = makeAgent(ctx, child, 'idle')
    ctx.agents.register(childAgent)
    flipAgent(ctx, childAgent, 'running')
    await vi.waitFor(() => {
      expect(published.views.get('leader-session')?.members.find(member => member.memberId === 'backend')?.status)
        .toBe('running')
    })
    expect(leaderPublications).toBe(2)
    const callsAfterChildFlip = listChildrenCalls

    // A flip of a plain non-team session's agent recomputes nothing: no fold
    // (no directory read), no publication.
    const plain = ctx.sessions.create(SessionId('plain-flip'), { meta: { cwd: join(root as string, 'elsewhere') } })
    const plainAgent = makeAgent(ctx, plain, 'idle')
    ctx.agents.register(plainAgent)
    flipAgent(ctx, plainAgent, 'running')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(listChildrenCalls).toBe(callsAfterChildFlip)
    expect(leaderPublications).toBe(2)
    expect(published.views.has('plain-flip')).toBe(false)
  }, 30_000)

  it('serves the message-page form strictly before a folded anchor', async () => {
    const ctx = await boot()
    const session = leaderSession(ctx)
    for (const text of ['m1', 'm2', 'm3']) say(session, 'captain', 'backend', text)
    const fold = await ctx.teamProjection.project(LEADER)
    if (!('teamId' in fold)) throw new Error('expected the snapshot form')
    const anchor = fold.messages[1]
    if (anchor === undefined) throw new Error('expected three messages')
    const page = await ctx.teamProjection.project(LEADER, undefined, { messagesBefore: anchor, limit: 1 })
    expect(page).toMatchObject({ kind: 'message-page', messages: [{ message: 'm1' }], messageCount: 3 })
  }, 30_000)

  it('rejects a live non-team session loudly and publishes nothing for it', async () => {
    const ctx = await boot()
    // A plain session under the same workspace roster: the roster entry alone
    // never qualifies as team-ness.
    const plain = ctx.sessions.create(SessionId('plain-plain'), { meta: { cwd: workspace } })
    await expect(ctx.teamProjection.get(plain.id))
      .rejects.toMatchObject({ code: 'LEADER_UNKNOWN', message: /not a team session/u })
    const published = collector()
    ctx.teamProjection.onChanged((leaderId, view) => {
      published.views.set(String(leaderId), view)
    })
    // A trigger-relevant event on the plain session attempts a fold that the
    // gate stops: no snapshot, ever.
    plain.append('tool/call', { turn: 1, step: 1, callId: 'c', name: 'some_tool', arguments: '{}' } as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(published.views.size).toBe(0)
  }, 30_000)

  it('passes the gate on a team-labeled continuable child without any log facts', async () => {
    const ctx = await boot()
    leaderSession(ctx)
    // The directory alone is a team fact: the leader log carries no events.
    provideSubagents(ctx)
    const view = await ctx.teamProjection.get(LEADER)
    expect(view.teamId).toBe('leader-session')
  }, 30_000)

  it('passes the gate on each leader-side team fact alone', async () => {
    const ctx = await boot()
    const facts: { type: keyof SessionEventMap; data: Record<string, unknown> }[] = [
      { type: 'team/progress', data: { taskId: 't', subject: 'S', status: 'pending', memberId: 'captain' } },
      { type: 'team/control-decision', data: { requestId: 'r', decision: 'deny' } },
      { type: 'team/message', data: { from: 'captain', to: 'backend', message: 'hi' } },
      { type: 'team/control-request', data: { requestId: 'r', memberId: 'backend', toolName: 't', reason: 'r' } },
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c', name: 'delegate_to_teammate', arguments: JSON.stringify({ teammate_id: 'backend' }) } },
    ]
    for (const [index, fact] of facts.entries()) {
      const session = ctx.sessions.create(SessionId(`fact-${index}`), { meta: { cwd: workspace } })
      session.append(fact.type, fact.data as never)
      const view = await ctx.teamProjection.get(session.id)
      expect(view.leaderSessionId).toBe(`fact-${index}`)
    }
  }, 30_000)

  it('anchors a bound teammate request on its leader', async () => {
    const ctx = await boot()
    leaderSession(ctx)
    const child = childSession(ctx, 'backend')
    provideSubagents(ctx)
    const view = await ctx.teamProjection.get(child.id)
    expect(view.teamId).toBe('leader-session')
    expect(view.leaderSessionId).toBe('leader-session')
    expect(view.members.find(member => member.memberId === 'backend'))
      .toMatchObject({ status: 'bound', sessionIds: ['child-session'] })
  }, 30_000)

  it('anchors a parentless member-bound session on itself', async () => {
    const ctx = await boot()
    const orphan = ctx.sessions.create(SessionId('orphan'), { meta: { cwd: workspace } })
    orphan.append('team/member-bound', { memberId: 'backend', role: 'teammate' } as never)
    const view = await ctx.teamProjection.get(orphan.id)
    expect(view.teamId).toBe('orphan')
  }, 30_000)

  it('anchors a bound teammate on its leader without a subagent directory', async () => {
    const ctx = await boot()
    leaderSession(ctx)
    const child = childSession(ctx, 'backend')
    // No subagents service: the directory is empty, so the bound member does
    // not reach the corpus — the anchor is still the leader.
    const view = await ctx.teamProjection.get(child.id)
    expect(view.teamId).toBe('leader-session')
    expect(view.members.find(member => member.memberId === 'backend'))
      .toMatchObject({ status: 'unbound', sessionIds: [] })
  }, 30_000)

  it('rejects a bound teammate whose leader log is unreadable loudly', async () => {
    const ctx = await boot()
    // A member-bound session whose parent is known to neither store.
    const child = ctx.sessions.create(SessionId('loose-child'), {
      meta: { cwd: workspace, parentSession: SessionId('vanished-leader') },
    })
    child.append('team/member-bound', { memberId: 'backend', role: 'teammate' } as never)
    await expect(ctx.teamProjection.get(child.id)).rejects.toMatchObject({
      code: 'LEADER_UNKNOWN',
      message: /vanished-leader.*neither live nor persisted/u,
    })
  }, 30_000)
})

describe('team projection teardown', () => {
  it('removes the service and its listeners when the fiber disposes (HMR safety)', async () => {
    await sandbox()
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(TeamProjectionService)
    const session = ctx.sessions.create(SessionId('leader-hmr'), { meta: { cwd: join(root as string, 'elsewhere') } })
    const published = collector()
    ctx.teamProjection.onChanged((leaderId, view) => {
      published.views.set(String(leaderId), view)
    })
    await fiber.dispose()
    expect(ctx.get('teamProjection')).toBeUndefined()
    say(session, 'captain', 'backend', 'after')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(published.views.size).toBe(0)
  }, 30_000)

  it('ignores a status flip whose owner leader is not active', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(TeamProjectionService)
    // The trigger resolves the flip's owner leader and recomputes only when
    // that leader is active: no store walk, no fold, no publish, no throw.
    const flipper = { session: { header: { id: SessionId('nowhere') } } }
    ctx.emit('agent/status', { agent: flipper as never, status: 'running' })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(ctx.get('teamProjection')).toBeDefined()
  }, 30_000)
})
