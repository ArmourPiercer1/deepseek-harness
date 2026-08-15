/**
 * Session-scoped team orchestrator managing teammate activations.
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
 * Manages the lifecycle of teammate activations within a single leader session.
 * At most one active delegation per teammate at any time.
 */
export class TeamOrchestrator {
  private readonly activations = new Map<string, TeammateActivation>()

  /**
   * Record a new teammate activation.
   *
   * @param memberId - which teammate.
   * @param childSessionId - the child session id.
   * @returns the recorded activation.
   * @throws when the teammate already has an in-flight activation.
   */
  recordActivation(memberId: TeamMemberId, childSessionId: string): TeammateActivation {
    const existing = this.activations.get(memberId)
    if (existing && existing.status === 'running') {
      throw new Error(`Teammate "${memberId}" already has an in-flight delegation`)
    }

    const activation: TeammateActivation = {
      memberId,
      childSessionId,
      status: 'running',
    }
    this.activations.set(memberId, activation)
    return activation
  }

  /**
   * Mark a teammate activation as settled.
   *
   * @param memberId - the teammate whose activation settled.
   */
  markSettled(memberId: TeamMemberId): void {
    const activation = this.activations.get(memberId)
    if (activation && activation.status === 'running') {
      activation.status = 'settled'
    }
  }

  /**
   * Mark a teammate activation as disposed.
   *
   * @param memberId - the teammate whose activation was disposed.
   */
  markDisposed(memberId: TeamMemberId): void {
    const activation = this.activations.get(memberId)
    if (activation) {
      activation.status = 'disposed'
    }
  }

  /** List all current activations. */
  list(): readonly TeammateActivation[] {
    return [...this.activations.values()]
  }

  /**
   * Get activation by member id.
   *
   * @param memberId - the teammate to look up.
   * @returns the activation, or undefined if none recorded.
   */
  get(memberId: TeamMemberId): TeammateActivation | undefined {
    return this.activations.get(memberId)
  }

  /**
   * Check if a teammate currently has an in-flight activation.
   *
   * @param memberId - the teammate to check.
   * @returns true if the teammate has a running activation.
   */
  isInFlight(memberId: TeamMemberId): boolean {
    const activation = this.activations.get(memberId)
    return activation?.status === 'running'
  }

  /**
   * Find an activation by child session id.
   *
   * @param childSessionId - the child session id to look up.
   * @returns the first matching activation, or undefined if none recorded.
   */
  findByChildSession(childSessionId: string): TeammateActivation | undefined {
    for (const activation of this.activations.values()) {
      if (activation.childSessionId === childSessionId) {
        return activation
      }
    }
    return undefined
  }

  /**
   * Update the activity tracking fields of a teammate activation.
   *
   * @param memberId - the teammate whose activation recorded activity.
   * @param action - description of the last action (e.g. tool name).
   */
  updateActivity(memberId: TeamMemberId, action: string): void {
    const activation = this.activations.get(memberId)
    if (activation) {
      activation.lastActivityAt = Date.now()
      activation.lastAction = action
    }
  }
}
