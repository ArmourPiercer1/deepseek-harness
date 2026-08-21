# Agent Note: Permission rule matching aligns with harness tool calls

Status: implemented

English | [中文](2026-08-21-permission-rule-matching-aligns-with-harness-tool-calls.zh.md)

## Problem

The documented rule language names tools with Claude Code-style capitalized spellings — the `dsh-team-local` README and the adding-agent-team cookbook both write `Bash(...)` and `Read(...)` — while harness tools register lowercase (`bash`, `read`, `write`), and file tools receive workspace-relative paths (`notes/hello.txt`) while path rules resolve against the session cwd. Two comparisons ignored both facts: the path and param matchers compared tool names exactly (the command matcher already compared case-insensitively), and `matchPath` compared the resolved absolute pattern against the raw input path without resolving a relative input against the cwd. An authored `Write` ask rule compiled, never matched a `write` call on a relative path, and the gated call fell through to the mode fallback — a teammate's `ask: [Write]` never asked, and under `default` mode every gate silently allowed.

## Decision

Rule-to-call matching aligns with harness naming and paths; the `mcp__` prefix stays exact because server names are identity, not spelling:

- Parse detects the command/path families and the primary-content-field table on the lowercased tool name; the compiled matcher keeps the authored spelling, and the path and param matchers compare both sides lowercased — the contract the command matcher already kept.
- `matchPath` resolves the input path before comparing: an absolute input keeps its POSIX form, and a relative input joins the scope's session cwd from the same bases that anchor the pattern's relative form.

## Alternatives considered

**Normalize authored rules to lowercase at parse.** Storing a canonical lowercase name would also fix tool comparison, but it rewrites the authored name that `RuleIR.tool` surfaces in audits, and the invoked side still needs lowercasing in the matchers; comparing both sides leaves authored text untouched everywhere.

**Require absolute paths in tool calls or in rules.** The file tools receive workspace-relative paths from models as a matter of course; demanding absolute input on either side pushes the cwd bookkeeping onto every caller instead of the one module that owns the bases.

**Rename harness tools to the capitalized spellings.** Tool names are model-visible, logged, and durable across session events and payloads; renaming them for rule-spelling parity costs a durability migration that two comparisons absorb.

## Consequences

- The documented examples (`Bash(...)`, `Read(...)`, bare `Write`) match the lowercase harness tools and their relative paths as written.
- Regression cases pin case-insensitive family detection and tool comparison in `parse.spec.ts`, `match-path.spec.ts`, and `match-param.spec.ts`, and relative-input resolution against the cwd.
- The [team-agent keyless snapshot](../testing/2026-08-20-team-agent-keyless-e2e-snapshot.md) is the assembled-level proof: the fixture members' inline `ask: [Write]` rules suspend their relative-path `write` calls through the shipped enforcement hook.

## Related

- The [base-composition wiring note](2026-08-21-base-composition-carries-the-permission-engine.md) supplies the engine row that makes this matching reachable in shipped compositions.
- The [permission seam note](../architecture/2026-08-15-permission-seam-and-mcp-fusion.md) owns the matcher vocabulary this note keeps.
- The `dsh-permission-engine` README documents the matcher table and the rule file format.
