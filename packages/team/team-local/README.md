# dsh-team-local

English | [中文](README.zh.md)

Local filesystem team member definition loader for the DeepSeek Harness team plugin.

## Role

**Service Provider** — reads Markdown team member definitions from `$DSH_HOME/teammates/` and `.dsh/teammates/`, parses them, and populates the `ctx.team` registry.

## Definition Format

Team members are defined as Markdown files with YAML frontmatter:

```yaml
---
schemaVersion: 1
id: backend-dev
role: teammate
name: Backend Developer
description: Handles server-side logic and API design.
provider: Qiyuan-Inter
model: deepseek-v4-flash-0731
maxTokens: 16384
tools:
  allow: [read, edit, write, grep, glob, pwsh]
mcpServers:
  servers: [postgres-mcp]
permissions:
  deny:
    - Bash(rm -rf *)
    - "Read(//**/.env)"
  ask:
    - "Bash(git push:*)"
permissionMode: enforce
contextPolicy: persistent
---

You are a senior backend developer...
```

Permission fields:

- `permissions` — the member's inline rules for the permission engine: `deny` / `ask` / `allow` arrays of rule strings in the engine's rule format (inline `[a, b]` or block `- a` lists). Rule syntax is `Tool` or `Tool(specifier)`: a bare name (or `Tool(*)`) matches the whole tool for the engine's known families — `Bash` / `pwsh` by command pattern, `Read` / `Edit` / `Write` / `Grep` / `Glob` / `NotebookEdit` by path pattern, and `mcp__server` by server — while any other tool takes a `param:value` specifier (`*` wildcards) over one of its arguments. Rules that parse to no matcher are dropped with a diagnostic, so a rule that names an unsupported form silently allows nothing. The lists are snapshotted into the member's durable `team/member-bound` payload at delegation time, so a later-deleted definition file does not break cold recovery; the engine merges them with the managed/project rule files, where `deny` stays absolute across layers.
- `permissionMode` — the member's permission mode: `enforce` or `default`, `enforce` when the field is omitted (a controlled teammate's unmatched call is denied at the executor rather than allowed). The reserved values `readonly` and `bypass` are rejected at parse time.
- `requiresApproval` — legacy field, still parsed and snapshotted into the `team/member-bound` payload for existing definitions, but no longer gates anything: the enforcement hook evaluates every teammate call through the permission engine, so the field is superseded by an `ask` rule for the same tool.

## Config

| Key | Type | Default | Description |
|---|---|---|---|
| `homePath` | `string` | `$DSH_HOME` | Path for global definitions |
| `workspacePath` | `string` | `$DSH_CWD`, then the process cwd | Initial path for project-level definitions; live sessions override it (below) |

## Session Workspace Tracking

A preset's standing mount is shared by every session joined under it, so mount-time process state alone cannot know which workspace's `.dsh/teammates/` to scan. team-local therefore tracks the workspace at runtime:

- The initial workspace is the configured `workspacePath`, then `$DSH_CWD`, then the process cwd.
- Every `agent/created` event whose session header carries a different non-empty `cwd` re-points the workspace at that session directory and reloads immediately.
- A workspace that defines members under `.dsh/teammates/` is self-contained: those definitions form the complete team for that workspace, so global home definitions never merge into a project team. Home definitions apply only to workspaces that define none of their own.
- Each observed workspace's `.dsh/teammates/` directory gains a watcher, so later edits there reload through the normal debounce.

## Teammate Enablement

Per-workspace teammate enablement persists in the `team-enablement` settings namespace as a record of workspace path to teammate id to enabled flag:

```yaml
team-enablement:
  C:/projects/demo:
    backend-dev: false
```

- An absent section, workspace, or teammate means enabled; only an explicit `false` disables.
- Only `role: teammate` definitions are filtered. The leader is never disabled: a valid team requires exactly one leader, and the leader is metadata only, composed by its own preset rather than the registry.
- A committed settings change reloads the definitions, so enabling and disabling takes effect without a restart.
- The workspace key is the currently tracked workspace path: the initial resolution (configured `workspacePath`, then `$DSH_CWD`, then the process cwd) until a session under a different cwd re-points it; no path normalization is applied.

## Startup Diagnostic

After each successful load, team-local warns through `ctx.logger('team-local')` when a registered leader expects `DEFAULT_LEADER_TOOLS` that `ctx.tools` has not registered, naming every missing tool. The warning is diagnostic only: loading never fails, and no tool policy is enforced from the leader definition.

## Model Experience

None, as the filesystem loader populates the registry with no prompt, schema, or result.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- The YAML parser is minimal; complex YAML constructs (anchors, multi-line strings) may not parse correctly.
- The team registry holds one flat definition set per standing mount. Concurrent sessions under different workspaces therefore share it, and the most recently created agent's workspace determines the registered set; per-workspace registry views are deferred until the orchestrator and progress store are session-scoped.
