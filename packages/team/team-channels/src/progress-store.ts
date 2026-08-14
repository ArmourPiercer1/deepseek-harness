/**
 * Team progress store.
 *
 * Read/write team progress backed by in-memory state. Session events
 * are the durable backing and are emitted by the tool-team tool;
 * the store folds them into a queryable view.
 *
 * @module @deepseek-ai/dsh-team-channels
 */

import type { TeamProgressData } from '@deepseek-ai/dsh-team'

/**
 * In-memory team progress store. All mutations are tracked by taskId;
 * reads fold entries by taskId (latest wins).
 */
export class TeamProgressStore {
  private readonly entries = new Map<string, TeamProgressData>()

  /**
   * Upsert a progress entry.
   *
   * @param entry - the progress data to record.
   */
  update(entry: TeamProgressData): void {
    this.entries.set(entry.taskId, entry)
  }

  /**
   * Read all progress entries, deduplicated by taskId (latest wins).
   *
   * @returns all current progress entries.
   */
  list(): readonly TeamProgressData[] {
    return [...this.entries.values()]
  }

  /**
   * Read one entry by task id.
   *
   * @param taskId - the task to look up.
   * @returns the progress entry, or undefined if unknown.
   */
  get(taskId: string): TeamProgressData | undefined {
    return this.entries.get(taskId)
  }

  /**
   * Restore entries from session events (fold by taskId, latest wins).
   *
   * @param events - progress events to restore from.
   */
  restore(events: readonly TeamProgressData[]): void {
    for (const event of events) {
      this.entries.set(event.taskId, event)
    }
  }
}
