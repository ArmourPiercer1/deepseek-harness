/**
 * Per-member skill tool guard.
 *
 * Dynamically denies `skill` tool calls whose requested skill name is not in
 * the member's `skills` allowlist, checked at execution time. A member with a
 * `skills` policy of `[]` may load no skill; absence of the policy installs
 * no guard at all.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

/**
 * Create a guard that dynamically denies `skill` tool calls whose requested
 * skill name is not in the member's skills allowlist. The guard only inspects
 * the `name` argument of `skill` calls; every other tool passes through.
 *
 * @param allowedSkills - the member's skill allowlist (skill names).
 * @returns a guard function suitable for `ctx.tools.guard()`.
 */
export function createSkillGuard(
  allowedSkills: readonly string[],
): (exec: { readonly name: string; readonly arguments?: unknown }) => string | undefined {
  const allowed = new Set(allowedSkills)

  return (exec): string | undefined => {
    if (exec.name !== 'skill') return undefined // Not a skill tool

    const args = exec.arguments
    const skillName = typeof args === 'object' && args !== null
      ? (args as Record<string, unknown>).name
      : undefined
    if (typeof skillName === 'string' && !allowed.has(skillName)) {
      return `Skill "${skillName}" is not authorized for this team member`
    }
    return undefined
  }
}
