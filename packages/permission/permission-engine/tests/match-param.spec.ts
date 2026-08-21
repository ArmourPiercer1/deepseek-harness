import { describe, expect, it } from 'vitest'
import type { ParamMatcher } from '../src/matchers.ts'
import { matchParam } from '../src/match-param.ts'

function matcher(param: string, value: string, tool = 'Agent'): ParamMatcher {
  return { kind: 'param', tool, param, value }
}

describe('matchParam', () => {
  it('matches an exact scalar value', () => {
    const m = matcher('isolation', 'worktree')
    expect(matchParam(m, 'Agent', { isolation: 'worktree' })).toBe(true)
    expect(matchParam(m, 'Agent', { isolation: 'none' })).toBe(false)
  })

  it('matches any value with a bare wildcard', () => {
    const m = matcher('isolation', '*')
    expect(matchParam(m, 'Agent', { isolation: 'worktree' })).toBe(true)
    expect(matchParam(m, 'Agent', { isolation: 'anything' })).toBe(true)
  })

  it('matches a boolean field', () => {
    const m = matcher('run_in_background', 'true', 'Bash')
    expect(matchParam(m, 'Bash', { run_in_background: true })).toBe(true)
    expect(matchParam(m, 'Bash', { run_in_background: false })).toBe(false)
  })

  it('matches a number field through string coercion', () => {
    const m = matcher('port', '8080', 'Bash')
    expect(matchParam(m, 'Bash', { port: 8080 })).toBe(true)
    expect(matchParam(m, 'Bash', { port: 8081 })).toBe(false)
  })

  it('matches a null field', () => {
    const m = matcher('flag', 'null')
    expect(matchParam(m, 'Agent', { flag: null })).toBe(true)
  })

  it('does not match an omitted parameter', () => {
    const m = matcher('isolation', 'worktree')
    expect(matchParam(m, 'Agent', {})).toBe(false)
    expect(matchParam(m, 'Agent', { other: 'worktree' })).toBe(false)
  })

  it('does not match a nested object or array value', () => {
    const objectM = matcher('isolation', '*')
    expect(matchParam(objectM, 'Agent', { isolation: { deep: 'worktree' } })).toBe(false)

    const arrayM = matcher('tags', 'a', 'Bash')
    expect(matchParam(arrayM, 'Bash', { tags: ['a'] })).toBe(false)
  })

  it('does not match a mismatched tool', () => {
    const m = matcher('isolation', 'worktree', 'Agent')
    expect(matchParam(m, 'Bash', { isolation: 'worktree' })).toBe(false)
  })

  it('matches the tool name case-insensitively', () => {
    const m = matcher('isolation', 'worktree', 'Agent')
    expect(matchParam(m, 'agent', { isolation: 'worktree' })).toBe(true)
    expect(matchParam(m, 'AGENT', { isolation: 'worktree' })).toBe(true)
  })
})
