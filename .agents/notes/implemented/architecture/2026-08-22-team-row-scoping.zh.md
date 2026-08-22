# Agent Note: 预设行级团队贡献按所属 standing generation 过滤

Status: implemented

[English](2026-08-22-team-row-scoping.md) | 中文

## Problem

Agent Team 插件的 GUI 全功能验收（issue `20260822-team-acceptance`）发现长驻进程中 leader 审批链路被阻断：页面刷新或第二个团队会话之后，每个受限 teammate 调用被评估两次——每个 `tool/call` 产生两条 `permission/decision` 与两个 `team/control-request`——leader 对第一个请求的 `allow_once` 永远无法兑现执行，因为第二次评估把调用重新挂起成一个无人应答的请求。第二个缺陷使会话切换后的首次 `run` 委派以 `Follow-up failed: subagent "…" belongs to another parent session` 失败。

开发实例上的插桩复现锁定了机理：历史列表中每个不同的 preset id 都会获得自己的 standing composition（`presenterScopeFor` → `standingKeyFor`），而该部署带着两个都挂载 `dsh-team-runtime` 的预设（出厂 `team` 加一份用户拷贝）。两个 generation 都在进程全局的 `subagents` activation-setup 注册表上注册 member-setup 贡献，而 `SubagentActivationSetupRegistry.apply()` 不做来源检查地把所有存活贡献装进每个 continuable 子上下文——每个 generation 一个 `tools/pre-execute` 钩子，即双重评估。orchestrator 缺陷是同一共享的另一面：`dsh-tool-team` 每个插件实例持有一个 `TeamOrchestrator`，每个 standing generation 一个实例，而其激活记录（leader 会话级事实）只按 member id 分键，于是新 leader 会话继承了前一 leader 的 settled child，对 durable parent 属于另一会话的 child 发起冷 followup。

## Decision

- 预设行的 continuable-setup 贡献只装入派生自同一 standing composition 的子会话。过滤读取既有的身份：`scopeOf(rowCtx)` 即 standing scope key（预设行从挂载 scope 上下文继承 scope 标签），经 `composeFrom` 派生的 child 以该 key 为 scope parent（`scopeParentOf(scopeOf(childCtx))`）。宿主平面的行不带 scope 标签，保持对所有 team child 安装——宿主行只挂载一次，全域语义在那里是正确的。
- `TeamOrchestrator` 按 leader 会话 id 划分激活记录：每个方法接收 leader id，`session/event` 监听器经 child header 的 `parentSession` 把 child 事件归属到 leader。跨 leader 读取一律返回空，来自其他 leader 的陈旧 child session id 再也无法到达 `followup`。
- `enforce` 模式拦截团队内部工具（`report`）保持引擎既有行为；契约写入 agent-team cookbook：`enforce` 成员的 allow 列表必须显式包含团队自身的汇报工具。

## Consequences

预设行对其自身另一 generation（编辑中的 composition）下派生的 child 不再执行强制——这是正确的，因为 child 自己的 generation 携带它自己的行。orchestrator 按 leader 保留激活记录、无跨 leader 复用，这不付出代价，因为激活记录跨 leader 本就无效。`TeamOrchestrator` 的公开方法全部以 leader 会话 id 为首参，触及 `dsh-tool-team` 及其测试的每个调用方。

## Alternatives considered

按 fiber 祖先（`withinFiber`）过滤——否决：child agent 的 scope fiber 由宿主根 agent loop 铸出，而非 preset 子树，fiber 成员关系无法表达派生关系。在 `SubagentActivationSetupRegistry` 内去重注册——否决：两个存活 generation 注册同一贡献都是合法的；注册表无法知道哪些 child 属于哪个 generation，只有 scope 链可以。引擎侧豁免团队内部工具——对 `report` 否决：那会把工具置于"每次调用都评估"不变量之外；cookbook 改为记录 allow 列表要求。

## Verification

- `packages/team/team-runtime/tests/member-setup.spec.ts`——四个新用例：装入本 generation 的 child、跳过外来 generation 的 child、跳过无 scope parent 的 child、不带标签（宿主）行上下文全部装入。
- `packages/team/team-runtime/tests/orchestrator.spec.ts` 与 `packages/team/tool-team/tests/settlement.spec.ts`——跨 leader 不可见、按 leader 的成员复用、同一 member id 在两个 leader 下持有不同 child。
- `examples/team-agent/tests/team-e2e.snapshot.ts` 原样通过（单 generation 启动路径字节稳定：ask → allow_once → 执行仍然成立）。
- `pnpm vitest run packages/team packages/permission packages/subagent packages/preset` 与 `pnpm run typecheck` 全绿。
