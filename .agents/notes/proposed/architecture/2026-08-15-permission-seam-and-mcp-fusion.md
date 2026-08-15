# Agent Note: The permission seam — parameter-level tool rules and fused MCP mounting for controlled team workflows

Status: proposed

English | [中文](2026-08-15-permission-seam-and-mcp-fusion.zh.md)

## Problem

DeepSeek Harness can restrict a team member's tools only by tool name. `TeamToolPolicy` carries `allow`/`deny` name lists, `TEAMMATE_DENIED_TOOLS` hard-codes three coordination tools, and `createMcpGuard` masks MCP tool names by their `mcp__<server>__` prefix. A member that is allowed `pwsh` may run any command; a member allowed `write` may write any path. There is no way to express "this teammate may run `git status` but not `rm -rf`", "may read the repository but never `.env`", or "may call the `postgres` MCP query tool but no other server". For an engineering-control environment where a teammate is entrusted with real authority, name-level gating is not a foundation that can be trusted.

MCP access has the same shape gap. Every MCP server is mounted globally; the only per-member control is name masking. A member cannot be assigned a stable, persisted set of MCP servers, a skill cannot pull in the MCP it needs for the duration of a task, and an unused server cannot stay disconnected to keep its tool descriptions out of an unrelated session's context. The two useful patterns — a member's persisted MCP set (stable, auditable) and a skill's on-demand MCP (loaded with the task) — are both absent, and the reference implementations that have them either scatter server credentials into copyable skill files (oh-my-opencode) or stop at name-list filtering over shared connections (PilotDeck).

These gaps sit at the boundary the [agent team plugin](../../implemented/feature/2026-08-14-agent-team-plugin.md) already owns, but they are not team-specific: a main agent and a single delegated subagent need the same parameter-level authority. Delegated subagents additionally run with [approvals pinned to `'never'`](../../implemented/feature/2026-08-10-subagent-approval-pinned-never.md), so for them a rule engine — not an interactive prompt — must be the decision authority.

## Proposal

Introduce a `permission` capability seam as an independent set of packages, consumed by the team plugin, the main agent, and single delegated subagents alike. Fuse MCP mounting so a member's persisted servers and a skill's declared dependencies aggregate into one lazily-managed, per-scope MCP set. Deliver in stages so a trustworthy team-control floor ships first and the general engine and MCP isolation follow without rework.

### The `permission` seam and its boundary

Three packages form the seam:

- `packages/permission/permission` — the Service Definition: `evaluate(toolCall, context)` returning `deny | ask | allow`, plus the rule intermediate representation (IR), rule-layer, and permission-mode types. Publishing a service places this row in the host composition.
- `packages/permission/permission-engine` — the Service Provider: string-rule parsing to IR, the four matchers below, `deny > ask > allow` layered resolution with an absolute managed layer, permission-mode fallback, and the audit event.
- `packages/permission/tool-permission-guard` — a `tools/pre-execute` Consumer that applies `evaluate` for the main agent and single delegated subagents.

The team plugin changes to `inject: ['permission']`: its `installApprovalHook` stops gating by tool name and calls `evaluate` instead. An `ask` result reuses the existing leader rendezvous (the suspend-wake-decide loop over `team/control-request`) rather than a new channel.

The seam sits above the OS floor, not inside it. The `permission` engine decides whether a tool call may be issued; the [subprocess sandbox](../../implemented/feature/2026-07-06-sandbox.md) and `fs-sandbox` remain a parallel OS-level backstop that physically contains a call that was issued. An `ask` outcome is delivered through the existing [approval seam](../../implemented/feature/2026-07-06-approval-seam.md) for the main agent and through the leader rendezvous for a teammate. `permission` depends on the approval seam to fulfil `ask`; it does not absorb it, and it does not merge with the sandbox.

Rule layer, matcher engine, and permission-mode fallback are not separate packages: they are parts of one `evaluate` that must produce a single decision at the point the decision is made, so they cannot be split without creating an order-of-precedence ambiguity the seam exists to remove.

### Rule language: authored strings, structured IR core

Rules are authored as Claude Code-style strings that a person can review, diff, and put under version control, and parsed into a structured IR the engine matches and audits:

```yaml
permissions:
  deny:  ["Bash(rm -rf *)", "Read(//**/.env)", "mcp__*"]
  ask:   ["Bash(git push:*)", "pwsh(Remove-Item *)"]
  allow: ["Bash(git status:*)", "mcp__postgres__query"]
permissionMode: enforce            # enforce | default (readonly/bypass reserved)
```

The IR dispatches to four matchers, aligned with Claude Code's documented behavior and its documented failure modes:

1. **Command** (Bash / pwsh): split a compound command on `&&`, `||`, `;`, `|`, `|&`, `&`, and newlines and match each subcommand independently; strip the fixed wrapper set; canonicalize pwsh aliases. The primary content field (`command`) is not matchable by a `param:value` rule, because a compound command would bypass it.
2. **Path** (Read / Edit / Write and the read/edit family): gitignore semantics with the `//` (filesystem root), `~` (home), and `/` (relative to the rule's settings source) anchors; Windows paths normalize to POSIX (`C:\` → `/c/`).
3. **MCP**: the `mcp__server`, `mcp__server__tool`, and `mcp__server__*` prefixes.
4. **Generic parameter**: `Tool(param:value)` against a top-level scalar input field for long-tail tools, never a primary content field.

Resolution order is `deny → ask → allow → mode fallback`. A managed-layer `deny` is absolute in every mode and cannot be overridden by a lower layer's `allow`.

### Permission modes and the default decision

An unmatched call is decided by a per-scope permission mode, a config enum. Two modes ship first: `enforce` (unmatched ⇒ `deny`, an allowlist; the default for a controlled teammate) and `default` (unmatched ⇒ `allow`, a denylist; for the main agent). `readonly` and `bypass` are reserved enum values for later. The mode binds per scope — the main agent's mode comes from host or project configuration, a teammate declares its own in `.md` frontmatter — and the managed layer can cap the mode (for example forbidding `bypass` fleet-wide). A managed `deny` still applies under every mode, so an organization's `deny: Read(//**/.env)` backstops even a `default`-mode main agent.

### Rule layering, persistence, and audit

Rules load from layered files: managed (a protected policy file), project (a project-level file), and teammate (`.md` frontmatter). Loading concatenates and deduplicates the array-valued rule sets and keeps `deny` absolute across layers. Rule learning — writing an approved `ask` back to a chosen destination (`session`/`project`/…) — is shaped into the file format now but not implemented in the first stage; a session-level learned rule maps to a session event.

Every `evaluate` appends a `permission/decision` audit session event carrying the tool name, decision, matched rule, layer, member id, mode, and cause. An engineering-control environment must be able to reconstruct after the fact who was allowed or denied which operation and under which rule.

### Fused MCP mounting

A member's usable MCP set aggregates two sources: member-level `mcpServers` (persisted, always-assigned) and the MCP dependency names a member's enabled skills declare. A skill declares only dependency names; the real server definition — command, arguments, endpoint, credentials — lives in one MCP registry governed by the managed and project layers. This keeps oh-my-opencode's on-demand loading without scattering credentials into copyable skill files, and keeps PilotDeck's single auditable source. The aggregate is deduplicated, validated against the registry catalog at load (an undefined server fails loud with `MCP_SERVER_NOT_FOUND`), and then filtered by the `permission` engine's `mcp__server` rules.

MCP lifecycle ships in two stages. Stage B: reference-counted lazy start and stop — a registry server connects when any live member references it and disconnects when all references drop, with same-named servers sharing one connection; each connection is a `ctx.effect()` disposer bound to the child session. A `warmup: eager | lazy` config setting lets an eager server pre-connect in the background during cold recovery and first delegation, in parallel with the teammate's work, so the first call does not pay the process-spawn, MCP `initialize` handshake, and `tools/list` latency; a failed eager warmup degrades in three steps — the teammate side falls back to lazy and keeps working, the failure is reported to the leader and the UI, and a tool that still cannot reach its MCP fails closed with the reason. Stage C: per-scope dedicated instances for process, state, and credential isolation, replacing shared connections without reworking the lifecycle. `maxPerSessionMcpInstances`, the lazy-start timeout, the idle-disconnect timeout, and the default `warmup` value are config fields present from the first stage.

### Cold recovery

A recovered teammate session rebuilds its policy from the durable `team/member-bound` event without the parent's live registry. Teammate-inline rules are snapshotted into that event and frozen with the session, so a deleted member file does not break recovery. The managed and project layers are re-read at recovery so an organization's tightened `deny` immediately constrains an in-flight recovered session; a missing managed file fails loud and refuses recovery. MCP recovery rebuilds the usable-dependency declaration only; connections start lazily, and an `eager` server pre-connects in the background. When an `ask` cannot be decided because the leader session is unreachable, `permission` fails closed with a `deny` whose reason states plainly that this is not a final verdict — the teammate should advance other work and retry the operation itself later — and the decision is audited.

### Delivery stages

- Stage 1 (the trustworthy floor): the `permission` triplet, four matchers, `deny > ask > allow` with `enforce`/`default` modes and an absolute managed layer; the team plugin injects `permission`, `installApprovalHook` calls `evaluate`, `ask` reuses the rendezvous; the `permission/decision` audit event; layered-file loading and merging (read-only); the cold-recovery rule snapshot.
- Stage 2 (MCP fusion B): registry catalog validation, member ∪ skill-dependency aggregation, reference-counted lazy start/stop with the `ctx.effect()` lifecycle, the limit and timeout config, and eager warmup with three-step degradation.
- Stage 3 (hardening): rule learning with the write-back destination and its persistence and concurrency; per-scope dedicated MCP instances; the `readonly`/`bypass` modes; the Claude Code and Codex hook bridges as `permission` consumers.

## Alternatives considered

**Extend the team layer only, without a new seam.** Growing `TeamToolPolicy` and `installApprovalHook` in place would ship fastest, but the parameter-level authority is not team-specific — the main agent and single delegated subagents need the same rules — and a rule engine that lives inside one `tools/pre-execute` listener has no Service Definition to consume, relies on listener order rather than a decision point (which the package invariants reject as non-enforcement), and would be reworked into a service later. Rejected in favor of the seam, staged so the team-layer outcome still ships first.

**A single global default decision.** A global `allow` default (denylist only) matches today's behavior but leaves an engineering-control environment one missing `deny` away from an open tool; a global `deny` default (allowlist only) is safe but paralyzes the main agent. A per-scope permission mode lets a controlled teammate run `enforce` while the main agent runs `default`, with the managed `deny` backstopping both.

**Structured JSON selectors as the authored form (PilotDeck's `ToolCallSelector`).** A structured selector is precise and easy to construct programmatically, but rules that must be human-reviewed, version-controlled, and merged across layers read far better as strings; the engine keeps the structured IR internally for matching and audit while authors write strings.

**Skills carry inline MCP server definitions (oh-my-opencode).** Letting a skill's frontmatter define the MCP server gives on-demand loading, but an MCP server definition is deployment-sensitive — command, endpoint, credentials — and must not be scattered into copyable skill files where it drifts and leaks and escapes managed control. A skill declares only the dependency name; the definition stays in one governed registry.

**Merge `permission` into `fs-sandbox`.** The two answer different questions — whether a tool call may be issued versus whether an issued call is physically contained — and evolve independently, so they are parallel layers of one defense-in-depth stack, not one package.

**Per-scope MCP instances from the start (skip stage B).** Full process isolation is the strongest form, but its instance pool, per-session cap, and failure recovery are complex, and the first-stage need is on-demand start/stop and keeping unrelated MCP out of a session's context — which reference-counted shared connections already satisfy. The dedicated-instance form replaces the shared connection later without reworking the lifecycle.

**Eager warmup as a per-MCP script.** Pre-connecting an MCP does not need a script per server: the start command already lives in the registry, so warmup is the engine initiating the existing connection earlier, in parallel. A per-MCP script would reintroduce the scattered-configuration problem the registry removes.

## Acceptance criteria

- A controlled teammate in `enforce` mode is denied a tool call that matches no allow rule, and the denial is observable at the executor, not merely absent from the tool schema.
- A managed-layer `deny` blocks a call that a teammate or project `allow` would otherwise permit, in both `enforce` and `default` modes.
- A `Bash`/`pwsh` compound command is denied when any subcommand matches a `deny` rule; a `param:value` rule against a primary content field is ignored with a load-time warning.
- Every `evaluate` appends a `permission/decision` event whose fields reconstruct the decision, and a recovered teammate session re-derives teammate-inline rules from `team/member-bound` while re-reading the managed and project layers.
- A member's usable MCP set is the deduplicated union of its `mcpServers` and its enabled skills' declared dependencies; an undefined server fails loud at load with `MCP_SERVER_NOT_FOUND`.
- A stage-B registry server connects on first live reference and disconnects when all references drop; an `eager` server pre-connects during cold recovery; a failed eager warmup degrades to lazy without failing the teammate.
- `maxPerSessionMcpInstances`, the lazy-start and idle-disconnect timeouts, and the default `warmup` value are config fields.
- A real cordis.yml composition test exercises the enforce-mode denial, the managed cross-layer deny, and the main-agent default path.

## Risks

- **A second permission system.** If `permission` and `fs-sandbox` blur, decisions split across two owners. The boundary is explicit: `permission` decides issuance, the sandbox contains execution, and only `permission` produces `deny`/`ask`/`allow`.
- **Rule fragility.** Command-argument patterns are best-effort — a compound command, a variable, or extra spaces can evade a naive pattern, as Claude Code documents. The engine mitigates with subcommand splitting and wrapper stripping, and the managed `deny` plus the OS sandbox are the real backstops; the rule language is not presented as a security boundary on its own.
- **MCP lifecycle correctness.** Reference-counted start/stop, cold-recovery reconnection, and eager warmup touch process lifecycle, where a leaked or double-freed connection is a defect; each connection is a single `ctx.effect()` disposer, and warmup failure degrades rather than crashing.
- **Cold-recovery policy staleness versus availability.** Re-reading the managed layer keeps a recovered session current but couples recovery to file availability; a missing managed file fails recovery closed, which a controlled environment prefers over running with a lapsed policy.
- **Staging cost.** Three stages take longer than one, but the first stage delivers the trustworthy team-control floor and the later stages replace parts without reworking the IR module or the lifecycle, provided the stage-1 interfaces are shaped for reuse.
