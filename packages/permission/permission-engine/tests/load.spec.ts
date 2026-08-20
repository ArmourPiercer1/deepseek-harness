import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ManagedRulesMissingError,
  RuleFileError,
  loadRuleLayers,
  mergeRuleSources,
  parseRuleFileText,
  readRuleLayer,
} from '../src/load.ts'
import { parseRule } from '../src/parse.ts'
import { evaluatePermission } from '../src/index.ts'
import type { PathMatchBases } from '../src/match-path.ts'
import type { ToolCallView } from '@deepseek-ai/dsh-permission'

const pathBases: PathMatchBases = { settingsDir: '/p', homeDir: '/h', cwd: '/p' }

describe('parseRuleFileText', () => {
  it('parses block-list rules for every stance', () => {
    const rules = parseRuleFileText([
      'permissions:',
      '  deny:',
      '    - Bash(rm -rf *)',
      '    - "Read(//**/.env)"',
      '  ask:',
      '    - "Bash(git push:*)"',
      '  allow:',
      '    - Bash(git status:*)',
    ].join('\n'), 'rule.yml')
    expect(rules).toEqual({
      deny: ['Bash(rm -rf *)', 'Read(//**/.env)'],
      ask: ['Bash(git push:*)'],
      allow: ['Bash(git status:*)'],
    })
  })

  it('parses inline arrays, keeping quoted entries with commas intact', () => {
    const rules = parseRuleFileText(
      'permissions:\n  deny: ["Bash(echo a,b)", Bash(rm *)]\n  allow: [Bash(git status:*)]\n',
      'rule.yml',
    )
    expect(rules).toEqual({
      deny: ['Bash(echo a,b)', 'Bash(rm *)'],
      allow: ['Bash(git status:*)'],
    })
  })

  it('treats an empty inline array as an absent stance', () => {
    expect(parseRuleFileText('permissions:\n  deny: []\n', 'rule.yml')).toEqual({})
  })

  it('skips comments and blank lines', () => {
    const rules = parseRuleFileText(
      '# org policy\n\npermissions:\n  # the deny stance\n  deny:\n    - Bash(rm *)\n',
      'rule.yml',
    )
    expect(rules).toEqual({ deny: ['Bash(rm *)'] })
  })

  it('accepts a file without a permissions key as an empty policy', () => {
    expect(parseRuleFileText('# nothing here\n', 'rule.yml')).toEqual({})
  })

  it('rejects an unknown top-level key', () => {
    expect(() => parseRuleFileText('other:\n  deny: []\npermissions:\n', 'rule.yml'))
      .toThrowError(RuleFileError)
    try {
      parseRuleFileText('other:\n  deny: []\npermissions:\n', 'rule.yml')
    } catch (e: unknown) {
      expect((e as RuleFileError).message).toContain('unknown top-level key "other"')
    }
  })

  it('rejects an unknown nested key', () => {
    expect(() => parseRuleFileText('permissions:\n  forbid: []\n', 'rule.yml'))
      .toThrowError(RuleFileError)
  })

  it('rejects a scalar value under a stance key', () => {
    expect(() => parseRuleFileText('permissions:\n  deny: Bash(rm *)\n', 'rule.yml'))
      .toThrowError(RuleFileError)
  })

  it('rejects an empty rule entry', () => {
    expect(() => parseRuleFileText('permissions:\n  deny:\n    - ""\n', 'rule.yml'))
      .toThrowError(RuleFileError)
  })

  it('rejects an unterminated quote in an inline array', () => {
    expect(() => parseRuleFileText('permissions:\n  deny: ["Bash(rm *)]\n', 'rule.yml'))
      .toThrowError(RuleFileError)
  })
})

describe('readRuleLayer', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-rule-layer-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reports absence for an undefined path', async () => {
    await expect(readRuleLayer('managed', undefined)).resolves.toEqual({ layer: 'managed', present: false, rules: {} })
  })

  it('reports absence for a missing file without throwing', async () => {
    await expect(readRuleLayer('project', join(dir, 'nope.yml')))
      .resolves.toEqual({ layer: 'project', present: false, rules: {} })
  })

  it('reads and parses a present file', async () => {
    const path = join(dir, 'permissions.yml')
    await writeFile(path, 'permissions:\n  deny:\n    - Bash(rm *)\n')
    await expect(readRuleLayer('managed', path)).resolves.toEqual({
      layer: 'managed',
      present: true,
      rules: { deny: ['Bash(rm *)'] },
    })
  })

  it('throws a RuleFileError for a malformed file', async () => {
    const path = join(dir, 'permissions.yml')
    await writeFile(path, 'permissions:\n  forbid: []\n')
    await expect(readRuleLayer('managed', path)).rejects.toThrowError(RuleFileError)
  })
})

describe('mergeRuleSources', () => {
  it('concatenates the file layers with the teammate rules, layer-tagged', () => {
    const merged = mergeRuleSources(
      [
        { layer: 'managed', rules: { deny: ['Bash(rm -rf *)'] } },
        { layer: 'project', rules: { allow: ['Bash(git status:*)'] } },
      ],
      { ask: ['Bash(git push:*)'] },
    )
    expect(merged).toEqual([
      { raw: 'Bash(rm -rf *)', kind: 'deny', layer: 'managed' },
      { raw: 'Bash(git status:*)', kind: 'allow', layer: 'project' },
      { raw: 'Bash(git push:*)', kind: 'ask', layer: 'teammate' },
    ])
  })

  it('deduplicates an identical (kind, raw) rule, keeping the highest layer', () => {
    const merged = mergeRuleSources(
      [
        { layer: 'project', rules: { deny: ['Bash(rm *)'] } },
        { layer: 'managed', rules: { deny: ['Bash(rm *)'] } },
      ],
      { deny: ['Bash(rm *)'] },
    )
    expect(merged).toEqual([{ raw: 'Bash(rm *)', kind: 'deny', layer: 'managed' }])
  })

  it('keeps a deny and an allow that share a raw string', () => {
    const merged = mergeRuleSources(
      [{ layer: 'teammate', rules: { allow: ['Bash(git push:*)'] } }],
      { deny: ['Bash(git push:*)'] },
    )
    expect(merged).toHaveLength(2)
    expect(merged.map(r => r.kind).sort()).toEqual(['allow', 'deny'])
  })

  it('deduplicates an identical entry within one layer', () => {
    const merged = mergeRuleSources(
      [{ layer: 'managed', rules: { deny: ['Bash(rm *)', 'Bash(rm *)'] } }],
    )
    expect(merged).toEqual([{ raw: 'Bash(rm *)', kind: 'deny', layer: 'managed' }])
  })

  it('returns the file layers alone when the scope has no teammate rules', () => {
    const merged = mergeRuleSources(
      [{ layer: 'project', rules: { allow: ['Bash(git status:*)'] } }],
    )
    expect(merged).toEqual([{ raw: 'Bash(git status:*)', kind: 'allow', layer: 'project' }])
  })
})

describe('deny absoluteness across the merged layers', () => {
  const merged = mergeRuleSources(
    [{ layer: 'managed', rules: { deny: ['Bash(rm *)'] } }],
    { allow: ['Bash(rm *)'], ask: ['Bash(rm *)'] },
  )
  const compiled = merged
    .map(s => parseRule(s.raw, s.kind, s.layer).rule)
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
  const call: ToolCallView = { name: 'Bash', arguments: { command: 'rm important.txt' } }

  it('a managed deny wins over a teammate allow and ask in default mode', () => {
    const decision = evaluatePermission(call, compiled, 'default', pathBases)
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.cause).toBe('rule')
      expect(decision.matchedRule?.layer).toBe('managed')
    }
  })

  it('a managed deny wins over a teammate allow in enforce mode', () => {
    const decision = evaluatePermission(call, compiled, 'enforce', pathBases)
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.matchedRule?.kind).toBe('deny')
    }
  })
})

describe('loadRuleLayers', () => {
  let home: string
  let workspace: string
  const managedPath = (): string => join(home, 'permissions.yml')
  const projectPath = (): string => join(workspace, '.dsh', 'permissions.yml')

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-rule-home-'))
    workspace = await mkdtemp(join(tmpdir(), 'dsh-rule-ws-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  it('reconstructs the full rule set from the file layers and the teammate snapshot', async () => {
    await writeFile(managedPath(), 'permissions:\n  deny:\n    - Bash(rm -rf *)\n')
    await mkdir(join(workspace, '.dsh'), { recursive: true })
    await writeFile(projectPath(), 'permissions:\n  allow:\n    - Bash(git status:*)\n')
    const loaded = await loadRuleLayers({
      managedPath: managedPath(),
      projectPath: projectPath(),
      teammateRules: { ask: ['Bash(git push:*)'] },
    })
    expect(loaded).toEqual({
      rules: [
        { raw: 'Bash(rm -rf *)', kind: 'deny', layer: 'managed' },
        { raw: 'Bash(git status:*)', kind: 'allow', layer: 'project' },
        { raw: 'Bash(git push:*)', kind: 'ask', layer: 'teammate' },
      ],
      managedPresent: true,
      projectPresent: true,
    })
  })

  it('reconstructs the same rule set on every load of the same layers and snapshot', async () => {
    await writeFile(managedPath(), 'permissions:\n  deny:\n    - Bash(rm -rf *)\n')
    const options = {
      managedPath: managedPath(),
      projectPath: projectPath(),
      teammateRules: { ask: ['Bash(git push:*)'] },
    }
    const first = await loadRuleLayers(options)
    const second = await loadRuleLayers(options)
    expect(second.rules).toEqual(first.rules)
  })

  it('refuses the load when the managed file a bound scope expected is missing', async () => {
    await expect(
      loadRuleLayers({
        managedPath: managedPath(),
        projectPath: projectPath(),
        managedPresent: true,
      }),
    ).rejects.toThrowError(ManagedRulesMissingError)
    await expect(
      loadRuleLayers({
        managedPath: managedPath(),
        projectPath: projectPath(),
        managedPresent: true,
      }),
    ).rejects.toThrow('managed rule file')
  })

  it('refuses the load when the managed file is unresolvable but expected', async () => {
    await expect(
      loadRuleLayers({ projectPath: projectPath(), managedPresent: true }),
    ).rejects.toThrowError(ManagedRulesMissingError)
  })

  it('does not refuse when no managed policy was present at bind time', async () => {
    const loaded = await loadRuleLayers({
      managedPath: managedPath(),
      projectPath: projectPath(),
      managedPresent: false,
    })
    expect(loaded.managedPresent).toBe(false)
    expect(loaded.projectPresent).toBe(false)
    expect(loaded.rules).toEqual([])
  })

  it('picks up a managed policy deployed after the bind', async () => {
    await writeFile(managedPath(), 'permissions:\n  deny:\n    - Bash(rm -rf *)\n')
    const loaded = await loadRuleLayers({
      managedPath: managedPath(),
      projectPath: projectPath(),
      managedPresent: false,
    })
    expect(loaded.managedPresent).toBe(true)
    expect(loaded.rules).toEqual([{ raw: 'Bash(rm -rf *)', kind: 'deny', layer: 'managed' }])
  })

  it('throws a RuleFileError when a present layer file is malformed', async () => {
    await mkdir(join(workspace, '.dsh'), { recursive: true })
    await writeFile(projectPath(), 'permissions:\n  forbid: []\n')
    await expect(
      loadRuleLayers({ managedPath: managedPath(), projectPath: projectPath() }),
    ).rejects.toThrowError(RuleFileError)
  })
})
