# Agent Note: The base composition carries the permission engine

Status: implemented

English | [中文](2026-08-21-base-composition-carries-the-permission-engine.zh.md)

## Problem

`dsh-team-runtime` hard-injects `permission` because teammate enforcement is required wherever the team runs under a policy ([teammate permission enforcement](../architecture/2026-08-20-teammate-permission-enforcement-at-the-executor.md)). Nothing provided the engine row: no bundle, no profile, and no preset composed `@deepseek-ai/dsh-permission-engine`, so the injection never resolved and the shipped `team` preset failed to mount with `team-runtime ... waiting for permission`. Every team session create and resume rejected, and the engine's rule loading and enforcement shipped unreachable.

## Decision

The base bundle composition carries the engine row: `packages/bundle/base/cordis.patch.yml` mounts `- id: permission-engine` / `@deepseek-ai/dsh-permission-engine` beside the sandbox `permission` presets row, and `@deepseek-ai/dsh-base` declares the workspace dependency. The engine publishes `ctx.permission` on the host plane, where its README places the row: the managed rule layer is `$DSH_HOME/permissions.yml`, a deployment fact that outlives every session, and preset-plane rows resolve the service through scope parentage exactly as they resolve the host `tools` and `subagents` registries. The engine is pure until a consumer compiles a scope's authored rules — no config, empty inject, no tools of its own — so mounting it changes no behavior until a consumer reads it.

## Alternatives considered

**Compose the engine row inside the team preset.** A preset-scoped engine would resolve the same injection for team sessions, but permission policy is a host-plane concern: the managed layer reads a deployment file, every user copy of the team preset would compose its own engine instance, and a host-plane consumer could never resolve a preset-scoped service. The row belongs where the policy lives.

**Soften the injection back to a loose `ctx.get`.** Mounting would succeed without the engine, but the team would then run with a silently unenforced policy — the invisible gap the enforcement note chose hard injection to make legible. The fix supplies the missing row instead of weakening the consumer.

**Leave the wiring to each deployment.** The shipped preset mounts in the shipped deployment; pushing the same two lines to every deployment restates the defect as boilerplate.

## Consequences

- Every session composed over the base bundle carries `ctx.permission`; the shipped team preset mounts its full row set, team sessions create and resume, and the [team-agent keyless snapshot](../testing/2026-08-20-team-agent-keyless-e2e-snapshot.md) exercises the live enforcement path over the shipped profile.
- The `dsh-team-runtime` and `dsh-permission-engine` READMEs state the activation condition for custom compositions — the plugin activates only where the composition carries an engine row, as every shipped one does — without a shipped-gap limitation.
- A custom composition that drops the base row still shows the team-runtime row as pending: the legible failure the hard injection was chosen for.

## Related

- The [teammate permission enforcement note](../architecture/2026-08-20-teammate-permission-enforcement-at-the-executor.md) owns the hard injection this row satisfies.
- The [layered rule loading note](../architecture/2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md) owns the load the enforcement consumes.
- The [permission seam note](../architecture/2026-08-15-permission-seam-and-mcp-fusion.md) owns the wider seam.
