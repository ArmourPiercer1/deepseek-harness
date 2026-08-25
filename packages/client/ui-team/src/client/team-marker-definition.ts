/**
 * Team marker Conversation Node definition (D14/D15): one compact single-line
 * Chat node per durable team event of the session log — task progress
 * (`team/progress`), control request (`team/control-request`), control
 * decision (`team/control-decision`), and member message (`team/message`).
 *
 * Every event owns its Context: the Definition-local id embeds the event's
 * stable business identity (the task id for progress, the request id for the
 * approval pair) plus the event's log seq, so one event is one row and every
 * state change adds a row (D15: the flow is the reproducible team ledger).
 * Request and decision keep distinct id prefixes around the same request id,
 * so the two rows pair at the render layer from their own data, never from a
 * fold. The message payload carries no id of its own, so its id is derived
 * from the log seq alone.
 *
 * Single-event Contexts: `start` builds the state from its match, and
 * `update` re-derives the same state from its match (idempotent — a second
 * event cannot land under a unique id, and replaying the same event is
 * byte-identical). No hot-path window scan: the State carries the whole row.
 */
import type {
  ChatConversationViewNode, ConversationNodeDefinition, ConversationEventInput,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the team SessionEventMap merge (all four event types) and
// the payload types into this program.
import type {
  TeamControlDecision, TeamProgressStatus,
} from '@deepseek-ai/dsh-team'

/** Definition kind, slot registration key, and Chat node kind in one name. */
export const TEAM_MARKER_KIND = 'team-marker'

/** One durable team event's row data (the keyed Chat payload). */
export type TeamMarkerChatData =
  | TeamMarkerProgressData
  | TeamMarkerRequestData
  | TeamMarkerControlDecisionData
  | TeamMarkerMessageData

interface TeamMarkerDataBase {
  /** The event's log seq (the row's flow order key). */
  readonly seq: number
  /** The event's durable time (epoch ms; the row's clock label). */
  readonly at: number
}

/** One `team/progress` row: the task subject plus its status. */
export interface TeamMarkerProgressData extends TeamMarkerDataBase {
  readonly type: 'progress'
  /** Stable task identity from the event payload. */
  readonly taskId: string
  /** Short task subject. */
  readonly subject: string
  /** Task status at the event. */
  readonly status: TeamProgressStatus
  /** Progress or blocker summary, when the event carried one. */
  readonly summary?: string
  /** Assigned member id (brand stripped: renderer data stays plain). */
  readonly memberId: string
}

/** One `team/control-request` row: the waiting approval request. */
export interface TeamMarkerRequestData extends TeamMarkerDataBase {
  readonly type: 'request'
  /** The request id (the render-layer pairing key with its decision row). */
  readonly requestId: string
  /** Requesting member id (brand stripped). */
  readonly memberId: string
  /** The tool the teammate wants to execute. */
  readonly toolName: string
  /** The request's reason. */
  readonly reason: string
  /** Request kind: tool execution or plan approval. */
  readonly requestKind: 'tool' | 'plan'
}

/** One `team/control-decision` row: the five-value result plus its reason. */
export interface TeamMarkerControlDecisionData extends TeamMarkerDataBase {
  readonly type: 'decision'
  /** The decided request id (the render-layer pairing key with its request row). */
  readonly requestId: string
  /** The leader's decision. */
  readonly decision: TeamControlDecision
  /** The decision's reason, when one was carried. */
  readonly reason?: string
}

/** One `team/message` row: the sender, the recipient, and the content. */
export interface TeamMarkerMessageData extends TeamMarkerDataBase {
  readonly type: 'message'
  /** Sender member id (brand stripped). */
  readonly from: string
  /** Recipient member id (brand stripped). */
  readonly to: string
  /** Message content. */
  readonly message: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** One compact inline marker row: a single durable team event. */
    'team-marker': TeamMarkerChatData
  }
}

/**
 * Build one marker row's Definition-local id: the business identity the
 * event anchors on, plus the event's log seq so every event is its own
 * Context (D15 per-event rows) while the business id stays addressable in
 * the id for the render layer's pairing.
 * @param event - a matched team event (one of the four marker types).
 * @returns the unique stable id.
 * @throws when the event is not one of the four marker types — the caller
 *   (`match`) narrows before calling, so a throw names a definition bug.
 */
export function teamMarkerId(event: ConversationEventInput['event']): string {
  switch (event.type) {
    case 'team/progress':
      return `progress:${event.data.taskId}:${event.seq}`
    case 'team/control-request':
      return `request:${event.data.requestId}:${event.seq}`
    case 'team/control-decision':
      return `decision:${event.data.requestId}:${event.seq}`
    case 'team/message':
      return `message:${event.seq}`
    default:
      // match() is the only caller and narrows to the four marker types; a
      // divergence here is a definition bug, not an input state.
      throw new Error(`team-marker: unmatched event type "${event.type}"`)
  }
}

/**
 * Fold one matched team event into the row state. The only entry point that
 * reads a raw event payload; `start` and `update` both delegate here, so
 * replaying the same event always yields the same state.
 * @param event - a matched team event (one of the four marker types).
 * @returns the row state for the event.
 */
export function teamMarkerData(event: ConversationEventInput['event']): TeamMarkerChatData {
  switch (event.type) {
    case 'team/progress': {
      const data = event.data
      return {
        type: 'progress',
        seq: event.seq,
        at: event.time,
        taskId: data.taskId,
        subject: data.subject,
        status: data.status,
        ...(data.summary !== undefined ? { summary: data.summary } : {}),
        memberId: String(data.memberId),
      }
    }
    case 'team/control-request': {
      const data = event.data
      return {
        type: 'request',
        seq: event.seq,
        at: event.time,
        requestId: data.requestId,
        memberId: String(data.memberId),
        toolName: data.toolName,
        reason: data.reason,
        requestKind: data.kind ?? 'tool',
      }
    }
    case 'team/control-decision': {
      const data = event.data
      return {
        type: 'decision',
        seq: event.seq,
        at: event.time,
        requestId: data.requestId,
        decision: data.decision,
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
      }
    }
    case 'team/message': {
      const data = event.data
      return {
        type: 'message',
        seq: event.seq,
        at: event.time,
        from: String(data.from),
        to: String(data.to),
        message: data.message,
      }
    }
    default:
      // match() and this fold share the four-type switch; a divergence here
      // is a definition bug, not an input state.
      throw new Error(`team-marker: unmatched event type "${event.type}"`)
  }
}

/**
 * Inline team marker definition over the four durable team event types of
 * the current session: each event renders as one compact single-line row at
 * its own log position (D14/D15).
 */
export const teamMarkerDefinition: ConversationNodeDefinition<TeamMarkerChatData> = {
  kind: TEAM_MARKER_KIND,
  target: 'chat',
  match: (event) => {
    if (event.type === 'team/progress'
      || event.type === 'team/control-request'
      || event.type === 'team/control-decision'
      || event.type === 'team/message') {
      return { id: teamMarkerId(event), role: 'start' }
    }
    return null
  },
  start: (_context, match) => teamMarkerData(match.event),
  update: (_context, match) => teamMarkerData(match.event),
  buildViewNode: (context): ChatConversationViewNode | null => {
    const data = context.state
    const start = context.start
    if (data === undefined || start === undefined) return null
    return {
      key: context.key,
      kind: TEAM_MARKER_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: start.event.seq,
      location: start.location,
      visibility: 'visible',
      data,
    }
  },
}
