/**
 * Per-workspace teammate enablement persisted in the `team-enablement`
 * settings namespace.
 *
 * @module @deepseek-ai/dsh-team-local
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'

/** Settings namespace persisting per-workspace teammate enablement. */
export const TEAM_ENABLEMENT_SETTINGS_NAMESPACE = settingsNamespace('team-enablement')

/**
 * Resolved `team-enablement` settings section: workspace path -> teammate id
 * -> enabled. An absent section, workspace, or teammate means enabled.
 */
export type TeamEnablementSettings = Record<string, Record<string, boolean>>

/**
 * Schema for the `team-enablement` section: a record of workspace paths, each
 * a record of teammate ids to enabled flags. An absent section resolves to
 * `{}` — nothing disabled anywhere.
 */
export const TeamEnablementSettingsSchema: z<TeamEnablementSettings> = z.dict(z.dict(z.boolean()))

/** Resolved section with no disabled teammate: the source while no settings service is mounted. */
export const DEFAULT_TEAM_ENABLEMENT: TeamEnablementSettings = {}

/**
 * Whether one teammate is enabled for one workspace.
 *
 * @param settings - resolved enablement section.
 * @param workspacePath - workspace the definitions serve; an empty path has no
 *   enablement section and enables every teammate.
 * @param teammateId - the teammate definition's id.
 * @returns true unless the workspace explicitly disables the teammate.
 */
export function isTeammateEnabled(
  settings: TeamEnablementSettings,
  workspacePath: string,
  teammateId: string,
): boolean {
  if (workspacePath === '') return true
  return settings[workspacePath]?.[teammateId] !== false
}

/**
 * Drop the teammates disabled for one workspace from a definition set.
 *
 * Leader definitions are never filtered: a valid team requires exactly one
 * leader, and the leader is metadata only — the root agent is composed by its
 * own preset, never by the registry — so disabling it would fail validation
 * without any runtime effect to enforce.
 *
 * @param definitions - deduplicated definitions to filter.
 * @param settings - resolved enablement section.
 * @param workspacePath - workspace the definitions serve.
 * @returns the definitions to register, in input order.
 */
export function filterDisabledTeammates(
  definitions: readonly TeamMemberDefinition[],
  settings: TeamEnablementSettings,
  workspacePath: string,
): readonly TeamMemberDefinition[] {
  return definitions.filter(def => def.role !== 'teammate' || isTeammateEnabled(settings, workspacePath, def.id))
}
