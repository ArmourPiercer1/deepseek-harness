# dsh-bundle-team

English | [中文](README.zh.md)

The dsh agent-team bundle: leader-teammate coordination over continuable subagents.

## Mounting team mode

Two surfaces expose the same five packages, and a deployment uses one:

- **The shipped `team` preset** (`apps/cli/config/agent-presets/team/`) is the standard dsh deployment's choice. It is an agent-plane composition: the team group sits behind an `isolate` realm (`team`, `teamControl`), so every session on the preset shares the standing mount's own registry and coordinator by scope parentage, and the `subagents` registry the teammates run on stays host-side.
- **This bundle** is the opt-in host-plane entry for a custom profile that composes no preset roster (headless or automation deployments). Its rows register `team` and `teamControl` into the root realm, so they are process-global.

Using both at once gives each side its own registry: the preset's agent resolves the realm-local one, and the host rows stay inert.

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
