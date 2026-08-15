import { describe, expect, it } from 'vitest'
import { evaluatePermission } from '../src/index.ts'
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

describe('evaluatePermission', () => {
  it('deny overrides a matching allow', () => {
    const decision = evaluatePermission(
      bashCall,
      [commandRule('allow', 'managed'), commandRule('deny', 'managed')],
      'default',
      pathBases,
    )
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.cause).toBe('rule')
      expect(decision.matchedRule?.layer).toBe('managed')
    }
  })

  it('ask overrides a matching allow', () => {
    const decision = evaluatePermission(
      bashCall,
      [commandRule('allow', 'managed'), commandRule('ask', 'project')],
      'default',
      pathBases,
    )
    expect(decision.kind).toBe('ask')
    expect(decision.matchedRule?.kind).toBe('ask')
  })

  it('allow wins when no deny or ask matches', () => {
    const decision = evaluatePermission(
      bashCall,
      [commandRule('allow', 'managed')],
      'enforce',
      pathBases,
    )
    expect(decision.kind).toBe('allow')
    expect(decision.matchedRule?.raw).toBe('Bash(rm *)')
  })

  it('enforce mode falls back to denying an unmatched call', () => {
    const decision = evaluatePermission(
      bashCall,
      [commandRule('allow', 'managed', 'git status *')],
      'enforce',
      pathBases,
    )
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.cause).toBe('mode')
      expect(decision.matchedRule).toBeUndefined()
    }
  })

  it('default mode falls back to allowing an unmatched call', () => {
    const decision = evaluatePermission(
      bashCall,
      [commandRule('allow', 'managed', 'git status *')],
      'default',
      pathBases,
    )
    expect(decision.kind).toBe('allow')
    expect(decision.matchedRule).toBeUndefined()
  })

  it('decides an mcp rule through the same path', () => {
    const decision = evaluatePermission(
      mcpCall,
      [mcpRule('deny', 'managed', 'query')],
      'default',
      pathBases,
    )
    expect(decision.kind).toBe('deny')
    expect(decision.matchedRule?.matcher).toBe('mcp')
  })
})
