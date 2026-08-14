/**
 * Per-member MCP tool guard.
 *
 * Dynamically denies MCP tools not in the member's `mcpServers` allowlist
 * at execution time. Covers late-connected and reconnected MCP servers.
 *
 * @module @deepseek-ai/dsh-team-runtime
 */

import type { TeamMcpPolicy } from '@deepseek-ai/dsh-team'

const MCP_PREFIX = 'mcp__'

/**
 * Tool guard function type matching DSH's ToolGuard signature.
 * Returns a denial reason string, or undefined to allow.
 */
export type McpGuardFn = (exec: { readonly name: string }) => string | undefined

/**
 * Create a guard that dynamically denies MCP tools not in the member's
 * mcpServers allowlist. Checks tool name prefix `mcp__<server>__` at
 * execution time, covering late-connected and reconnected MCP servers.
 *
 * @param policy - the member's MCP policy (allowed server names).
 * @returns a guard function suitable for `ctx.tools.guard()`.
 */
export function createMcpGuard(policy: TeamMcpPolicy): McpGuardFn {
  const allowedPrefixes = new Set(
    policy.servers.map(server => `${MCP_PREFIX}${server}__`),
  )

  return (exec: { readonly name: string }): string | undefined => {
    const toolName = exec.name
    if (!toolName.startsWith(MCP_PREFIX)) return undefined // Not an MCP tool

    // Check if it matches any allowed server prefix
    for (const prefix of allowedPrefixes) {
      if (toolName.startsWith(prefix)) return undefined // Allowed
    }

    // Extract server name for diagnostic message
    const serverEnd = toolName.indexOf('__', MCP_PREFIX.length)
    const server = serverEnd > 0
      ? toolName.slice(MCP_PREFIX.length, serverEnd)
      : '(unknown)'
    return `MCP server "${server}" is not authorized for this team member`
  }
}
