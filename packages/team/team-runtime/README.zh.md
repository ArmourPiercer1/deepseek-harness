# dsh-team-runtime

[English](README.md) | 中文

DeepSeek Harness 团队插件的团队运行时编排、委托与每个成员的能力过滤。

## 角色

**Consumer** —— 编排 teammate 生命周期，在可继续的子作用域上安装每个成员的组合（skill guard、MCP guard），并在执行器上强制执行每个 teammate 的权限策略。

## 关键导出

| 导出 | 说明 |
|---|---|
| `TeamOrchestrator` | 会话作用域的激活管理器 |
| `createMcpGuard` | 动态 MCP 工具 guard 工厂 |
| `createSkillGuard` | 动态 skill 工具 guard 工厂 |
| `installMemberComposition` | 从绑定数据进行的复合成员设置 |
| `installApprovalHook` | 作用域的 `tools/pre-execute` 强制点：每个调用都由 `permission` 服务评估；allow 放行，deny 以引擎的理由阻断，ask 在 leader 会合处挂起；中止与无法联系 leader 以 deny 结束 |
| `teamMemberSetupContribution` | 读取 `team/member-bound`、对账待处理控制请求、安装强制钩子并启动规则分层恢复加载的 `registerContinuableSetup` 贡献 |
| `resolveRuleLayerPaths` | 解析 managed（`$DSH_HOME/permissions.yml`）与 project（`<workspace>/.dsh/permissions.yml`）规则文件路径 |
| `getRecoveredRuleLayers` | 读取某团队子会话存储的规则分层加载（一个可能以 managed 失效或文件格式错误拒绝的 promise）；`setRecoveredRuleLayers` / `releaseRecoveredRuleLayers` 写入与移除条目 |

## 权限强制

`permission` 服务是本插件的硬注入：插件只在组合了 permission engine 行的地方激活，且每个绑定的 teammate 子会话都带有强制钩子。该钩子就是决策点——它不过滤工具 schema，因此被拒绝的调用仍然是一次已分发的调用，由执行器以引擎对模型可见的理由结算。

子会话发起的每个工具调用都在该成员恢复的规则分层、以及其权限模式（来自持久 `team/member-bound` 载荷的 `permissionMode`，未声明时为 `enforce`）之下被评估。引擎的有序策略生效：`deny` 规则压倒一切，`ask` 规则挂起调用，`allow` 规则放行，模式决定未匹配的情况（`enforce` 拒绝，`default` 放行）。每次评估都在提交点向子会话追加一个 `permission/decision` 审计事件；从未到达引擎的调用（无规则状态、策略加载被拒绝）直接拒绝且不留审计。

一个 `ask` 决策在既有的 leader 会合处挂起该调用：子会话记录 `team/control-request`，创建一个控制注册表条目，并唤醒 leader。`allow_once` / `approve_plan` 恢复被挂起的执行，`deny` 与 `request_revision` 阻断它，`escalate_to_user` 把 ask 上抛给用户。当没有任何可达的 leader 时，该 ask 结算为一个带 `cause: 'leader_unreachable'` 的已审计 deny，其理由明确说明这并非最终裁决。

规则路径按子会话自身 scope 解析：managed 层读 `$DSH_HOME/permissions.yml`，project 层读子会话的 cwd；引擎的路径锚点把 `/` 锚定规则解析到会话 cwd、`~` 解析到 `$DSH_HOME`、`//` 解析到文件系统根。

## 规则分层恢复

在全新创建与冷恢复两种情况下，`teamMemberSetupContribution` 都会启动该团队子会话的规则分层加载：它以该 scope 的规则文件路径（managed 位于 `$DSH_HOME`，project 位于子会话 cwd 之下）、快照进持久 `team/member-bound` 载荷的 teammate 内联规则、以及同一载荷中记录的绑定期 managed 存在性，调用 `loadRuleLayers`。文件层总是从磁盘重读，因此在途的恢复会话受组织当前策略约束；绑定时存在、如今缺失的 managed 文件会使加载拒绝而非被跳过，存储的拒绝由强制点消费，而不是浮现为未处理的拒绝。

## 模型体验

间接的，经由编排器为 teammate 执行而委托的 subagent seam。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- `maxTokens` 只在全新委托时应用；冷恢复的 teammate 会回退到其路由默认值，因为可继续描述符按设计省略了每次激活的预算。
- 硬 `permission` 注入意味着插件只在携带 permission engine 行的组合中激活。已发布的 base bundle 携带该行，因此每个已发布预设都能解析该注入；不带 engine 行的自定义组合会把 team-runtime 行显示为 pending，而不是带着看不见的策略缺口运行。
