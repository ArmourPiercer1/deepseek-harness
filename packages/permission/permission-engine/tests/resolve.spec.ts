import { describe, expect, it } from 'vitest'
import { matchesRule, resolveDecision } from '../src/resolve.ts'
import type { CompiledRule } from '../src/parse.ts'
import type { PathMatchBases } from '../src/match-path.ts'
import type { ToolCallView } from '@deepseek-ai/dsh-permission'

const pathBases: PathMatchBases = { settingsDir: '/p', homeDir: '/h', cwd: '/p' }

function commandRule(kind: CompiledRule['kind'], layer: CompiledRule['layer'], pattern: string = 'rm *'): CompiledRule {
  return { kind, layer, tool: 'Bash', raw: `Bash(${pattern})`, matcher: { kind: 'command', tool: 'Bash', pattern } }
}

function mcpRule(kind: CompiledRule['kind'], layer: CompiledRule['layer'], tool?: string): CompiledRule {
  const toolSegment = tool === undefined ? '' : `__${tool}`
  return {
    kind,
    layer,
    tool: `mcp__postgres${toolSegment}`,
    raw: `mcp__postgres${toolSegment}`,
    matcher: { kind: 'mcp', server: 'postgres', ...(tool !== undefined ? { tool } : {}) },
  }
}

const bashCall: ToolCallView = { name: 'Bash', arguments: { command: 'rm important.txt' } }
const mcpCall: ToolCallView = { name: 'mcp__postgres__query', arguments: {} }

describe('matchesRule', () => {
  it('dispatches a command matcher', () => {
    expect(matchesRule(commandRule('allow', 'managed').matcher, bashCall, pathBases)).toBe(true)
  })

  it('dispatches an mcp matcher', () => {
    expect(matchesRule(mcpRule('allow', 'managed', 'query').matcher, mcpCall, pathBases)).toBe(true)
  })
})

describe('resolveDecision', () => {
  it('deny overrides a matching allow', () => {
    const decision = resolveDecision({
      call: bashCall,
      rules: [commandRule('allow', 'managed'), commandRule('deny', 'managed')],
      mode: 'default',
      pathBases,
    })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.cause).toBe('rule')
      expect(decision.reason).toContain('Bash(rm *)')
      expect(decision.reason).toContain('(managed)')
      expect(decision.matchedRule?.kind).toBe('deny')
    }
  })

  it('ask overrides a matching allow', () => {
    const decision = resolveDecision({
      call: bashCall,
      rules: [commandRule('allow', 'managed'), commandRule('ask', 'project')],
      mode: 'default',
      pathBases,
    })
    expect(decision.kind).toBe('ask')
    expect(decision.matchedRule?.kind).toBe('ask')
  })

  it('a managed-layer deny beats a teammate-layer allow', () => {
    const decision = resolveDecision({
      call: bashCall,
      rules: [commandRule('allow', 'teammate'), commandRule('deny', 'managed')],
      mode: 'default',
      pathBases,
    })
    expect(decision.kind).toBe('deny')
    expect(decision.matchedRule?.layer).toBe('managed')
  })

  it('enforce mode falls back to denying an unmatched call', () => {
    const decision = resolveDecision({
      call: bashCall,
      rules: [commandRule('allow', 'managed', 'git status *')],
      mode: 'enforce',
      pathBases,
    })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.cause).toBe('mode')
      expect(decision.matchedRule).toBeUndefined()
    }
  })

  it('default mode falls back to allowing an unmatched call', () => {
    const decision = resolveDecision({
      call: bashCall,
      rules: [commandRule('allow', 'managed', 'git status *')],
      mode: 'default',
      pathBases,
    })
    expect(decision.kind).toBe('allow')
    expect(decision.matchedRule).toBeUndefined()
  })

  it('rejects readonly and bypass modes', () => {
    for (const mode of ['readonly', 'bypass'] as const) {
      expect(() =>
        resolveDecision({ call: bashCall, rules: [], mode, pathBases }),
      ).toThrow(`permission mode "${mode}" is not implemented`)
    }
  })

  it('carries matchedRule on a rule-decided outcome and omits it on a mode fallback', () => {
    const ruled = resolveDecision({
      call: bashCall,
      rules: [commandRule('allow', 'managed')],
      mode: 'default',
      pathBases,
    })
    expect(ruled.kind).toBe('allow')
    expect(ruled.matchedRule).toEqual({ kind: 'allow', layer: 'managed', tool: 'Bash', matcher: 'command', raw: 'Bash(rm *)' })

    const fallback = resolveDecision({ call: bashCall, rules: [], mode: 'default', pathBases })
    expect(fallback.kind).toBe('allow')
    expect(fallback.matchedRule).toBeUndefined()
  })

  it('decides a command rule and an mcp rule through the same path', () => {
    const commandDecision = resolveDecision({
      call: bashCall,
      rules: [commandRule('allow', 'managed')],
      mode: 'enforce',
      pathBases,
    })
    expect(commandDecision.kind).toBe('allow')

    const mcpDecision = resolveDecision({
      call: mcpCall,
      rules: [mcpRule('deny', 'managed', 'query')],
      mode: 'default',
      pathBases,
    })
    expect(mcpDecision.kind).toBe('deny')
    expect(mcpDecision.matchedRule?.matcher).toBe('mcp')
  })
})
