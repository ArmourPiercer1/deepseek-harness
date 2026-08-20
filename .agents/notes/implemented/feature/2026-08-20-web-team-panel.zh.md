# Agent Note：Web 团队面板 Conversation Node（进度看板与队员状态）

Status: implemented

[English](2026-08-20-web-team-panel.md) | 中文

## 问题

团队插件的 Web 界面此前只有只读的 `settings.section` 配置区块。领导者会话进行团队工作时——通过 `delegate_to_teammate` 委托、通过 `team_progress` 更新任务状态——会话中不呈现任何关于这些工作的内容：没有进度看板，也没有队员状态。Round 3 任务 M7 定义了 MVP：消费 `team/progress` 的任务进度面板，加上 teammate 状态显示（bound/running/settled）；按计划决策 D7，`team/message` 时间线明确不在本批范围内。

## 决策

- [dsh-client-ui-team](../../../../packages/client/ui-team/README.md) 内只有一个 `ConversationNodeDefinition`（`kind: 'team-panel'`，target `chat`）。它匹配当前（领导者）会话的两类持久事件形态——`team/progress`，以及 `delegate_to_teammate` 工具的 `tool/call`——全部作为 `role: 'update'` 归入同一个 Context id `board`。该事件族是检查点式：每条 `team/progress` 事件携带任务的完整当前值，且不存在独立 start 事件，因此 `buildViewNode` 直接折叠 Context 自身收集到的 matches（无 start 检查点模式：引擎将 update-only 窗口保留为 pending，回退结果直接构建）。若引擎调用 `start`/`update`，二者折叠同样的 matches，保证按日志 seq 重放确定性。
- keyed 渲染器注册进 `conversation.chat.node`，key 为 `team-panel`，并带包内 locale 席位，遵循 [Conversation Node cookbook](../../../../docs/cookbook/adding-a-conversation-node.md)。节点数据即折叠结果：每个 `taskId` 取最新事件、按首次出现顺序排列，外加排序去重后的 `delegate_to_teammate` 目标集合。
- 队员行来自框架套件而非事件：组件通过 `useSessions` 选择父会话寻址的 subagent 目录，读取 `team:` 前缀标签的 continuable 子会话——该标签前缀是委托工具为每个 teammate 子会话铸造的。
- 行状态按行派生：子会话的 store 快照 activity 为 running 时显示运行中；inactive 且其名称出现在窗口委托目标集中的队员显示已交接；其余显示已绑定。目录 label 携带队员 name，而委托调用携带队员 id —— 二者是相互独立的 frontmatter 字段 —— 因此按 name 的关联是尽力而为的，并在包 README 中记录为 MVP 语义。
- 变更保持在客户端平面：无新增 host 服务、无新增会话事件、不改动事件结构。`dsh-team` 的导入仅为类型（携带 `SessionEventMap` 合并与载荷类型）；值导入限于 bundle 外部依赖（react、ui-primitives、runtime client 面），客户端 bundle 纯度门槛不受影响。`tool/call.arguments` 是模型 JSON，在该边界处解析：格式错误或缺失的 `teammate_id` 不产生委托事实。

## 备选方案

**由第一条 `team/progress` 事件 start 的按任务 Context。** 否决：生产者发出的是完整值检查点，没有专门的 start，而“加载窗口内的第一条事件”不是稳定的业务标识——加载窗口可能是历史中段，cookbook 也禁止把 update 指派给合成的“最新” Context。

**由会话事件监听器喂数据的按会话 team store。** 否决：业务组件不包含订阅机制，Conversation Node 引擎才是持久事件族的受支持通道；目录这半部分通过常设的 `useSessions` 席位到达。

**从 `team/member-bound` 派生队员行。** 否决：该事件追加在子会话自己的日志中，永远不会到达领导者的会话窗口；目录 label 才是客户端侧的团队信号。

**按 member id 做逐行委托关联。** 本批否决：目录不暴露 member id（只有 label），而渲染按队员明细的 message 时间线批次才是携带 id 的关联的合适位置。

## 后果

- 面板在加载窗口的第一条团队事件处出现于会话中，并随事件流更新；向上加载更旧页面会为同一节点补入更早的任务（key 稳定、anchor 迁移），并可能按首次出现位置重排任务列表。
- `delegated` 事实会静默丢弃无法解析的委托参数；窗口内只有这类调用时不渲染节点。
- 队员行依赖目录拉取；加载中时该分组显示空态，到达后填充。
- `team/message` 时间线与 dock 栏、设置区块编辑一同保持暂缓；包 README 的 Known Limitations 一节是现行记录。
- 验证：焦点 spec `packages/client/ui-team/tests/team-panel.client.spec.tsx`（assembler 的 replace/prepend/append 重放、模型 JSON 边界、组件渲染、以及证明 dispose 的 HMR 安全 fiber 生命周期）与构建产物 spec `packages/client/ui-team/tests/client-bundle.client.spec.ts`（handoff id、导出形态、真实 slot 环上的注册与注销）。
