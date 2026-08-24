/**
 * Browser-safe team domain contract. One leader-keyed projection snapshot or
 * one older-messages page per call; the host's change feed carries the same
 * snapshot shape (see the `session/team` mux frame).
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MessageAnchor, TeamMessagePage, TeamView } from '@deepseek-ai/dsh-team-projection/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** team.projection request: either a full snapshot or an older-messages page. */
export type TeamProjectionRequest =
  | { leaderSessionId: SessionId }
  | { leaderSessionId: SessionId; messagesBefore: MessageAnchor; limit?: number }

/** team.projection response: discriminated by `kind` when a page was requested. */
export type TeamProjectionValue = TeamView | TeamMessagePage

/** Team-domain unary methods. */
export interface TeamApi {
  /**
   * Reads one leader's team projection without loading or activating any
   * Agent: a cold leader is served from persistence. The requested session
   * must pass the team-ness gate — a `team:`-labeled continuable child, a
   * team fact in its own log, or a bound teammate (whose leader is anchored)
   * — otherwise the call is a loud `team-leader-unknown`, never an empty
   * view. Without `messagesBefore` the value is the full snapshot; with it,
   * the value is the message page strictly earlier than the anchor (the
   * anchor must name a folded message, `limit` must be an integer in
   * `[1, MESSAGE_CAP]`).
   */
  projection(
    request: RpcRequest<TeamProjectionRequest>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<TeamProjectionValue>>
}
