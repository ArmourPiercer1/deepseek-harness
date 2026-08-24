/**
 * Pure fold from one leader's session corpus plus the enabled roster to the
 * {@link TeamView} snapshot. Deterministic by construction: input order is the
 * only order — no wall clock, no random ids, no environment reads — so folding
 * the same logs twice yields deeply equal views (the replay guarantee).
 *
 * @module @deepseek-ai/dsh-team-projection
 */

import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team/types'
import { TeamProjectionError } from './error.ts'
import type { MessageAnchor, TeamApprovalView, TeamDelegationView, TeamMemberView, TeamMessagePage, TeamMessageView, TeamTaskView, TeamView } from './types.ts'

/**
 * Messages carried by one team snapshot or message page. The wire layer states
 * its own bound (`dsh-host-apiproxy/api/team.schema.ts`); the two constants
 * must stay equal — the schema's closed range enforces the same number.
 */
export const MESSAGE_CAP = 500

/** Creation-label prefix the delegate tool stamps on every teammate child session. */
export const TEAM_LABEL_PREFIX = 'team:'

/** Tool name whose leader-log calls record one delegation span. */
const DELEGATE_TOOL = 'delegate_to_teammate'

/** Fallback member id for the leader row when the roster defines no leader. */
const LEADER_FALLBACK_ID = 'leader'

/** One candidate team child's complete log plus its durable creation label. */
export interface TeamChildCorpus {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly label: string
}

/** The leader log plus every team-labeled continuable child log. */
export interface TeamCorpus {
  readonly leader: { readonly header: SessionHeader; readonly events: readonly SessionEvent[] }
  readonly children: readonly TeamChildCorpus[]
}

/** Fold output: the capped view plus the complete ordered message list pages slice from. */
export interface TeamFold {
  readonly view: TeamView
  readonly allMessages: readonly TeamMessageView[]
}

/** Live-activity probe over the agent registry. */
export type RunningProbe = (sessionId: string) => boolean

/**
 * Read the delegation target from one delegate call's raw arguments (model
 * JSON string, a wire boundary); tolerant of malformed model output.
 * @param argumentsRaw - raw arguments string of the tool/call event.
 * @returns the teammate_id argument, or undefined when absent, unparseable, or not a string.
 */
function delegatedMemberId(argumentsRaw: string): string | undefined {
  let args: unknown
  try {
    args = JSON.parse(argumentsRaw)
  } catch {
    // Malformed model JSON: the call simply carries no delegation fact.
    return undefined
  }
  if (typeof args !== 'object' || args === null) return undefined
  const teammateId = (args as Record<string, unknown>)['teammate_id']
  return typeof teammateId === 'string' && teammateId !== '' ? teammateId : undefined
}

/** Source fields of a `subagent-settled` user message, read structurally off the merge-extensible source. */
function settledSender(data: unknown): SessionId | undefined {
  const source = (data as { source?: { kind?: unknown; senderSessionId?: unknown } }).source
  if (source === undefined || source.kind !== 'subagent-settled') return undefined
  const sender = source.senderSessionId
  return typeof sender === 'string' && sender !== '' ? sender as SessionId : undefined
}

/** Compare two globally ordered messages: at, then recording session id, then seq. */
function compareMessages(a: TeamMessageView, b: TeamMessageView): number {
  return a.at - b.at || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0) || a.seq - b.seq
}

/** Events at or past the durable seed boundary: the child's own work, never the forked ancestor log. */
function ownSuffix(header: SessionHeader, events: readonly SessionEvent[]): readonly SessionEvent[] {
  const seedLength = header.seedLength ?? 0
  return seedLength === 0 ? events : events.filter(event => event.seq >= seedLength)
}

/** Team event families whose occurrence in one own log suffix marks a team fact. */
const TEAM_FACT_TYPES = new Set(['team/progress', 'team/control-decision', 'team/message', 'team/control-request'])

/** Team-ness gate facts scanned from one session's own log suffix. */
export interface TeamFacts {
  /**
   * A team fact: one of the families above, a `delegate_to_teammate` call, or
   * a `team/member-bound` (the bound-teammate mark).
   */
  readonly fact: boolean
  /** A `team/member-bound` in the own suffix: the session is a bound teammate. */
  readonly bound: boolean
}

/**
 * Scan one session's own suffix for the team-ness gate facts. Facts below the
 * durable seed boundary (forked ancestor log) never count.
 * @param header - the session header carrying the seed boundary.
 * @param events - the session's complete log.
 * @returns the gate facts observed in the own suffix.
 */
export function scanTeamFacts(header: SessionHeader, events: readonly SessionEvent[]): TeamFacts {
  let fact = false
  let bound = false
  for (const event of ownSuffix(header, events)) {
    if (event.type === 'tool/call') {
      if (event.data.name === DELEGATE_TOOL) fact = true
    } else if (event.type === 'team/member-bound') {
      bound = true
      fact = true
    } else if (TEAM_FACT_TYPES.has(event.type)) {
      fact = true
    }
    if (fact && bound) break
  }
  return { fact, bound }
}

/**
 * Fold one leader's team view.
 * @param leaderSessionId - the leader session anchoring the fold.
 * @param corpus - the leader log and the team children logs (children in listing order).
 * @param roster - the enabled roster (already deduplicated and enablement-filtered).
 * @param isRunning - live agent-status probe for the running overlay.
 * @returns the capped view plus the complete ordered message list.
 */
export function foldTeamView(
  leaderSessionId: SessionId,
  corpus: TeamCorpus,
  roster: readonly TeamMemberDefinition[],
  isRunning: RunningProbe,
): TeamFold {
  const leaderId = String(leaderSessionId)
  /** memberId -> bound session ids in binding order. */
  const memberSessions = new Map<string, SessionId[]>()
  /** session id -> memberId (last binding wins). */
  const bindingOf = new Map<SessionId, string>()
  /** memberId -> role carried by the binding event. */
  const boundRoles = new Map<string, 'leader' | 'teammate'>()
  /** Latest tool/call name per session own-suffix (the currentAction source). */
  const lastToolName = new Map<SessionId, string>()
  /** Sessions the leader log settled via a subagent-settled notice. */
  const settledSessions = new Set<SessionId>()
  const approvals: TeamApprovalView[] = []
  const messages: TeamMessageView[] = []
  /** requestId -> decision fields from the leader log. */
  const decisions = new Map<string, NonNullable<TeamApprovalView['decision']>>()

  // Child pass first: the leader pass pairs settlement senders through the
  // bindings collected here.
  for (const child of corpus.children) {
    for (const event of ownSuffix(child.header, child.events)) {
      switch (event.type) {
        case 'team/member-bound': {
          const memberId = String(event.data.memberId)
          const previous = bindingOf.get(child.id)
          if (previous !== undefined) {
            // The earlier bind for `previous` recorded this session in the
            // same fold (both writes are in this case block), so the lookup
            // cannot miss; filter removes the id wherever it sits.
            // oxlint-disable-next-line typescript/no-non-null-assertion
            memberSessions.set(previous, memberSessions.get(previous)!.filter(id => id !== child.id))
          }
          bindingOf.set(child.id, memberId)
          const sessions = memberSessions.get(memberId)
          // A consecutive rebind to the same member always re-pushes: the
          // guard above already removed this session from that member's list.
          if (sessions === undefined) memberSessions.set(memberId, [child.id])
          else sessions.push(child.id)
          boundRoles.set(memberId, event.data.role)
          break
        }
        case 'team/control-request': {
          approvals.push({
            requestId: event.data.requestId,
            memberId: String(event.data.memberId),
            toolName: event.data.toolName,
            reason: event.data.reason,
            ...event.data.kind !== undefined ? { kind: event.data.kind } : {},
            requestedAt: event.time,
          })
          break
        }
        case 'team/message': {
          messages.push({
            from: String(event.data.from),
            to: String(event.data.to),
            message: event.data.message,
            at: event.time,
            seq: event.seq,
            sessionId: String(child.id),
          })
          break
        }
        case 'tool/call': {
          lastToolName.set(child.id, event.data.name)
          break
        }
        default:
          break
      }
    }
  }

  /** Delegation spans in open order; closed spans keep their position. */
  const spans: { memberId: string; startedAt: number; endedAt?: number; childSessionId?: string }[] = []
  /** memberId -> still-open span indices in open order (FIFO pairing). */
  const openSpans = new Map<string, number[]>()
  const tasks = new Map<string, TeamTaskView>()

  for (const event of ownSuffix(corpus.leader.header, corpus.leader.events)) {
    switch (event.type) {
      case 'team/progress': {
        tasks.set(event.data.taskId, {
          taskId: event.data.taskId,
          subject: event.data.subject,
          status: event.data.status,
          ...event.data.summary !== undefined ? { summary: event.data.summary } : {},
          memberId: String(event.data.memberId),
          seq: event.seq,
          at: event.time,
        })
        break
      }
      case 'tool/call': {
        lastToolName.set(leaderSessionId, event.data.name)
        if (event.data.name === DELEGATE_TOOL) {
          const memberId = delegatedMemberId(event.data.arguments)
          if (memberId !== undefined) {
            spans.push({ memberId, startedAt: event.time })
            const open = openSpans.get(memberId)
            if (open === undefined) openSpans.set(memberId, [spans.length - 1])
            else open.push(spans.length - 1)
          }
        }
        break
      }
      case 'user/message': {
        const sender = settledSender(event.data)
        if (sender !== undefined) {
          const memberId = bindingOf.get(sender)
          if (memberId !== undefined) {
            const next = openSpans.get(memberId)?.shift()
            // The length guard proves one span exists at every queued index.
            // oxlint-disable-next-line typescript/no-non-null-assertion
            if (next !== undefined) spans[next] = { ...spans[next]!, endedAt: event.time, childSessionId: String(sender) }
          }
          settledSessions.add(sender)
        }
        break
      }
      case 'team/message': {
        messages.push({
          from: String(event.data.from),
          to: String(event.data.to),
          message: event.data.message,
          at: event.time,
          seq: event.seq,
          sessionId: leaderId,
        })
        break
      }
      case 'team/control-decision': {
        decisions.set(event.data.requestId, {
          value: event.data.decision,
          ...event.data.reason !== undefined ? { reason: event.data.reason } : {},
          decidedAt: event.time,
        })
        break
      }
      default:
        break
    }
  }

  const resolvedApprovals = approvals.map((approval) => {
    const decision = decisions.get(approval.requestId)
    return decision === undefined ? approval : { ...approval, decision }
  })
  const pendingByMember = new Map<string, number>()
  for (const approval of resolvedApprovals) {
    if (approval.decision !== undefined) continue
    pendingByMember.set(approval.memberId, (pendingByMember.get(approval.memberId) ?? 0) + 1)
  }

  /** One member's log-derived row over its bound sessions. */
  const boundRow = (memberId: string, rosterName: string | undefined, role: 'leader' | 'teammate', fallbackLabel: string): TeamMemberView => {
    const sessions = memberSessions.get(memberId) ?? []
    const latest = sessions.at(-1)
    const name = rosterName ?? (fallbackLabel.startsWith(TEAM_LABEL_PREFIX) ? fallbackLabel.slice(TEAM_LABEL_PREFIX.length) : fallbackLabel)
    const action = latest === undefined ? undefined : lastToolName.get(latest)
    return {
      memberId,
      name,
      role,
      sessionIds: sessions.map(String),
      status: sessions.some(session => isRunning(String(session)))
        ? 'running'
        : latest !== undefined && settledSessions.has(latest) ? 'settled' : sessions.length > 0 ? 'bound' : 'unbound',
      ...action !== undefined ? { currentAction: action } : {},
      pendingControlCount: pendingByMember.get(memberId) ?? 0,
    }
  }

  const rosterIds = new Set(roster.map(definition => String(definition.id)))
  const rosterLeader = roster.find(definition => definition.role === 'leader')
  const leaderAction = lastToolName.get(leaderSessionId)
  const leaderMemberId = String(rosterLeader?.id ?? LEADER_FALLBACK_ID)
  const members: TeamMemberView[] = [{
    memberId: leaderMemberId,
    name: rosterLeader?.name ?? LEADER_FALLBACK_ID,
    role: 'leader',
    sessionIds: [leaderId],
    status: isRunning(leaderId) ? 'running' : 'bound',
    ...leaderAction !== undefined ? { currentAction: leaderAction } : {},
    pendingControlCount: pendingByMember.get(leaderMemberId) ?? 0,
  }]
  for (const definition of roster) {
    if (definition.role === 'leader') continue
    members.push(boundRow(String(definition.id), definition.name, 'teammate', String(definition.id)))
  }
  const labelByMember = new Map<string, string>()
  for (const child of corpus.children) {
    const memberId = bindingOf.get(child.id)
    if (memberId !== undefined && !labelByMember.has(memberId)) labelByMember.set(memberId, child.label)
  }
  const boundOnly = [...memberSessions.keys()].filter(memberId => !rosterIds.has(memberId)).sort()
  for (const memberId of boundOnly) {
    // Every bound member's binding event carried its role in this same fold.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    members.push(boundRow(memberId, undefined, boundRoles.get(memberId)!, labelByMember.get(memberId) ?? memberId))
  }

  const delegations: TeamDelegationView[] = spans.map(span => span.endedAt !== undefined
    ? {
      memberId: span.memberId,
      // The close statement sets childSessionId together with endedAt.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      childSessionId: span.childSessionId!,
      startedAt: span.startedAt,
      endedAt: span.endedAt,
      inProgress: false,
    }
    : {
      memberId: span.memberId,
      childSessionId: String(memberSessions.get(span.memberId)?.at(-1) ?? ''),
      startedAt: span.startedAt,
      inProgress: true,
    })

  const allMessages = [...messages].sort(compareMessages)
  const view: TeamView = {
    teamId: leaderId,
    leaderSessionId: leaderId,
    rosterMemberCount: roster.length,
    members,
    delegations,
    tasks: [...tasks.values()],
    approvals: resolvedApprovals,
    messages: allMessages.slice(-MESSAGE_CAP),
    messageCount: allMessages.length,
  }
  return { view, allMessages }
}

/**
 * Validate pagination options and resolve the effective limit.
 * @param options - caller-supplied pagination options.
 * @returns the effective limit (MESSAGE_CAP when unset).
 * @throws {@link TeamProjectionError} INVALID_LIMIT when limit is outside [1, MESSAGE_CAP].
 */
export function resolvePageLimit(options: { limit?: number }): number {
  const limit = options.limit ?? MESSAGE_CAP
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MESSAGE_CAP) {
    throw new TeamProjectionError(
      'INVALID_LIMIT',
      `message page limit must be an integer in [1, ${MESSAGE_CAP}], got ${String(options.limit)}`,
    )
  }
  return limit
}

/**
 * Slice one older-messages page strictly earlier than the anchor.
 * @param fold - the fold whose message list the page slices.
 * @param leaderSessionId - the leader session (echoed on the page).
 * @param anchor - names one folded message; the page is strictly earlier in the global order.
 * @param limit - effective page length (already validated by {@link resolvePageLimit}).
 * @returns the ascending page with the same messageCount basis as the snapshot.
 * @throws {@link TeamProjectionError} ANCHOR_UNKNOWN when the anchor names no folded message.
 */
export function sliceMessagePage(
  fold: TeamFold,
  leaderSessionId: SessionId,
  anchor: MessageAnchor,
  limit: number,
): TeamMessagePage {
  const index = fold.allMessages.findIndex(message =>
    message.at === anchor.at && message.sessionId === anchor.sessionId && message.seq === anchor.seq)
  if (index === -1) {
    throw new TeamProjectionError(
      'ANCHOR_UNKNOWN',
      'messagesBefore anchor names no message of this team fold',
    )
  }
  const start = Math.max(0, index - limit)
  return {
    kind: 'message-page',
    teamId: String(leaderSessionId),
    leaderSessionId: String(leaderSessionId),
    messages: fold.allMessages.slice(start, index),
    messageCount: fold.allMessages.length,
  }
}
