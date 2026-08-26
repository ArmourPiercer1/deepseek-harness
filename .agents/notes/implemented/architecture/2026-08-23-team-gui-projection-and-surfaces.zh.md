# Agent Note：团队 GUI —— host 只读投影与 Web 界面

Status: implemented

[English](2026-08-23-team-gui-projection-and-surfaces.md) | 中文

## 问题

团队插件的 Web 界面此前只是只读的 `settings.section` 配置区块。领导会话做团队工作——通过 `delegate_to_teammate` 委派、记录 `team/progress` 检查点、发起裁决请求——在会话流中不渲染任何相关内容；而早先唯一的尝试，整卡式 `team-panel` Chat 节点，把整个团队状态收进一张锚定在首个团队事件处的卡片：它无法把每个事件放到自己的日志位置，会话流因此没有逐事件的团队台账，它的队员行也仅按名称把 catalog 标签与委派参数做尽力而为的关联。

重设计（冻结规格 D1–D23）要求一个活的团队界面——会话标签页、坞条读数、逐事件内联标记——受两条硬约束：团队编排运行时零改动，且投影归 host 所有（web 层是纯展示，会话日志在 host 侧）。

## 决策

- **host 投影。** `@deepseek-ai/dsh-team-projection`（`ctx.teamProjection` 服务）从会话日志折叠一个领导者的 `TeamView`——冷启动安全，日志是唯一权威，进程内编排状态永不读取——叠加来自 agent 注册表的实时运行状态，并在每个团队相关提交后重发全量快照（领导者事实、子会话事实、subagent 来源生命周期、活跃领导者的状态翻转）。重建按领导者合并；落在进行中之折叠日志读取之后的触发，恰好重新武装一次后续折叠（按领导者的触发序号与折叠读启动水位比较），因此无提交被漏掉，而已覆盖的触发不产生额外广播。无领导者定义的 roster 给领导者行 id `leader`——若某队员定义已占用该 id，则改用领导者会话 id——保证成员 id 唯一。折叠契约归[包 README](../../../../packages/team/team-projection/README.zh.md)所有。
- **Wire。** API 网关为每个发布的领导者视图广播全量 `session/team` 帧，并提供 `team.projection` 一元调用（快照形式，或 `messagesBefore` 分页、limit 取 [1, 500]），错误码为 `team-leader-unknown`、`team-anchor-unknown`、`team-unavailable`（[apiproxy README](../../../../packages/host/apiproxy/README.zh.md)）。
- **Client 对象层。** `ctx.sessions.teams` 持有只读镜像：按领导者会话键控的全量 `TeamView` 快照，来自帧的 last-wins，在 `session/subscribed` 与 `host/session-removed` 上重基线，由单飞 `teams.refresh` 冷读补齐。`resolveTeamView` 是所有界面共享的唯一冻结团队性判定。[runtime README](../../../../packages/client/runtime/README.zh.md)。
- **Web 界面。** [dsh-client-ui-team](../../../../packages/client/ui-team/README.zh.md) 注册三处：全局可见的团队标签页（`conversation.view`，order 20——非团队会话为单行零态，团队会话为四节正文）、常驻坞条（`conversation.input.dock`，order 15——团队会话的折叠读数 `Team · N running · M pending`）、内联团队标记（`conversation.chat.node`，key `team-marker`——每个持久团队事件一行紧凑单行，位于事件自身日志位置，即会话流可复现的团队台账）。整卡式 `team-panel` 节点被废除；本 note 合并该面板的 note（`2026-08-20-web-team-panel`，随本 note 删除），并保留其独特决策如下。
- **身份关联。** 成员行通过每个子会话上记录的 `team/member-bound` memberId 关联——不解析标签或委派参数，取代面板的尽力而为名称关联。`tool/call.arguments` 仍是模型 JSON，只在该边界解析：畸形或缺失的 `teammate_id` 不产生委派事实。
- **D13 降级。** 坞条跳转团队标签页降级为对标签环团队按钮的 DOM 激活——chat store 的 `setView` 动作属 ui-conversation 私有，无跨包视图切换契约。脆弱性记录在包 README 的 Known Limitations。
- **D16 降级。** 从其他会话点击的内联标记降级为仅切换会话：该行目标位于另一日志空间的 seq，在本行所在会话无从命名，故仅本会话点击获得流内滚动锚定。
- **继承自面板。** `team/progress` 是无开始事件的整值检查点族（折叠按 task id 保留最新值）；catalog 提供成员名称，投影提供 id 与会话绑定。

## 备选方案

**保留整卡面板作为台账。** 否决（规格 D14/D15）：单卡片无法在每个事件自身的日志位置承载一行一事件；聚合卡片把逐事件细节藏进一张用户必须知道去展开的卡片后面。

**Client 侧聚合团队状态。** 否决：web 层是纯展示，而唯一完整权威的会话日志在 host 侧；在浏览器折叠日志等于在 wire 上复制投影，并把事实劈到两个平面。对象层携带帧，不携带日志。

**扩展 `ViewTab` 契约或为 D13 新增跨包视图切换契约。** 未采纳：`ViewTab` 冻结为 `{id, label}`（规格 D2），程序化切换将是 ui-conversation 的新公共面、跨包——超出本批次范围，留给编排仲裁；DOM 兜底先行。

**按任务 Context、由首个 `team/progress` 事件开启（面板时期）。** 否决：生产者只发整值检查点、无专门开始事件，而「加载窗口内首个事件」不是稳定的业务身份——加载窗口可能是历史中段页。

**按会话团队 store、由 session 事件监听器喂数（面板时期）。** 否决：业务组件不含订阅机械，共享的业务活状态属于对象层（持久事件族则属于 Conversation Node 引擎），不属于入口 store。

**Client 侧从 `team/member-bound` 派生队员行（面板时期）。** 被取代：该事件仍不会到达领导者的会话窗口，所以名称来自 catalog——但关联本身现已在 host 侧按持久 memberId 完成，client 从镜像而非窗口派生行。

## 后果

- 逐事件台账可从日志复现：标记位于各自位置，向前预载旧页是重定位而非重复行；标签页正文是同一帧的派生视图。
- 坞条跳转按文档所述脆弱：任何标签列表中同名的标签会抢先匹配；未渲染任何标签环时（空白会话隐藏其头部）跳转静默无操作。
- 跨会话标记点击落在目标会话但不把该行带入视野（仅切换）；本会话点击滚动该行入视。
- 待裁决计数基于日志：超时自动拒绝不是已记录的裁决，此类请求在读数中保持待裁决。
- 在重建进行中之时落下的提交，恰好由一次重新武装的后续发布覆盖；仅当提交确实错过了折叠拷贝时才发生这次额外广播。
- 验证：`packages/team/team-projection/tests/`（fold、invariant、真实 Loader 组合含重新武装窗口）、`packages/client/ui-team/tests/`（标记定义与渲染、时间线、成员、任务、事件流、坞条，以及断言 `team-panel` kind 已从 `ChatNodeKind` 合并中消失的构建产物 spec）、重新生成的 client slot catalog。
