# Agent Note: The `dsh teammate` Command Family

Status: implemented

English | [中文](2026-08-19-dsh-teammate-cli.zh.md)

## Problem

Teammate definitions are Markdown files under a workspace's `.dsh/teammates/` or under `$DSH_HOME/teammates/`, and per-workspace enablement lives in the `team-enablement` section of `$DSH_HOME/settings.yaml` (the [Round 2](2026-08-18-team-plugin-round-2.md) N2 storage face). Before this change neither surface had a first-party CLI: listing, adding, or toggling a teammate required knowing the on-disk layout and, for enablement, hand-editing a YAML document owned by the settings-file provider.

## Decision

`apps/cli` ships `dsh teammate` with four subcommands, implemented in `apps/cli/src/teammate.ts` and wired through `args.ts`/`bin.ts` on the `plugin.ts` precedent:

- `list` prints the teammates visible from the current workspace under the loader's self-contained visibility rule (a workspace with its own `.dsh/teammates/` definitions hides the home definitions) with role, enablement status, a capability summary (provider, model, tools, skills, mcpServers, requiresApproval, contextPolicy), and the definition's source (home or workspace); unparseable files are surfaced as stderr warnings while the command still exits 0.
- `add <file>` validates the file's frontmatter against the team-local parser's exact rules and installs it under `$DSH_HOME/teammates/<basename>` by default or under `<workspace>/.dsh/teammates/<basename>` with `-w, --workspace`; a missing file, invalid frontmatter, or an existing target all exit 1 without writing anything, and `add` refuses to overwrite.
- `enable <id>` / `disable <id>` read and write the `team-enablement` section of `$DSH_HOME/settings.yaml` keyed by workspace path and teammate id: `disable` stores the explicit `false` the loader filters on, `enable` clears an explicit `false` (absent is the loader's canonical enabled state, and an explicit `true` is never stored), the leader can never be disabled, and unknown ids or no-ops are reported with no-ops exiting 0 without writing.

The CLI's parser is a verbatim self-contained mirror of `dsh-team-local`'s `parseTeamMemberMarkdown` and `parseSimpleYaml`, because the published CLI cannot take a dependency on the team packages for this change. The parity battery in `apps/cli/tests/teammate.spec.ts` imports the loader's real parser from the workspace source tree (a test-only relative import; the published artifact keeps no team-local dependency) and asserts identical verdicts, extracted fields, and diagnostics across 24 fixtures — including the loader's own parsing quirks (an indented block list under a nested key becomes an array, a quoted number stays a string) that the mirror reproduces rather than fixes.

The settings write round-trips the whole document with js-yaml: other namespaces are preserved, comments inside `settings.yaml` are not (the settings-file provider patches its documents with the YAML Document API and keeps comments; the CLI writes the document whole). The write is a temp-file-plus-rename swap; no cross-process lock exists on the document, in either direction.

## Alternatives considered

- **Adding `@deepseek-ai/dsh-team-local` as a CLI dependency**: rejected — the CLI's dependency surface was frozen for this change (no new dependencies), and under pnpm's strict layout a source launch breaks when a package is imported but absent from the importing package's lockfile entry. The verbatim mirror keeps "what `add` accepts" identical to "what the loader parses" without a new dependency.
- **A strict YAML frontmatter parser for `add`**: rejected — it would accept files the loader's line-based `parseSimpleYaml` mis-parses, so `add` could install files the runtime reads as something else. The mirror reproduces the loader's quirks exactly, and the parity battery detects drift.
- **Keying enablement per teammate id instead of per workspace**: rejected — the Round 2 N2 storage face is `workspacePath -> teammateId -> boolean`, and the CLI speaks the same dialect so the loader and any other writer agree.
- **Storing an explicit `true` on `enable`**: rejected — absent is the canonical enabled state, and storing `true` would add state the loader ignores.
- **A `dsh teammate rm` subcommand**: not part of this decision; removing a definition remains a plain filesystem operation on its Markdown file.

## Consequences

- Teammates can be listed, added, and toggled without knowing the on-disk layout; all four subcommands and their error paths (missing file, invalid frontmatter variants, unknown id, duplicate add, leader disable) are pinned by `apps/cli/tests/teammate.spec.ts` (57 tests including the parity battery), and `apps/cli/tests/teammate-source-launch.spec.ts` (4 tests) spawns the real source bin against a temporary `DSH_HOME`.
- The frontmatter parser now exists in two copies; the mutation-checked parity battery (a one-character message change in the mirror fails it) is the drift guard.
- A whole-document settings round-trip: other namespaces' data is preserved, `settings.yaml` comments are not, and concurrent writers of the document are not locked out in either direction.
- This change's built-bin smoke is replaced by a source-launch smoke (`node --import tsx/esm apps/cli/src/bin.ts`, the [source-launch contract](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md) vector) per the no-repository-build task constraint; the parent round re-verifies at acceptance.
