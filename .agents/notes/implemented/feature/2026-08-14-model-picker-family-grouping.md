# Agent Note: Family grouping and select-all in the model picker

Status: implemented

English | [中文](2026-08-14-model-picker-family-grouping.zh.md)

## Problem

The fetch picker of the [Models-page declaring flow](../architecture/2026-08-04-declaring-a-provider-from-the-models-page.md) renders a provider's discovered models as one undifferentiated checkbox list. That is the right shape for a vendor's own few models and the wrong one for the case the flow exists for: a relay or gateway serves every vendor's catalog at once, a listing of a hundred ids scrolls past as a wall, and there is no way to pick or clear the whole batch — the user who wants three models from one relay must either uncheck the ninety-seven the picker pre-selected or leave them all configured.

## Decision

The picker groups candidates by the **family their ids name** and gains one **select-all toggle** for the whole listing.

The family is the leading identifier token of the id: `claude-3-5-sonnet` and `claude-3-opus` are both `claude`, `gpt-4o` is `gpt`, `gemini-2.0-flash` is `gemini`, `deepseek-chat` is `deepseek`. A vendor-qualified id (`openai/gpt-4o`) classifies by what follows the slash, which is the part that names the series. The derivation is the whole rule on purpose — `modelFamily` in `src/client/modelGrouping.ts` — so it needs no vendor table to stay current: a model from a provider this build has never heard of still lands in a group that reads like its family. Groups render in first-appearance order with the ids of each family in discovery order, under a caption that names the family and its size (`Claude · 2`). Display casing comes from a small table for the few families whose everyday spelling is not plain title case (`gpt` → `GPT`, `deepseek` → `DeepSeek`, `o1` → `o1`); anything else falls back to title case.

The toggle sits above the scroll and selects every distinct candidate id — the unit adoption actually writes — or, once everything is picked, reads as its inverse and clears the listing. A candidate already configured participates in the toggle like any other row, but adoption still keeps the tuned row over a rediscovered one, so a "select all" can never overwrite a capacity the user corrected. Grouping is presentation only: adoption writes the profile's `models` array back in discovery order, unchanged.

## Alternatives considered

- **A maintained vendor table** (`claude-*`, `gemini-*`, `gpt-*`, …) driving the groups. Rejected: every new vendor needs a new row before its models group sensibly, and the table can drift from the ids a relay actually returns. The leading-token heuristic needs no knowledge and never goes stale.
- **A per-family select-all toggle beside each caption.** Rejected for this change: the request was one global toggle, and a family's rows are few enough that the global toggle plus per-row checkboxes covers the bulk cases. A per-family toggle is the natural follow-up if the global one proves too coarse.
- **A fixed "select all" that always selects.** Rejected: with everything picked the user needs the inverse, so the control flips its label to "deselect all" instead of pretending a no-op click is progress.

## Consequences

A relay's listing now scans like the families it actually contains, and the user who wants a few models gets them without unchecking the rest or adopting the lot. The heuristic can split what a person would call one series (`qwen-max` and `qwen2.5-72b` land in different groups), which is transparent and harmless because the ids remain visible under each caption. The picker costs one toolbar row and one scroll container; the fetch picker's existing default selection, adopt-keeps-tuned-rows, and cancel semantics are unchanged.

## Testing

`tests/model-grouping.client.spec.ts` pins the pure contract: family derivation (plain, vendor-qualified, cased, blank), the casing table and its fallback, first-appearance group order, within-group discovery order, metadata carried into the group, and the empty listing. `tests/provider-form.client.spec.tsx` drives the rendered dialog over a scripted wire face: grouped captions with sizes, adoption writing discovery order back, and the toggle selecting, clearing, and re-selecting the whole listing while the tuned row survives adoption. `apps/web/tests/models-settings.e2e.ts` drives the assembled picker through a real interrogation of a local mock endpoint and pins the grouped dialog in an ARIA golden.
