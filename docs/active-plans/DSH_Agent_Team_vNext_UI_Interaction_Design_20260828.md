# DSH Agent Team vNext：UI 与交互设计基线

**状态**：Frozen UI / Interaction Baseline  
**适用目标**：DSH Web UI + Team Mode vNext  
**日期**：2026-08-28  
**依赖兼容性文档**：`DSH_Agent_Team_vNext_Compatibility_Design_20260828.md`

> 本文档定义用户可观察的 UI 与交互契约。  
> 本地 agent 不得为了减少实现工作，把这里明确存在的对象、状态、历史可见性或控制入口删除。  
> 视觉样式可以顺应现有 DSH design system；对象层次、导航语义、阻塞行为和 provenance 不可自行改变。

---

# 0. 设计目标

UI vNext 的目标不是重做当前 Team UI，而是：

1. 消除 `Team = AgentPreset` 的旧心智模型；
2. 让 `Team Blueprint → MemberTemplate → MemberInstance` 映射到清晰界面；
3. 保留当前 Team Tab 中已经成熟的 Timeline / Members / Events 结构；
4. 让 TeamSession 的配置与 runtime override 可检查、可编辑、可追溯；
5. 保持每个 Root/Member Session 的 Chat 与 Trajectory 都是完整第一视角；
6. compatibility warning 必须可修复、可 acknowledge、可恢复进入；
7. 不让高级控制面把普通 Team 使用变成“配置文件编辑器”。

---

# 1. 顶层信息架构

Conversation 保持现有多 View 模型：

```text
Conversation
├─ Chat
├─ Trajectory
└─ Team

Composer
└─ Team Dock
```

三个 View 的职责：

```text
Chat
= 当前 Session 的人类可读 chronological history

Trajectory
= 当前 Session 的第一视角执行轨迹与审计

Team
= 所属 TeamSession 的全局 control plane / coordination projection
```

普通 AgentSession 也保留 Team Tab，但显示 zero-state。

---

# 2. New Session：Agent / Team 是一级模式

新建入口保持一个统一 `New Session` 产品流：

```text
                    New Session

                 [ Agent ] [ Team ]

Workspace       [ AIUED                  ▾ ]

Team Blueprint  [ AIUED-ALGO             ▾ ]   ← Team only

Agent Preset    [ team                    ▾ ]   ← secondary

                 [ first prompt composer ]
```

## 2.1 Team Blueprint 是 primary identity selection

Team 模式中：

```text
Team Blueprint
    = “这支团队是谁”
```

必须视觉上比 AgentPreset 更主要。

AgentPreset：

```text
= ordinary runtime composition
```

可以：

- 始终显示当前值；
- 视觉弱化；
- 放在“运行预设 / Advanced”区域。

禁止把 Blueprint 和 AgentPreset 做成两个同级、同样突出的“团队选择器”。

---

## 2.2 Generic Team-friendly preset 默认值

Team Intent 创建时：

```text
AgentPreset default = team-friendly generic `team`
```

但用户在可切换窗口内可以改为：

```text
standard
minimal
custom
...
```

Blueprint 与 AgentPreset 默认值分开配置。

---

# 3. New Session Intent 与 materialization

普通 Agent 继续按 DSH 原生行为 staging Workspace/Preset。

Team：

```text
select Team mode
select Workspace
select Blueprint
select/stage AgentPreset
type first prompt
```

此时不立即创建 Host TeamSession。

第一次 Send：

```text
Team Intent
    ↓
optional handoff summary
    ↓
fresh Team Root materialization
    ↓
compatibility
    ↓
READY or AWAITING_ACK
    ↓
first prompt
```

Team Intent 不复用已有 Host blank Session。

---

# 4. Blueprint Picker

统一 picker，按来源分组：

```text
Project
────────────────
AIUED-ALGO
rev 17 · Current

AIUED-SAMPLE
rev 4 · Current

Global
────────────────
Generic Research Team
rev 8

Legacy
────────────────
.dsh/teammates
Legacy workspace definition
```

要求：

- 同 displayName 不 silent shadow；
- 显示 source；
- 显示 current revision；
- 旧 revision 放二级入口 `Other revisions…`；
- 默认创建只突出 current revision。

## 4.1 Staging 期间 Blueprint revision 改变

若用户选择后 catalog 已变化：

```text
Selected: rev 17
Current:  rev 18
```

不得 silent replace。

UI：

```text
Blueprint changed since selection

[Use rev 18] [Review] [Cancel]
```

如 rev17 仍可 resolve，可显式选择继续用 rev17。

---

# 5. Compatibility 创建流程

第一次 Send 后，真实 TeamSession 可以进入：

```text
READY
```

或：

```text
AWAITING_COMPATIBILITY_ACK
```

warning 集中展示。

示例：

```text
Team compatibility

2 requirements need attention

Simulator
  MCP server "abtem" unavailable

Leader
  runtime context is disabled by current AgentPreset

[Change configuration] [Continue anyway]
```

Structural Error 不提供 Continue Anyway。

---

# 6. AWAITING_ACK 状态

一旦 TeamSession 已 materialize：

- Sidebar 必须显示；
- 不再被 ordinary blank reuse；
- first prompt draft 必须保留；
- Composer 被 Team admission gate 阻塞；
- Team Tab / compatibility detail 可进入；
- 用户可以修复配置或 acknowledge。

Provisional Sidebar title：

```text
Team · AIUED-ALGO    ⚠
```

正常 title 生成后继续使用 DSH 普通 Session title，不要求永久使用 Blueprint 名。

---

# 7. AWAITING_ACK 时允许的修复控制

若：

```text
root has no turn
AND
no Member provisioning ever started
```

Compatibility detail 提供：

```text
AgentPreset    minimal      [Change]
```

切换后：

```text
rerun compatibility
```

Blueprint 不允许换。

模型/route 可通过普通 Root model control 调整，并重新评估对应 requirement。

一旦：

```text
first root turn
OR
first member provisioning
```

AgentPreset label 变成 read-only。

---

# 8. Compatibility 状态的长期呈现

Team Header 始终可检查：

正常：

```text
Compatibility   ✓ Compatible
```

已 acknowledge warning：

```text
Compatibility   ⚠ Degraded · 3
```

有新未处理 warning：

```text
Compatibility   ⚠ Action required · 2
```

点击：

```text
Compatibility
────────────────────────

Action required
Simulator
  MCP abtem unavailable

Previously acknowledged
Researcher
  web unavailable
  acknowledged at ...
```

Acknowledged warning 不从历史中消失。

---

# 9. Team admission gate 的 UI

当存在未处理 compatibility warning：

```text
new Team work
→ blocked
```

UI 需同时体现：

- Composer blocker/banner；
- Team Header badge；
- 任何 Create/Resume/Delegate action 的 disabled reason；
- Member follow-up disabled reason。

已经运行中的实例仍可观察其状态，不显示为“被强制停止”。

---

# 10. Team Tab 总体结构：保留当前实现骨架

冻结：

```text
Team Tab
├─ Team Header
├─ Timeline / 泳道
├─ Members
├─ Activity / Progress
└─ Events
```

不做大规模重构，不替换为全局右侧 sidebar。

Timeline 继续是一级核心区域，位于 Members 上方。

---

# 11. Team Header

推荐：

```text
AIUED-ALGO · rev17
Policy: Exploration
Compatibility: ✓ Compatible
AgentPreset: team
Current: Leader
3 running · 1 settled
```

Member Session 打开 Team Tab：

```text
AIUED-ALGO · rev17
Current: researcher-A
```

并在 Members / Timeline 高亮当前实例。

Header 控制：

- PolicyState；
- Compatibility；
- read-only AgentPreset（或可切换窗口内 Change）；
- Team identity/source；
- 可选 Blueprint revision/source detail。

---

# 12. Timeline / 泳道

保留当前 Timeline 的核心能力：

- linear time domain；
- zoom；
- pan；
- pointer-centered wheel zoom；
- keyboard pan/zoom/reset；
- hover exact start/end/duration；
- running interval 随时间延伸；
- idle gaps；
- session navigation。

## 12.1 vNext 对象语义

采用：

```text
MemberTemplate
    └─ MemberInstance sublane
```

示例：

```text
Algorithm Researcher
 ├─ researcher-A    ███████       █████
 └─ researcher-B       ███████

Simulator
 └─ simulator-A          █████████
```

Bar 表示：

```text
RUNNING interval
```

而不是整个 MemberInstance 生命周期。

同一 persistent instance：

```text
RUNNING → SETTLED → RUNNING
```

在同一 sublane 出现多段 bar。

Archive/Dispose 不删除历史 bar。

## 12.2 Timeline 点击

第一版保守继承现有能力：

```text
click bar
→ Open corresponding Member Session
```

hover 展示：

- template；
- instance label/id；
- start/end；
- duration；
- lifecycle state。

Members 区承担 contextual detail selection；不强制改变现有 timeline click 心智。

---

# 13. Members：Template → Instance

结构：

```text
Leader
  Current root session

Algorithm Researcher                      [+]
  researcher-A       RUNNING
  researcher-B       SETTLED

Simulator                                  [+]
  simulator-main      RUNNING
  ▸ Archived (2)

Reviewer                                   [+]
  No instances
```

Template row：

- role/displayName；
- create `+`；
- template-level menu；
- current counts/quota。

Instance row：

- label；
- lifecycle；
- running indicator；
- optional group；
- model summary；
- compatibility/degraded hint；
- selected/current perspective highlight。

---

# 14. MemberInstance contextual detail

不增加永久第五大区块。

选中 Instance 后，在 Team Tab 内显示 contextual detail。

桌面宽屏可分栏：

```text
┌──────── Members ─────────┬──── Instance Detail ─────┐
│ researcher-A             │ Status: RUNNING          │
│ researcher-B             │ Model: ...               │
│                          │ Workspace: ...           │
│                          │ Tools: ...               │
└──────────────────────────┴──────────────────────────┘
```

窄屏：

```text
Members
↓
Selected Instance Detail
```

两者是同一语义 surface，不维护两套配置逻辑。

---

# 15. Instance Detail：read-effective-first

默认显示：

```text
Effective Configuration
```

并且每个值都显示 provenance。

示例：

```text
Model
GPT-X
Source: User override

Workspace
D:\Projects\AIUED
Source: Instance creation

Bash
Allowed
Source: Blueprint

Web
Denied
Source: PolicyState / Validation

Autonomy overlay
Allow bash
Currently suppressed
```

原则：

> 默认先让用户理解“当前到底是什么、为什么”，再进入 override 编辑。

---

# 16. Configure override

点击：

```text
Configure
```

进入编辑：

```text
Model       [ GPT-X      ▾ ]
Bash        [ Allow      ▾ ]
Web         [ Inherit    ▾ ]
MCP abtem   [ Allow      ▾ ]
...
```

提供：

```text
Reset override
```

Reset 表示恢复到当前下一层有效值，不修改 Blueprint。

显式区分 provenance：

```text
Blueprint
PolicyState
Autonomy Overlay
Explicit User Override
Runtime unavailable
External hard policy
```

---

# 17. Template-local Session Defaults

Template menu：

```text
Algorithm Researcher   [...]
```

二级入口：

```text
Role details
Session defaults…
View Blueprint definition
```

`Session defaults` 的准确语义：

> 当前 TeamSession 中，后续从此 MemberTemplate 创建的新实例所使用的 session-local default override。

默认：

```text
只影响 future instances
```

不自动重写已经存在/运行的实例。

要改现有实例，通过 Instance Detail 单独修改。

---

# 18. PolicyState

PolicyState 放 Team Header：

```text
Policy   [ Exploration ▾ ]
```

切换是正常 durable Team 操作，不默认弹危险确认框。

操作反馈可显示：

```text
Validation
3 effective settings changed
2 explicit user overrides retained
1 autonomy overlay suppressed
```

关键规则：

```text
Explicit User Override
→ 不被 PolicyState suppress

Autonomy Overlay
→ 可能 stored-but-suppressed
```

UI 必须能显示 suppressed overlay，而不是让用户误以为其配置被删除。

---

# 19. Model Override

Root Session：

- 使用普通 DSH session model control。

MemberInstance：

- Instance Detail 提供 Team-owned model selector；
- 不跳转/复用 addressed-subagent 普通 `/model`；
- 改动在 next request boundary 生效；
- provenance 标记 `User override` 或其他 owner。

如果 current route 不可用：

```text
Model
GPT-X
Unavailable
[Change]
```

而不是 silent substitute。

---

# 20. 生命周期控制

## 20.1 CREATED / RUNNING

可操作：

```text
Open Session
Archive
Dispose
```

Archive/Dispose 对 RUNNING 会执行 quiesce；UI 应说明“将停止当前运行”。

---

## 20.2 SETTLED

```text
Resume
Open Session
Archive
Dispose
```

按钮必须叫：

```text
Resume
```

因为是继续同一个 persistent MemberInstance / child Session，不是 Restart 新实例。

---

## 20.3 ARCHIVED

默认折叠：

```text
▸ Archived (3)
```

展开后：

```text
Restore
Open Session
Dispose
```

---

## 20.4 DISPOSED

不进入正常 roster。

仍保留于：

- Events；
- Diagnostics；
- Session history；
- Trajectory；
- Timeline historical intervals。

Dispose 确认文案必须明确：

```text
This instance cannot be restored.
Its session history and trajectory will be retained.
```

不要暗示删除数据。

---

# 21. Activity / Progress

保留当前类似任务板的视觉价值，但正式名称改为：

```text
Activity / Progress
```

它是 telemetry/projection，不是 authoritative Workflow/task DAG。

示例：

```text
● Running
Literature screening
researcher-A
“17 papers retained”

✓ Completed
Baseline simulation
simulator-A
```

未来真正 Workflow 系统应独立新增，不复用该板作为 workflow state authority。

---

# 22. Events

Team Tab 的 Events：

```text
= Root TeamSession coordination ledger
```

显示：

- TeamSession bind；
- member provisioning/creation/lifecycle；
- policy change；
- compatibility ack；
- user/team overrides；
- delegation/control/progress；
-其他 durable Team event。

支持：

- chronological browse；
- filter；
- instance/template filter；
- jump to related Session/Event；
- diagnostic raw payload view。

---

# 23. Chat 中 durable Team event

用户明确要求：

> 每个 durable Team event 都出现在其实际所属 Session 的 Chat 时间线上。

第一版：

\[
1\ durable\ event = 1\ addressable\ ChatNode
\]

默认折叠：

```text
▸ Team · researcher-A → RUNNING
```

展开：

```text
Instance
Template
Previous state
Current state
Timestamp
Related child Session
Event seq
Additional detail
```

第一版不做多事件 aggregation。

允许 presentation 上缩小相邻 marker 间距，但不合并 identity。

---

# 24. Trajectory

每个 Root/Member Session 都保留独立 Trajectory。

Trajectory 是：

> 该 Session 第一视角的完整执行记录。

Team durable event 若存在于当前 Session log：

- 必须有 Trajectory record；
- unknown Team event 也有 fallback；
- 不依赖 Chat snapshot。

禁止创建一个所谓：

```text
Global Team Trajectory
```

跨 Session 的协调时间关系属于 Team Timeline/Events。

---

# 25. Member Session 导航

每个 MemberInstance 是一个真正可独立打开的 DSH Session：

```text
researcher-A
    ├─ Chat
    ├─ Trajectory
    └─ Team
```

Team Tab 显示同一个共享 TeamSession control plane，并高亮当前实例。

Members：

```text
click instance row
→ select/show contextual detail

[Open Session]
→ navigate to child Session
```

Timeline bar：

```text
click
→ 保留现有直接打开 Session 行为
```

---

# 26. 普通 AgentSession 的 Team Tab

普通 Session 仍显示：

```text
[Chat] [Trajectory] [Team]
```

Team zero-state：

```text
This session is not part of a team.

[Start Team from Here]
```

这样 Team 功能可发现，不需要另造 header 菜单入口。

---

# 27. Start Team from Here

点击后：

```text
Current AgentSession A
    ↓
New Team Intent B
```

默认：

```text
Workspace = A.workspace
Source session = A
Blueprint = choose
AgentPreset = team-friendly default
```

不是原地 convert。

---

# 28. One-shot context handoff UX

vNext 自动尝试：

```text
A current canonical surface
    ↓
one-shot summary
    ↓
inject frozen handoff context into B
```

UI 不声称：

```text
B “继承了完整对话”
```

而应明确：

```text
Context handoff
Automatic summary from:
“UED peak indexing discussion”
```

Chat 中用折叠 sourced-context marker：

```text
▸ Context handoff · from “UED peak indexing discussion”
```

展开可读摘要与 source metadata。

---

# 29. Handoff 失败

不静默继续。

显示：

```text
Context handoff failed

[Retry]
[Continue without handoff]
[Cancel]
```

`Continue without handoff` 是显式 user decision。

vNext 不提供 B 对 A 的后续 history_read/search。

---

# 30. Team Dock

Composer 上方保留紧凑 Team Dock。

折叠态最多显示：

```text
AIUED-ALGO · 3 running · ⚠ 1
```

Member perspective：

```text
AIUED-ALGO · researcher-A · 3 running
```

展开态：

- 当前身份；
- active instance counts；
- pending control；
- compatibility alert；
- `Open Team`。

禁止把 Dock 发展成：

- config editor；
- full event list；
- Timeline；
- override matrix。

Dock = status/navigation surface。

---

# 31. Sidebar

Root TeamSession 是 normal first-class Session row。

Member child Session 按 DSH subagent lineage/navigation 语义处理，不要求重复成普通 Workspace sidebar row。

AWAITING_ACK Root：

```text
Team · BlueprintName   ⚠
```

必须可重新进入。

Disposed Member history仍通过 Team ledger / child session navigation 可访问。

---

# 32. UI 状态来源规则

UI 不自行推导业务真相。

来源：

```text
Team Header / Members / Events
→ TeamSession projection

Member Chat / Trajectory
→ selected Session conversation projection

Model availability
→ host model directory / Team authorized route probe

Compatibility
→ Team compatibility projection

Effective config/provenance
→ Team policy resolver output
```

禁止 client 自己根据 event type 猜 effective policy。

---

# 33. 错误与降级原则

必须显式区分：

```text
Unavailable
    capability does not exist / route not served

Denied
    policy forbids use

Degraded
    requirement warning acknowledged

Action required
    new warning blocks Team admission

Structural error
    Team cannot become operational
```

不得把这几种状态统一成“disabled”。

---

# 34. 响应式原则

桌面：

- Timeline 全宽；
- Members + Instance Detail 可局部分栏。

窄屏：

- Timeline 可水平/触控导航；
- Instance Detail 下沉到 Members 后；
- Team Dock 保持紧凑；
- 不为移动端建立另一套业务逻辑。

---

# 35. 可访问性与历史性

现有 Timeline keyboard/pointer affordance 应保留。

Disclosure rows：

- keyboard expandable；
- 有可读事件名；
- 不只靠颜色表达 state。

Team lifecycle/compatibility：

- badge + text；
- archived/disposed 不只用透明度。

---

# 36. UI 不变量

1. New Session 只有一套产品流；Agent/Team 是一级模式。
2. Blueprint primary，AgentPreset secondary。
3. Team Intent first Send 才 materialize。
4. Team Intent fresh-create，不复用 Host blank。
5. Blueprint revision change 不 silent replace。
6. AWAITING_ACK Root 必须出现在 Sidebar。
7. AWAITING_ACK 时必须存在可修复 AgentPreset/model/config 入口。
8. Team Tab 保留 Header/Timeline/Members/Activity/Events。
9. Timeline 是一级核心区域，不删除。
10. Timeline 按 Template→Instance 组织，多 RUNNING interval 同 lane 展示。
11. Members 按 Template→Instance。
12. Instance Detail contextual，不成为永久第五大板块。
13. Effective config 默认显示 provenance。
14. Edit override 是二级操作。
15. Template Session defaults 默认只影响未来实例。
16. PolicyState 在 Header。
17. Explicit User Override 不被 PolicyState suppress。
18. Autonomy Overlay 可显示 suppressed。
19. Member model picker 走 Team control，不走 generic subagent session model API。
20. Archive/Dispose RUNNING 会停止/收束工作。
21. Archived 默认折叠。
22. Disposed 不在 normal roster，但历史保留。
23. Activity/Progress 不是 Workflow authority。
24. 每个 durable Team event 在所属 Session Chat 中有默认折叠 node。
25. 第一版不聚合多个 durable event。
26. 每个 Session Trajectory 必须能重建自己的 Team event。
27. 不做 Global Team Trajectory。
28. Member Session 保留 Chat/Trajectory/Team。
29. Team Tab 在 Member Session 中显示同一 TeamSession 并高亮 current instance。
30. 普通 Session 保留 Team zero-state + Start Team from Here。
31. Start Team from Here 创建新 Team Intent，不原地 convert。
32. handoff 是 one-shot frozen summary，不是 live cross-session memory。
33. handoff 失败不 silent downgrade。
34. Team Dock 是紧凑状态入口，不是第二控制面。
35. UI 显式区分 unavailable/denied/degraded/action-required/structural-error。

---

# 37. 明确不在 vNext UI 中实现

- Workflow DAG editor；
- Workstream tree；
- per-member AgentPreset picker；
- Blueprint live editor 与 save-back；
- automatic Blueprint upgrade；
- source-session live recall UI；
- Global Team Trajectory；
- worktree manager；
- arbitrary capability severity editor；
-多个 durable Team event 自动聚合；
-把 Team control 全部塞入 Composer Dock；
-删除 disposed history。

---

# 38. UI 开发验收方法

任何 UI 任务至少覆盖：

1. happy path；
2. cold/reconnect projection；
3. disabled/degraded/error；
4. keyboard/basic accessibility；
5. no-silent-fallback；
6. snapshot or component test；
7. 与 Host authority 的 race 不让旧 response 覆盖新状态。

不得只以“截图看起来对”为验收。
