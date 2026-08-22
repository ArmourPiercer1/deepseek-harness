/**
 * Team orchestrator managing teammate activations, partitioned by leader
 * session.
 *
 * One instance may serve many concurrent leader sessions (a plugin row is
 * shared by every agent its composition composes), so every method takes the
 * leader's session id and partitions state under it. Activations from other
 * leaders are invisible: reading one never yields a child session whose
 * durable parent is a different session, which would otherwise poison
 * follow-ups with `UNAUTHORIZED`.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { TeamMemberId } from '@deepseek-ai/dsh-team'

/** Runtime status of a teammate activation. */
export type TeammateActivationStatus = 'running' | 'settled' | 'disposed'

/** A tracked teammate activation. */
export interface TeammateActivation {
  /** The activated member. */
  readonly memberId: TeamMemberId
  /** The child session id (opaque string). */
  readonly childSessionId: string
  /** Current activation status. */
  status: TeammateActivationStatus
  /** Epoch ms of last known activity. */
  lastActivityAt?: number
  /** Description of the last action (e.g. tool name). */
  lastAction?: string
}

/**
 * Manages the lifecycle of teammate activations, partitioned by leader
 * session. At most one active delegation per teammate per leader at any time.
 */
export class TeamOrchestrator {
  /** Live activations by leader session id, then member id. */
  private readonly byLeader = new Map<string, Map<string, TeammateActivation>>()

  /** One leader's activation partition, created on first use. */
  private activationsFor(leaderSessionId: string): Map<string, TeammateActivation> {
    let activations = this.byLeader.get(leaderSessionId)
    if (activations === undefined) {
      activations = new Map()
      this.byLeader.set(leaderSessionId, activations)
    }
    return activations
  }

  /**
   * Record a new teammate activation under one leader.
   *
   * @param leaderSessionId - the leader whose delegation this is.
   * @param memberId - which teammate.
   * @param childSessionId - the child session id.
   * @returns the recorded activation.
   * @throws when the teammate already has an in-flight activation.
   */
  recordActivation(leaderSessionId: string, memberId: TeamMemberId, childSessionId: string): TeammateActivation {
    const activations = this.activationsFor(leaderSessionId)
    const existing = activations.get(memberId)
    if (existing && existing.status === 'running') {
      throw new Error(`Teammate "${memberId}" already has an in-flight delegation`)
    }

    const activation: TeammateActivation = {
      memberId,
      childSessionId,
      status: 'running',
    }
    activations.set(memberId, activation)
    return activation
  }

  /**
   * Mark a teammate activation as settled.
   *
   * @param leaderSessionId - the leader whose delegation settled.
   * @param memberId - the teammate whose activation settled.
   */
  markSettled(leaderSessionId: string, memberId: TeamMemberId): void {
    const activation = this.activationsFor(leaderSessionId).get(memberId)
    if (activation && activation.status === 'running') {
      activation.status = 'settled'
    }
  }

  /**
   * Mark a teammate activation as disposed.
   *
   * @param leaderSessionId - the leader whose delegation was disposed.
   * @param memberId - the teammate whose activation was disposed.
   */
  markDisposed(leaderSessionId: string, memberId: TeamMemberId): void {
    const activation = this.activationsFor(leaderSessionId).get(memberId)
    if (activation) {
      activation.status = 'disposed'
    }
  }

  /**
   * List one leader's current activations.
   *
   * @param leaderSessionId - the leader whose activations to list.
   * @returns the current activations, in recording order.
   */
  list(leaderSessionId: string): readonly TeammateActivation[] {
    return [...(this.byLeader.get(leaderSessionId)?.values() ?? [])]
  }

  /**
   * Get one leader's activation by member id.
   *
   * @param leaderSessionId - the leader whose delegation to look up.
   * @param memberId - the teammate to look up.
   * @returns the activation, or undefined if none recorded.
   */
  get(leaderSessionId: string, memberId: TeamMemberId): TeammateActivation | undefined {
    return this.byLeader.get(leaderSessionId)?.get(memberId)
  }

  /**
   * Check if a teammate currently has an in-flight activation under one leader.
   *
   * @param leaderSessionId - the leader whose delegation to check.
   * @param memberId - the teammate to check.
   * @returns true if the teammate has a running activation.
   */
  isInFlight(leaderSessionId: string, memberId: TeamMemberId): boolean {
    return this.get(leaderSessionId, memberId)?.status === 'running'
  }

  /**
   * Find one leader's activation by child session id.
   *
   * @param leaderSessionId - the leader whose delegation to search.
   * @param childSessionId - the child session id to look up.
   * @returns the first matching activation, or undefined if none recorded.
   */
  findByChildSession(leaderSessionId: string, childSessionId: string): TeammateActivation | undefined {
    for (const activation of this.byLeader.get(leaderSessionId)?.values() ?? []) {
      if (activation.childSessionId === childSessionId) {
        return activation
      }
    }
    return undefined
  }

  /**
   * Update the activity tracking fields of one leader's teammate activation.
   *
   * @param leaderSessionId - the leader whose delegation recorded activity.
   * @param memberId - the teammate whose activation recorded activity.
   * @param action - description of the last action (e.g. tool name).
   */
  updateActivity(leaderSessionId: string, memberId: TeamMemberId, action: string): void {
    const activation = this.byLeader.get(leaderSessionId)?.get(memberId)
    if (activation) {
      activation.lastActivityAt = Date.now()
      activation.lastAction = action
    }
  }
}
