import { describe, expect, it } from 'vitest'
import * as toolTeam from '../src/index.ts'

describe('dsh-tool-team plugin shape', () => {
  it('has the namespace-plugin export shape (no stray default)', () => {
    expect('default' in toolTeam).toBe(false)
    expect(toolTeam.name).toBe('tool-team')
    expect(toolTeam.inject).toEqual(['tools', 'team', 'teamControl'])
  })

  it('exports apply function', () => {
    expect(typeof toolTeam.apply).toBe('function')
  })
})
