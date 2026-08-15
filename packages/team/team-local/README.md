# dsh-team-local

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

## Model Experience

None, as the filesystem loader populates the registry with no prompt, schema, or result.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- The YAML parser is minimal; complex YAML constructs (anchors, multi-line strings) may not parse correctly.
