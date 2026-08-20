/**
 * `dsh teammate` — teammate definition and per-workspace enablement management.
 *
 * Four subcommands over the two storage surfaces the team plugin owns:
 *
 * - **Definitions**: Markdown files with YAML frontmatter under
 *   `$DSH_HOME/teammates/` (global) and `<workspace>/.dsh/teammates/`
 *   (project level) — the layout `dsh-team-local` discovers. A workspace
 *   that defines its own members is self-contained: those files form the
 *   complete visible team, and global definitions never merge into them.
 * - **Enablement**: the `team-enablement` section of the harness settings
 *   document (`settings.yaml` under the harness home) — a record of
 *   workspace path to teammate id to enabled flag. An absent section,
 *   workspace, or teammate means enabled; only an explicit `false` disables,
 *   and the leader can never be disabled.
 *
 * The frontmatter parser and field validation mirror the `dsh-team-local`
 * loader rule for rule: the launcher cannot import that package (it is not a
 * dependency of the published CLI), and a stricter YAML parser here would
 * accept files the loader itself mis-parses. The cross-check battery in
 * `tests/teammate.spec.ts` pins the mirror against the loader's behavior.
 *
 * @module @deepseek-ai/dsh/teammate
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** The `dsh teammate` subcommands. */
export type TeammateSubcommand = 'list' | 'add' | 'enable' | 'disable'

/** Discriminant for leader vs teammate definitions. */
export type TeammateRole = 'leader' | 'teammate'

/** Context window reload strategy for a teammate definition. */
export type TeammateContextPolicy = 'persistent' | 'fresh_per_delegation'

/** Tool allow/deny policy for one teammate definition. */
export interface TeammateToolPolicy {
  /** Tool names the member is allowed to use. Absence means no allowlist filtering. */
  readonly allow?: readonly string[]
  /** Tool names the member is denied from using. */
  readonly deny?: readonly string[]
}

/** MCP server access policy for one teammate definition. */
export interface TeammateMcpPolicy {
  /** MCP server names the member may access. Unlisted servers are denied. */
  readonly servers: readonly string[]
}

/** One teammate definition as the CLI parses and displays it. */
export interface TeammateDefinition {
  /** Unique member id. */
  readonly id: string
  /** Whether the member is the leader or a teammate. */
  readonly role: TeammateRole
  /** Display name. */
  readonly name: string
  /** One-line description of the member's responsibility. */
  readonly description: string
  /** Markdown body — becomes the member's persona prompt. */
  readonly prompt: string
  /** LLM provider route, if overridden. */
  readonly provider?: string
  /** Model id for this member. */
  readonly model?: string
  /** Max output tokens per request. */
  readonly maxTokens?: number
  /** Tool allow/deny policy. */
  readonly tools?: TeammateToolPolicy
  /** Tool names whose execution requires leader approval (teammate only). */
  readonly requiresApproval?: readonly string[]
  /** Skill names the member may load. Absence means unrestricted. */
  readonly skills?: readonly string[]
  /** MCP server access policy. */
  readonly mcpServers?: TeammateMcpPolicy
  /** Context window reload strategy. */
  readonly contextPolicy?: TeammateContextPolicy
  /** Absolute path of the definition file. */
  readonly sourcePath: string
}

/** Diagnostic from parsing one teammate definition file. */
export interface TeammateDiagnostic {
  /** Error severity. */
  readonly severity: 'error' | 'warning'
  /** Human-readable diagnostic message. */
  readonly message: string
}

/** Result of parsing one teammate definition file. */
export interface TeammateParseResult {
  /** Absolute path of the parsed file. */
  readonly sourcePath: string
  /** The parsed definition (present even with warnings; absent on errors). */
  readonly definition?: TeammateDefinition
  /** Diagnostics collected during parsing. */
  readonly diagnostics: readonly TeammateDiagnostic[]
}

/** The `team-enablement` section: workspace path -> teammate id -> enabled. */
export type TeamEnablementSection = Record<string, Record<string, boolean>>

/** Options for one `dsh teammate` invocation. */
export interface TeammateOptions {
  /** Harness home override; defaults to `$DSH_HOME`, then `~/.dsh`. */
  readonly home?: string
  /** Workspace override; defaults to `$DSH_CWD`, then the process cwd. */
  readonly workspace?: string
  /** `add` only: install into the workspace's `.dsh/teammates/` instead of the harness home. */
  readonly workspaceInstall?: boolean
}

const NAME = 'dsh'

/** Frontmatter delimiter for teammate definition files. */
const FRONTMATTER_DELIMITER = '---'

/** The only supported definition schema version. */
const SUPPORTED_SCHEMA_VERSION = 1

/** The accepted member roles. */
const VALID_ROLES: readonly string[] = ['leader', 'teammate']

/** The accepted context policies. */
const VALID_CONTEXT_POLICIES: readonly string[] = ['persistent', 'fresh_per_delegation']

/** Settings section key holding per-workspace teammate enablement. */
export const TEAM_ENABLEMENT_SECTION = 'team-enablement'

/** Whether a filesystem error means absence. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Resolve the workspace the definitions are discovered from and the
 * enablement section is keyed by: an explicit override, then `$DSH_CWD`,
 * then the process cwd — no path normalization, exactly as the loader
 * tracks the workspace it serves.
 * @param override - explicit workspace from the command options.
 * @returns the workspace root path.
 */
export function resolveWorkspace(override?: string): string {
  return override ?? process.env['DSH_CWD'] ?? process.cwd()
}

/**
 * Parse one teammate definition Markdown file into a {@link TeammateDefinition}.
 *
 * Mirrors `dsh-team-local`'s `parseTeamMemberMarkdown` rule for rule: the
 * same delimiter split, the same minimal YAML reading, the same
 * required-field checks, and the same diagnostic wording — so `dsh teammate
 * add` accepts exactly what the loader will accept (the cross-check battery
 * in `tests/teammate.spec.ts` pins the parity).
 *
 * @param content - raw UTF-8 file content.
 * @param sourcePath - filesystem path for diagnostics.
 * @returns parsed definition and any diagnostics.
 */
export function parseTeammateMarkdown(
  content: string,
  sourcePath: string,
): TeammateParseResult {
  const diagnostics: TeammateDiagnostic[] = []

  // Split frontmatter from body
  const trimmed = content.trimStart()
  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    diagnostics.push({ severity: 'error', message: 'Missing YAML frontmatter delimiter (---)' })
    return { sourcePath, diagnostics }
  }

  const afterFirst = trimmed.slice(FRONTMATTER_DELIMITER.length)
  const endIdx = afterFirst.indexOf(`\n${FRONTMATTER_DELIMITER}`)
  if (endIdx === -1) {
    diagnostics.push({ severity: 'error', message: 'Missing closing YAML frontmatter delimiter (---)' })
    return { sourcePath, diagnostics }
  }

  const yamlContent = afterFirst.slice(0, endIdx)
  const body = afterFirst.slice(endIdx + 1 + FRONTMATTER_DELIMITER.length).trim()

  // Parse YAML frontmatter
  let frontmatter: Record<string, unknown>
  try {
    frontmatter = parseSimpleYaml(yamlContent)
  } catch (e: unknown) {
    diagnostics.push({ severity: 'error', message: `YAML parse error: ${e instanceof Error ? e.message : String(e)}` })
    return { sourcePath, diagnostics }
  }

  // Validate schemaVersion
  const schemaVersion = frontmatter['schemaVersion']
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    diagnostics.push({
      severity: 'error',
      message: `Unsupported schemaVersion: ${String(schemaVersion)} (expected ${SUPPORTED_SCHEMA_VERSION})`,
    })
    return { sourcePath, diagnostics }
  }

  // Validate required fields
  const id = frontmatter['id']
  if (typeof id !== 'string' || id.length === 0) {
    diagnostics.push({ severity: 'error', message: 'Missing or empty required field: id' })
    return { sourcePath, diagnostics }
  }

  const role = frontmatter['role']
  if (typeof role !== 'string' || !VALID_ROLES.includes(role)) {
    diagnostics.push({ severity: 'error', message: `Invalid or missing role: ${String(role)} (expected 'leader' | 'teammate')` })
    return { sourcePath, diagnostics }
  }

  const memberName = frontmatter['name']
  if (typeof memberName !== 'string' || memberName.length === 0) {
    diagnostics.push({ severity: 'error', message: 'Missing or empty required field: name' })
    return { sourcePath, diagnostics }
  }

  const description = frontmatter['description']
  if (typeof description !== 'string' || description.length === 0) {
    diagnostics.push({ severity: 'error', message: 'Missing or empty required field: description' })
    return { sourcePath, diagnostics }
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
  let tools: TeammateToolPolicy | undefined
  const rawTools = frontmatter['tools']
  if (rawTools != null && typeof rawTools === 'object' && !Array.isArray(rawTools)) {
    const t = rawTools as Record<string, unknown>
    tools = {
      ...(Array.isArray(t['allow']) ? { allow: (t['allow'] as unknown[]).map(String) } : {}),
      ...(Array.isArray(t['deny']) ? { deny: (t['deny'] as unknown[]).map(String) } : {}),
    }
  }

  // Approval-gated tools (leader approval required before execution)
  let requiresApproval: readonly string[] | undefined
  const rawApproval = frontmatter['requiresApproval']
  if (Array.isArray(rawApproval)) {
    requiresApproval = (rawApproval as unknown[]).map(String)
  }

  // Skill allowlist (skill names the member may load; absence means unrestricted)
  let skills: readonly string[] | undefined
  const rawSkills = frontmatter['skills']
  if (rawSkills !== undefined) {
    if (!Array.isArray(rawSkills) || !rawSkills.every(s => typeof s === 'string' && s.length > 0)) {
      diagnostics.push({ severity: 'error', message: 'skills must be an array of non-empty strings' })
      return { sourcePath, diagnostics }
    }
    skills = rawSkills as readonly string[]
  }

  // MCP policy
  let mcpServers: TeammateMcpPolicy | undefined
  const rawMcp = frontmatter['mcpServers']
  if (rawMcp != null && typeof rawMcp === 'object' && !Array.isArray(rawMcp)) {
    const m = rawMcp as Record<string, unknown>
    if (Array.isArray(m['servers'])) {
      mcpServers = { servers: (m['servers'] as unknown[]).map(String) }
    }
  }

  // Context policy
  let contextPolicy: TeammateContextPolicy | undefined
  const rawCtxPolicy = frontmatter['contextPolicy']
  if (typeof rawCtxPolicy === 'string') {
    if (VALID_CONTEXT_POLICIES.includes(rawCtxPolicy)) {
      contextPolicy = rawCtxPolicy as TeammateContextPolicy
    } else {
      diagnostics.push({
        severity: 'warning',
        message: `Unknown contextPolicy: ${rawCtxPolicy} (expected 'persistent' | 'fresh_per_delegation')`,
      })
    }
  }

  const definition: TeammateDefinition = {
    id,
    role: role as TeammateRole,
    name: memberName,
    description,
    prompt: body,
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(requiresApproval !== undefined ? { requiresApproval } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    ...(contextPolicy !== undefined ? { contextPolicy } : {}),
    sourcePath,
  }

  return { sourcePath, definition, diagnostics }
}

/**
 * Minimal YAML parser for frontmatter, mirrored from `dsh-team-local`.
 * Handles simple key-value pairs, arrays (inline or block), and nested
 * objects one level deep, including a block array under a nested key.
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = content.split('\n')
  let currentKey: string | undefined
  let currentArray: unknown[] | undefined
  let currentObject: Record<string, unknown> | undefined
  // A nested key whose value is a block array the following "- " items fill.
  let pendingNestedKey: string | undefined

  const splitInlineArray = (value: string): unknown[] => {
    const inner = value.slice(1, -1).trim()
    return inner === '' ? [] : inner.split(',').map(s => parseYamlValue(s.trim()))
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim().length === 0 || line.trim().startsWith('#')) continue

    // Array item under current key (or under the pending nested key)
    if (/^\s+-\s/.test(line) && currentKey !== undefined) {
      const value = line.replace(/^\s+-\s+/, '').trim()
      if (currentObject !== undefined && pendingNestedKey !== undefined) {
        const existing = currentObject[pendingNestedKey]
        if (Array.isArray(existing)) existing.push(parseYamlValue(value))
        else currentObject[pendingNestedKey] = [parseYamlValue(value)]
        result[currentKey] = currentObject
      } else if (currentObject === undefined) {
        if (currentArray === undefined) {
          currentArray = []
        }
        currentArray.push(parseYamlValue(value))
        result[currentKey] = currentArray
      }
      continue
    }

    // Nested key under current key (indented)
    if (/^\s+\w/.test(line) && currentKey !== undefined && currentArray === undefined) {
      const nestedMatch = /^\s+(\w+):\s*(.*)$/.exec(line)
      if (nestedMatch) {
        const key = nestedMatch[1]
        const nestedRaw = nestedMatch[2]?.trim() ?? ''
        if (key === undefined) continue
        if (currentObject === undefined) {
          currentObject = {}
        }
        if (nestedRaw.startsWith('[') && nestedRaw.endsWith(']')) {
          currentObject[key] = splitInlineArray(nestedRaw)
        } else if (nestedRaw.length > 0) {
          currentObject[key] = parseYamlValue(nestedRaw)
        } else {
          pendingNestedKey = key
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
      pendingNestedKey = undefined
      const topKey = topMatch[1]
      const topValue = topMatch[2]?.trim() ?? ''
      if (topKey === undefined) continue
      currentKey = topKey
      if (topValue.length === 0) {
        result[topKey] = undefined
      } else if (topValue.startsWith('[') && topValue.endsWith(']')) {
        result[topKey] = splitInlineArray(topValue)
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

/** The definitions visible from one workspace, and where they came from. */
export interface TeammateDiscovery {
  /** Parse results of the visible directory, in sorted filename order. */
  readonly results: readonly TeammateParseResult[]
  /** The scanned directory (which may not exist when no definitions live there). */
  readonly dir: string
  /** Whether the workspace's own definitions are the visible set (self-contained). */
  readonly selfContained: boolean
}

/**
 * List the `.md` definition files of one directory, in sorted filename
 * order. An absent directory is the ordinary empty set, not an error — a
 * fresh harness home has no teammate directory at all.
 * @param dir - the definition directory to scan.
 * @returns the `.md` file names, sorted.
 */
async function listDefinitionFiles(dir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if (isENOENT(error)) return []
    throw error
  }
  return entries.filter(entry => entry.endsWith('.md')).sort()
}

/**
 * Read and parse every definition file of one directory.
 * @param dir - the definition directory.
 * @param files - the file names to read, in scan order.
 * @returns one parse result per file, in scan order.
 */
async function parseDirectory(dir: string, files: readonly string[]): Promise<TeammateParseResult[]> {
  const results: TeammateParseResult[] = []
  for (const file of files) {
    const filePath = join(dir, file)
    results.push(parseTeammateMarkdown(await readFile(filePath, 'utf8'), filePath))
  }
  return results
}

/**
 * Discover the teammate definitions visible from one workspace, mirroring
 * `dsh-team-local`'s loader: a workspace that defines any members under
 * `.dsh/teammates/` is self-contained — its files (even unparsable ones)
 * form the complete visible set and hide the global definitions — while a
 * workspace without any falls back to `$DSH_HOME/teammates/`.
 * @param home - resolved harness home.
 * @param workspace - workspace root.
 * @returns the visible parse results, the scanned directory, and the self-containment fact.
 */
export async function discoverVisibleTeammates(home: string, workspace: string): Promise<TeammateDiscovery> {
  const workspaceDir = join(workspace, '.dsh', 'teammates')
  const workspaceFiles = await listDefinitionFiles(workspaceDir)
  if (workspaceFiles.length > 0) {
    return { results: await parseDirectory(workspaceDir, workspaceFiles), dir: workspaceDir, selfContained: true }
  }
  const homeDir = join(home, 'teammates')
  const homeFiles = await listDefinitionFiles(homeDir)
  return { results: await parseDirectory(homeDir, homeFiles), dir: homeDir, selfContained: false }
}

/**
 * Deduplicate parse results by id (last file wins), keeping at most the
 * last leader — the same reduction the loader applies before registration.
 * @param results - visible parse results, in scan order.
 * @returns the surviving definitions, in scan order.
 */
export function deduplicateTeammates(results: readonly TeammateParseResult[]): TeammateDefinition[] {
  const byId = new Map<string, TeammateDefinition>()
  for (const result of results) {
    if (result.definition !== undefined) byId.set(result.definition.id, result.definition)
  }
  const definitions = [...byId.values()]
  const leaders = definitions.filter(d => d.role === 'leader')
  if (leaders.length <= 1) return definitions
  const survivingLeaderId = leaders.at(-1)?.id
  return definitions.filter(d => d.role !== 'leader' || d.id === survivingLeaderId)
}

/**
 * Absolute path of the harness settings document under one home.
 * @param home - resolved harness home.
 * @returns the document path.
 */
export function settingsDocumentPath(home: string): string {
  return join(home, 'settings.yaml')
}

/** Whether a value is a well-formed `team-enablement` section. */
function isEnablementSection(value: unknown): value is TeamEnablementSection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  for (const workspace of Object.values(value as Record<string, unknown>)) {
    if (typeof workspace !== 'object' || workspace === null || Array.isArray(workspace)) return false
    for (const flag of Object.values(workspace as Record<string, unknown>)) {
      if (typeof flag !== 'boolean') return false
    }
  }
  return true
}

/**
 * Read the harness settings document as the raw namespace-to-section map.
 * @param home - resolved harness home.
 * @returns the document; `{}` when the file is absent or empty.
 * @throws when the file exists but is not a parsable map of namespace sections.
 */
export async function readSettingsDocument(home: string): Promise<Record<string, unknown>> {
  const file = settingsDocumentPath(home)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (isENOENT(error)) return {}
    throw error
  }
  if (text.trim().length === 0) return {}
  let doc: unknown
  try {
    doc = yaml.load(text)
  } catch (error) {
    throw new Error(`invalid settings document at ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (doc !== null && doc !== undefined && (typeof doc !== 'object' || Array.isArray(doc))) {
    throw new Error(`${file} must be a map of namespace sections`)
  }
  return (doc ?? {}) as Record<string, unknown>
}

/**
 * Read the `team-enablement` section of the harness settings document.
 * @param home - resolved harness home.
 * @returns the section; `{}` when the document or section is absent.
 * @throws when the section exists but is not a workspace-to-id-to-flag record.
 */
export async function readEnablementSection(home: string): Promise<TeamEnablementSection> {
  const doc = await readSettingsDocument(home)
  const section = doc[TEAM_ENABLEMENT_SECTION]
  if (section === undefined) return {}
  if (!isEnablementSection(section)) {
    throw new Error(`invalid ${TEAM_ENABLEMENT_SECTION} section in ${settingsDocumentPath(home)}: expected a record of workspace path to teammate id to enabled flag`)
  }
  return section
}

/**
 * Copy a settings document without the enablement section.
 * @param doc - the current document.
 * @returns the document without the section key.
 */
function omitEnablementSection(doc: Record<string, unknown>): Record<string, unknown> {
  const { [TEAM_ENABLEMENT_SECTION]: _removed, ...rest } = doc
  return rest
}

/**
 * Write the `team-enablement` section back into the settings document,
 * preserving every other namespace section. The write is temp-file-plus-rename
 * where the platform allows it, with a direct overwrite as the fallback for
 * rename-over-existing failures (Windows).
 * @param home - resolved harness home.
 * @param section - the complete next section; `undefined` removes the section
 *   (and the document file when no other namespace remains).
 */
export async function writeEnablementSection(home: string, section: TeamEnablementSection | undefined): Promise<void> {
  const file = settingsDocumentPath(home)
  const current = await readSettingsDocument(home)
  const doc =
    section === undefined
      ? omitEnablementSection(current)
      : { ...current, [TEAM_ENABLEMENT_SECTION]: section }
  if (Object.keys(doc).length === 0) {
    // Nothing left to store: absence of the file means absence of the document.
    await rm(file, { force: true })
    return
  }
  await mkdir(home, { recursive: true, mode: 0o700 })
  const text = yaml.dump(doc, { lineWidth: -1 })
  const temp = `${file}.${String(process.pid)}.tmp`
  await writeFile(temp, text, { mode: 0o600 })
  try {
    await rename(temp, file)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code !== 'EPERM' && code !== 'EEXIST' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw error
    await writeFile(file, text, { mode: 0o600 })
    await rm(temp, { force: true })
  }
}

/**
 * Set one workspace/teammate flag in a copy of the section, creating the
 * workspace record as needed.
 * @param section - the current section.
 * @param workspace - the workspace key.
 * @param id - the teammate id.
 * @param enabled - the flag to store.
 * @returns the next section.
 */
function setEnablement(section: TeamEnablementSection, workspace: string, id: string, enabled: boolean): TeamEnablementSection {
  const workspaceRecord = { ...(section[workspace] ?? {}) }
  workspaceRecord[id] = enabled
  return { ...section, [workspace]: workspaceRecord }
}

/**
 * Clear one workspace/teammate flag from a copy of the section, dropping the
 * workspace record (and the whole section) when it becomes empty, so
 * "absent means enabled" is what the document says.
 * @param section - the current section.
 * @param workspace - the workspace key.
 * @param id - the teammate id.
 * @returns the next section, or `undefined` when no workspace record remains.
 */
function unsetEnablement(section: TeamEnablementSection, workspace: string, id: string): TeamEnablementSection | undefined {
  const current = section[workspace] ?? {}
  const workspaceRecord: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(current)) {
    if (key !== id) workspaceRecord[key] = value
  }
  if (Object.keys(workspaceRecord).length === 0) {
    const { [workspace]: _removed, ...rest } = section
    return Object.keys(rest).length === 0 ? undefined : rest
  }
  return { ...section, [workspace]: workspaceRecord }
}

/**
 * One teammate's displayable capability summary for `list` output.
 * @param def - the parsed definition.
 * @returns the capability fields in fixed order, or `-` when none are set.
 */
function capabilityString(def: TeammateDefinition): string {
  const parts: string[] = []
  if (def.provider !== undefined) parts.push(`provider=${def.provider}`)
  if (def.model !== undefined) parts.push(`model=${def.model}`)
  if (def.maxTokens !== undefined) parts.push(`maxTokens=${String(def.maxTokens)}`)
  if (def.tools !== undefined) {
    if (def.tools.allow !== undefined) parts.push(`tools.allow=[${def.tools.allow.join(', ')}]`)
    if (def.tools.deny !== undefined) parts.push(`tools.deny=[${def.tools.deny.join(', ')}]`)
  }
  if (def.requiresApproval !== undefined && def.requiresApproval.length > 0) {
    parts.push(`requiresApproval=[${def.requiresApproval.join(', ')}]`)
  }
  if (def.skills !== undefined && def.skills.length > 0) parts.push(`skills=[${def.skills.join(', ')}]`)
  if (def.mcpServers !== undefined && def.mcpServers.servers.length > 0) {
    parts.push(`mcp=[${def.mcpServers.servers.join(', ')}]`)
  }
  if (def.contextPolicy !== undefined) parts.push(`contextPolicy=${def.contextPolicy}`)
  return parts.length > 0 ? parts.join(' ') : '-'
}

/**
 * Render a table of cell rows with padded columns.
 * @param rows - one row per line; the first row is the header.
 * @returns the rendered table text without a trailing newline.
 */
function renderTable(rows: readonly string[][]): string {
  const columns = rows[0]?.length ?? 0
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(...rows.map(row => row[column]?.length ?? 0)))
  return rows.map(row => row
    .map((cell, column) => (column < columns - 1 ? cell.padEnd(widths[column] ?? 0) : cell))
    .join('  '))
    .join('\n')
}

/**
 * `dsh teammate list` — the definitions visible from the current workspace,
 * with their roles, capabilities, and enablement status. Unparsable files in
 * the visible directory are reported as warnings on stderr (the loader drops
 * them the same way) and do not fail the listing.
 * @param home - resolved harness home.
 * @param workspace - workspace root.
 * @returns the exit code.
 */
async function listTeammates(home: string, workspace: string): Promise<number> {
  const discovery = await discoverVisibleTeammates(home, workspace)
  const enablement = await readEnablementSection(home)
  for (const result of discovery.results) {
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.severity !== 'error') continue
      process.stderr.write(`${NAME}: warning: ${result.sourcePath}: ${diagnostic.message}\n`)
    }
  }
  const definitions = deduplicateTeammates(discovery.results)
  if (definitions.length === 0) {
    process.stdout.write(`no teammate definitions found (looked in ${discovery.dir})\n`)
    return 0
  }
  const rows: string[][] = [['ID', 'ROLE', 'STATUS', 'CAPABILITIES', 'SOURCE']]
  for (const def of definitions) {
    const enabled = def.role === 'leader' || enablement[workspace]?.[def.id] !== false
    rows.push([
      def.id,
      def.role,
      enabled ? 'enabled' : 'disabled',
      capabilityString(def),
      discovery.selfContained ? 'workspace' : 'home',
    ])
  }
  process.stdout.write(`${renderTable(rows)}\n`)
  return 0
}

/**
 * `dsh teammate add <file>` — validate one definition file against the
 * loader's rules and install it under the harness home (default) or the
 * current workspace's `.dsh/teammates/`. Add never overwrites: an existing
 * target is an error, and the file name (not the definition id) names the
 * target, so a second file with the same id installs as a distinct file the
 * loader deduplicates by scan order.
 * @param home - resolved harness home.
 * @param workspace - workspace root.
 * @param args - the file positional.
 * @param workspaceInstall - install project-level instead of globally.
 * @returns the exit code.
 */
async function addTeammate(
  home: string,
  workspace: string,
  args: readonly string[],
  workspaceInstall: boolean,
): Promise<number> {
  const file = args[0]
  if (file === undefined || file.length === 0) {
    throw new Error('teammate add needs a definition file path')
  }
  const source = resolve(process.cwd(), file)
  if (!basename(source).toLowerCase().endsWith('.md')) {
    throw new Error(`teammate add: ${file} is not a .md definition file`)
  }
  let content: string
  try {
    content = await readFile(source, 'utf8')
  } catch (error) {
    if (isENOENT(error)) throw new Error(`teammate add: file not found: ${file}`)
    throw error
  }
  const parsed = parseTeammateMarkdown(content, source)
  const errors = parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
  if (parsed.definition === undefined || errors.length > 0) {
    for (const diagnostic of errors) {
      process.stderr.write(`${NAME}: teammate add: ${source}: ${diagnostic.message}\n`)
    }
    throw new Error('teammate add: invalid definition frontmatter (nothing installed)')
  }
  const definition = parsed.definition
  const targetDir = workspaceInstall ? join(workspace, '.dsh', 'teammates') : join(home, 'teammates')
  const target = join(targetDir, basename(source))
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  try {
    // wx: refuse to overwrite an existing definition, even between the check
    // and the write.
    await writeFile(target, content, { mode: 0o644, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') {
      throw new Error(`teammate add: ${target} already exists — remove it first (add never overwrites)`)
    }
    throw error
  }
  process.stdout.write(`${NAME}: installed teammate "${definition.id}" (${definition.role}) from ${file} to ${target}\n`)
  return 0
}

/**
 * `dsh teammate enable|disable <id>` — set the current workspace's
 * enablement flag for one visible teammate. Enable clears an explicit
 * `false` (restoring the absent-means-enabled default) and never stores an
 * explicit `true`; disable stores the explicit `false` the loader filters on.
 * Both are idempotent: a no-op reports and leaves the document untouched.
 * @param home - resolved harness home.
 * @param workspace - workspace root (the enablement key).
 * @param args - the id positional.
 * @param enabled - true for `enable`, false for `disable`.
 * @returns the exit code.
 */
async function setTeammateEnablement(
  home: string,
  workspace: string,
  args: readonly string[],
  enabled: boolean,
): Promise<number> {
  const id = args[0]
  const verb = enabled ? 'enable' : 'disable'
  if (id === undefined || id.length === 0) {
    throw new Error(`teammate ${verb} needs a teammate id`)
  }
  const discovery = await discoverVisibleTeammates(home, workspace)
  const definition = deduplicateTeammates(discovery.results).find(candidate => candidate.id === id)
  if (definition === undefined) {
    throw new Error(`teammate ${verb}: no teammate "${id}" visible from workspace ${workspace} (looked in ${discovery.dir})`)
  }
  if (!enabled && definition.role === 'leader') {
    throw new Error(`teammate ${verb}: "${id}" is the team leader — the leader cannot be disabled`)
  }
  const section = await readEnablementSection(home)
  const current = section[workspace]?.[id]
  if (enabled) {
    if (current !== false) {
      process.stdout.write(`${NAME}: teammate "${id}" is already enabled for workspace ${workspace}\n`)
      return 0
    }
    await writeEnablementSection(home, unsetEnablement(section, workspace, id))
  } else {
    if (current === false) {
      process.stdout.write(`${NAME}: teammate "${id}" is already disabled for workspace ${workspace}\n`)
      return 0
    }
    await writeEnablementSection(home, setEnablement(section, workspace, id, false))
  }
  process.stdout.write(`${NAME}: ${enabled ? 'enabled' : 'disabled'} teammate "${id}" for workspace ${workspace}\n`)
  return 0
}

/**
 * Run one `dsh teammate` subcommand against the real filesystem.
 *
 * @param sub - the subcommand to run.
 * @param args - the subcommand's positional arguments: the file for `add`,
 *   the id for `enable`/`disable`, none for `list`.
 * @param options - storage overrides for tests and embedded callers.
 * @returns the process exit code: 0 on success (including idempotent no-ops
 *   and an empty listing), 1 on any usage, validation, or filesystem error.
 */
export async function runTeammate(
  sub: TeammateSubcommand,
  args: readonly string[],
  options: TeammateOptions = {},
): Promise<number> {
  const home = resolveDshHome(options.home)
  const workspace = resolveWorkspace(options.workspace)
  try {
    switch (sub) {
      case 'list':
        return await listTeammates(home, workspace)
      case 'add':
        return await addTeammate(home, workspace, args, options.workspaceInstall === true)
      case 'enable':
        return await setTeammateEnablement(home, workspace, args, true)
      case 'disable':
        return await setTeammateEnablement(home, workspace, args, false)
      default:
        sub satisfies never
        throw new Error(`dsh: unhandled teammate subcommand ${JSON.stringify(sub)}`)
    }
  } catch (error) {
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
