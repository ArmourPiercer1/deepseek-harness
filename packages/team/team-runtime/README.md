# dsh-team-runtime

English | [中文](README.zh.md)

Team runtime orchestration, delegation, and per-member capability filtering for the DeepSeek Harness team plugin.

## Role

**Consumer** — orchestrates teammate lifecycles, installs per-member composition (skill guard, MCP guard) on continuable child scopes, and enforces each teammate's permission policy at the executor.

## Key Exports

| Export | Description |
|---|---|
| `TeamOrchestrator` | Session-scoped activation manager |
| `createMcpGuard` | Dynamic MCP tool guard factory |
| `createSkillGuard` | Dynamic skill tool guard factory |
| `installMemberComposition` | Composite member setup from bound data |
| `installApprovalHook` | Scoped `tools/pre-execute` enforcement: every call is evaluated by the `permission` service; allow proceeds, deny blocks with the engine's reason, ask suspends at the leader rendezvous; abort and leader-unreachability settle with a deny |
| `teamMemberSetupContribution` | `registerContinuableSetup` contribution reading `team/member-bound`, reconciling pending control requests, installing the enforcement hook, and starting the rule-layer recovery load |
| `resolveRuleLayerPaths` | Resolve the managed (`$DSH_HOME/permissions.yml`) and project (`<workspace>/.dsh/permissions.yml`) rule file paths |
| `getRecoveredRuleLayers` | Read a team child's stored rule-layer load (a promise that may reject with a lapsed-managed or malformed-file error); `setRecoveredRuleLayers` / `releaseRecoveredRuleLayers` write and remove the entry |

## Permission Enforcement

The `permission` service is a hard injection of this plugin: the plugin activates only where a permission engine row is composed, and every bound teammate child carries the enforcement hook. The hook is the decision point — it does not filter the tool schema, so a denied call is still a dispatched call that the executor settles with the engine's model-visible reason.

Every tool call the child makes is evaluated against the member's recovered rule layers under the member's permission mode (`permissionMode` from the durable `team/member-bound` payload, `enforce` when undeclared). The engine's ordered policy applies: a `deny` rule beats everything, an `ask` rule suspends the call, an `allow` rule releases it, and the mode decides the unmatched case (`enforce` denies, `default` allows). Each evaluation appends a `permission/decision` audit event to the child session at the commit point; a call that never reaches the engine (no rule state, a rejected policy load) is denied without an audit.

An `ask` decision suspends the call at the existing leader rendezvous: the child logs `team/control-request`, a control-registry entry is created, and the leader is woken. `allow_once` / `approve_plan` resume the suspended execution, `deny` and `request_revision` block it, and `escalate_to_user` surfaces an ask to the user. When no leader is reachable, the ask settles as an audited deny with `cause: 'leader_unreachable'` whose reason states plainly that it is not a final verdict.

Rule paths resolve against the child's own scope: the managed layer reads `$DSH_HOME/permissions.yml`, the project layer reads the child session's cwd, and the engine's path anchors resolve `/`-anchored rules against the session cwd, `~` against `$DSH_HOME`, and `//` against the filesystem root.

## Rule Layer Recovery

On both fresh creation and cold resume, `teamMemberSetupContribution` starts the team child's rule-layer load: it calls `loadRuleLayers` with the scope's rule file paths (managed under `$DSH_HOME`, project under the child session's cwd), the teammate inline rules snapshotted into the durable `team/member-bound` payload, and the bind-time managed presence recorded in that same payload. The file layers are always re-read from disk, so an in-flight recovered session is constrained by the organization's current policy; a managed file that was present at bind and is now missing rejects the load instead of being skipped, and the stored rejection is consumed by the enforcement point rather than surfacing as an unhandled rejection.

## Model Experience

Indirectly, through the subagent seam that the orchestrator delegates to for teammate execution.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- `maxTokens` is applied on fresh delegation only; a cold-resumed teammate falls back to its route default because the continuable descriptor omits per-activation budgets by design.
- The hard `permission` injection means the plugin activates only in compositions that carry a permission engine row. The shipped base bundle carries it, so every shipped preset resolves the injection; a custom composition without the engine row shows the team-runtime row as pending instead of running with an invisible policy gap.
