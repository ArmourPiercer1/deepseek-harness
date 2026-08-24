# @deepseek-ai/dsh-team-projection

[English](README.md) | 中文

Host 侧只读团队投影。`TeamProjectionService`（默认导出，`ctx.teamProjection`）从会话日志——leader 日志加上全部 `team:` 前缀标签的 continuable child——折叠出单个 leader 会话的完整 `TeamView`，与启用名册 join，叠加实时 `agent/status` 运行态，经变更订阅发布全量快照，并按需切取更早的消息页。会话日志是唯一权威：不读 `TeamProgressStore` 与 `TeamControlRegistry` 的进程内状态，进程重启后重建同一基线（构造上冷安全）。

## 放置

Host 平面服务包，挂在 web bundle 的 host 名册之后（apiproxy 是 wire 消费方；浏览器 store 在 `dsh-client-runtime` 落地）。不读 `ctx.team` —— team 组位于 agent preset 的 isolate realm 之后，对 host 平面不可见——名册改为从文件系统重扫（`$DSH_HOME/teammates` 加 leader 会话工作区的 `.dsh/teammates`，工作区自包含语义），并在已组合 `ctx.get('settings')` 时应用 `team-enablement` 设置。

## 服务 API

| 成员 | 契约 |
|---|---|
| `get(leaderSessionId, signal?)` | 全量快照；冷路径读持久化，绝不唤醒 Agent。请求的会话必须通过[团队性门槛](#team-ness-gate)；失败抛 `TeamProjectionError('LEADER_UNKNOWN')` —— 响亮失败，绝不合成空团队。 |
| `project(leaderSessionId, signal?, options?)` | 快照形态不变；带 `options.messagesBefore` 时返回严格早于锚点的 `TeamMessagePage`（`limit` 取 `[1, MESSAGE_CAP]`，缺省 `MESSAGE_CAP`；锚点不指向折叠内真实消息时为 `ANCHOR_UNKNOWN`，绝不静默回落）。门槛同 `get`。 |
| `onChanged(listener)` | 每个 leader 已提交状态恰好一次全量快照发布（last-wins）；触发源为团队事件族、leader `delegate_to_teammate`/结算通知、团队 child 创建/销毁、`agent/status`（仅重算本进程已折叠过快照的 leader）。 |

## 团队性门槛

`get` 与 `project` 只折叠团队会话，判据为确定性可观察事实 —— 名册条目本身从不构成团队性（工作区任何会话都有名册）：

- 会话的 subagent 目录中存在 `team:` 前缀标签的 continuable child；或
- 会话自身日志后缀（`seq >= seedLength`）含团队事实：`team/progress`、`team/control-decision`、`team/message`、`team/control-request`，或 `delegate_to_teammate` 调用；或
- 会话自身日志后缀含 `team/member-bound` 标记：该会话是已绑定的 teammate，投影锚定其 leader。

不满足任何判据的会话以 `TeamProjectionError('LEADER_UNKNOWN')` 响亮拒绝，绝不静默空视图。

## 折叠契约要点

- child 日志只折自身后缀（`seq >= header.seedLength`），fork 种子重放祖先历史不会双计。
- 消息全局序为 `(event.time, 记录会话 sessionId, seq)`；快照携带最近 `MESSAGE_CAP = 500` 条与总数 `messageCount`。
- 委派跨度将 `delegate_to_teammate` 调用与该成员的下一条 `subagent-settled` 通知配对（每成员 FIFO）；未闭合跨度的 `childSessionId` 冷取该成员最新绑定会话。
- `members` 为启用名册 ∪ 语料绑定：从未绑定的 teammate 发布 `status: 'unbound'` 行；已绑定但名册已删的成员以标签派生显示名保留；leader 行锚定 `sessionIds: [leaderSessionId]` 且永不为 `settled`。

## Model Experience

无。该只读 GUI 投影不注册任何 prompt、工具、消息或 provider 请求。

#### KV Cache effect

无；本包绝不组装模型输入。

## Known Limitations and Deferred Work

- **超时/重启自动拒绝在日志视角仍为未决** —— control coordinator 只解析内存 promise，不落 `team/control-decision` 事件，折叠出的 approvals 仍显示未决；措辞由消费方 UI 处理，不在本包。
- **teammate 自记进度的时效** —— `tasks.at` 取 leader 日志最新 `team/progress` 时间；teammate 仅记在自己日志的进度不推进它（与现有面板一致）。
- **名册变更随下次触发生效** —— 每次折叠都重打名册目录但不监听；纯名册编辑在团队事件、状态翻转或显式读取前不发布。
- **`fresh_per_delegation` child 的 `sessionIds` 语义** —— 持久策略（当前默认）下每成员至多一个绑定会话；未来多实例运行时须先放宽跨度-会话配对再复用本折叠。
- **one-shot/不可解析 team child 被投影跳过** —— child 语料即 `subagents.listChildren` 目录，目录未列为 `team:` 前缀 continuable child 的 child（one-shot，或描述符无法解析）不向折叠贡献任何事实（与 subagent 目录同口径）；其已绑定 teammate 在目录行缺失期间显示 `unbound`。
