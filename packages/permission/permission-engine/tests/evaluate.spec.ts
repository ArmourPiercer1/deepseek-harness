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

describe('compound command denial through evaluatePermission', () => {
  const denyRule = commandRule('deny', 'managed', 'rm -rf *')
  const allowAll = commandRule('allow', 'teammate', '*')

  it('denies a Bash compound command when any subcommand matches a deny rule', () => {
    const decision = evaluatePermission(
      { name: 'Bash', arguments: { command: 'git status && rm -rf /var/data' } },
      [allowAll, denyRule],
      'default',
      pathBases,
    )
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.cause).toBe('rule')
      expect(decision.matchedRule?.kind).toBe('deny')
      expect(decision.matchedRule?.layer).toBe('managed')
    }
  })

  it('denies a pwsh compound command when a subcommand matches a deny rule through alias canonicalization', () => {
    const pwshDeny: CompiledRule = {
      kind: 'deny',
      layer: 'managed',
      tool: 'pwsh',
      raw: 'pwsh(Remove-Item *)',
      matcher: { kind: 'command', tool: 'pwsh', pattern: 'Remove-Item *' },
    }
    const decision = evaluatePermission(
      { name: 'pwsh', arguments: { command: 'Get-ChildItem x; del foo' } },
      [commandRule('allow', 'teammate', '*'), pwshDeny],
      'default',
      pathBases,
    )
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.cause).toBe('rule')
      expect(decision.matchedRule?.kind).toBe('deny')
    }
  })

  it('does not deny a compound command when no subcommand matches the deny rule', () => {
    const decision = evaluatePermission(
      { name: 'Bash', arguments: { command: 'git status && git diff' } },
      [denyRule, allowAll],
      'default',
      pathBases,
    )
    expect(decision.kind).toBe('allow')
    expect(decision.matchedRule?.kind).toBe('allow')
  })
})

describe('a managed-layer deny over a project-layer allow', () => {
  const projectAllow = commandRule('allow', 'project')
  const managedDeny = commandRule('deny', 'managed')

  it('wins in default mode with the managed rule as the deciding rule', () => {
    const decision = evaluatePermission(bashCall, [projectAllow, managedDeny], 'default', pathBases)
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.cause).toBe('rule')
      expect(decision.matchedRule?.kind).toBe('deny')
      expect(decision.matchedRule?.layer).toBe('managed')
    }
  })

  it('wins in enforce mode with the managed rule as the deciding rule', () => {
    const decision = evaluatePermission(bashCall, [projectAllow, managedDeny], 'enforce', pathBases)
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.cause).toBe('rule')
      expect(decision.matchedRule?.layer).toBe('managed')
    }
  })
})
