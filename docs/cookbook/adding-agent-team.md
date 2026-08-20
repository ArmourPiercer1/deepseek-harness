# Cookbook: adding an agent team

English | [中文](adding-agent-team.zh.md)

How to give a running DeepSeek Harness a leader and its teammates, and operate the team day to day. A team is one leader agent and named teammates, each a durable continuable subagent, coordinated through five leader tools; the [Team subsystem page](../subsystems/team.md) owns the mechanism, this guide owns the procedure.

**Prerequisites.** A running harness with a working model route, reached through the [Web UI](../user/guide/index.md). Nothing to install: the team capability ships with the deployment (Step 2).

## 1. Write the team definitions

Team members are Markdown files — YAML frontmatter plus a persona prompt body — that the [dsh-team-local](../../packages/team/team-local/README.md) loader discovers from two directories:

- `$DSH_HOME/teammates/` — global definitions, shared by every workspace.
- `<workspace>/.dsh/teammates/` — project-level definitions; a workspace that defines its own team is self-contained, and home definitions never merge into it.

Exactly one file in the loaded set declares `role: leader`; the rest declare `role: teammate`. The leader file is metadata only: the session's root agent is composed by its own preset, so no leader policy is applied at runtime.

```yaml
---
schemaVersion: 1
id: backend-dev
role: teammate
name: Backend Developer
description: Implements server-side APIs and verifies them with tests.
model: deepseek-v4-flash
maxTokens: 16384
tools:
  allow: [read, edit, write, grep, glob, pwsh, send_team_message]
mcpServers:
  servers: [postgres-mcp]
contextPolicy: persistent
---

You are a senior backend developer...
```

| Field | Required | Meaning |
|---|---|---|
| `schemaVersion`, `id`, `role`, `name`, `description` | yes | identity; `id` is unique per loaded set and is the delegation address |
| prompt body (after the frontmatter) | yes | the member's persona prompt; an empty body parses with a warning |
| `provider`, `model`, `maxTokens` | no | the member's model route and output budget |
| `tools` | no | `allow`/`deny` name lists; a teammate's `deny` always includes the team coordination tools |
| `requiresApproval` | no | legacy: still parsed and snapshotted into `team/member-bound` for existing definitions, but it no longer gates execution — an `ask` rule (Step 4) suspends a tool until the leader decides |
| `skills` | no | skill names the member may load; absence means unrestricted |
| `mcpServers` | no | `servers` allowlist of MCP server names |
| `contextPolicy` | no | `persistent` (default) reuses one child session across delegations; `fresh_per_delegation` starts a new session per `run` |
| `permissions`, `permissionMode` | no | parameter-level rules and the member's permission mode (Step 4) |

Verify: a session on the team preset answers `list_teammates` with the new `id`, and `dsh teammate list` (Step 6) reads the same two directories.

## 2. Choose the mount

Two mount planes exist, and the shipped default is the preset.

**Shipped team preset (default).** The deployment ships a `team` preset in the agent-preset roster — the [round 3 plan](../../AGENT_TEAM_PLUGIN_ROUND3_PLAN.md) decision D6. The preset mounts all five team packages on the preset plane, with the team group inside an `isolate` realm so its services stay off the host plane. Pick it in the Web UI preset picker when starting a session, or set it as the default for later sessions in the **Agent preset** settings row.

**Bundle (opt-in).** [`@deepseek-ai/dsh-bundle-team`](../../packages/bundle/team/README.md) is the install entry for deployments that compose their own profile instead of picking a preset; it inserts the five packages into the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: team-bundle
      name: '@deepseek-ai/dsh-bundle-team'
```

Verify: the `team` row appears in the preset roster, and a session started on it offers the five team tools to the model.

## 3. Delegate work

The leader coordinates through five tools ([dsh-tool-team](../../packages/team/tool-team/README.md)):

| Tool | Purpose |
|---|---|
| `list_teammates` | List teammates with live status |
| `delegate_to_teammate` | Start, continue, or stop a teammate |
| `send_team_message` | Leader ↔ teammate messaging |
| `team_control` | Review and decide pending approval requests |
| `team_progress` | Read/update the team task board |

`delegate_to_teammate` takes a `teammate_id`, a `prompt`, and an `action` — `run` (default), `follow_up`, or `shutdown`. Delegation is asynchronous: the call returns `dispatched` at once, the teammate works in the background in its own child session, and its settled report wakes the leader with the outcome. One in-flight turn per teammate: delegating to a running teammate answers `already_running` and points to `follow_up` or `shutdown`. A `persistent` (default) member reuses its settled child session across delegations; a `fresh_per_delegation` member starts a new session per `run`.

`send_team_message` is bidirectional. A teammate that targets a peer reports to the leader, which is woken to forward the message; direct teammate-to-teammate delivery is a [documented limitation](../../packages/team/tool-team/README.md).

Verify: the delegation result reads `dispatched`, the settled report wakes the leader, and the Web team panel tracks the task board from `team/progress` events and each teammate's bound, running, or settled status.

## 4. Gate what a teammate may do

Tool-name allow/deny, `skills`, and `mcpServers` (Step 1) bound what a member can invoke; parameter-level rules bound what each call does. Rules are authored as strings in three layers — a managed policy file, a project-level file, and the teammate's frontmatter — resolved `deny > ask > allow`, with a managed `deny` absolute in every mode:

```yaml
permissions:
  deny: ["Bash(rm -rf *)", "Read(//**/.env)"]
  ask: ["Bash(git push:*)"]
  allow: ["Bash(git status:*)"]
permissionMode: enforce
```

Four matcher families cover commands, paths, MCP tool prefixes, and generic `Tool(param:value)` arguments; an unmatched call falls back to the member's `permissionMode`, where `enforce` (the controlled teammate's default) denies and `default` allows. The full rule language and its failure modes live in the [dsh-permission-engine README](../../packages/permission/permission-engine/README.md), and the team-side enforcement point in the [dsh-team-runtime README](../../packages/team/team-runtime/README.md).

A teammate's inline rules are snapshotted into its `team/member-bound` event at first delegation, so a deleted definition file cannot break a cold resume; the managed and project layers are re-read at recovery, and a missing managed file refuses recovery rather than running under a lapsed policy.

Verify: a denied call is observable at the executor — the tool call fails with the denial, not merely absent from the tool list — and every decision appends a `permission/decision` event that reconstructs the matched rule, layer, member, mode, and cause.

## 5. Approve teammate requests

An `ask` outcome from an `ask` rule suspends the teammate's call and opens a control request:

1. The runtime persists a `team/control-request` on the teammate's session and wakes the leader.
2. The leader lists it through `team_control` (`action: "list"`) and decides (`action: "decide"` with the request id) with one of `allow_once`, `deny`, `escalate_to_user`, `approve_plan`, or `request_revision`.
3. The decision is persisted as `team/control-decision` and the suspended call settles: an allow executes, a deny or revision fails the call with the reason, and `escalate_to_user` hands the request to the human approval flow.

Every pending request is time-bounded: the [dsh-team-channels](../../packages/team/team-channels/README.md) sweep auto-denies after `controlRequestTimeoutMs` (default 120 s), disposing the leader session auto-denies its pending requests, and a cold resume auto-denies the resuming child's persisted requests still pending in the registry.

Verify: both events appear in the session log in request-then-decision order, and the teammate's tool result states the outcome.

## 6. Manage the team

```bash
dsh teammate list
dsh teammate add ./backend-dev.md
dsh teammate disable backend-dev
dsh teammate enable backend-dev
```

- `list` reads `$DSH_HOME/teammates` and the current workspace's `.dsh/teammates`.
- `add` validates the file's frontmatter before it lands as a definition.
- `enable`/`disable` record the choice per workspace in the `team-enablement` settings namespace ([dsh-team-local](../../packages/team/team-local/README.md#teammate-enablement)) and take effect without a restart; the leader is never disabled.

Definition edits reload through the loader's debounce, so a fixed file reaches the next delegation without a restart. The Web team panel shows the task board and each teammate's status while the session runs.

## References

- [Team subsystem page](../subsystems/team.md) — the leader/teammate model, the control-request flow, the `team/*` events.
- [packages/team](../../packages/team/README.md) — the group README: package table, bundle, quick start.
- [dsh-team](../../packages/team/team/README.md) — Service Definition: types, events, constants.
- [dsh-team-local](../../packages/team/team-local/README.md) — definition format, discovery, enablement, startup diagnostic.
- [dsh-team-runtime](../../packages/team/team-runtime/README.md) — orchestration, guards, approval hook.
- [dsh-team-channels](../../packages/team/team-channels/README.md) — control registry, progress store.
- [dsh-bundle-team](../../packages/bundle/team/README.md) — the opt-in bundle.
- [Agent team round 3 plan](../../AGENT_TEAM_PLUGIN_ROUND3_PLAN.md) — the productization decisions this guide describes.
