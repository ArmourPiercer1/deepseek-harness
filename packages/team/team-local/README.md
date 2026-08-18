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
contextPolicy: persistent
---

You are a senior backend developer...
```

## Config

| Key | Type | Default | Description |
|---|---|---|---|
| `homePath` | `string` | `$DSH_HOME` | Path for global definitions |
| `workspacePath` | `string` | — | Path for project-level definitions |

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
- The workspace key is the exact `workspacePath` string from the plugin config; no path normalization is applied.

## Startup Diagnostic

After each successful load, team-local warns through `ctx.logger('team-local')` when a registered leader expects `DEFAULT_LEADER_TOOLS` that `ctx.tools` has not registered, naming every missing tool. The warning is diagnostic only: loading never fails, and no tool policy is enforced from the leader definition.

## Model Experience

None, as the filesystem loader populates the registry with no prompt, schema, or result.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- The YAML parser is minimal; complex YAML constructs (anchors, multi-line strings) may not parse correctly.
