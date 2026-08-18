# Team

English | [中文](team.zh.md)

The team capability of [packages/team](../../packages/team) coordinates one leader and its teammates as durable continuable subagents. `ctx.team` ([dsh-team](../../packages/team/team)) is the [Service Definition](../../packages/team/team/README.md): the abstract `TeamRegistry` that loads, queries, and validates `TeamMemberDefinition` records and resolves each member's effective `ToolRestriction`. A provider such as [dsh-team-local](../../packages/team/team-local/README.md) supplies the definitions; [dsh-team-runtime](../../packages/team/team-runtime/README.md) orchestrates teammate lifecycles and installs per-member composition (MCP guard and approval hook) on continuable child scopes; [dsh-team-channels](../../packages/team/team-channels/README.md) provides host-level `ctx.teamControl` (the `TeamControlRegistry` of pending teammate control requests and the `TeamProgressStore`); and [dsh-tool-team](../../packages/team/tool-team/README.md) registers the five model-facing team tools. The package-level [README](../../packages/team/README.md) owns composition and the bundle.

Source: [`packages/team/team/src/index.ts`](../../packages/team/team/src/index.ts)

## The leader/teammate model

A `TeamMemberDefinition` is one unified record for a leader or a teammate; only `role` differs. The leader is metadata only — the root agent is composed by its own preset, never by this registry, so no leader policy is applied at runtime. `TeamRegistry` resolves the effective tool policy: a leader's `allow` always includes the irremovable `DEFAULT_LEADER_TOOLS` and never denies them, while a teammate's `deny` always includes the `TEAMMATE_DENIED_TOOLS` (`delegate_to_teammate`, `team_control`, `list_teammates`), so a teammate cannot delegate further or review requests. A teammate may carry `requiresApproval` tools that pause execution until the leader decides, and an `mcpServers` allowlist.

A teammate is a durable continuable subagent. On delegation, `dsh-team-runtime` binds the child session to its member definition by appending a `team/member-bound` event once in the child's initial turn; that event carries the full effective policy snapshot so cold resume reconstructs the member without the parent's live registry.

## Delegation and coordination tools

[dsh-tool-team](../../packages/team/tool-team/README.md) registers five tools on the leader:

| Tool | Purpose |
|---|---|
| `delegate_to_teammate` | Start, continue, or stop a teammate |
| `list_teammates` | List teammates with live status |
| `send_team_message` | Send a message between leader and teammate |
| `team_progress` | Read or update the team task board |
| `team_control` | Review and decide pending teammate control requests |

## The control-request flow

`ctx.teamControl` ([dsh-team-channels](../../packages/team/team-channels/README.md)) is a host-level registry of pending teammate → leader approval requests, keyed by the leader's session id. When a teammate calls a `requiresApproval` tool, a `tools/pre-execute` listener creates a request and suspends execution; the leader receives it via `reportFrom` wakeup and decides through the `team_control` tool. A `controlRequestTimeoutMs` sweep auto-denies expired requests, and disposal auto-denies pending ones.

## The `team/*` session events

The team plugin declares five `team/*` session events: `team/member-bound` (durable binding of a child session to a member definition), `team/message` (leader ↔ teammate messaging), `team/progress` (a structured task item created or updated), `team/control-request` (a teammate asking the leader to approve a tool), and `team/control-decision` (the leader's decision on a request). The complete event declarations are in the generated [Cordis API](#cordis-surface) below; the session event catalog owns their full payload types.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteam--teamregistry"></a>

### `ctx.team` — `TeamRegistry`

Registry of team member definitions.

Service Providers call register to populate the registry with definitions. Consumers read definitions through list, get, etc.

```ts cordis-catalog
/**
 * Register member definitions. Replaces any previously registered set.
 *
 * @param definitions - the complete set of definitions to register.
 */
register(definitions: readonly TeamMemberDefinition[]): void

/**
 * List all loaded member definitions (leader + teammates).
 *
 * @returns the registry's full set of member definitions.
 */
list(): readonly TeamMemberDefinition[]

/**
 * Get one member by id.
 *
 * @param id - the member to look up.
 * @returns the member definition, or undefined when the id is unknown.
 */
get(id: TeamMemberId): TeamMemberDefinition | undefined

/**
 * Get the leader definition, or `undefined` when none is loaded. The leader
 * definition is metadata only: the root agent is composed by its own preset,
 * never by this registry, so no leader policy is applied at runtime.
 *
 * @returns the leader definition, or undefined when none is loaded.
 */
getLeader(): TeamMemberDefinition | undefined

/**
 * Resolve the effective {@link ToolRestriction} for a member.
 *
 * - **Leader**: `allow = DEFAULT_LEADER_TOOLS ∪ definition.tools.allow`;
 *   `deny = definition.tools.deny` (DEFAULT_LEADER_TOOLS never denied).
 * - **Teammate**: `allow`/`deny` from definition; `deny` always includes
 *   team control tools (`delegate_to_teammate`, `team_control`, `list_teammates`).
 *
 * @param member - the member definition to resolve.
 * @returns the resolved tool restriction.
 */
effectiveToolPolicy(member: TeamMemberDefinition): ToolRestriction
```

Types: [ToolRestriction](tools.md)

Source: [`packages/team/team/src/index.ts:38`](../../packages/team/team/src/index.ts)

<a id="ctxteamcontrol--teamcontrolregistry"></a>

### `ctx.teamControl` — `TeamControlRegistry`

Host-level registry of pending control requests, keyed by leader session id.

Flow: 1. Teammate calls a `requiresApproval` tool 2. The teammate's `tools/pre-execute` listener calls `create` 3. Request is logged as `team/control-request` session event 4. Leader receives the request via `reportFrom` wakeup 5. Leader calls `team_control` tool with decision 6. Decision is logged as `team/control-decision` session event 7. The suspended `tools/pre-execute` Promise resolves → tool proceeds or is denied

Orphaned pending requests — whose suspended execution has already been torn down — are auto-denied through three settlement paths: `sweep` (timeout), `dispose` (leader session teardown), and `reconcilePending` (cold resume of a resuming child, or an aborted execution settling its own entry).

```ts cordis-catalog
/**
 * Create a pending request under a leader session and return its settlement promise.
 *
 * @param leaderSessionId - the leader session the request is addressed to.
 * @param data - the control request data.
 * @returns a promise that resolves with the leader's decision.
 */
create(leaderSessionId: string, data: TeamControlRequestData): Promise<TeamControlDecision>

/**
 * Settle a pending request with the leader's decision.
 *
 * @param leaderSessionId - the leader session the request belongs to.
 * @param requestId - the request to settle.
 * @param decision - the leader's decision.
 * @throws when the request id is unknown for that leader.
 */
decide(leaderSessionId: string, requestId: string, decision: TeamControlDecision): void

/**
 * List all pending requests for one leader.
 *
 * @param leaderSessionId - the leader session whose pending requests to return.
 * @returns the pending request data for that leader.
 */
list(leaderSessionId: string): readonly TeamControlRequestData[]

/**
 * Time out and auto-deny expired requests across every leader.
 *
 * @param now - current epoch ms.
 * @param timeoutMs - maximum age in ms.
 */
sweep(now: number, timeoutMs: number): void

/**
 * Reconcile persisted requests against the live registry, auto-denying the
 * still-pending entries.
 *
 * A request whose suspended execution has already been torn down (child
 * activation disposal, execution abort, or a process restart in between)
 * can never drive a tool again, so it is settled with 'deny' and dropped
 * from the pending list. Requests with no live entry — already decided, or
 * lost with a restart — are a no-op. A concurrent `decide` on the same
 * request is safe: it removes the entry first and this method skips it.
 *
 * @param leaderSessionId - the leader session the requests are addressed to.
 * @param requests - the persisted requests to reconcile, e.g. every
 *   `team/control-request` logged by a resuming child.
 * @returns the ids of the requests that were still pending and were denied.
 */
reconcilePending(leaderSessionId: string, requests: readonly TeamControlRequestData[]): string[]

/**
 * Dispose all pending requests for one leader, auto-denying each.
 *
 * @param leaderSessionId - the leader session whose pending requests to dispose.
 */
dispose(leaderSessionId: string): void
```

Source: [`packages/team/team-channels/src/control-coordinator.ts:52`](../../packages/team/team-channels/src/control-coordinator.ts)
<!-- END GENERATED cordis-surface -->
