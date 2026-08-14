import { describe, expect, it } from 'vitest'
import { TeamMemberId, DEFAULT_LEADER_TOOLS, TEAMMATE_DENIED_TOOLS } from '@deepseek-ai/dsh-team'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import { buildToolRestriction } from '../src/tool-policy.ts'

function makeMember(role: 'leader' | 'teammate', tools?: { allow?: string[]; deny?: string[] }): TeamMemberDefinition {
  return {
    id: TeamMemberId('test'),
    role,
    name: 'Test',
    description: 'Test',
    prompt: 'Test',
    ...(tools ? { tools } : {}),
  }
}

describe('buildToolRestriction', () => {
  describe('leader', () => {
    it('includes DEFAULT_LEADER_TOOLS in allow when leader has allow list', () => {
      const restriction = buildToolRestriction(makeMember('leader', { allow: ['custom_tool'] }))
      for (const tool of DEFAULT_LEADER_TOOLS) {
        expect(restriction.allow).toContain(tool)
      }
      expect(restriction.allow).toContain('custom_tool')
    })

    it('returns no allow list when leader has no allow config', () => {
      const restriction = buildToolRestriction(makeMember('leader'))
      expect(restriction.allow).toBeUndefined()
    })

    it('cannot deny DEFAULT_LEADER_TOOLS', () => {
      const restriction = buildToolRestriction(
        makeMember('leader', { deny: ['delegate_to_teammate', 'custom_deny'] }),
      )
      expect(restriction.deny).not.toContain('delegate_to_teammate')
      expect(restriction.deny).toContain('custom_deny')
    })
  })

  describe('teammate', () => {
    it('always denies team control tools', () => {
      const restriction = buildToolRestriction(makeMember('teammate'))
      for (const tool of TEAMMATE_DENIED_TOOLS) {
        expect(restriction.deny).toContain(tool)
      }
    })

    it('merges definition deny with TEAMMATE_DENIED_TOOLS', () => {
      const restriction = buildToolRestriction(
        makeMember('teammate', { deny: ['pwsh'] }),
      )
      expect(restriction.deny).toContain('pwsh')
      for (const tool of TEAMMATE_DENIED_TOOLS) {
        expect(restriction.deny).toContain(tool)
      }
    })

    it('passes through allow list from definition', () => {
      const restriction = buildToolRestriction(
        makeMember('teammate', { allow: ['read', 'write'] }),
      )
      expect(restriction.allow).toEqual(['read', 'write'])
    })
  })
})
