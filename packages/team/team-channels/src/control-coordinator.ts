/**
 * Host-level team control registry.
 *
 * Manages the lifecycle of teammate → leader approval requests, keyed by the
 * leader's session id so a leader and its teammates rendezvous on one registry
 * regardless of which scope created the request. A teammate calls a
 * `requiresApproval` tool, the coordinator creates a pending request, and the
 * leader decides via the `team_control` tool.
 *
 * @module @deepseek-ai/dsh-team-channels
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { TeamControlDecision } from '@deepseek-ai/dsh-team'
import type { TeamControlRequestData } from '@deepseek-ai/dsh-team'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-level registry of pending teammate control requests. */
    teamControl: TeamControlRegistry
  }
}

/** A pending control request awaiting the leader's decision. */
interface PendingControlRequest {
  /** The request data. */
  readonly data: TeamControlRequestData
  /** Resolve the settlement promise. */
  readonly resolve: (decision: TeamControlDecision) => void
  /** When this request was created (epoch ms). */
  readonly createdAt: number
}

/**
 * Host-level registry of pending control requests, keyed by leader session id.
 *
 * Flow:
 * 1. Teammate calls a `requiresApproval` tool
 * 2. The teammate's `tools/pre-execute` listener calls `create`
 * 3. Request is logged as `team/control-request` session event
 * 4. Leader receives the request via `reportFrom` wakeup
 * 5. Leader calls `team_control` tool with decision
 * 6. Decision is logged as `team/control-decision` session event
 * 7. The suspended `tools/pre-execute` Promise resolves → tool proceeds or is denied
 *
 * Orphaned pending requests — whose suspended execution has already been torn
 * down — are auto-denied through three settlement paths: `sweep` (timeout),
 * `dispose` (leader session teardown), and `reconcilePending` (cold resume of
 * a resuming child, or an aborted execution settling its own entry).
 */
export class TeamControlRegistry extends Service {
  private readonly byLeader = new Map<string, Map<string, PendingControlRequest>>()

  constructor(ctx: Context) {
    super(ctx, 'teamControl')
  }

  private pendingFor(leaderSessionId: string): Map<string, PendingControlRequest> {
    let pending = this.byLeader.get(leaderSessionId)
    if (pending === undefined) {
      pending = new Map()
      this.byLeader.set(leaderSessionId, pending)
    }
    return pending
  }

  /**
   * Create a pending request under a leader session and return its settlement promise.
   *
   * @param leaderSessionId - the leader session the request is addressed to.
   * @param data - the control request data.
   * @returns a promise that resolves with the leader's decision.
   */
  create(leaderSessionId: string, data: TeamControlRequestData): Promise<TeamControlDecision> {
    return new Promise<TeamControlDecision>((resolve) => {
      this.pendingFor(leaderSessionId).set(data.requestId, {
        data,
        resolve,
        createdAt: Date.now(),
      })
    })
  }

  /**
   * Settle a pending request with the leader's decision.
   *
   * @param leaderSessionId - the leader session the request belongs to.
   * @param requestId - the request to settle.
   * @param decision - the leader's decision.
   * @throws when the request id is unknown for that leader.
   */
  decide(leaderSessionId: string, requestId: string, decision: TeamControlDecision): void {
    const pending = this.byLeader.get(leaderSessionId)
    const request = pending?.get(requestId)
    if (pending === undefined || request === undefined) {
      throw new Error(`Unknown control request: "${requestId}"`)
    }
    pending.delete(requestId)
    if (pending.size === 0) this.byLeader.delete(leaderSessionId)
    request.resolve(decision)
  }

  /**
   * List all pending requests for one leader.
   *
   * @param leaderSessionId - the leader session whose pending requests to return.
   * @returns the pending request data for that leader.
   */
  list(leaderSessionId: string): readonly TeamControlRequestData[] {
    return [...(this.byLeader.get(leaderSessionId)?.values() ?? [])].map(request => request.data)
  }

  /**
   * Time out and auto-deny expired requests across every leader.
   *
   * @param now - current epoch ms.
   * @param timeoutMs - maximum age in ms.
   */
  sweep(now: number, timeoutMs: number): void {
    for (const [leaderId, pending] of this.byLeader) {
      for (const [requestId, request] of pending) {
        if (now - request.createdAt >= timeoutMs) {
          pending.delete(requestId)
          request.resolve('deny')
        }
      }
      if (pending.size === 0) this.byLeader.delete(leaderId)
    }
  }

  /**
   * Reconcile persisted requests against the live registry, auto-denying the
   * still-pending entries.
   *
   * A request whose suspended execution has already been torn down (child
   * activation disposal, execution abort, or a process restart in between)
   * can never drive a tool again, so it is settled with 'deny' and dropped
   * from the pending list. Requests with no live entry — already decided, or
   * lost with a restart — are a no-op. A concurrent `decide` on the same
   * request is safe: it removes the entry first and this method skips it.
   *
   * @param leaderSessionId - the leader session the requests are addressed to.
   * @param requests - the persisted requests to reconcile, e.g. every
   *   `team/control-request` logged by a resuming child.
   * @returns the ids of the requests that were still pending and were denied.
   */
  reconcilePending(leaderSessionId: string, requests: readonly TeamControlRequestData[]): string[] {
    const pending = this.byLeader.get(leaderSessionId)
    if (pending === undefined) return []
    const denied: string[] = []
    for (const data of requests) {
      const request = pending.get(data.requestId)
      if (request === undefined) continue
      pending.delete(data.requestId)
      request.resolve('deny')
      denied.push(data.requestId)
    }
    if (pending.size === 0) this.byLeader.delete(leaderSessionId)
    return denied
  }

  /**
   * Dispose all pending requests for one leader, auto-denying each.
   *
   * @param leaderSessionId - the leader session whose pending requests to dispose.
   */
  dispose(leaderSessionId: string): void {
    const pending = this.byLeader.get(leaderSessionId)
    if (pending === undefined) return
    this.byLeader.delete(leaderSessionId)
    for (const request of pending.values()) request.resolve('deny')
  }
}
