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
skills: [codebase-design, tdd]
mcpServers:
  servers: [postgres-mcp]
contextPolicy: persistent
---

You are a senior backend developer specializing in Node.js and TypeScript.
`

const VALID_SKILLS_BLOCK = `---
schemaVersion: 1
id: docs-writer
role: teammate
name: Docs Writer
description: Writes documentation.
skills:
  - codebase-design
  - tdd
---

You write documentation for the team.
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
    expect(result.definition!.skills).toEqual(['codebase-design', 'tdd'])
    expect(result.definition!.mcpServers?.servers).toEqual(['postgres-mcp'])
    expect(result.definition!.contextPolicy).toBe('persistent')
  })

  it('parses skills given as a block list', () => {
    const result = parseTeamMemberMarkdown(VALID_SKILLS_BLOCK, '/test/skills-block.md')
    expect(result.definition).toBeDefined()
    expect(result.definition!.skills).toEqual(['codebase-design', 'tdd'])
    expect(result.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0)
  })

  it('leaves skills undefined when the frontmatter has no skills key', () => {
    const result = parseTeamMemberMarkdown(VALID_LEADER, '/test/leader.md')
    expect(result.definition).toBeDefined()
    expect(result.definition!.skills).toBeUndefined()
    expect(result.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0)
  })

  it('reports error when skills is not an array', () => {
    const content = `---
schemaVersion: 1
id: test
role: teammate
name: Test
description: Test
skills: codebase-design
---

Test prompt
`
    const result = parseTeamMemberMarkdown(content, '/test/bad-skills.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('skills'))).toBe(true)
  })

  it('reports error when skills contains an empty string', () => {
    const content = `---
schemaVersion: 1
id: test
role: teammate
name: Test
description: Test
skills: [codebase-design, '']
---

Test prompt
`
    const result = parseTeamMemberMarkdown(content, '/test/bad-skills.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('skills'))).toBe(true)
  })

  it('reports error when skills contains a non-string entry', () => {
    const content = `---
schemaVersion: 1
id: test
role: teammate
name: Test
description: Test
skills: [codebase-design, 123]
---

Test prompt
`
    const result = parseTeamMemberMarkdown(content, '/test/bad-skills.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('skills'))).toBe(true)
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

describe('parseTeamMemberMarkdown permissions fields', () => {
  const base = (extra: string) => `---
schemaVersion: 1
id: backend-dev
role: teammate
name: Backend Developer
description: Handles server-side logic.
${extra}---

You are a senior backend developer.
`

  it('parses inline permission rules and mode', () => {
    const result = parseTeamMemberMarkdown(base(`permissions:
  deny: ["Bash(rm -rf *)", "Read(//**/.env)"]
  ask: ["Bash(git push:*)"]
permissionMode: enforce
`), '/test/teammate.md')
    expect(result.definition).toBeDefined()
    expect(result.definition!.permissions).toEqual({
      deny: ['Bash(rm -rf *)', 'Read(//**/.env)'],
      ask: ['Bash(git push:*)'],
    })
    expect(result.definition!.permissionMode).toBe('enforce')
  })

  it('parses block-list permission rules', () => {
    const result = parseTeamMemberMarkdown(base(`permissions:
  deny:
    - Bash(rm -rf *)
    - "Read(//**/.env)"
  allow:
    - Bash(git status:*)
permissionMode: default
`), '/test/teammate.md')
    expect(result.definition).toBeDefined()
    expect(result.definition!.permissions).toEqual({
      deny: ['Bash(rm -rf *)', 'Read(//**/.env)'],
      allow: ['Bash(git status:*)'],
    })
    expect(result.definition!.permissionMode).toBe('default')
  })

  it('leaves permissions undefined when the frontmatter declares none', () => {
    const result = parseTeamMemberMarkdown(base(''), '/test/teammate.md')
    expect(result.definition).toBeDefined()
    expect(result.definition!.permissions).toBeUndefined()
    expect(result.definition!.permissionMode).toBeUndefined()
  })

  it('leaves permissions undefined when every stance is an empty array', () => {
    const result = parseTeamMemberMarkdown(base('permissions:\n  deny: []\n'), '/test/teammate.md')
    expect(result.definition).toBeDefined()
    expect(result.definition!.permissions).toBeUndefined()
  })

  it('reports error when permissions is not an object', () => {
    const result = parseTeamMemberMarkdown(base('permissions: Bash(rm *)\n'), '/test/bad.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('permissions'))).toBe(true)
  })

  it('reports error when a permission stance is not an array of strings', () => {
    const result = parseTeamMemberMarkdown(base('permissions:\n  deny: [Bash(rm *), 123]\n'), '/test/bad.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('permissions.deny'))).toBe(true)
  })

  it('reports error when a permission stance contains an empty string', () => {
    const result = parseTeamMemberMarkdown(base('permissions:\n  ask: [""]\n'), '/test/bad.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('permissions.ask'))).toBe(true)
  })

  it('reports error for an unsupported permissionMode', () => {
    const result = parseTeamMemberMarkdown(base('permissionMode: bypass\n'), '/test/bad.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('permissionMode'))).toBe(true)
  })

  it('reports error for a non-string permissionMode', () => {
    const result = parseTeamMemberMarkdown(base('permissionMode: 1\n'), '/test/bad.md')
    expect(result.definition).toBeUndefined()
    expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('permissionMode'))).toBe(true)
  })
})
