# Agent Note: The permission seam — parameter-level tool rules and fused MCP mounting for controlled team workflows

Status: implemented

English | [中文](2026-08-15-permission-seam-and-mcp-fusion.zh.md)

## Problem

DeepSeek Harness can restrict a team member's tools only by tool name. `TeamToolPolicy` carries `allow`/`deny` name lists, `TEAMMATE_DENIED_TOOLS` hard-codes three coordination tools, and `createMcpGuard` masks MCP tool names by their `mcp__<server>__` prefix. A member that is allowed `pwsh` may run any command; a member allowed `write` may write any path. There is no way to express "this teammate may run `git status` but not `rm -rf`", "may read the repository but never `.env`", or "may call the `postgres` MCP query tool but no other server". For an engineering-control environment where a teammate is entrusted with real authority, name-level gating is not a foundation that can be trusted.

MCP access has the same shape gap. Every MCP server is mounted globally; the only per-member control is name masking. A member cannot be assigned a stable, persisted set of MCP servers, a skill cannot pull in the MCP it needs for the duration of a task, and an unused server cannot stay disconnected to keep its tool descriptions out of an unrelated session's context. The two useful patterns — a member's persisted MCP set (stable, auditable) and a skill's on-demand MCP (loaded with the task) — are both absent, and the reference implementations that have them either scatter server credentials into copyable skill files (oh-my-opencode) or stop at name-list filtering over shared connections (PilotDeck).

These gaps sit at the boundary the [agent team plugin](../feature/2026-08-14-agent-team-plugin.md) already owns, but they are not team-specific: a main agent and a single delegated subagent need the same parameter-level authority. Delegated subagents additionally run with [approvals pinned to `'never'`](../feature/2026-08-10-subagent-approval-pinned-never.md), so for them a rule engine — not an interactive prompt — must be the decision authority.

## Decision

Stage 1 of the seam is shipped: the `permission` capability decides whether a tool call may be issued, and it is consumed by the team plugin, the main agent, and single delegated subagents alike. Stages 2 and 3 (fused MCP mounting, hardening) remain unbuilt; their scope is recorded in the Deferred section below.

### The `permission` seam and its boundary

Three packages form the seam:

- `packages/permission/permission` — the Service Definition: `evaluate(toolCall, context)` returning `deny | ask | allow`, plus the rule intermediate representation (IR), rule-layer, and permission-mode types. Publishing a service places this row in the host composition.
- `packages/permission/permission-engine` — the Service Provider: string-rule parsing to IR, the four matchers below, `deny > ask > allow` layered resolution with an absolute managed layer, and the permission-mode fallback. `compile` and `evaluate` stay pure; a consumer appends the `permission/decision` audit event at its commit point.
- `packages/permission/tool-permission-guard` — a `tools/pre-execute` Consumer that applies `evaluate` for the main agent and single delegated subagents; its per-call service resolution is owned by the [tool permission guard note](2026-08-20-tool-permission-guard-resolves-permission-per-call.md).

The team plugin hard-injects `permission` and installs its enforcement hook on every bound teammate child instead of the legacy `requiresApproval` name gate: every `tools/pre-execute` call is evaluated at the executor under the member's mode, and an `ask` result reuses the existing leader rendezvous (the suspend-wake-decide loop over `team/control-request`) rather than a new channel. The [teammate permission enforcement note](2026-08-20-teammate-permission-enforcement-at-the-executor.md) owns that stage.

The seam sits above the OS floor, not inside it. The `permission` engine decides whether a tool call may be issued; the [subprocess sandbox](../feature/2026-07-06-sandbox.md) and `fs-sandbox` remain a parallel OS-level backstop that physically contains a call that was issued. An `ask` outcome is delivered through the existing [approval seam](../feature/2026-07-06-approval-seam.md) for the main agent and through the leader rendezvous for a teammate. `permission` depends on the approval seam to fulfil `ask`; it does not absorb it, and it does not merge with the sandbox.

Rule layer, matcher engine, and permission-mode fallback are not separate packages: they are parts of one `evaluate` that must produce a single decision at the point the decision is made, so they cannot be split without creating an order-of-precedence ambiguity the seam exists to remove.

### Rule language: authored strings, structured IR core

Rules are authored as Claude Code-style strings so they stay human-reviewable, diffable, and versioned, then parsed into the structured IR the engine matches and audits:

```yaml
permissions:
  deny:  ["Bash(rm -rf *)", "Read(//**/.env)", "mcp__*"]
  ask:   ["Bash(git push:*)", "pwsh(Remove-Item *)"]
  allow: ["Bash(git status:*)", "mcp__postgres__query"]
permissionMode: enforce            # enforce | default (readonly/bypass reserved)
```

The IR dispatches to four matchers, aligned with Claude Code's documented behavior and its documented failure modes:

1. **Command** (Bash / pwsh): compound commands are split on `&&`, `||`, `;`, `|`, `|&`, `&`, and newlines, and each subcommand is matched independently; a fixed set of wrappers is stripped; pwsh aliases are canonicalized. The primary content field (`command`) cannot be matched by a `param:value` rule, because a compound command would bypass it.
2. **Path** (Read / Edit / Write and the read-modify family): gitignore semantics, with `//` (filesystem root), `~` (home), and `/` (relative to the rule's config source) anchors; Windows paths normalize to POSIX (`C:\` → `/c/`).
3. **MCP**: `mcp__server`, `mcp__server__tool`, and `mcp__server__*` prefixes.
4. **Generic parameter**: `Tool(param:value)` against a top-level scalar input field of a long-tail tool, never against the primary content field.

Resolution order is `deny → ask → allow → mode fallback`. A `deny` in the managed layer is absolute in every mode and cannot be overridden by a lower layer's `allow`.

### Permission modes and the default decision

An unmatched call is decided by a per-scope permission mode, a config enum. Two modes ship: `enforce` (unmatched ⇒ `deny`; the allowlist default for a controlled teammate) and `default` (unmatched ⇒ `allow`; the denylist for the main agent). `readonly` and `bypass` are reserved enum values; the engine rejects them as unimplemented rather than silently allowing a call. Modes bind per scope — the main agent's mode comes from host or project configuration, a teammate declares its own in `.md` frontmatter — and the managed layer may cap a mode (for example, no `bypass` fleet-wide). A managed `deny` stays in force in every mode, so an organization's `deny: Read(//**/.env)` covers even a `default`-mode main agent.

### Rule layering, persistence, and audit

Rules load from layered files — managed (a protected policy file), project (a project-level file), and teammate (the member definition's `permissions` frontmatter) — through the read-only loader the [layered rule loading note](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md) owns, with its fail-closed contract: a missing managed file a scope was bound with is refused, not skipped, and a malformed layer file fails the load. Loading concatenates the array-valued rule sets and deduplicates them, keeping `deny` absolute across layers. Rule learning is shaped into this file format but not implemented; a session-level learned rule would map to a session event.

Every evaluated call appends a `permission/decision` audit session event so the session log reconstructs the decision: the tool name, outcome, and mode always; the acting member, the deciding rule's raw string and layer, and the deny cause when they apply. The round-3 D8 step checked that payload against the fields the audit requires; the finding is recorded in the section below.

## Audit event compatibility (round-3 D8, read-only)

The round-3 plan required a field-by-field check of the `permission/decision` payload against the fields a Stage 1 audit must carry before the event could be reused. The check is read-only: no event structure was modified, and the reuse-versus-pause decision under D8 is the parent's to make; this section records the finding, not the decision.

| Stage 1 audit field | Payload field in `PermissionDecisionData` | Presence |
|---|---|---|
| tool | `toolName: string` | always |
| decision | `decision: 'allow' \| 'ask' \| 'deny'` | always |
| matched rule | `matchedRuleRaw?: string` | when a rule, not the mode fallback, decided |
| layer | `layer?: 'managed' \| 'project' \| 'teammate'` | with the matched rule |
| member | `memberId?: string` | when the call came from a teammate |
| mode | `mode: PermissionMode` | always |
| cause | `cause?: 'rule' \| 'mode' \| 'leader_unreachable'` | when the decision was a deny |

The payload is compatible: it carries every field the audit requires, and the optional fields are omitted by design when they do not apply. The event is a plain-JSON `SessionEventMap` member, so cold recovery and old-log replay read it without a format change, and no existing event structure was touched. One premise correction for the record: the round-3 plan attributed the vocabulary entry to an upstream `interaction/permission-presets` declaration, but upstream declares only `permission/preset`; `permission/decision` entered the generated event vocabulary through this round's `@deepseek-ai/dsh-permission` declaration, with no earlier upstream declaration anywhere in the git history.

## Alternatives considered

**A name-level filter extended in place.** Extending `TeamToolPolicy` with condition matchers keeps the change local, but the policy is a per-member denylist; there is no layering, no managed absolute, and no audit trail, so the extension would grow a second decision system beside the sandbox instead of the one documented seam.

**Rules in the session log only.** Durable events make the decision auditable but not re-evaluable: the engine needs the rule set as data it can compile, not as prose in a transcript. The log records the outcome; the rule files own the policy.

**A dedicated permission process.** An out-of-process engine isolates rule evaluation, but every tool call would pay a round-trip to decide it, and the process boundary adds a failure mode the approval flow must distinguish from a real deny. The engine is pure in-process code; isolation is not the point.

**Per-member MCP servers with eager warmup.** Mounting every member's servers at session start makes tools available immediately, but pays connection cost and context for servers a member never calls, and leaks tool descriptions into unrelated sessions. Lazy reference-counted mounting keeps an unused server disconnected; the member set and the skill set are merged into one per-scope union (Stage 2, deferred).

**One global permission mode.** A single mode for the whole session cannot express the split that is the point of the seam: a controlled teammate runs `enforce` while the main agent that delegates to it runs `default`. The mode binds per scope, and the managed layer may cap it.

**Fail-closed with no audit on refusal.** A denied call that leaves no log line breaks the reconstructability contract — the session log must be able to answer "what was allowed, prompted, or denied, under which rule, layer, member, and mode". The audit event is therefore part of the seam, not an add-on.

**Folding the seam into `fs-sandbox`.** The filesystem sandbox already owns OS-level containment; adding rule evaluation there would merge two owners of "may this happen" and make the boundary between decision and containment invisible. The seam stays a separate capability above the OS floor.

## Consequences

- The two-system risk resolved as a boundary, not a merge: `permission` decides the issue, the sandbox contains the execution, and only `permission` produces `deny`/`ask`/`allow`. The enforcement point is the operation that makes the decision, pinned by a real-composition test that denies through the executor with the tool still in the schema (the [teammate permission enforcement note](2026-08-20-teammate-permission-enforcement-at-the-executor.md)).
- Rule fragility is a standing limitation: command patterns are best-effort — a compound command, a variable, or stray whitespace can defeat a naive pattern, as Claude Code documents. The engine mitigates with subcommand splitting and wrapper stripping, and the managed `deny` plus the OS sandbox are the real backstops; the rule language is not presented as a security boundary on its own.
- Cold recovery couples availability to the managed file: re-reading the managed layer keeps a recovered session current, and a missing managed file fails recovery closed, which a controlled environment prefers over running with a lapsed policy (the [layered rule loading note](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md)).
- The staging cost was accepted: Stage 1 ships the trustworthy team-control floor; the later stages replace parts without reworking the IR module or the (still-unbuilt) MCP lifecycle, provided the stage-1 interfaces stay shaped for reuse.

## Deferred

Stage 2 (fused MCP mounting) and Stage 3 (hardening) remain unbuilt; their acceptance items (5–7 in the Testing section) carry no test mapping by design:

- **Stage 2 — fused MCP mounting.** A registry catalog with load-time validation, a member's usable MCP set as the deduplicated union of its `mcpServers` and the declared dependencies of its enabled skills, reference-counted lazy start/stop with each connection a single `ctx.effect()` disposer, the `maxPerSessionMcpInstances` and lazy-start/idle-disconnect timeout and default `warmup` config fields, and eager warmup with three-step degradation. An undefined server fails loudly at load with `MCP_SERVER_NOT_FOUND`.
- **Stage 3 — hardening.** Rule learning with the write-back destination and its persistence and concurrency, per-scope dedicated MCP instances, the `readonly`/`bypass` modes, and the Claude Code and Codex hook bridges as `permission` consumers.

## Testing

The proposal's eight acceptance criteria map to these tests; items 5–7 are Stage 2 scope and are deferred:

1. An `enforce`-mode teammate is denied an unmatched call, observable at the executor with the tool still in the schema — `packages/team/team-runtime/tests/permission-enforcement.loader-composition.spec.ts` ("denies an unmatched call of an enforce-mode teammate at the executor, audited, with the tool still in the schema").
2. A managed-layer `deny` blocks a call a teammate or project `allow` would permit, in both `enforce` and `default` mode — `packages/permission/permission-engine/tests/load.spec.ts` ("deny absoluteness across the merged layers", teammate allow in both modes), `packages/permission/permission-engine/tests/evaluate.spec.ts` (managed deny over a project allow in both modes), and the team-runtime composition spec's managed-deny test under `default` mode.
3. A `Bash`/`pwsh` compound command is denied when any subcommand matches a `deny` rule, and a `param:value` rule against a primary content field is ignored with a load-time warning — `packages/permission/permission-engine/tests/evaluate.spec.ts` (compound-command denial for Bash and pwsh), `packages/permission/permission-engine/tests/match-command.spec.ts` (subcommand splitting, wrapper stripping, alias canonicalization), `packages/permission/permission-engine/tests/parse.spec.ts` (the parse-level warning), `packages/permission/permission/tests/permission.loader-composition.spec.ts` (the warning as a `compile` diagnostic at load), and `packages/permission/tool-permission-guard/tests/guard.loader-composition.spec.ts` (the warning to the logger at first compile).
4. Every `evaluate` appends a `permission/decision` event whose fields reconstruct the decision, and a recovered teammate session re-derives teammate-inline rules from `team/member-bound` while re-reading the managed and project layers — `packages/permission/permission-engine/tests/audit.spec.ts` (the field mapping and the append), the guard and team-runtime composition specs (the audit read back from the session log per decision), and `packages/team/team-runtime/tests/member-setup.spec.ts` ("rule-layer recovery on setup": the snapshot plus re-read, the pre-rules cold resume, and the lapsed-managed refusal).
5. (Stage 2) The member MCP set union and `MCP_SERVER_NOT_FOUND` — deferred; no mapping.
6. (Stage 2) Reference-counted start/stop, cold-recovery reconnection, and eager warmup degradation — deferred; no mapping.
7. (Stage 2) `maxPerSessionMcpInstances`, the lazy-start and idle-disconnect timeouts, and the default `warmup` value as config fields — deferred; no mapping.
8. A real cordis.yml composition exercises the enforce-mode denial, the managed cross-layer deny, and the main-agent default path — the team-runtime `permission-enforcement` composition spec (items 1 and 2) and `packages/permission/tool-permission-guard/tests/guard.loader-composition.spec.ts` ("applies the mode config default and allows an unmatched call in default mode").

## Related

- The [teammate permission enforcement note](2026-08-20-teammate-permission-enforcement-at-the-executor.md) ships the team decision plane this note specifies: evaluate at the executor, the ask over the leader rendezvous, the enforce default, and the audit at the commit point.
- The [layered rule loading note](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md) ships the loader, the rule-file format, the fail-closed contract, and the durable snapshot the enforcement hook consumes.
- The [tool permission guard note](2026-08-20-tool-permission-guard-resolves-permission-per-call.md) owns the guard's per-call service resolution under the same hard-activation semantics.
- The [agent team plugin](../feature/2026-08-14-agent-team-plugin.md) note owns the team capability this seam extends.
- The [permission subsystem page](../../../../docs/subsystems/permission.md) and the [adding-agent-team cookbook](../../../../docs/cookbook/adding-agent-team.md) document the shipped surface.
