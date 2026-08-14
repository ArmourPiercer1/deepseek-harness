import { describe, expect, it } from 'vitest'
import { TeamMemberId } from '../src/brand.ts'

describe('TeamMemberId brand', () => {
  it('constructs from a plain string', () => {
    const id = TeamMemberId('backend-dev')
    expect(id).toBe('backend-dev')
  })

  it('round-trips through string coercion', () => {
    const id = TeamMemberId('leader')
    const plain: string = id
    expect(plain).toBe('leader')
    expect(TeamMemberId(plain)).toBe(id)
  })

  it('preserves identity across construction', () => {
    const a = TeamMemberId('test')
    const b = TeamMemberId('test')
    expect(a).toBe(b)
  })
})
