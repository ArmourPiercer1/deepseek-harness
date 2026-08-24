/**
 * Host-side read-only team projection service: rebuilds one leader's
 * {@link TeamView} from session logs (cold-safe), overlays live agent status,
 * republishes the whole snapshot after every team-relevant commit, and slices
 * older-message pages on demand. The session logs are the single authority —
 * the in-process `TeamProgressStore`/`TeamControlRegistry` state is never read.
 *
 * @module @deepseek-ai/dsh-team-projection
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import { TEAM_ENABLEMENT_SETTINGS_NAMESPACE, deduplicateDefinitions, discoverTeamMembers, filterDisabledTeammates } from '@deepseek-ai/dsh-team-local'
import type { TeamEnablementSettings } from '@deepseek-ai/dsh-team-local'
import type { TeamPageOptions, TeamMessagePage, TeamProjectionListener, TeamView } from './types.ts'
import { TeamProjectionError } from './error.ts'
import { foldTeamView, resolvePageLimit, scanTeamFacts, sliceMessagePage, TEAM_LABEL_PREFIX } from './fold.ts'
import type { TeamChildCorpus, TeamCorpus, TeamFold } from './fold.ts'

export { TeamProjectionError } from './error.ts'
export type { TeamProjectionErrorCode } from './error.ts'
export { foldTeamView, MESSAGE_CAP, resolvePageLimit, scanTeamFacts, sliceMessagePage, TEAM_LABEL_PREFIX } from './fold.ts'
export type { RunningProbe, TeamChildCorpus, TeamCorpus, TeamFacts, TeamFold } from './fold.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    teamProjection: TeamProjectionService
  }
}

/** The team-relevant event types of one leader session log. */
const LEADER_RELEVANT = new Set(['team/progress', 'team/message', 'team/control-decision', 'tool/call', 'user/message'])

/** The team-relevant event types of one child session log. */
const CHILD_RELEVANT = new Set([
  'team/member-bound', 'team/progress', 'team/control-request', 'team/control-decision', 'team/message', 'tool/call',
])

/** Whether one appended leader event can move the team view. */
function leaderEventRelevant(event: SessionEvent): boolean {
  if (LEADER_RELEVANT.has(event.type)) return true
  return false
}

/** The leader session one session id belongs to: its durable parent, else itself. */
function ownerLeaderOf(header: SessionHeader): SessionId {
  return header.parentSession ?? header.id
}

/**
 * Read-only team projection over session logs and the workspace roster.
 * The service owns no cache; every call re-reads the corpus (roster directory
 * reads are cheap and logs are local), so a fold always reflects committed state.
 *
 * Folds are gated on team-ness: the requested session must own a
 * `team:`-labeled continuable child in its subagent directory or a team fact
 * in its own log suffix (a roster entry alone never qualifies); a bound
 * teammate (own `team/member-bound`) anchors its leader. A session passing
 * no criterion is rejected with `LEADER_UNKNOWN`, never an empty view.
 */
export default class TeamProjectionService extends Service {
  private readonly listeners = new Set<TeamProjectionListener>()
  /** in-flight rebuilds keyed by leader, so one microtask coalesces to one publish. */
  private readonly pending = new Map<SessionId, Promise<void>>()
  /**
   * Leaders whose view this process has folded at least once (published or
   * served): team facts are log facts, so the set only grows. The running
   * overlay of exactly these leaders is what an agent/status flip can move —
   * the trigger recomputes the flip's owner leader when it is here, never an
   * O(N) walk of every live session.
   */
  private readonly activeLeaders = new Set<SessionId>()

  constructor(ctx: Context) {
    super(ctx, 'teamProjection')
    ctx.effect(() => {
      const onEvent = ctx.on('session/event', (session: Session, event: SessionEvent) => {
        const leader = ownerLeaderOf(session.header)
        const relevant = ownerLeaderOf(session.header) === session.id
          ? leaderEventRelevant(event)
          : CHILD_RELEVANT.has(event.type)
        if (relevant) void this.rebuild(leader)
      }, { global: true })
      const onStatus = ctx.on('agent/status', (payload) => {
        const leader = ownerLeaderOf(payload.agent.session.header)
        if (this.activeLeaders.has(leader)) void this.rebuild(leader)
      }, { global: true })
      const onCreated = ctx.on('session/created', (session: Session) => {
        if (session.header.origin === 'subagent') void this.rebuild(ownerLeaderOf(session.header))
      }, { global: true })
      const onDisposed = ctx.on('session/disposed', (session: Session) => {
        if (session.header.origin === 'subagent') void this.rebuild(ownerLeaderOf(session.header))
      }, { global: true })
      return () => {
        onEvent()
        onStatus()
        onCreated()
        onDisposed()
      }
    }, 'teamProjection live triggers')
  }

  /**
   * Subscribe to whole-snapshot publications. Last-wins per leader: a listener
   * sees the newest committed snapshot for each leader, never deltas.
   * @param listener - invoked once per committed leader snapshot.
   * @returns the disposer removing this listener.
   */
  onChanged(listener: TeamProjectionListener): () => void {
    const dispose = this.ctx.effect(() => {
      this.listeners.add(listener)
      return () => {
        this.listeners.delete(listener)
      }
    }, 'teamProjection.onChanged()')
    return () => void dispose()
  }

  /**
   * Fold one leader's complete current view. Cold-safe: a leader absent from
   * the live store is rebuilt from persistence. The requested session must
   * pass the team-ness gate — a roster entry alone never qualifies — so an
   * ordinary session is a loud rejection, never a synthetic empty team; a
   * bound teammate request anchors its leader.
   * @param leaderSessionId - the team session anchoring the fold (a leader, or
   *   a bound teammate whose leader is anchored instead).
   * @param signal - caller cancellation observed around every persistence read.
   * @param options - pagination options for the message-page response form.
   * @returns the full snapshot, or the older-messages page when `messagesBefore` is set.
   * @throws {@link TeamProjectionError} LEADER_UNKNOWN when neither store knows the session, or the
   *   session fails the team-ness gate (no team child, no team fact in its own log).
   * @throws {@link TeamProjectionError} ANCHOR_UNKNOWN when the anchor names no folded message.
   * @throws {@link TeamProjectionError} INVALID_LIMIT when limit is outside [1, MESSAGE_CAP].
   */
  async project(
    leaderSessionId: SessionId,
    signal?: AbortSignal,
    options?: TeamPageOptions,
  ): Promise<TeamView | TeamMessagePage> {
    const fold = await this.fold(leaderSessionId, signal)
    if (options?.messagesBefore === undefined) return fold.view
    const limit = resolvePageLimit(options)
    return sliceMessagePage(fold, fold.view.leaderSessionId as SessionId, options.messagesBefore, limit)
  }

  /**
   * Read one leader's current snapshot without pagination (the push payload shape).
   * @param leaderSessionId - the team session anchoring the fold (a leader, or
   *   a bound teammate whose leader is anchored instead).
   * @param signal - caller cancellation observed around every persistence read.
   * @returns the full snapshot.
   * @throws {@link TeamProjectionError} LEADER_UNKNOWN when neither store knows the session, or the
   *   session fails the team-ness gate (no team child, no team fact in its own log).
   */
  async get(leaderSessionId: SessionId, signal?: AbortSignal): Promise<TeamView> {
    return (await this.fold(leaderSessionId, signal)).view
  }

  /** Whether one candidate child row is a team child (continuable with the team label prefix). */
  private isTeamChild(entry: SubagentListEntry): entry is Extract<SubagentListEntry, { kind: 'child' }> & { mode: 'continuable' } {
    return entry.kind === 'child' && entry.mode === 'continuable'
      && entry.label.startsWith(TEAM_LABEL_PREFIX)
  }

  /** Read one session's log live-preferred, without resuming a cold session. */
  private async readSession(
    id: SessionId,
    persistence: SessionPersistence | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ header: SessionHeader; events: readonly SessionEvent[] } | undefined> {
    const live = this.ctx.get('sessions')?.get(id)
    if (live !== undefined) return { header: live.header, events: [...live.events] }
    if (persistence === undefined) return undefined
    try {
      const inspected = await persistence.inspect(id, signal)
      return { header: inspected.meta, events: inspected.events }
    } catch (error: unknown) {
      if (signal?.aborted) throw error
      // A vanished or unreadable log is indistinguishable from an unknown
      // session at this read point; the caller folds what it has.
      return undefined
    }
  }

  /** The enabled roster for one workspace, self-contained semantics included. */
  private async rosterFor(workspacePath: string | undefined, signal: AbortSignal | undefined): Promise<readonly TeamMemberDefinition[]> {
    const workspace = workspacePath ?? ''
    const noSignal = signal === undefined ? {} : { signal }
    const workspaceResults = workspace === ''
      ? []
      : await discoverTeamMembers({ homePath: '', workspacePath: workspace, ...noSignal })
    const results = workspaceResults.length > 0
      ? workspaceResults
      : await discoverTeamMembers({ homePath: resolveDshHome(), ...noSignal })
    const definitions = deduplicateDefinitions(results)
    return filterDisabledTeammates(definitions, this.enablement(), workspace)
  }

  /** Resolved team-enablement settings: the live section, the empty default otherwise. */
  private enablement(): TeamEnablementSettings {
    const settings = this.ctx.get('settings')
    if (settings === undefined) return {}
    const section = settings.get(TEAM_ENABLEMENT_SETTINGS_NAMESPACE) as TeamEnablementSettings | undefined
    return section ?? {}
  }

  /**
   * Team-ness gate over the durable observable facts: the roster entry alone
   * never qualifies (every workspace session sits under a roster), so the
   * session must own a `team:`-labeled continuable child in its subagent
   * directory or a team fact in its own log suffix — and a bound teammate
   * (own `team/member-bound`) anchors its leader.
   * @param requestedLog - the requested session's header and complete log.
   * @param requestedId - the session id the caller named.
   * @param requestedEntries - the requested session's directory listing (empty when the service is absent).
   * @returns the leader session the fold anchors on.
   * @throws {@link TeamProjectionError} LEADER_UNKNOWN when no criterion holds.
   */
  private resolveAnchor(
    requestedLog: { header: SessionHeader; events: readonly SessionEvent[] },
    requestedId: SessionId,
    requestedEntries: readonly SubagentListEntry[],
  ): SessionId {
    const hasTeamChild = requestedEntries.some(entry => this.isTeamChild(entry))
    const facts = scanTeamFacts(requestedLog.header, requestedLog.events)
    if (hasTeamChild || facts.fact) return facts.bound && !hasTeamChild ? ownerLeaderOf(requestedLog.header) : requestedId
    throw new TeamProjectionError(
      'LEADER_UNKNOWN',
      `session "${String(requestedId)}" is not a team session: no team child in its directory and no team fact in its own log`,
    )
  }

  /** The anchor's readable team children as fold corpus rows, in listing order. */
  private async collectChildren(
    entries: readonly SubagentListEntry[],
    persistence: SessionPersistence | undefined,
    signal: AbortSignal | undefined,
  ): Promise<TeamChildCorpus[]> {
    const children: TeamChildCorpus[] = []
    for (const entry of entries) {
      if (!this.isTeamChild(entry)) continue
      const childLog = await this.readSession(entry.id, persistence, signal)
      if (childLog !== undefined) children.push({ id: entry.id, header: childLog.header, events: childLog.events, label: entry.label })
    }
    return children
  }

  /**
   * Fold one team session's view: gate the requested session, anchor a bound
   * teammate on its leader, and fold the leader's corpus against the enabled
   * roster. A successful fold registers the anchor as an active leader for
   * the agent/status trigger.
   */
  private async fold(requestedId: SessionId, signal?: AbortSignal): Promise<TeamFold> {
    const sessions = this.ctx.get('sessions')
    const persistence = this.ctx.get('sessionPersistence')
    const subagents = this.ctx.get('subagents')
    if (sessions === undefined) {
      throw new TeamProjectionError('LEADER_UNKNOWN', 'the session store is not composed')
    }
    const requestedLog = await this.readSession(requestedId, persistence, signal)
    if (requestedLog === undefined) {
      throw new TeamProjectionError(
        'LEADER_UNKNOWN',
        `session "${String(requestedId)}" is neither live nor persisted`,
      )
    }
    const requestedEntries = subagents === undefined ? [] : await subagents.listChildren(requestedId, signal)
    const leaderSessionId = this.resolveAnchor(requestedLog, requestedId, requestedEntries)
    const leaderLog = leaderSessionId === requestedId
      ? requestedLog
      : await this.readSession(leaderSessionId, persistence, signal)
    if (leaderLog === undefined) {
      throw new TeamProjectionError(
        'LEADER_UNKNOWN',
        `leader session "${String(leaderSessionId)}" is neither live nor persisted`,
      )
    }
    const leaderEntries = leaderSessionId === requestedId
      ? requestedEntries
      : subagents === undefined ? [] : await subagents.listChildren(leaderSessionId, signal)
    const children = await this.collectChildren(leaderEntries, persistence, signal)
    const corpus: TeamCorpus = { leader: leaderLog, children }
    const roster = await this.rosterFor(leaderLog.header.cwd, signal)
    const agents = this.ctx.get('agents')
    const isRunning = (id: string): boolean => agents?.get(id as SessionId)?.status === 'running'
    const folded = foldTeamView(leaderSessionId, corpus, roster, isRunning)
    this.activeLeaders.add(leaderSessionId)
    return folded
  }

  /**
   * Rebuild one leader and publish the snapshot. Coalesced per leader: callers
   * inside one committing tick share a single rebuild (the fold defers one
   * microtask so every event of that tick is in the log before it reads), and
   * the publish happens exactly once after the fold settles.
   */
  private async rebuild(leaderSessionId: SessionId): Promise<void> {
    const existing = this.pending.get(leaderSessionId)
    if (existing !== undefined) return existing
    const task = (async () => {
      try {
        await Promise.resolve()
        const { view } = await this.fold(leaderSessionId)
        for (const listener of this.listeners) listener(leaderSessionId, view)
      } catch {
        // An unknown session, a session that fails the team-ness gate (the
        // common non-team session), or an unreadable corpus simply has nothing
        // to publish; the fold stays available to callers that name a team.
      } finally {
        this.pending.delete(leaderSessionId)
      }
    })()
    this.pending.set(leaderSessionId, task)
    return task
  }
}
