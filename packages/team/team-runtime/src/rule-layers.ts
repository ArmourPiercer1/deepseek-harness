/**
 * Rule-layer file paths and the recovered team rule state.
 *
 * The rule-layer types come from the `@deepseek-ai/dsh-permission` Service
 * Definition as a type-only import: the runtime's `permission` hard injection
 * carries the live service at runtime, and the definition module in the
 * compile program supplies the `LoadedRuleLayers` and `PermissionService`
 * types (and the `permission/decision` session event declaration) without a
 * runtime package dependency.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { LoadedRuleLayers } from '@deepseek-ai/dsh-permission'

/** Rule file name for the managed layer, directly under the harness home. */
export const MANAGED_RULE_FILE = 'permissions.yml'

/** Rule file segments for the project layer, relative to the workspace root. */
export const PROJECT_RULE_FILE: readonly string[] = ['.dsh', 'permissions.yml']

/**
 * The resolved on-disk paths of a scope's file rule layers.
 */
export interface RuleLayerPaths {
  /** The managed rule file; undefined when the harness home is unresolvable. */
  readonly managedPath?: string
  /** The project rule file; undefined when the scope's workspace is unresolvable. */
  readonly projectPath?: string
}

/**
 * Resolve a scope's rule-layer file paths: the managed layer directly under
 * the harness home, the project layer under the scope's workspace (its
 * session cwd). An unresolvable root yields an undefined path, which the
 * loader reads as a layer absence.
 *
 * @param homePath - explicit harness home; undefined falls back to `$DSH_HOME`.
 * @param workspacePath - the scope's workspace path (session cwd).
 * @returns the resolved rule-layer paths.
 */
export function resolveRuleLayerPaths(
  homePath: string | undefined,
  workspacePath: string | undefined,
): RuleLayerPaths {
  const home = homePath ?? process.env['DSH_HOME'] ?? ''
  const paths: { managedPath?: string; projectPath?: string } = {}
  if (home !== '') paths.managedPath = join(home, MANAGED_RULE_FILE)
  if (workspacePath !== undefined && workspacePath !== '') {
    paths.projectPath = join(workspacePath, ...PROJECT_RULE_FILE)
  }
  return paths
}

/**
 * Recovered rule-layer state per team child session, registered by the member
 * setup contribution on both fresh creation and cold resume and released when
 * the child disposes. The enforcement point (the teammate approval hook)
 * awaits the entry to compile the member's policy; a rejected entry (a lapsed
 * managed file, an unreadable or malformed layer file) settles into its
 * denial there, never as an unhandled rejection.
 */
const recoveredRuleLayers = new Map<SessionId, Promise<LoadedRuleLayers>>()

/**
 * Record the rule-layer load for one team child session.
 *
 * @param sessionId - the child session id.
 * @param promise - the `loadRuleLayers` result.
 */
export function setRecoveredRuleLayers(
  sessionId: SessionId,
  promise: Promise<LoadedRuleLayers>,
): void {
  recoveredRuleLayers.set(sessionId, promise)
}

/**
 * Read the rule-layer load of one team child session.
 *
 * @param sessionId - the child session id.
 * @returns the load promise, or undefined when the session has no team rule state.
 */
export function getRecoveredRuleLayers(
  sessionId: SessionId,
): Promise<LoadedRuleLayers> | undefined {
  return recoveredRuleLayers.get(sessionId)
}

/**
 * Release the rule-layer state of a disposed child session.
 *
 * @param sessionId - the child session id.
 */
export function releaseRecoveredRuleLayers(sessionId: SessionId): void {
  recoveredRuleLayers.delete(sessionId)
}
