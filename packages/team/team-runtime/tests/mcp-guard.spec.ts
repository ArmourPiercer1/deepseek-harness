import { describe, expect, it } from 'vitest'
import { createMcpGuard } from '../src/mcp-guard.ts'

describe('createMcpGuard', () => {
  it('allows tools from authorized MCP servers', () => {
    const guard = createMcpGuard({ servers: ['postgres-mcp', 'redis-mcp'] })
    expect(guard({ name: 'mcp__postgres-mcp__query' })).toBeUndefined()
    expect(guard({ name: 'mcp__redis-mcp__get' })).toBeUndefined()
  })

  it('denies tools from unauthorized MCP servers', () => {
    const guard = createMcpGuard({ servers: ['postgres-mcp'] })
    const reason = guard({ name: 'mcp__redis-mcp__get' })
    expect(reason).toContain('redis-mcp')
    expect(reason).toContain('not authorized')
  })

  it('ignores non-MCP tools', () => {
    const guard = createMcpGuard({ servers: [] })
    expect(guard({ name: 'read' })).toBeUndefined()
    expect(guard({ name: 'write' })).toBeUndefined()
    expect(guard({ name: 'grep' })).toBeUndefined()
  })

  it('denies all MCP tools when policy has no servers', () => {
    const guard = createMcpGuard({ servers: [] })
    expect(guard({ name: 'mcp__any-server__tool' })).toBeDefined()
  })

  it('handles MCP tool names with unusual server names', () => {
    const guard = createMcpGuard({ servers: ['my-server-123'] })
    expect(guard({ name: 'mcp__my-server-123__some_tool' })).toBeUndefined()
    expect(guard({ name: 'mcp__other__tool' })).toBeDefined()
  })
})
