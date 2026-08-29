/**
 * Team projection Remote face: one unary `team/projection` endpoint serving
 * full `TeamView` snapshots and older-message pages over the shared wire.
 *
 * @module @deepseek-ai/dsh-api-session-controller
 */

import { Context } from '@deepseek-ai/cordis'
import { TeamProjectionError } from '@deepseek-ai/dsh-team-projection'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TeamProjectionRequest, TeamProjectionValue } from './types.ts'

/**
 * Publishes the read-only team projection as the `team/projection` Remote.
 * Deployments without the team-projection service answer `team-unavailable`;
 * every fold rejection maps to a stable wire code, and abort settles as
 * `cancelled` like every other Remote call.
 */
export class SessionTeamController extends TypertRemoteService {
  /** The Typert registry must be live before this face can publish. */
  static inject = ['typert']

  /**
   * @param ctx - Host context containing the Session capability assembly.
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionTeamController', { namespace: 'team' })
  }

  /**
   * Fold one team leader's projection.
   * @param request - snapshot request, or a page request anchored before one message.
   * @param signal - caller lifetime; abort settles the call as cancelled.
   * @returns the full team snapshot, or the older-message page when `messagesBefore` was set.
   * @throws TypertRemoteFailure with code `team-unavailable`, `team-leader-unknown`,
   *   `team-anchor-unknown`, `bad-request` (page limit out of range), `cancelled`,
   *   or `internal`.
   */
  @Remote('projection')
  async projection(
    request: TeamProjectionRequest,
    signal: AbortSignal,
  ): Promise<TeamProjectionValue> {
    const teamProjection = this.ctx.get('teamProjection')
    if (teamProjection === undefined) {
      throw new TypertRemoteFailure({
        code: 'team-unavailable',
        message: 'the team projection service is not installed',
        details: {},
      })
    }
    signal.throwIfAborted()
    try {
      return await teamProjection.project(
        request.leaderSessionId,
        signal,
        'messagesBefore' in request
          ? request.limit === undefined
            ? { messagesBefore: request.messagesBefore }
            : { messagesBefore: request.messagesBefore, limit: request.limit }
          : undefined,
      )
    } catch (error: unknown) {
      if (signal.aborted) {
        throw new TypertRemoteFailure({
          code: 'cancelled',
          message: 'team projection was aborted',
          details: {},
        })
      }
      if (error instanceof TeamProjectionError) {
        switch (error.code) {
          case 'LEADER_UNKNOWN':
            throw new TypertRemoteFailure({
              code: 'team-leader-unknown',
              message: error.message,
              details: { leaderSessionId: request.leaderSessionId },
            })
          case 'ANCHOR_UNKNOWN':
            throw new TypertRemoteFailure({
              code: 'team-anchor-unknown',
              message: error.message,
              details: { leaderSessionId: request.leaderSessionId },
            })
          case 'INVALID_LIMIT':
            throw new TypertRemoteFailure({
              code: 'bad-request',
              message: error.message,
              details: { leaderSessionId: request.leaderSessionId },
            })
        }
      }
      throw new TypertRemoteFailure({
        code: 'internal',
        message: `team projection failed: ${error instanceof Error ? error.message : String(error)}`,
        details: {},
      })
    }
  }
}
