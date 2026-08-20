/**
 * Team panel Conversation Node definition: one keyed Chat node per session
 * folding the durable team events of the leader's log.
 *
 * The event family is checkpoint-based: every `team/progress` event carries
 * the task's complete current value, and no separate start event exists. The
 * definition therefore never emits a start role; `buildViewNode` folds the
 * Context's own matches into the renderer payload (the compaction fallback
 * pattern). `start` and `update` still implement the contract: if the engine
 * ever invokes them, they fold the same matches into the same value.
 */
import type {
  ChatConversationViewNode, ConversationMatch, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the team SessionEventMap merge (team/progress) and payload types.
import type { TeamProgressStatus } from '@deepseek-ai/dsh-team'

/** Stable Context id shared by every panel event: one board per session. */
const BOARD_ID = 'board'

/** Label prefix the delegate tool mints on every teammate child session. */
export const TEAM_LABEL_PREFIX = 'team:'

/** Tool name whose calls record a delegation for one teammate id. */
const DELEGATE_TOOL = 'delegate_to_teammate'

/** Final renderer data for one progress task (latest `team/progress` fold per taskId). */
export interface TeamTaskItem {
  /** Stable task identity from the event payload. */
  readonly taskId: string
  /** Short task subject from the latest event. */
  readonly subject: string
  /** Task status from the latest event. */
  readonly status: TeamProgressStatus
  /** Optional progress or blocker summary from the latest event carrying one. */
  readonly summary?: string
  /** Member the task is assigned to (brand stripped: renderer data stays plain). */
  readonly memberId: string
  /** Log seq of the newest event that set this entry. */
  readonly seq: number
}

/** Final keyed Chat payload for the team panel node. */
export interface TeamPanelChatData {
  /** Tasks in first-seen order, latest event per taskId. */
  readonly tasks: readonly TeamTaskItem[]
  /** Sorted, de-duplicated delegate_to_teammate targets seen in the window. */
  readonly delegated: readonly string[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Durable team panel: the task progress board plus in-window delegations. */
    'team-panel': TeamPanelChatData
  }
}

interface TeamBoardState {
  readonly tasks: readonly TeamTaskItem[]
  readonly delegated: readonly string[]
}

/**
 * Read the delegation target from one delegate_to_teammate call's raw
 * arguments (model JSON string, a wire boundary).
 * @param argumentsRaw - raw arguments string of the tool/call event.
 * @returns the teammate_id argument, or undefined when absent, unparseable, or not a string.
 */
function delegatedMemberId(argumentsRaw: string): string | undefined {
  let args: unknown
  try {
    args = JSON.parse(argumentsRaw)
  } catch {
    // Malformed model JSON: the schema requires an object, but the raw string is model
    // output, so an unparseable call simply carries no delegation fact.
    return undefined
  }
  if (typeof args !== 'object' || args === null) return undefined
  const teammateId = (args as Record<string, unknown>)['teammate_id']
  return typeof teammateId === 'string' && teammateId !== '' ? teammateId : undefined
}

/**
 * Fold one Context's matches into the board payload: latest event per taskId
 * in first-seen order, plus the sorted de-duplicated delegation targets.
 * @param matches - the Context's matches in ascending log seq order.
 * @returns the folded board payload.
 */
export function foldTeamBoard(matches: readonly ConversationMatch[]): TeamBoardState {
  const tasks = new Map<string, TeamTaskItem>()
  const delegated = new Set<string>()
  for (const match of matches) {
    const event = match.event
    if (event.type === 'team/progress') {
      tasks.set(event.data.taskId, {
        taskId: event.data.taskId,
        subject: event.data.subject,
        status: event.data.status,
        ...(event.data.summary !== undefined ? { summary: event.data.summary } : {}),
        memberId: String(event.data.memberId),
        seq: event.seq,
      })
    } else if (event.type === 'tool/call' && event.data.name === DELEGATE_TOOL) {
      const memberId = delegatedMemberId(event.data.arguments)
      if (memberId !== undefined) delegated.add(memberId)
    }
  }
  return { tasks: [...tasks.values()], delegated: [...delegated].sort() }
}

/**
 * Durable team panel definition over `team/progress` events and
 * delegate_to_teammate tool calls of the current (leader) session.
 */
export const teamPanelDefinition: ConversationNodeDefinition<TeamBoardState> = {
  kind: 'team-panel',
  target: 'chat',
  match: (event) => {
    if (event.type === 'team/progress') return { id: BOARD_ID, role: 'update' }
    if (event.type === 'tool/call' && event.data.name === DELEGATE_TOOL) {
      return { id: BOARD_ID, role: 'update' }
    }
    return null
  },
  start: context => foldTeamBoard(context.matches),
  update: context => foldTeamBoard(context.matches),
  buildViewNode: (context): ChatConversationViewNode | null => {
    const data = foldTeamBoard(context.matches)
    const first = context.matches[0]
    if (first === undefined || (data.tasks.length === 0 && data.delegated.length === 0)) return null
    return {
      key: context.key,
      kind: 'team-panel',
      id: context.id,
      target: 'chat',
      anchorSeq: first.event.seq,
      location: first.location,
      visibility: 'visible',
      data,
    }
  },
}
