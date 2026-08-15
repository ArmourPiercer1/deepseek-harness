import { describe, expect, it, vi } from 'vitest'
import { appendPermissionDecision, toPermissionDecisionData } from '../src/audit.ts'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PermissionContext, PermissionDecisionData, RuleIR } from '@deepseek-ai/dsh-permission'

function toolCall(name: string) {
  return { name, arguments: {} }
}

const policy = { __compiledPolicy: true as const }

function context(mode: 'enforce' | 'default', memberId?: string): PermissionContext {
  return { policy, mode, pathBases: { settingsDir: '/p', homeDir: '/h', cwd: '/p' }, ...(memberId !== undefined ? { memberId } : {}) }
}

function ir(kind: RuleIR['kind'], layer: RuleIR['layer'], matcher: RuleIR['matcher'], tool: string, raw: string): RuleIR {
  return { kind, layer, tool, matcher, raw }
}

function expectNoUndefined(data: PermissionDecisionData): void {
  const entries = Object.entries(data)
  for (const [key, value] of entries) {
    expect(value, `field ${key}`).not.toBeUndefined()
  }
}

describe('toPermissionDecisionData', () => {
  it('maps an allow decided by a rule', () => {
    const decision = {
      kind: 'allow' as const,
      matchedRule: ir('allow', 'managed', 'command', 'Bash', 'Bash(git push:*)'),
    }
    const data = toPermissionDecisionData(toolCall('Bash'), context('enforce'), decision)
    expect(data).toEqual({
      toolName: 'Bash',
      decision: 'allow',
      mode: 'enforce',
      matchedRuleRaw: 'Bash(git push:*)',
      layer: 'managed',
    })
    expect(data.memberId).toBeUndefined()
    expect(data.cause).toBeUndefined()
    expectNoUndefined(data)
  })

  it('maps an allow mode fallback without a matched rule', () => {
    const decision = { kind: 'allow' as const }
    const data = toPermissionDecisionData(toolCall('Bash'), context('default', 'u-1'), decision)
    expect(data).toEqual({ toolName: 'Bash', decision: 'allow', mode: 'default', memberId: 'u-1' })
    expect(data.matchedRuleRaw).toBeUndefined()
    expect(data.layer).toBeUndefined()
    expectNoUndefined(data)
  })

  it('maps an ask with its matched rule and no cause', () => {
    const decision = {
      kind: 'ask' as const,
      reason: 'requested by rule',
      matchedRule: ir('ask', 'project', 'path', 'Read', 'Read(.env)'),
    }
    const data = toPermissionDecisionData(toolCall('Read'), context('default'), decision)
    expect(data).toEqual({
      toolName: 'Read',
      decision: 'ask',
      mode: 'default',
      matchedRuleRaw: 'Read(.env)',
      layer: 'project',
    })
    expect(data.cause).toBeUndefined()
    expectNoUndefined(data)
  })

  it('maps a deny decided by a rule with its cause and layer', () => {
    const decision = {
      kind: 'deny' as const,
      reason: 'denied by rule',
      cause: 'rule' as const,
      matchedRule: ir('deny', 'teammate', 'command', 'Bash', 'Bash(rm *)'),
    }
    const data = toPermissionDecisionData(toolCall('Bash'), context('enforce', 'u-2'), decision)
    expect(data).toEqual({
      toolName: 'Bash',
      decision: 'deny',
      mode: 'enforce',
      memberId: 'u-2',
      matchedRuleRaw: 'Bash(rm *)',
      layer: 'teammate',
      cause: 'rule',
    })
    expectNoUndefined(data)
  })

  it('maps an enforce-mode deny fallback without a matched rule', () => {
    const decision = { kind: 'deny' as const, reason: 'no matching allow rule (enforce mode)', cause: 'mode' as const }
    const data = toPermissionDecisionData(toolCall('Bash'), context('enforce'), decision)
    expect(data).toEqual({ toolName: 'Bash', decision: 'deny', mode: 'enforce', cause: 'mode' })
    expect(data.matchedRuleRaw).toBeUndefined()
    expect(data.layer).toBeUndefined()
    expectNoUndefined(data)
  })
})

describe('appendPermissionDecision', () => {
  it('appends the permission/decision event with the data', () => {
    const append = vi.fn()
    const session = { append } as unknown as Session
    const data: PermissionDecisionData = { toolName: 'Bash', decision: 'deny', mode: 'enforce', cause: 'mode' }
    appendPermissionDecision(session, data)
    expect(append).toHaveBeenCalledWith('permission/decision', data)
  })
})
