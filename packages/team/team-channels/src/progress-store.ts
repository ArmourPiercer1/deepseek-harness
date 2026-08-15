/**
 * Team progress store.
 *
 * Read/write team progress backed by in-memory state keyed by the leader's
 * session id. Session events are the durable backing and are emitted by the
 * tool-team tool; the store folds them into a queryable view.
 *
 * @module @deepseek-ai/dsh-team-channels
 */

import type { TeamProgressData } from '@deepseek-ai/dsh-team'

/**
 * In-memory team progress store keyed by leader session id. Mutations are
 * tracked by taskId within each leader; reads fold entries by taskId (latest
 * wins).
 */
export class TeamProgressStore {
  private readonly byLeader = new Map<string, Map<string, TeamProgressData>>()

  private entriesFor(leaderSessionId: string): Map<string, TeamProgressData> {
    let entries = this.byLeader.get(leaderSessionId)
    if (entries === undefined) {
      entries = new Map()
      this.byLeader.set(leaderSessionId, entries)
    }
    return entries
  }

  /**
   * Upsert a progress entry for one leader.
   *
   * @param leaderSessionId - the leader whose board is updated.
   * @param entry - the progress data to record.
   */
  update(leaderSessionId: string, entry: TeamProgressData): void {
    this.entriesFor(leaderSessionId).set(entry.taskId, entry)
  }

  /**
   * Read all progress entries for one leader, deduplicated by taskId (latest wins).
   *
   * @param leaderSessionId - the leader whose board is read.
   * @returns the leader's current progress entries.
   */
  list(leaderSessionId: string): readonly TeamProgressData[] {
    return [...(this.byLeader.get(leaderSessionId)?.values() ?? [])]
  }

  /**
   * Read one entry by task id for one leader.
   *
   * @param leaderSessionId - the leader whose board is read.
   * @param taskId - the task to look up.
   * @returns the progress entry, or undefined if unknown.
   */
  get(leaderSessionId: string, taskId: string): TeamProgressData | undefined {
    return this.byLeader.get(leaderSessionId)?.get(taskId)
  }

  /**
   * Restore entries from session events for one leader (fold by taskId, latest wins).
   *
   * @param leaderSessionId - the leader whose board is restored.
   * @param events - progress events to restore from.
   */
  restore(leaderSessionId: string, events: readonly TeamProgressData[]): void {
    for (const event of events) {
      this.entriesFor(leaderSessionId).set(event.taskId, event)
    }
  }
}
