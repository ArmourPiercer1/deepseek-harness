# 团队

[English](team.md) | 中文

[packages/team](../../packages/team) 的团队能力将一位 leader 及其 teammates 协调为持久的可延续子代理。`ctx.team`（[dsh-team](../../packages/team/team)）是[服务定义](../../packages/team/team/README.zh.md)：抽象的 `TeamRegistry`，负责加载、查询和校验 `TeamMemberDefinition` 记录，并解析每个成员的有效 `ToolRestriction`。诸如 [dsh-team-local](../../packages/team/team-local/README.zh.md) 这样的提供方负责提供定义；[dsh-team-runtime](../../packages/team/team-runtime/README.zh.md) 编排 teammate 生命周期，并在可延续子作用域上安装逐成员组合（MCP 守卫与审批钩子）；[dsh-team-channels](../../packages/team/team-channels/README.zh.md) 提供宿主级 `ctx.teamControl`（待处理 teammate 控制请求的 `TeamControlRegistry` 与 `TeamProgressStore`）；[dsh-tool-team](../../packages/team/tool-team/README.zh.md) 注册五个面向模型的团队工具。包级 [README](../../packages/team/README.zh.md) 负责组合方式与 bundle。

源码：[`packages/team/team/src/index.ts`](../../packages/team/team/src/index.ts)

## leader/teammate 模型

`TeamMemberDefinition` 是 leader 或 teammate 的统一记录，只有 `role` 不同。leader 仅作为元数据存在——根代理由其自身的 preset 组合，绝不通过该注册表，因此运行时不会施加任何 leader 策略。`TeamRegistry` 解析有效工具策略：leader 的 `allow` 始终包含不可移除的 `DEFAULT_LEADER_TOOLS`，且绝不否认其中任何工具；teammate 的 `deny` 始终包含 `TEAMMATE_DENIED_TOOLS`（`delegate_to_teammate`、`team_control`、`list_teammates`），因此 teammate 无法进一步委派或审阅请求。teammate 可以携带 `requiresApproval` 工具，在执行暂停期间等待 leader 决定，并可携带 `mcpServers` 白名单。

teammate 是持久的可延续子代理。在委派时，`dsh-team-runtime` 通过在子会话的初始轮次中追加一次 `team/member-bound` 事件，将该子会话绑定到其成员定义；该事件携带完整的有效策略快照，因此冷恢复可在不依赖父进程实时注册表的情况下重建该成员。

## 委派与协调工具

[dsh-tool-team](../../packages/team/tool-team/README.zh.md) 在 leader 上注册五个工具：

| 工具 | 用途 |
|---|---|
| `delegate_to_teammate` | 启动、继续或停止一个 teammate |
| `list_teammates` | 列出带实时状态的 teammates |
| `send_team_message` | 在 leader 与 teammate 之间发送消息 |
| `team_progress` | 读取或更新团队任务看板 |
| `team_control` | 审阅并决定待处理的 teammate 控制请求 |

## 控制请求流程

`ctx.teamControl`（[dsh-team-channels](../../packages/team/team-channels/README.zh.md)）是一个宿主级注册表，按 leader 的会话 id 记录待处理的 teammate → leader 审批请求。当 teammate 调用 `requiresApproval` 工具时，`tools/pre-execute` 监听器创建一个请求并挂起执行；leader 通过 `reportFrom` 唤醒接收该请求，并通过 `team_control` 工具决定。`controlRequestTimeoutMs` 清扫会超时自动拒绝过期请求，销毁时也会自动拒绝所有待处理请求。

## `team/*` 会话事件

团队插件声明了五个 `team/*` 会话事件：`team/member-bound`（子会话与成员定义的持久绑定）、`team/message`（leader ↔ teammate 消息）、`team/progress`（结构化任务项被创建或更新）、`team/control-request`（teammate 请求 leader 批准某个工具）以及 `team/control-decision`（leader 对请求的决定）。完整的事件声明见下方生成的 [Cordis API](#cordis-surface)；会话事件目录拥有它们的完整 payload 类型。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [ToolRestriction](tools.zh.md)

Source: [`packages/team/team/src/index.ts`](../../packages/team/team/src/index.ts)

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

Source: [`packages/team/team-channels/src/control-coordinator.ts`](../../packages/team/team-channels/src/control-coordinator.ts)

<a id="ctxteamprojection--teamprojectionservice"></a>

### `ctx.teamProjection` — `TeamProjectionService`

Read-only team projection over session logs and the workspace roster. The service owns no cache; every call re-reads the corpus (roster directory reads are cheap and logs are local), so a fold always reflects committed state.

Folds are gated on team-ness: the requested session must own a `team:`-labeled continuable child in its subagent directory or a team fact in its own log suffix (a roster entry alone never qualifies); a bound teammate (own `team/member-bound`) anchors its leader. A session passing no criterion is rejected with `LEADER_UNKNOWN`, never an empty view.

```ts cordis-catalog
/**
 * Subscribe to whole-snapshot publications. Last-wins per leader: a listener
 * sees the newest committed snapshot for each leader, never deltas.
 * @param listener - invoked once per committed leader snapshot.
 * @returns the disposer removing this listener.
 */
onChanged(listener: TeamProjectionListener): () => void

/**
 * Fold one leader's complete current view. Cold-safe: a leader absent from
 * the live store is rebuilt from persistence. The requested session must
 * pass the team-ness gate — a roster entry alone never qualifies — so an
 * ordinary session is a loud rejection, never a synthetic empty team; a
 * bound teammate request anchors its leader.
 * @param leaderSessionId - the team session anchoring the fold (a leader, or
 *   a bound teammate whose leader is anchored instead).
 * @param signal - caller cancellation observed around every persistence read.
 * @param options - pagination options for the message-page response form.
 * @returns the full snapshot, or the older-messages page when `messagesBefore` is set.
 * @throws {@link TeamProjectionError} LEADER_UNKNOWN when neither store knows the session, or the
 *   session fails the team-ness gate (no team child, no team fact in its own log).
 * @throws {@link TeamProjectionError} ANCHOR_UNKNOWN when the anchor names no folded message.
 * @throws {@link TeamProjectionError} INVALID_LIMIT when limit is outside [1, MESSAGE_CAP].
 */
async project( leaderSessionId: SessionId, signal?: AbortSignal, options?: TeamPageOptions, ): Promise<TeamView | TeamMessagePage>

/**
 * Read one leader's current snapshot without pagination (the push payload shape).
 * @param leaderSessionId - the team session anchoring the fold (a leader, or
 *   a bound teammate whose leader is anchored instead).
 * @param signal - caller cancellation observed around every persistence read.
 * @returns the full snapshot.
 * @throws {@link TeamProjectionError} LEADER_UNKNOWN when neither store knows the session, or the
 *   session fails the team-ness gate (no team child, no team fact in its own log).
 */
async get(leaderSessionId: SessionId, signal?: AbortSignal): Promise<TeamView>
```

Types: [SessionId](core.zh.md)

Source: [`packages/team/team-projection/src/index.ts`](../../packages/team/team-projection/src/index.ts)
<!-- END GENERATED cordis-surface -->
