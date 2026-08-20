/**
 * Read-only layered rule-file loading and merging.
 *
 * A scope's rules come from two on-disk files — the managed layer (an
 * organization policy file under the harness home) and the project layer (a
 * file in the scope's workspace) — plus the teammate inline rules carried by
 * the member definition (or by its durable snapshot on cold recovery). Each
 * file uses a strict YAML subset; anything outside it fails loud. Loading
 * concatenates and deduplicates the array-valued rule sets; the deduplication
 * key is (kind, raw), so a deny in one layer is never dropped in favor of an
 * allow in another, and a duplicate rule keeps the highest layer.
 *
 * @module @deepseek-ai/dsh-permission-engine
 */

import { readFile } from 'node:fs/promises'
import type {
  LoadedRuleLayers,
  LoadRuleLayersOptions,
  PermissionRules,
  RuleLayer,
  RuleSource,
} from '@deepseek-ai/dsh-permission'

/**
 * A rule-layer file that exists but cannot be read or parsed.
 */
export class RuleFileError extends Error {
  /** The rule file the diagnostics refer to. */
  readonly source: string
  /** Human-readable read or parse problems, one per line. */
  readonly diagnostics: readonly string[]

  /**
   * @param source - the rule file path (or label) the error refers to.
   * @param diagnostics - the human-readable problems found.
   */
  constructor(source: string, diagnostics: readonly string[]) {
    super(`rule file ${source}: ${diagnostics.join('; ')}`)
    this.name = 'RuleFileError'
    this.source = source
    this.diagnostics = [...diagnostics]
  }
}

/**
 * Cold recovery refused: the managed rule file the scope was bound under is no
 * longer present. A lapsed managed policy is never run — the scope must not
 * recover with a policy floor that can no longer be verified.
 */
export class ManagedRulesMissingError extends Error {
  /** The managed rule file the scope expected, when resolvable. */
  readonly managedPath: string

  /**
   * @param managedPath - the expected managed rule file path, or undefined when the home itself is unresolvable.
   */
  constructor(managedPath: string | undefined) {
    super(managedPath === undefined
      ? 'the managed rule file is unresolvable; refusing to run a session that was bound under it'
      : `managed rule file ${managedPath} is missing; refusing to run a session that was bound under it`)
    this.name = 'ManagedRulesMissingError'
    this.managedPath = managedPath ?? ''
  }
}

/** One rule layer's declared rules, tagged with the layer they came from. */
export interface RuleLayerRules {
  /** The layer these rules were declared in. */
  readonly layer: RuleLayer
  /** The rule sets the layer declares. */
  readonly rules: PermissionRules
}

/** One on-disk rule layer's load result. */
export interface RuleLayerLoad {
  /** Which layer this load refers to. */
  readonly layer: 'managed' | 'project'
  /** Whether the layer file was present and readable. */
  readonly present: boolean
  /** The rules the file declares (empty when the file is absent). */
  readonly rules: PermissionRules
}

/** The stance keys a rule-file `permissions` section may declare. */
const KIND_KEYS: readonly (keyof PermissionRules)[] = ['deny', 'ask', 'allow']

/**
 * Strip one pair of matching outer quotes from a rule entry. Returns undefined
 * when the entry starts a quote it never closes (an unterminated quote).
 *
 * @param value - the trimmed entry text.
 * @returns the unquoted entry, or undefined for an unterminated quote.
 */
function stripQuotes(value: string): string | undefined {
  const first = value[0]
  if (first !== '"' && first !== "'") return value
  if (value.length < 2 || value[value.length - 1] !== first) return undefined
  return value.slice(1, -1)
}

/**
 * Split an inline array's contents on commas, respecting single- and
 * double-quoted entries.
 *
 * @param inner - the text between the brackets.
 * @returns the entry texts, or undefined when a quote is never closed.
 */
function splitInlineArray(inner: string): readonly string[] | undefined {
  const items: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  for (const ch of inner) {
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ',') {
      items.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (quote !== undefined) return undefined
  items.push(current.trim())
  return items
}

/**
 * Parse one rule entry: strip quotes, reject the empty entry.
 *
 * @param value - the trimmed entry text after `- ` or a comma split.
 * @returns the rule string, or undefined when the entry is empty or the quote is unterminated.
 */
function parseEntry(value: string): string | undefined {
  const unquoted = stripQuotes(value)
  if (unquoted === undefined) return undefined
  if (unquoted.length === 0) return undefined
  return unquoted
}

/**
 * Parse the strict YAML subset a rule-layer file uses. The file has one
 * top-level `permissions` key; under it, `deny`, `ask`, and `allow` each take
 * an inline array (`[a, b]`) or a block list of `-` items. Comments and blank
 * lines are skipped. Any other construct — another top-level key, a scalar
 * value, deeper nesting, an empty entry — is a RuleFileError: a rule file that
 * cannot be understood must not be read as "no rules".
 *
 * @param text - the raw rule-file content.
 * @param source - the file path (or label) for error messages.
 * @returns the declared rule sets; absent stances are omitted.
 * @throws {RuleFileError} when the content is outside the supported subset.
 */
export function parseRuleFileText(text: string, source: string): PermissionRules {
  const diagnostics: string[] = []
  const rules: { deny?: string[]; ask?: string[]; allow?: string[] } = {}
  let inPermissions = false
  let kind: keyof PermissionRules | undefined
  let kindLevel = -1
  let kindInline = false

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    if (rawLine === undefined) break // unreachable under the loop bound; present for noUncheckedIndexedAccess
    const lineNo = i + 1
    const trimmed = rawLine.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = rawLine.length - rawLine.trimStart().length

    if (indent === 0) {
      if (!inPermissions) {
        const match = /^(\w+):(.*)$/.exec(trimmed)
        if (match === null || match[1] === undefined) {
          diagnostics.push(`line ${lineNo}: unsupported top-level line (expected "permissions:")`)
          continue
        }
        const key = match[1]
        const rest = (match[2] ?? '').trim()
        if (key === 'permissions') {
          if (rest !== '') {
            diagnostics.push(`line ${lineNo}: "permissions" must not carry an inline value`)
            continue
          }
          inPermissions = true
        } else {
          diagnostics.push(`line ${lineNo}: unknown top-level key "${key}" (only "permissions" is supported)`)
        }
        continue
      }
      diagnostics.push(`line ${lineNo}: unexpected top-level line after "permissions"`)
      continue
    }

    if (!inPermissions) {
      diagnostics.push(`line ${lineNo}: content before "permissions:"`)
      continue
    }

    if (trimmed.startsWith('- ') || trimmed === '-') {
      const entryText = trimmed === '-' ? '' : trimmed.slice(2).trim()
      if (kind === undefined || kindInline) {
        diagnostics.push(`line ${lineNo}: array item outside a block-list key`)
        continue
      }
      if (indent <= kindLevel) {
        diagnostics.push(`line ${lineNo}: array item must be indented under its key`)
        continue
      }
      const entry = entryText === '' ? undefined : parseEntry(entryText)
      if (entry === undefined) {
        diagnostics.push(`line ${lineNo}: empty or unterminated rule entry`)
        continue
      }
      (rules[kind] ??= []).push(entry)
      continue
    }

    const match = /^(\w+):(.*)$/.exec(trimmed)
    if (match === null || match[1] === undefined) {
      diagnostics.push(`line ${lineNo}: unsupported line (expected "deny:", "ask:", "allow:", or a "- " item)`)
      continue
    }
    const key = match[1]
    const rest = (match[2] ?? '').trim()
    if (!KIND_KEYS.includes(key as keyof PermissionRules)) {
      diagnostics.push(`line ${lineNo}: unknown key "${key}" (expected deny, ask, or allow)`)
      continue
    }
    if (kindLevel !== -1 && indent !== kindLevel) {
      diagnostics.push(`line ${lineNo}: inconsistent indent for "${key}"`)
      continue
    }
    kindLevel = indent
    kind = key as keyof PermissionRules
    kindInline = false
    if (rest === '') continue
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1)
      const items = inner.trim() === '' ? [] : splitInlineArray(inner)
      if (items === undefined) {
        diagnostics.push(`line ${lineNo}: unterminated quote in "${key}" inline array`)
        continue
      }
      kindInline = true
      for (const item of items) {
        const entry = item === '' ? undefined : parseEntry(item)
        if (entry === undefined) {
          diagnostics.push(`line ${lineNo}: empty or unterminated rule entry in "${key}"`)
          continue
        }
        (rules[kind] ??= []).push(entry)
      }
      continue
    }
    diagnostics.push(`line ${lineNo}: "${key}" must be an array (inline [..] or "- " items)`)
  }

  if (diagnostics.length > 0) throw new RuleFileError(source, diagnostics)

  const result: { deny?: readonly string[]; ask?: readonly string[]; allow?: readonly string[] } = {}
  for (const key of KIND_KEYS) {
    const items = rules[key]
    if (items !== undefined && items.length > 0) {
      result[key] = items
    }
  }
  return result
}

/** Whether a filesystem error means "the file does not exist". */
function isEnoent(e: unknown): boolean {
  return e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * Read one on-disk rule layer. A missing file (ENOENT) is a legitimate layer
 * absence, not an error; any other read failure or parse problem fails loud.
 *
 * @param layer - which layer the file belongs to.
 * @param path - the rule file path, or undefined when the layer's root is unresolvable.
 * @returns the layer's presence and declared rules.
 * @throws {RuleFileError} when the file cannot be read or is outside the supported subset.
 */
export async function readRuleLayer(layer: 'managed' | 'project', path: string | undefined): Promise<RuleLayerLoad> {
  if (path === undefined) return { layer, present: false, rules: {} }
  let text: string
  try {
    text = await readFile(path, 'utf-8')
  } catch (e: unknown) {
    if (isEnoent(e)) return { layer, present: false, rules: {} }
    throw new RuleFileError(path, [`cannot read file: ${e instanceof Error ? e.message : String(e)}`])
  }
  return { layer, present: true, rules: parseRuleFileText(text, path) }
}

/** Layer priority for deduplication: the higher layer keeps the duplicate. */
const LAYER_PRIORITY: Record<RuleLayer, number> = { managed: 3, project: 2, teammate: 1 }

/**
 * Merge the rule sets of the file layers with the teammate inline rules into
 * one deduplicated, layer-tagged rule source set. The deduplication key is
 * (kind, raw): the same rule string under the same stance declared in several
 * layers collapses to one entry that keeps the highest layer (managed over
 * project over teammate). A deny and an allow sharing a raw string are
 * different rules and both survive; deny absoluteness across layers is then
 * guaranteed by the deny-first adjudication order.
 *
 * @param layers - the file layers in precedence order (managed first).
 * @param teammate - the teammate inline rules, when the scope has a teammate.
 * @returns the merged rule sources in deterministic first-seen order.
 */
export function mergeRuleSources(layers: readonly RuleLayerRules[], teammate?: PermissionRules): RuleSource[] {
  const sources: RuleSource[] = []
  for (const layer of layers) {
    for (const kind of KIND_KEYS) {
      for (const raw of layer.rules[kind] ?? []) {
        sources.push({ raw, kind, layer: layer.layer })
      }
    }
  }
  if (teammate !== undefined) {
    for (const kind of KIND_KEYS) {
      for (const raw of teammate[kind] ?? []) {
        sources.push({ raw, kind, layer: 'teammate' })
      }
    }
  }

  const byKey = new Map<string, RuleSource>()
  for (const source of sources) {
    const key = `${source.kind}\u0000${source.raw}`
    const existing = byKey.get(key)
    if (existing === undefined || LAYER_PRIORITY[source.layer] > LAYER_PRIORITY[existing.layer]) {
      byKey.set(key, source)
    }
  }
  return [...byKey.values()]
}

/**
 * Load the managed and project rule layers from disk, refuse the load when the
 * managed file a bound scope expected is missing, and merge the result with
 * the teammate inline rules. This is the cold-recovery re-read: the file
 * layers always come from disk, never from the session's history, so a
 * tightened managed policy constrains a recovered scope immediately.
 *
 * @param options - the layer file paths and the optional teammate snapshot.
 * @returns the merged rule sources plus each layer's presence.
 * @throws {ManagedRulesMissingError} when `options.managedPresent` is true but the managed file is gone.
 * @throws {RuleFileError} when a present layer file cannot be read or parsed.
 */
export async function loadRuleLayers(options: LoadRuleLayersOptions): Promise<LoadedRuleLayers> {
  const [managed, project] = await Promise.all([
    readRuleLayer('managed', options.managedPath),
    readRuleLayer('project', options.projectPath),
  ])
  if (options.managedPresent === true && !managed.present) {
    throw new ManagedRulesMissingError(options.managedPath)
  }
  return {
    rules: mergeRuleSources([managed, project], options.teammateRules),
    managedPresent: managed.present,
    projectPresent: project.present,
  }
}
