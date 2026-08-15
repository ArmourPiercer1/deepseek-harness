import { describe, expect, it } from 'vitest'
import { matchMcp } from '../src/match-mcp.ts'

describe('matchMcp', () => {
  it('matches whole-server with no tool segment', () => {
    const matcher = { kind: 'mcp' as const, server: 'puppeteer' }
    expect(matchMcp(matcher, 'mcp__puppeteer__navigate', null)).toBe(true)
    expect(matchMcp(matcher, 'mcp__puppeteer__click', null)).toBe(true)
  })

  it('treats tool * as whole-server', () => {
    const matcher = { kind: 'mcp' as const, server: 'puppeteer', tool: '*' }
    expect(matchMcp(matcher, 'mcp__puppeteer__navigate', null)).toBe(true)
    expect(matchMcp(matcher, 'mcp__puppeteer__click', null)).toBe(true)
  })

  it('matches an exact tool only', () => {
    const matcher = { kind: 'mcp' as const, server: 'puppeteer', tool: 'navigate' }
    expect(matchMcp(matcher, 'mcp__puppeteer__navigate', null)).toBe(true)
    expect(matchMcp(matcher, 'mcp__puppeteer__click', null)).toBe(false)
    expect(matchMcp(matcher, 'mcp__puppeteer', null)).toBe(false)
  })

  it('matches any MCP tool when server is *', () => {
    const matcher = { kind: 'mcp' as const, server: '*' }
    expect(matchMcp(matcher, 'mcp__x__y', null)).toBe(true)
    expect(matchMcp(matcher, 'mcp__puppeteer__navigate', null)).toBe(true)
  })

  it('rejects non-MCP tool names', () => {
    const matcher = { kind: 'mcp' as const, server: '*' }
    expect(matchMcp(matcher, 'Bash', null)).toBe(false)
  })

  it('rejects a server mismatch', () => {
    const matcher = { kind: 'mcp' as const, server: 'postgres' }
    expect(matchMcp(matcher, 'mcp__puppeteer__navigate', null)).toBe(false)
  })

  it('handles a tool name with no tool segment', () => {
    const wholeServer = { kind: 'mcp' as const, server: 'puppeteer' }
    expect(matchMcp(wholeServer, 'mcp__puppeteer', null)).toBe(true)

    const exactTool = { kind: 'mcp' as const, server: 'puppeteer', tool: 'navigate' }
    expect(matchMcp(exactTool, 'mcp__puppeteer', null)).toBe(false)
  })
})
