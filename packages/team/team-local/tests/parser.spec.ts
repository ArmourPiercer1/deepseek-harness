import { describe, expect, it } from 'vitest'
import { parseTeamMemberMarkdown } from '../src/parser.ts'

const VALID_LEADER = `---
schemaVersion: 1
id: team-leader
role: leader
name: Team Leader
description: Coordinates all teammates.
model: deepseek-v4-flash-0731
maxTokens: 16384
---

You are the team leader. Coordinate all teammates effectively.
`

const VALID_TEAMMATE = `---
schemaVersion: 1
id: backend-dev
role: teammate
name: Backend Developer
description: Handles server-side logic.
provider: Qiyuan-Inter
model: deepseek-v4-flash-0731
maxTokens: 16384
tools:
  allow: [read, edit, write, grep, glob, pwsh]
requiresApproval: [write, pwsh]
mcpServers:
  servers: [postgres-mcp]
contextPolicy: persistent
---

You are a senior backend developer specializing in Node.js and TypeScript.
`

describe('parseTeamMemberMarkdown', () => {
  it('parses a valid leader definition', () => {
    const result = parseTeamMemberMarkdown(VALID_LEADER, '/test/leader.md')
    expect(result.definition).toBeDefined()
    expect(result.definition!.id).toBe('team-leader')
    expect(result.definition!.role).toBe('leader')
    expect(result.definition!.name).toBe('Team Leader')
    expect(result.definition!.model).toBe('deepseek-v4-flash-0731')
    expect(result.definition!.prompt).toContain('team leader')
    expect(result.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0)
  })

  it('parses a valid teammate definition with all fields', () => {
    const result = parseTeamMemberMarkdown(VALID_TEAMMATE, '/test/teammate.md')
    expect(result.definition).toBeDefined()
    expect(result.definition!.id).toBe('backend-dev')
    expect(result.definition!.role).toBe('teammate')
    expect(result.definition!.provider).toBe('Qiyuan-Inter')
    expect(result.definition!.tools?.allow).toEqual(['read', 'edit', 'write', 'grep', 'glob', 'pwsh'])
    expect(result.definition!.requiresApproval).toEqual(['write', 'pwsh'])
    expect(result.definition!.mcpServers?.servers).toEqual(['postgres-mcp'])
    expect(result.definition!.contextPolicy).toBe('persistent')
  })

  it('reports error for missing frontmatter', () => {
    const result = parseTeamMemberMarkdown('No frontmatter here', '/test/bad.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('frontmatter'))).toBe(true)
  })

  it('reports error for unsupported schemaVersion', () => {
    const content = `---
schemaVersion: 99
id: test
role: teammate
name: Test
description: Test
---

Test prompt
`
    const result = parseTeamMemberMarkdown(content, '/test/bad.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('schemaVersion'))).toBe(true)
  })

  it('reports error for missing required fields', () => {
    const content = `---
schemaVersion: 1
id: test
---

Test prompt
`
    const result = parseTeamMemberMarkdown(content, '/test/bad.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error')).toBe(true)
  })

  it('reports warning for empty prompt body', () => {
    const content = `---
schemaVersion: 1
id: test
role: teammate
name: Test
description: Test
---
`
    const result = parseTeamMemberMarkdown(content, '/test/warn.md')
    expect(result.diagnostics.some(d => d.severity === 'warning' && d.message.includes('Empty prompt body'))).toBe(true)
  })
})
