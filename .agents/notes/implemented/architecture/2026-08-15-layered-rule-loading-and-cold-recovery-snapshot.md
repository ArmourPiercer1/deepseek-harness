# Agent Note: Layered rule loading and the cold-recovery rule snapshot

Status: implemented

English | [中文](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.zh.md)

## Problem

The permission engine evaluates an already-merged, layer-tagged rule set, but nothing assembled that set: the managed and project rule files had no loader, and a teammate's inline rules (the `permissions` frontmatter of its definition) were not carried in any durable payload. A teammate session's effective policy therefore lived only in the parent's live registry — exactly the state a cold resume does not have, since recovery must rebuild the child's composition from its durable `team/member-bound` event alone. Separately, file-based policy is a moving target: an organization that tightens a managed `deny` after a session started would not constrain an in-flight recovered session unless recovery re-read the file layers from disk. And a loader that silently skipped a missing managed file would let a session bound under that policy recover into an unguarded one — the failure mode the permission seam note names as unacceptable.

## Decision

Layer loading is a pure, path-agnostic module in the engine (`dsh-permission-engine`'s `load.ts`) published through the `PermissionService.loadRuleLayers` contract on the `dsh-permission` Service Definition:

- **Sources.** The managed layer is `$DSH_HOME/permissions.yml`, the project layer is `<workspace>/.dsh/permissions.yml` (the scope's session cwd), and the teammate layer is an inline rule snapshot the caller passes in. The engine receives paths from its caller and owns no path resolution.
- **File format.** A rule file is a single top-level `permissions:` key whose `deny` / `ask` / `allow` values are rule-string lists, inline or block. Parsing is a strict subset: comments and blanks are skipped, and anything outside the format rejects with a `RuleFileError` naming the source and every diagnostic, so a typo fails loud instead of dropping a deny.
- **Merge.** Layers concatenate and an identical `(kind, raw)` rule deduplicates to the highest layer (managed > project > teammate). A `deny` and an `allow` that share a raw string are distinct rules and both survive; deny absoluteness is enforced at adjudication, not by dropping the `allow`.
- **Fail closed.** When the caller was bound under a managed policy (`managedPresent: true`) and the managed file is missing or unresolvable, the load rejects with a `ManagedRulesMissingError` rather than skipping the layer. A managed file deployed after the bind is picked up by the re-read and constrains the session immediately.

The team side supplies the three sources:

- `dsh-team-local` parses optional `permissions` (stance arrays of rule strings) and `permissionMode` (`enforce` / `default`; `readonly` / `bypass` rejected) from member frontmatter, which required extending `parseSimpleYaml` with nested block arrays and a correct empty inline array.
- The delegate tool snapshots the member's `permissions`, `permissionMode`, and a plain existence probe of the managed file into the durable `team/member-bound` payload as `rules`, `permissionMode`, and `managedPresent` — optional fields only, so a payload written before the fields exist still parses and still recovers.
- The team runtime's member setup contribution calls `loadRuleLayers` on both fresh creation and cold resume — `permission` is a hard injection of that plugin, and the [teammate permission enforcement note](2026-08-20-teammate-permission-enforcement-at-the-executor.md) owns this injection and the enforcement point that consumes the stored load — and stores the resulting promise keyed by the child session id. The file layers are always re-read from disk; the teammate rules come from the durable snapshot.

## Ownership of the load rejection

The stored promise can reject before any consumer awaits it (a lapsed managed file, a malformed layer file) — at setup time, while the enforcement point only reads the store on a tool call. An un-awaited rejection would surface as an unhandled rejection, so registration attaches a named swallow that consumes the rejection until the stored promise is read; the stored promise itself still delivers the rejection to whoever awaits it.

## Alternatives considered

**A static import of the loader into the team runtime** — a declared `dsh-permission` dependency in `dsh-team-runtime`'s package.json. The round's constraint is no new dependencies and no lockfile change, and the `permission` service is the seam by design: the runtime reads it with `ctx.get` and mirrors the small contract structurally (`TeamPermissionService`), which can be replaced by the real import when a formal dependency is justified.

**Durable-merged rule set instead of snapshot plus re-read** — storing the fully merged rule set in `team/member-bound` would be simpler at recovery, but it freezes the managed and project layers: an organization's tightened `deny` would not constrain an in-flight recovered session until the next delegation. Only the teammate layer is durable (its definition file may be deleted); the file layers are facts about the deployment and are re-read.

**A full `loadRuleLayers` probe at bind time** — calling the loader at delegation would both record `managedPresent` and validate the managed file, but a malformed project file would then reject every delegation in the workspace. The bind-time probe is a plain existence check: it records one boolean, and parse problems surface where the policy is actually read.

**Failing closed on any missing managed file at recovery** — unconditional refusal would regress every deployment without a managed policy: sessions that never ran under one could never cold-resume once recovery was wired. The bind-time `managedPresent` flag distinguishes "bound under it and it lapsed" (reject) from "never under it" (absence is normal).

**Hard `inject: ['permission']` in the team runtime** — rejected at this stage: injection would make the team rows incomposable without an engine row, and the team plugin composes and runs standalone, so the loose `ctx.get` read kept the documented no-engine state: no rule state installed, the child runs without the policy layer. The [teammate permission enforcement note](2026-08-20-teammate-permission-enforcement-at-the-executor.md) reverses this decision at the enforcement point: the hard injection shipped, with the activation condition made visible in the composition instead of a silently unenforced policy.

## Consequences

- A tightened managed `deny` constrains an in-flight recovered session at its next rule evaluation, and a lapsed managed file rejects the recovery load — both pinned by unit tests on the engine and the member setup.
- Backward compatibility is structural: pre-rules `team/member-bound` payloads (no `rules`, no `managedPresent`) cold-resume exactly as before, and the member setup test asserts the snapshot-less load call.
- The engine stays pure and path-agnostic; `resolveRuleLayerPaths` in `dsh-team-runtime` is the single owner of the file path convention, and the engine's tests use their own temp trees.
- The bind-time probe reads the ambient `$DSH_HOME`; tests stub it to temp directories.
- The enforcement point that compiles the recovered policy and denies calls (settling a stored rejection into a deny) is described by the [teammate permission enforcement note](2026-08-20-teammate-permission-enforcement-at-the-executor.md); the engine row it requires ships in the base bundle per the [base-composition wiring note](../bug-fix/2026-08-21-base-composition-carries-the-permission-engine.md), so every shipped preset's team rows resolve the hard injection.

## Related

- The [permission seam and MCP fusion](2026-08-15-permission-seam-and-mcp-fusion.md) proposal owns the wider seam; its stage 1 lists the layered-file loading, the cold-recovery rule snapshot, and the absolute managed layer that this note ships.
- The [teammate permission enforcement note](2026-08-20-teammate-permission-enforcement-at-the-executor.md) consumes this stage's load at the enforcement point and reverses the loose-`ctx.get` decision recorded above.
- The [tool permission guard note](2026-08-20-tool-permission-guard-resolves-permission-per-call.md) owns the guard's per-call service resolution, the consumer of the same `permission` service under the same activation-order constraint.
- The `dsh-permission-engine` README documents the rule file format and the fail-closed contract; the `dsh-team-local` README documents the frontmatter fields; the `dsh-team-runtime` README documents the recovery load and its store.
