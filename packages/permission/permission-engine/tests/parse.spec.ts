import { describe, expect, it } from 'vitest'
import { parseRule } from '../src/parse.ts'

describe('parseRule', () => {
  it('parses a command rule with a compound pattern', () => {
    const res = parseRule('Bash(git status:*)', 'allow', 'managed')
    expect(res.diagnostics).toEqual([])
    expect(res.rule).toBeDefined()
    expect(res.rule!.tool).toBe('Bash')
    expect(res.rule!.matcher).toEqual({ kind: 'command', tool: 'Bash', pattern: 'git status:*' })
  })

  it('parses bare and star command rules as match-all', () => {
    for (const raw of ['Bash', 'Bash(*)']) {
      const res = parseRule(raw, 'deny', 'teammate')
      expect(res.diagnostics).toEqual([])
      expect(res.rule!.matcher).toEqual({ kind: 'command', tool: 'Bash', pattern: '*' })
    }
  })

  it('parses an anchored path rule', () => {
    const res = parseRule('Read(//**/.env)', 'ask', 'project')
    expect(res.diagnostics).toEqual([])
    expect(res.rule!.matcher).toEqual({ kind: 'path', tool: 'Read', pattern: '//**/.env' })
  })

  it('parses mcp rules into server/tool matchers', () => {
    expect(parseRule('mcp__postgres__query', 'allow', 'managed').rule!.matcher)
      .toEqual({ kind: 'mcp', server: 'postgres', tool: 'query' })
    expect(parseRule('mcp__postgres', 'allow', 'managed').rule!.matcher)
      .toEqual({ kind: 'mcp', server: 'postgres' })
    expect(parseRule('mcp__postgres__*', 'allow', 'managed').rule!.matcher)
      .toEqual({ kind: 'mcp', server: 'postgres', tool: '*' })
    expect(parseRule('mcp__*', 'allow', 'managed').rule!.matcher)
      .toEqual({ kind: 'mcp', server: '*' })
  })

  it('parses a param rule', () => {
    const res = parseRule('Agent(isolation:worktree)', 'allow', 'managed')
    expect(res.diagnostics).toEqual([])
    expect(res.rule!.matcher).toEqual({ kind: 'param', tool: 'Agent', param: 'isolation', value: 'worktree' })
  })

  it('normalizes PowerShell to the pwsh command tool', () => {
    const res = parseRule('PowerShell(Remove-Item *)', 'deny', 'project')
    expect(res.diagnostics).toEqual([])
    expect(res.rule!.tool).toBe('pwsh')
    expect(res.rule!.matcher).toEqual({ kind: 'command', tool: 'pwsh', pattern: 'Remove-Item *' })
  })

  it('ignores a primary content field param:value rule with a warning and no rule', () => {
    const res = parseRule('Bash(command:rm *)', 'allow', 'managed')
    expect(res.rule).toBeUndefined()
    expect(res.diagnostics).toHaveLength(1)
    expect(res.diagnostics[0]!.severity).toBe('warning')
    expect(res.diagnostics[0]!.message).toContain("'command'")
  })

  it('threads kind and layer onto the compiled rule', () => {
    const res = parseRule('Read(//**/.env)', 'deny', 'teammate')
    expect(res.rule!.kind).toBe('deny')
    expect(res.rule!.layer).toBe('teammate')
    expect(res.rule!.raw).toBe('Read(//**/.env)')
  })
})
