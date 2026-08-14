/**
 * Team plugin constants shared across packages.
 *
 * @module @deepseek-ai/dsh-team
 */

/**
 * The 10 tools every leader receives unconditionally.
 * Plugin load fails if any is absent from the global tool registry.
 *
 * These tools guarantee the leader can always coordinate the team:
 * - 5 team-specific tools for delegation, messaging, progress, control, and discovery
 * - 5 general-purpose tools for file inspection, search, task tracking, and web research
 */
export const DEFAULT_LEADER_TOOLS = [
  'delegate_to_teammate',
  'send_team_message',
  'team_progress',
  'team_control',
  'list_teammates',
  'read',
  'grep',
  'glob',
  'todo_write',
  'web_search',
] as const satisfies readonly string[]

/** Tool names that teammates are never allowed to invoke. */
export const TEAMMATE_DENIED_TOOLS = [
  'delegate_to_teammate',
  'team_control',
  'list_teammates',
] as const satisfies readonly string[]

/** Session event type prefix for all team events. */
export const TEAM_EVENT_PREFIX = 'team/' as const
