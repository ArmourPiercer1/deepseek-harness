# dsh-bundle-team

The dsh agent-team bundle: leader-teammate coordination over continuable subagents.

## Installation

Add the team bundle to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: team-bundle
      name: '@deepseek-ai/dsh-bundle-team'
```

Or install via CLI:

```bash
pnpm add @deepseek-ai/dsh-bundle-team
```

## Included Packages

| Package | Role |
|---|---|
| `dsh-team` | Service Definition (types, events, abstract registry) |
| `dsh-team-local` | Service Provider (Markdown definition loader) |
| `dsh-team-runtime` | Consumer (orchestration, MCP guard, skill filter) |
| `dsh-team-channels` | Consumer (messaging, progress, approval) |
| `dsh-tool-team` | Consumer (5 model-facing tools) |

## Configuration

The bundle provides default configuration. Override in your `cordis.patch.yml`:

```yaml
- id: team-local
  config:
    homePath: /custom/path
    workspacePath: /workspace/path
- id: team-channels
  config:
    controlRequestTimeoutMs: 60000
```

## Model Experience

None, as the bundle is a pure composition manifest with no prompt, schema, or result.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- No web client integration (team progress panel, teammate status display).
- No CLI commands (`dsh teammate list/add/enable/disable`).
