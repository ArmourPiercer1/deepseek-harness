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
    expect(() => { validateTeamDefinitions([
      makeDef('leader', 'leader'),
      makeDef('backend', 'teammate'),
      makeDef('frontend', 'teammate'),
    ]) }).not.toThrow()
  })

  it('throws on duplicate ids', () => {
    expect(() => { validateTeamDefinitions([
      makeDef('leader', 'leader'),
      makeDef('dup', 'teammate'),
      makeDef('dup', 'teammate'),
    ]) }).toThrow(/[Dd]uplicate/)
  })

  it('throws when no leader is defined', () => {
    expect(() => { validateTeamDefinitions([
      makeDef('a', 'teammate'),
      makeDef('b', 'teammate'),
    ]) }).toThrow(/[Nn]o leader/)
  })

  it('throws when multiple leaders are defined', () => {
    expect(() => { validateTeamDefinitions([
      makeDef('leader1', 'leader'),
      makeDef('leader2', 'leader'),
    ]) }).toThrow(/[Mm]ultiple leader/)
  })

  it('accepts requiresApproval naming allowed, non-denied tools', () => {
    const backend: TeamMemberDefinition = {
      ...makeDef('backend', 'teammate'),
      tools: { allow: ['read', 'pwsh'], deny: ['rm'] },
      requiresApproval: ['pwsh'],
    }
    expect(() => { validateTeamDefinitions([makeDef('leader', 'leader'), backend]) }).not.toThrow()
  })

  it('throws when requiresApproval names a denied tool', () => {
    expect(() => { validateTeamDefinitions([
      makeDef('leader', 'leader'),
      {
        ...makeDef('backend', 'teammate'),
        tools: { deny: ['pwsh'] },
        requiresApproval: ['pwsh'],
      },
    ]) }).toThrow(/denied tool/)
  })

  it('throws when requiresApproval names a tool outside the allow list', () => {
    expect(() => { validateTeamDefinitions([
      makeDef('leader', 'leader'),
      {
        ...makeDef('backend', 'teammate'),
        tools: { allow: ['read'] },
        requiresApproval: ['pwsh'],
      },
    ]) }).toThrow(/not in member/)
  })

  it('accepts a member with a valid skills list', () => {
    expect(() => { validateTeamDefinitions([
      makeDef('leader', 'leader'),
      { ...makeDef('backend', 'teammate'), skills: ['codebase-design', 'tdd'] },
    ]) }).not.toThrow()
  })

  it('throws when skills contains an empty string', () => {
    expect(() => { validateTeamDefinitions([
      makeDef('leader', 'leader'),
      { ...makeDef('backend', 'teammate'), skills: ['codebase-design', ''] },
    ]) }).toThrow(/skills on member "backend" must be an array of non-empty strings/)
  })

  it('throws when skills is not an array', () => {
    expect(() => { validateTeamDefinitions([
      makeDef('leader', 'leader'),
      { ...makeDef('backend', 'teammate'), skills: 'codebase-design' as unknown as readonly string[] },
    ]) }).toThrow(/must be an array of non-empty strings/)
  })
})
