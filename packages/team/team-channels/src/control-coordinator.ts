/**
 * Team control coordinator.
 *
 * Manages the lifecycle of teammate → leader approval requests.
 * A teammate calls a restricted tool, the coordinator creates a pending
 * request, and the leader decides via the `team_control` tool.
 *
 * @module @deepseek-ai/dsh-team-channels
 */

import type { TeamControlDecision } from '@deepseek-ai/dsh-team'
import type { TeamControlRequestData } from '@deepseek-ai/dsh-team'

/** A pending control request awaiting the leader's decision. */
export interface PendingControlRequest {
  /** The request data. */
  readonly data: TeamControlRequestData
  /** Resolve the settlement promise. */
  readonly resolve: (decision: TeamControlDecision) => void
  /** When this request was created (epoch ms). */
  readonly createdAt: number
}

/**
 * Manages teammate → leader approval requests.
 *
 * Flow:
 * 1. Teammate calls a restricted tool
 * 2. `tools/pre-execute` listener creates a control request
 * 3. Request is logged as `team/control-request` session event
 * 4. Leader receives the request via settled notice or message
 * 5. Leader calls `team_control` tool with decision
 * 6. Decision is logged as `team/control-decision` session event
 * 7. Original `tools/pre-execute` Promise resolves → tool proceeds or is denied
 */
export class TeamControlCoordinator {
  private readonly pending = new Map<string, PendingControlRequest>()

  /**
   * Create a pending request and return its settlement promise.
   *
   * @param data - the control request data.
   * @returns a promise that resolves with the leader's decision.
   */
  createRequest(data: TeamControlRequestData): Promise<TeamControlDecision> {
    return new Promise<TeamControlDecision>(resolve => {
      this.pending.set(data.requestId, {
        data,
        resolve,
        createdAt: Date.now(),
      })
    })
  }

  /**
   * Settle a pending request with the leader's decision.
   *
   * @param requestId - the request to settle.
   * @param decision - the leader's decision.
   * @throws when the request id is unknown.
   */
  decide(requestId: string, decision: TeamControlDecision): void {
    const request = this.pending.get(requestId)
    if (!request) {
      throw new Error(`Unknown control request: "${requestId}"`)
    }
    this.pending.delete(requestId)
    request.resolve(decision)
  }

  /** List all pending requests. */
  listPending(): readonly PendingControlRequest[] {
    return [...this.pending.values()]
  }

  /**
   * Time out and auto-deny expired requests.
   *
   * @param now - current epoch ms.
   * @param timeoutMs - maximum age in ms.
   */
  sweep(now: number, timeoutMs: number): void {
    for (const [id, request] of this.pending) {
      if (now - request.createdAt >= timeoutMs) {
        this.pending.delete(id)
        request.resolve('deny')
      }
    }
  }

  /** Dispose all pending requests (auto-deny). */
  dispose(): void {
    for (const [id, request] of this.pending) {
      this.pending.delete(id)
      request.resolve('deny')
    }
  }
}
