/**
 * Fold failures with stable machine codes for wire mapping.
 *
 * @module @deepseek-ai/dsh-team-projection
 */

/** Stable failure codes of the team projection fold. */
export type TeamProjectionErrorCode =
  | 'LEADER_UNKNOWN'
  | 'ANCHOR_UNKNOWN'
  | 'INVALID_LIMIT'

/** A team projection fold rejection with a stable code. */
export class TeamProjectionError extends Error {
  /** Stable machine-readable failure code. */
  readonly code: TeamProjectionErrorCode

  /**
   * Construct a projection failure.
   * @param code - stable failure code.
   * @param message - violated contract.
   */
  constructor(code: TeamProjectionErrorCode, message: string) {
    super(message)
    this.name = 'TeamProjectionError'
    this.code = code
  }
}
