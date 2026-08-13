/**
 * Group a provider's discovered model list into families, for the picker a
 * gateway's model listing opens. A relay serving several vendors returns one
 * flat list, and the families the picker can offer come from the ids
 * themselves — no endpoint advertises a family field, and no installed
 * catalog exists for a route being declared.
 *
 * The family is the leading identifier token of the id: `claude-3-5-sonnet`
 * and `claude-3-opus` are both `claude`, `gemini-2.0-flash` is `gemini`,
 * `gpt-4o` is `gpt`, and `deepseek-chat` is `deepseek`. A vendor-qualified id
 * (`openai/gpt-4o`) classifies by what follows the slash. The heuristic is
 * deliberately the whole rule: it needs no vendor table to stay current, so a
 * model from a provider this build has never heard of still lands in a group
 * that reads like its family.
 */

import type { DiscoveredModelView } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * Display names for families whose everyday spelling is not the token in
 * plain title case. The heuristic must not need to know every vendor — a
 * family absent here falls back to title case — so this stays the small set
 * that would otherwise read wrong.
 */
const FAMILY_LABELS: Readonly<Record<string, string>> = {
  claude: 'Claude',
  dall: 'DALL-E',
  deepseek: 'DeepSeek',
  ernie: 'ERNIE',
  gemini: 'Gemini',
  glm: 'GLM',
  gpt: 'GPT',
  minimax: 'MiniMax',
  o1: 'o1',
  o3: 'o3',
}

/** One picker group: a family and the candidates whose ids classify into it. */
export interface CandidateGroup {
  /** The family key: the leading identifier token of the ids, lowercased. */
  family: string
  /** The family as the picker shows it. */
  label: string
  /** Candidates in this family, in discovery order. */
  models: DiscoveredModelView[]
}

/**
 * The leading dash-separated token of the id's last path segment: everything
 * up to the first `-` or `/` after an optional `vendor/` prefix.
 */
const FAMILY_PATTERN = /^(?:[^/]*\/)*([^/-]+)/

/**
 * Derive the family key of one model id.
 * @param id - the id a provider advertises.
 * @returns the leading identifier token, lowercased; empty only for a blank id.
 */
export function modelFamily(id: string): string {
  const trimmed = id.trim()
  if (trimmed.length === 0) return ''
  const match = FAMILY_PATTERN.exec(trimmed)
  return (match?.[1] ?? '').toLowerCase()
}

/**
 * Spell a family key as the picker shows it.
 * @param family - a family key from {@link modelFamily}.
 * @returns the display label; blank for a blank key, else the known spelling
 *   or plain title case.
 */
export function familyLabel(family: string): string {
  if (family.length === 0) return ''
  return FAMILY_LABELS[family] ?? `${family.charAt(0).toUpperCase()}${family.slice(1)}`
}

/**
 * Group a discovery reply by family, preserving discovery order inside each
 * group and first-appearance order across groups.
 * @param candidates - the models a provider advertised.
 * @returns one group per family, in first-appearance order.
 */
export function groupCandidates(candidates: readonly DiscoveredModelView[]): CandidateGroup[] {
  const groups: CandidateGroup[] = []
  const byFamily = new Map<string, CandidateGroup>()
  for (const candidate of candidates) {
    const family = modelFamily(candidate.id)
    let group = byFamily.get(family)
    if (group === undefined) {
      group = { family, label: familyLabel(family), models: [] }
      byFamily.set(family, group)
      groups.push(group)
    }
    group.models.push(candidate)
  }
  return groups
}
