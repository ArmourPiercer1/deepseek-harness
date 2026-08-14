/**
 * Markdown team member definition parser.
 * Extracts YAML frontmatter and Markdown body from a `.md` file.
 *
 * @module @deepseek-ai/dsh-team-local
 */

import { TeamMemberId } from '@deepseek-ai/dsh-team'
import type {
  TeamMemberDefinition,
  TeamMemberRole,
  TeamContextPolicy,
  TeamToolPolicy,
  TeamSkillPolicy,
  TeamMcpPolicy,
} from '@deepseek-ai/dsh-team'

/** Diagnostic from parsing a team member definition file. */
export interface ParseDiagnostic {
  /** Error severity. */
  readonly severity: 'error' | 'warning'
  /** Human-readable diagnostic message. */
  readonly message: string
}

/** Result of parsing one Markdown team member definition. */
export interface ParseResult {
  /** The parsed definition (present even with warnings; absent on errors). */
  readonly definition?: TeamMemberDefinition
  /** Diagnostics collected during parsing. */
  readonly diagnostics: readonly ParseDiagnostic[]
}

const FRONTMATTER_DELIMITER = '---'
const SUPPORTED_SCHEMA_VERSION = 1
const VALID_ROLES: readonly string[] = ['leader', 'teammate']
const VALID_CONTEXT_POLICIES: readonly string[] = ['persistent', 'fresh_per_delegation']

/**
 * Parse one Markdown file into a {@link TeamMemberDefinition}.
 *
 * @param content - raw UTF-8 file content.
 * @param sourcePath - filesystem path for diagnostics.
 * @returns parsed definition and any diagnostics.
 */
export function parseTeamMemberMarkdown(
  content: string,
  sourcePath: string,
): ParseResult {
  const diagnostics: ParseDiagnostic[] = []

  // Split frontmatter from body
  const trimmed = content.trimStart()
  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    diagnostics.push({ severity: 'error', message: 'Missing YAML frontmatter delimiter (---)' })
    return { diagnostics }
  }

  const afterFirst = trimmed.slice(FRONTMATTER_DELIMITER.length)
  const endIdx = afterFirst.indexOf(`\n${FRONTMATTER_DELIMITER}`)
  if (endIdx === -1) {
    diagnostics.push({ severity: 'error', message: 'Missing closing YAML frontmatter delimiter (---)' })
    return { diagnostics }
  }

  const yamlContent = afterFirst.slice(0, endIdx)
  const body = afterFirst.slice(endIdx + 1 + FRONTMATTER_DELIMITER.length).trim()

  // Parse YAML frontmatter
  let frontmatter: Record<string, unknown>
  try {
    frontmatter = parseSimpleYaml(yamlContent)
  } catch (e: unknown) {
    diagnostics.push({ severity: 'error', message: `YAML parse error: ${e instanceof Error ? e.message : String(e)}` })
    return { diagnostics }
  }

  // Validate schemaVersion
  const schemaVersion = frontmatter['schemaVersion']
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    diagnostics.push({
      severity: 'error',
      message: `Unsupported schemaVersion: ${String(schemaVersion)} (expected ${SUPPORTED_SCHEMA_VERSION})`,
    })
    return { diagnostics }
  }

  // Validate required fields
  const id = frontmatter['id']
  if (typeof id !== 'string' || id.length === 0) {
    diagnostics.push({ severity: 'error', message: 'Missing or empty required field: id' })
    return { diagnostics }
  }

  const role = frontmatter['role']
  if (typeof role !== 'string' || !VALID_ROLES.includes(role)) {
    diagnostics.push({ severity: 'error', message: `Invalid or missing role: ${String(role)} (expected 'leader' | 'teammate')` })
    return { diagnostics }
  }

  const memberName = frontmatter['name']
  if (typeof memberName !== 'string' || memberName.length === 0) {
    diagnostics.push({ severity: 'error', message: 'Missing or empty required field: name' })
    return { diagnostics }
  }

  const description = frontmatter['description']
  if (typeof description !== 'string' || description.length === 0) {
    diagnostics.push({ severity: 'error', message: 'Missing or empty required field: description' })
    return { diagnostics }
  }

  // Prompt body
  if (body.length === 0) {
    diagnostics.push({ severity: 'warning', message: 'Empty prompt body (Markdown content after frontmatter)' })
  }

  // Optional fields
  const provider = typeof frontmatter['provider'] === 'string' ? frontmatter['provider'] : undefined
  const model = typeof frontmatter['model'] === 'string' ? frontmatter['model'] : undefined
  const maxTokens = typeof frontmatter['maxTokens'] === 'number' ? frontmatter['maxTokens'] : undefined

  // Tool policy
  let tools: TeamToolPolicy | undefined
  const rawTools = frontmatter['tools']
  if (rawTools != null && typeof rawTools === 'object' && !Array.isArray(rawTools)) {
    const t = rawTools as Record<string, unknown>
    tools = {
      ...(Array.isArray(t['allow']) ? { allow: (t['allow'] as unknown[]).map(String) } : {}),
      ...(Array.isArray(t['deny']) ? { deny: (t['deny'] as unknown[]).map(String) } : {}),
    }
  }

  // Skill policy
  let skills: TeamSkillPolicy | undefined
  const rawSkills = frontmatter['skills']
  if (rawSkills != null && typeof rawSkills === 'object' && !Array.isArray(rawSkills)) {
    const s = rawSkills as Record<string, unknown>
    if (Array.isArray(s['allow'])) {
      skills = { allow: (s['allow'] as unknown[]).map(String) }
    }
  }

  // MCP policy
  let mcpServers: TeamMcpPolicy | undefined
  const rawMcp = frontmatter['mcpServers']
  if (rawMcp != null && typeof rawMcp === 'object' && !Array.isArray(rawMcp)) {
    const m = rawMcp as Record<string, unknown>
    if (Array.isArray(m['servers'])) {
      mcpServers = { servers: (m['servers'] as unknown[]).map(String) }
    }
  }

  // Context policy
  let contextPolicy: TeamContextPolicy | undefined
  const rawCtxPolicy = frontmatter['contextPolicy']
  if (typeof rawCtxPolicy === 'string') {
    if (VALID_CONTEXT_POLICIES.includes(rawCtxPolicy)) {
      contextPolicy = rawCtxPolicy as TeamContextPolicy
    } else {
      diagnostics.push({
        severity: 'warning',
        message: `Unknown contextPolicy: ${rawCtxPolicy} (expected 'persistent' | 'fresh_per_delegation')`,
      })
    }
  }

  const definition: TeamMemberDefinition = {
    id: TeamMemberId(id),
    role: role as TeamMemberRole,
    name: memberName,
    description,
    prompt: body,
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    ...(contextPolicy !== undefined ? { contextPolicy } : {}),
    sourcePath,
  }

  return { definition, diagnostics }
}

/**
 * Minimal YAML parser for frontmatter. Handles simple key-value pairs,
 * arrays, and nested objects one level deep.
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = content.split('\n')
  let currentKey: string | undefined
  let currentArray: unknown[] | undefined
  let currentObject: Record<string, unknown> | undefined

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim().length === 0 || line.trim().startsWith('#')) continue

    // Array item under current key
    if (/^\s+-\s/.test(line) && currentKey !== undefined) {
      const value = line.replace(/^\s+-\s+/, '').trim()
      if (currentArray === undefined) {
        currentArray = []
      }
      currentArray.push(parseYamlValue(value))
      result[currentKey] = currentArray
      continue
    }

    // Nested key under current key (indented)
    if (/^\s+\w/.test(line) && currentKey !== undefined && currentArray === undefined) {
      const nestedMatch = /^\s+(\w+):\s*(.*)$/.exec(line)
      if (nestedMatch) {
        const nestedKey = nestedMatch[1]!
        const nestedRaw = nestedMatch[2]!.trim()
        if (currentObject === undefined) {
          currentObject = {}
        }
        if (nestedRaw.startsWith('[') && nestedRaw.endsWith(']')) {
          currentObject[nestedKey] = nestedRaw
            .slice(1, -1)
            .split(',')
            .map(s => parseYamlValue(s.trim()))
        } else if (nestedRaw.length > 0) {
          currentObject[nestedKey] = parseYamlValue(nestedRaw)
        }
        result[currentKey] = currentObject
        continue
      }
    }

    // Top-level key
    const topMatch = /^(\w+):\s*(.*)$/.exec(line)
    if (topMatch) {
      currentArray = undefined
      currentObject = undefined
      const topKey = topMatch[1]!
      const topValue = topMatch[2]!.trim()
      currentKey = topKey
      if (topValue.length === 0) {
        result[topKey] = undefined
      } else if (topValue.startsWith('[') && topValue.endsWith(']')) {
        result[topKey] = topValue
          .slice(1, -1)
          .split(',')
          .map(s => parseYamlValue(s.trim()))
        currentKey = undefined
      } else {
        result[topKey] = parseYamlValue(topValue)
        currentKey = undefined
      }
    }
  }

  return result
}

/** Parse a simple YAML scalar value. */
function parseYamlValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  const num = Number(value)
  if (!Number.isNaN(num) && value.length > 0) return num
  if ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1)
  }
  return value
}
