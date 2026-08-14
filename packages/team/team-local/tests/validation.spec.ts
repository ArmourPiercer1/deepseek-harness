import { describe, expect, it } from 'vitest'
import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import { validateTeamDefinitions } from '../src/validation.ts'

function makeDef(id: string, role: 'leader' | 'teammate'): TeamMemberDefinition {
  return {
    id: TeamMemberId(id),
    role,
    name: id,
    description: `Test ${id}`,
    prompt: `You are ${id}`,
  }
}

describe('validateTeamDefinitions', () => {
  it('accepts a valid set with one leader and teammates', () => {
    expect(() => validateTeamDefinitions([
      makeDef('leader', 'leader'),
      makeDef('backend', 'teammate'),
      makeDef('frontend', 'teammate'),
    ])).not.toThrow()
  })

  it('throws on duplicate ids', () => {
    expect(() => validateTeamDefinitions([
      makeDef('leader', 'leader'),
      makeDef('dup', 'teammate'),
      makeDef('dup', 'teammate'),
    ])).toThrow(/[Dd]uplicate/)
  })

  it('throws when no leader is defined', () => {
    expect(() => validateTeamDefinitions([
      makeDef('a', 'teammate'),
      makeDef('b', 'teammate'),
    ])).toThrow(/[Nn]o leader/)
  })

  it('throws when multiple leaders are defined', () => {
    expect(() => validateTeamDefinitions([
      makeDef('leader1', 'leader'),
      makeDef('leader2', 'leader'),
    ])).toThrow(/[Mm]ultiple leader/)
  })
})
