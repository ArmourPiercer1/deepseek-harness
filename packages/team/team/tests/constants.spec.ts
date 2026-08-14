import { describe, expect, it } from 'vitest'
import { DEFAULT_LEADER_TOOLS, TEAMMATE_DENIED_TOOLS } from '../src/constants.ts'

describe('DEFAULT_LEADER_TOOLS', () => {
  it('has exactly 10 entries', () => {
    expect(DEFAULT_LEADER_TOOLS).toHaveLength(10)
  })

  it('contains no duplicates', () => {
    const unique = new Set(DEFAULT_LEADER_TOOLS)
    expect(unique.size).toBe(DEFAULT_LEADER_TOOLS.length)
  })

  it('includes all 5 team-specific tools', () => {
    expect(DEFAULT_LEADER_TOOLS).toContain('delegate_to_teammate')
    expect(DEFAULT_LEADER_TOOLS).toContain('send_team_message')
    expect(DEFAULT_LEADER_TOOLS).toContain('team_progress')
    expect(DEFAULT_LEADER_TOOLS).toContain('team_control')
    expect(DEFAULT_LEADER_TOOLS).toContain('list_teammates')
  })

  it('includes all 5 general-purpose tools', () => {
    expect(DEFAULT_LEADER_TOOLS).toContain('read')
    expect(DEFAULT_LEADER_TOOLS).toContain('grep')
    expect(DEFAULT_LEADER_TOOLS).toContain('glob')
    expect(DEFAULT_LEADER_TOOLS).toContain('todo_write')
    expect(DEFAULT_LEADER_TOOLS).toContain('web_search')
  })

  it('entries are valid tool name format (lowercase alphanumeric with underscores)', () => {
    for (const name of DEFAULT_LEADER_TOOLS) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})

describe('TEAMMATE_DENIED_TOOLS', () => {
  it('denies team control tools that teammates must not invoke', () => {
    expect(TEAMMATE_DENIED_TOOLS).toContain('delegate_to_teammate')
    expect(TEAMMATE_DENIED_TOOLS).toContain('team_control')
    expect(TEAMMATE_DENIED_TOOLS).toContain('list_teammates')
  })

  it('is a subset of DEFAULT_LEADER_TOOLS', () => {
    const leaderSet = new Set<string>(DEFAULT_LEADER_TOOLS)
    for (const tool of TEAMMATE_DENIED_TOOLS) {
      expect(leaderSet.has(tool)).toBe(true)
    }
  })
})
