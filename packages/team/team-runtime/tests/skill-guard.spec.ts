import { describe, expect, it } from 'vitest'
import { createSkillGuard } from '../src/skill-guard.ts'

describe('createSkillGuard', () => {
  it('allows non-skill tools regardless of their arguments', () => {
    const guard = createSkillGuard(['lit-review'])
    expect(guard({ name: 'read' })).toBeUndefined()
    expect(guard({ name: 'write', arguments: { path: '/tmp/x' } })).toBeUndefined()
    expect(guard({ name: 'skill-filter', arguments: { name: 'any' } })).toBeUndefined()
  })

  it('allows skills in the allowlist', () => {
    const guard = createSkillGuard(['lit-review', 'postgres-query'])
    expect(guard({ name: 'skill', arguments: { name: 'lit-review' } })).toBeUndefined()
    expect(guard({ name: 'skill', arguments: { name: 'postgres-query' } })).toBeUndefined()
  })

  it('denies skills not in the allowlist', () => {
    const guard = createSkillGuard(['lit-review'])
    expect(guard({ name: 'skill', arguments: { name: 'postgres-query' } }))
      .toBe('Skill "postgres-query" is not authorized for this team member')
  })

  it('denies all skills when the allowlist is empty', () => {
    const guard = createSkillGuard([])
    expect(guard({ name: 'skill', arguments: { name: 'any-skill' } })).toBeDefined()
    expect(guard({ name: 'read' })).toBeUndefined()
  })

  it('allows skill calls with missing or invalid arguments', () => {
    const guard = createSkillGuard(['lit-review'])
    expect(guard({ name: 'skill' })).toBeUndefined()
    expect(guard({ name: 'skill', arguments: undefined })).toBeUndefined()
    expect(guard({ name: 'skill', arguments: {} })).toBeUndefined()
    expect(guard({ name: 'skill', arguments: { name: 42 } })).toBeUndefined()
    expect(guard({ name: 'skill', arguments: { name: null } })).toBeUndefined()
    expect(guard({ name: 'skill', arguments: 'not-an-object' })).toBeUndefined()
  })
})
