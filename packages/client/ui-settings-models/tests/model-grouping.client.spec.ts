// @vitest-environment node
/** Family derivation and candidate grouping for the model picker. */
import { describe, expect, it } from 'vitest'
import { familyLabel, groupCandidates, modelFamily } from '../src/client/modelGrouping.ts'

describe('modelFamily', () => {
  it.each([
    ['claude-3-5-sonnet-20241022', 'claude'],
    ['claude-3-opus-20240229', 'claude'],
    ['gemini-2.0-flash', 'gemini'],
    ['gpt-4o', 'gpt'],
    ['gpt-4o-mini', 'gpt'],
    ['deepseek-chat', 'deepseek'],
    ['o1', 'o1'],
    ['o3-mini', 'o3'],
    ['qwen2.5-72b-instruct', 'qwen2.5'],
  ])('reads the family of %j as %j', (id, expected) => {
    expect(modelFamily(id)).toBe(expected)
  })

  it('classifies a vendor-qualified id by what follows the slash', () => {
    expect(modelFamily('openai/gpt-4o')).toBe('gpt')
    expect(modelFamily('anthropic/claude-3-5-sonnet')).toBe('claude')
    expect(modelFamily('google/gemini-2.0-flash')).toBe('gemini')
  })

  it('lowercases and trims the token', () => {
    expect(modelFamily('GLM-4-Plus')).toBe('glm')
    expect(modelFamily('  gpt-4o  ')).toBe('gpt')
  })

  it('yields an empty family for a blank id', () => {
    expect(modelFamily('')).toBe('')
    expect(modelFamily('   ')).toBe('')
  })

  it('yields an empty family for an id with no identifier token', () => {
    expect(modelFamily('-')).toBe('')
    expect(modelFamily('/')).toBe('')
  })
})

describe('familyLabel', () => {
  it.each([
    ['claude', 'Claude'],
    ['gemini', 'Gemini'],
    ['deepseek', 'DeepSeek'],
    ['gpt', 'GPT'],
    ['glm', 'GLM'],
    ['o1', 'o1'],
    ['o3', 'o3'],
    ['minimax', 'MiniMax'],
  ])('spells %j as %j', (family, expected) => {
    expect(familyLabel(family)).toBe(expected)
  })

  it('falls back to title case for a family the label table does not know', () => {
    expect(familyLabel('qwen')).toBe('Qwen')
    expect(familyLabel('moonshot')).toBe('Moonshot')
  })

  it('keeps a blank key blank', () => {
    expect(familyLabel('')).toBe('')
  })
})

describe('groupCandidates', () => {
  it('groups in first-appearance order, preserving order inside each group', () => {
    const groups = groupCandidates([
      { id: 'claude-3-5-sonnet-20241022' },
      { id: 'gpt-4o' },
      { id: 'gemini-2.0-flash' },
      { id: 'claude-3-opus-20240229' },
    ])
    expect(groups.map(group => group.family)).toEqual(['claude', 'gpt', 'gemini'])
    expect(groups[0]?.models.map(model => model.id)).toEqual([
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
    ])
    expect(groups[1]?.models.map(model => model.id)).toEqual(['gpt-4o'])
    expect(groups[2]?.models.map(model => model.id)).toEqual(['gemini-2.0-flash'])
  })

  it('merges vendor-qualified and plain ids of one family into one group', () => {
    const groups = groupCandidates([
      { id: 'openai/gpt-4o' },
      { id: 'gpt-4o-mini' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual({
      family: 'gpt',
      label: 'GPT',
      models: [{ id: 'openai/gpt-4o' }, { id: 'gpt-4o-mini' }],
    })
  })

  it('carries the candidates\u2019 disclosed metadata into the group', () => {
    const groups = groupCandidates([{ id: 'acme-large', contextWindow: 65_536, maxTokens: 8192 }])
    expect(groups[0]?.models[0]).toEqual({ id: 'acme-large', contextWindow: 65_536, maxTokens: 8192 })
  })

  it('leaves a blank-id candidate in its own empty-keyed group', () => {
    const groups = groupCandidates([{ id: '   ' }, { id: 'gpt-4o' }])
    expect(groups[0]).toEqual({ family: '', label: '', models: [{ id: '   ' }] })
    expect(groups[1]?.family).toBe('gpt')
  })

  it('returns no groups for an empty listing', () => {
    expect(groupCandidates([])).toEqual([])
  })
})
