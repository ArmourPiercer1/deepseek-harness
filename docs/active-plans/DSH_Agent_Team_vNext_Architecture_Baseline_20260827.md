# DSH Agent Team vNext 架构设计基线

**文档状态**：Architecture Baseline / 需求与核心语义已冻结，交互与实现融合待后续讨论  
**目标版本**：Agent Team vNext  
**基于分支**：`feat/agent-teams`  
**日期**：2026-08-27

---

## 0. 文档目的与边界

本文档定义 DSH Agent Team 下一版本的**架构基线**。其目标不是给出详细开发任务，也不是提前固定 UI、CLI 或 Cordis/package 级实现，而是先冻结那些一旦定义错误、后续实现很难局部修正的概念与语义：

- 团队是什么；
- 团队如何成为可复用的稳定实体；
- 团队与 root session、workspace 的绑定关系；
- leader、member template、member instance 的身份关系；
- 一个 teammate 如何被复用为多个并行运行实例；
- runtime overlay 如何在受控范围内改变 model、workspace、tools、permissions 等运行参数；
- Policy State 的职责边界；
- instance 的生命周期、上下文和隔离语义；
- Blueprint revision 与运行时环境策略之间的冻结边界；
- 持久化、恢复和事件投影需要满足的架构不变量；
- 为未来 router、workflow state、自动 teammate activation 预留哪些扩展缝。

本文档**暂不决定**：

1. Web UI 的具体布局、编辑器、创建流程与运行时展示形式；
2. CLI 命令结构；
3. Team Blueprint 的最终磁盘格式、最终目录名和完整 schema；
4. 与现有 Agent Preset、Cordis Context、package/bundle 的具体接线方案；
5. Git worktree 的原生生命周期管理；
6. Workflow State、WorkstreamInstance、自动 transition 和自动 activation 的最终设计；
7. 详细代码开发阶段、文件级改动计划和 migration task list。

这些内容将在本文档作为上游架构约束的基础上继续讨论。

---

# 1. 背景与问题定义

## 1.1 当前 Team Mode 的核心模型

当前 `feat/agent-teams` 实现建立在 DSH 可延续 subagent runtime 之上，其核心思想是：

> 不创造第二套 agent runtime，而是在 continuable subagent 之上增加 leader-teammate 协调、逐成员 capability isolation、审批、消息、进度与持久投影。

当前系统的主要对象包括：

- `TeamMemberDefinition`：leader / teammate 的统一静态定义；
- `TeamRegistry`：`ctx.team` 上的成员定义注册表；
- `TeamOrchestrator`：按 leader session 管理 teammate activation；
- continuable child session：teammate 的真实运行实体；
- `team/member-bound`：child session 与成员定义/策略快照的 durable binding；
- `team/message`、`team/progress`、`team/control-*`：持久协调事件；
- `TeamProjection`：从 session log 重建当前 TeamView。

当前实现已经具有两个非常重要的正确方向：

1. **teammate 是持久、可恢复的 child session，而不是一次性函数调用**；
2. **有效 teammate policy 在 bind 时写入 durable event，cold resume 不依赖父会话的瞬时内存状态**。

vNext 应保留并推广这两个原则。

## 1.2 当前实现暴露出的结构性问题

本次 roster drift 事故暴露了一个更根本的问题：

> workspace-local roster 被存放在 preset standing mount 上的共享 mutable registry 中，而多个 session 又共享该 standing mount。

这使系统同时拥有两个冲突的事实：

```text
roster 的语义：
    属于某个 workspace / session

roster 的存储：
    属于共享 standing mount
```

于是任意不同 cwd 的同 preset session 都可能覆盖彼此看到的 roster。

事故中的 AIEO home fallback 只是污染结果的放大器；真正的故障类来自：

```text
session-specific semantics
        +
mount-shared mutable state
```

vNext 不应继续通过 `workspacePath` pin 等方式修补这一模型，而应直接取消“某个 standing mount 当前持有哪个 workspace roster”这一概念。

## 1.3 当前模型对未来动态团队的限制

现有 runtime 还隐含了：

```text
(leaderSessionId, memberId) -> at most one activation
```

这意味着：

```text
algorithm-researcher
```

只能有一个当前运行实例。

若要并行探索：

- Fourier route
- neural route
- baseline route
- 新发现 route

现有系统必须预先定义：

```text
researcher-a
researcher-b
researcher-c
...
```

这会把“稳定的 teammate 能力定义”和“一次任务中的运行实例”混为一谈。

因此 vNext 的第二个核心目标是：

> 将 teammate 从“唯一运行成员”重新定义为“可实例化的稳定成员模板”。

---

# 2. vNext 的总体设计目标

vNext 需要完成两次相互耦合的语义升级。

## 2.1 团队自由化

团队本身应成为稳定、可登记、可复用的一等实体。

例如：

```text
AIUED-ALGO
AIUED-SAMPLE
SOFTWARE-REVIEW
```

它们不属于某个 workspace，也不等同于 DSH Agent Preset。

同一个 `AIUED-ALGO` 可以：

```text
AIUED workspace / session A
OtherProject / session B
```

分别启用。

同一个 workspace 也可以：

```text
AIUED / session A -> AIUED-ALGO
AIUED / session B -> AIUED-ALGO
AIUED / session C -> AIUED-SAMPLE
```

并行运行，彼此完全隔离。

## 2.2 团队运行时实例化

稳定团队中定义的是：

```text
MemberTemplate
```

实际执行任务的是：

```text
MemberInstance
```

同一个 template 可以同时产生多个 instance：

```text
algorithm-researcher
    |
    +-- researcher#route-A
    +-- researcher#route-B
    +-- researcher#route-C
```

这些 instance：

**共享：**

- persona；
- base model policy；
- base tool policy；
- base permission policy；
- skills；
- MCP capability；
- template-level mutation envelope。

**独立：**

- instance identity；
- child session；
- workspace；
- runtime overlay；
- actual model selection；
- task；
- conversation context；
- lifecycle；
- activity；
- group metadata。

---

# 3. 核心术语与对象模型

vNext 正式采用以下概念层次：

```text
TeamBlueprint
      |
      v
TeamSession
      |
      +--> LeaderInstance
      |
      +--> MemberInstance
      +--> MemberInstance
      +--> MemberInstance
                ^
                |
          MemberTemplate
```

其中静态定义与动态实体严格分离。

---

## 3.1 Team Blueprint

**Team Blueprint（团队蓝图）**是一个完整、稳定、可复用的团队定义。

选择 `Blueprint` 而不是 `Preset` 的原因是：

- DSH 已经存在 Agent Preset；
- Agent Preset 描述“如何 compose 一个 agent runtime”；
- Team Blueprint 描述“一个团队是什么”。

二者属于不同抽象层。

### Team Blueprint 必须包含

概念上至少包括：

```text
Blueprint identity
Blueprint revision
leader definition
member templates
team-level capability envelope
member-level mutation constraints
optional Policy State definitions
runtime quotas
metadata
```

### 强制校验

一个 Blueprint 在进入可用 catalog 前必须通过强校验。

至少必须保证：

- Blueprint identity 有效；
- revision / content identity 有效；
- **恰好存在一个完整 leader definition**；
- 所有 MemberTemplate identity 唯一；
- 所有 template 引用可解析；
- mutation envelope 自洽；
- Policy State 不引用不存在的字段或非法状态；
- quota / capability declaration 合法；
- 不存在违反系统 hard policy 的声明。

不允许“部分成员解析失败但仍登记残余成员”成为正常成功路径。

---

## 3.2 Blueprint Identity 与 Revision

Team Blueprint 的身份不应由：

- 目录路径；
- 显示名称；
- workspace；

决定。

概念上应至少区分：

```text
blueprintId
displayName
revision
contentHash
source
```

其中：

- `blueprintId`：稳定逻辑身份；
- `displayName`：可修改的人类显示名；
- `revision`：人类可理解的版本；
- `contentHash`：机器层面的内容身份；
- `source`：该 Blueprint 来自何处。

移动 Blueprint 或修改 display name 不改变 `blueprintId`。

---

## 3.3 TeamSession

**TeamSession** 表示：

> 一个 root session 对一个确定 Team Blueprint revision 的运行时绑定。

正式冻结以下基数：

```text
Root Session
    -> 0 or 1 TeamSession

TeamSession
    -> exactly 1 TeamBlueprint revision
```

### 创建时绑定

Team Blueprint 应作为 TeamSession 的身份组成部分。

因此：

```text
session A -> AIUED-ALGO@17
```

一旦开始运行，不能在生命周期中切换为：

```text
session A -> AIUED-SAMPLE@4
```

若要换团队，应创建新的 root session。

### 不支持中途“变成团队会话”

普通 root session 已经产生有效运行历史后，不应再动态挂载 Team Blueprint。

允许何种“空 session 尚未执行 turn 时修改选择”的交互行为，留待 UI / session creation 设计阶段决定；但从架构语义上：

> 第一个有效 TeamSession 运行事件出现后，Blueprint binding 必须不可改变。

---

## 3.4 TeamSession 与 workspace

TeamSession 可以拥有：

```text
defaultWorkspace
```

但 workspace 不定义团队身份。

它只是：

> MemberInstance 创建时未显式指定 workspace 时的默认运行位置。

正式建议：

- `defaultWorkspace` 在 TeamSession 创建时确定；
- vNext 中视为冻结；
- 修改某一 instance 的 workspace 不修改 TeamSession.defaultWorkspace；
- Team Blueprint 本身不属于 workspace。

因此：

```text
Team identity != workspace
```

这是修复当前 roster scope mismatch 的根本原则。

---

# 4. Leader 模型

## 4.1 Leader 是特殊约束的 MemberInstance

vNext 不再保留：

```text
leader definition = metadata only
root agent = unrelated preset-composed entity
```

这种长期不对称。

Leader 应统一进入成员对象模型：

```text
LeaderTemplate
      |
      v
LeaderInstance
```

LeaderInstance 是 MemberInstance 的特殊受约束形式。

### LeaderInstance 的特殊约束

```text
exactly one per TeamSession
is root session
cannot spawn another leader
cannot archive independently
cannot dispose independently
lifecycle tied to TeamSession
has no childSessionId
```

这样：

- identity；
- policy resolution；
- model metadata；
- projection；
- message attribution；
- audit；
- runtime overlay；

都可以基于统一成员模型工作。

---

# 5. MemberTemplate

MemberTemplate 是一个稳定的成员能力模板。

其概念结构包括：

```text
templateId
role
name
description
persona
base model/provider configuration
tools policy
permissions policy
skills
MCP capability
approval policy
context policy
member mutation envelope
instance quota
metadata
```

Template 本身：

- 不运行；
- 不拥有 conversation；
- 不拥有 workspace；
- 不拥有 runtime status；
- 不接受 follow-up；
- 不参与 runtime message addressing。

它只负责：

1. 描述可实例化成员；
2. 提供 instance 的基础配置；
3. 限制运行时 overlay 的合法范围。

---

# 6. MemberInstance

## 6.1 定义

MemberInstance 是团队中的真实运行主体。

一个 MemberTemplate 可以生成 0..N 个 MemberInstance。

概念结构：

```text
MemberInstance
    instanceId
    templateId
    label
    groupId?
    workspace
    childSessionId?
    effective config snapshot
    runtime overlay
    lifecycle state
    createdAt
    activity metadata
```

---

## 6.2 Instance Identity

真正 runtime identity 必须是系统生成的稳定 `instanceId`。

例如：

```text
instanceId = inst_...
label = route-fourier
templateId = algorithm-researcher
```

`label` 不是 identity。

允许存在：

```text
route-fourier
route-fourier
```

两个 display label 相同的 instance，只要 `instanceId` 不同。

### runtime 寻址原则

所有运行时操作必须 instance-first：

```text
follow-up
shutdown
message
approval attribution
progress attribution
archive
restore
dispose
activity lookup
```

全部通过 `instanceId` 唯一寻址。

`templateId` 仅用于：

- 查静态定义；
- 创建 instance；
- policy resolution；
- UI 中展示成员类型。

`groupId` 永远不是 runtime identity。

---

# 7. 多实例与并行运行

vNext 明确允许：

> 同一个 MemberTemplate 同时具有多个长期 persistent instance。

例如：

```text
algorithm-researcher
    +-- route-A
    +-- route-B
    +-- route-C
```

三者可以分别拥有：

```text
persistent context A
persistent context B
persistent context C
```

leader 可分别：

- follow-up；
- stop；
- restore；
- archive；
- inspect。

因此现有：

```text
(leaderSessionId, memberId) -> one activation
```

不再是正确的 identity 模型。

vNext 的运行时语义应改为：

```text
(TeamSessionId, instanceId) -> activation
```

而：

```text
instanceId -> templateId
```

提供静态定义关联。

---

# 8. groupId 与未来 Workstream

vNext **不引入正式 WorkstreamInstance**。

原因是：

- 当前还不实现 workflow automatic activation；
- 引入 workstream state 会额外引入 owner、transition、completion、crash recovery、concurrency 和 debug 语义；
- 当前主要目标仅要求多个实例可以按路线分组。

因此仅加入：

```text
groupId?: opaque string
```

例如：

```text
researcher#A
developer#A
reviewer#A

groupId = route-fourier
```

当前 runtime 对 group：

- 不建立 registry；
- 不赋予状态；
- 不赋予权限；
- 不赋予 lifecycle；
- 不自动 transition；
- 不自动 activation。

它只表示：

> 这些 instance 在逻辑上属于同一组。

未来若正式引入：

```text
WorkstreamInstance
```

可将历史 `groupId` 平滑解释为或迁移到 Workstream identity。

---

# 9. ActivationProvider：统一实例创建入口

## 9.1 设计目的

vNext 不应分别实现：

```text
leader spawn logic
router spawn logic
workflow spawn logic
```

而应建立统一的运行时 activation seam：

```text
ActivationRequest
       |
       v
ActivationProvider
       |
       +--> resolve Blueprint
       +--> resolve MemberTemplate
       +--> validate quota
       +--> validate mutation envelope
       +--> resolve effective policy
       +--> allocate instanceId
       +--> persist binding
       +--> create child session
       +--> register activation
       v
MemberInstance
```

## 9.2 vNext 的实际调用来源

vNext 实际支持：

```text
leader explicit create
leader delegate + implicit create
```

其中常用路径采用：

> delegation 时隐式创建新 instance。

但同时保留显式 create 能力，供：

- 先准备 workspace；
- 提前创建 instance；
- 设置复杂 overlay；
- 后续多次调度；

等场景使用。

## 9.3 未来调用来源

接口应允许未来增加：

```text
router
workflow activator
automation
```

但 vNext 不实现这些 producer。

这使未来“自动激活 reviewer”可以复用完全相同的 activation path，而无需复制 runtime 逻辑。

---

# 10. Instance Runtime Overlay

## 10.1 核心模型

MemberTemplate 提供基础配置，instance 可以携带 runtime overlay：

\[
EffectiveConfig
=
TemplateConfig
\oplus
InstanceOverlay
\]

但 overlay 不是任意修改。

其合法范围：

\[
AllowedOverlay
=
BlueprintEnvelope
\cap
MemberEnvelope
\cap
PolicyStateEnvelope
\]

再受到外部 hard policy 的最终约束。

---

## 10.2 Mutation Envelope

Blueprint 和 MemberTemplate 可以声明：

> 哪些字段允许改变，以及允许以什么生命周期语义改变。

不是简单：

```text
mutable: true / false
```

而应支持至少以下概念：

```text
immutable
creation-mutable
turn-mutable
runtime-mutable
bounded
tighten-only
```

最终具体 schema 可在实现设计阶段调整，但语义应保留。

---

# 11. 字段默认 Mutation 语义

如果 Blueprint / MemberTemplate 没有为字段显式声明特殊规则，vNext 采用以下默认项。

## 11.1 workspace

默认：

```text
creation-mutable
immutable-after-start
```

即：

- instance 创建时可以指定；
- 未指定则继承 TeamSession.defaultWorkspace；
- instance 第一次进入 RUNNING 后冻结。

原因：

persistent agent 一旦在 workspace A 工作，其 conversation context 已包含 A 的信息。

即使之后将 filesystem permission 切换到 B：

```text
context != isolated
```

因此若要换路线，应创建新的 instance，而不是搬迁现有 persistent instance。

---

## 11.2 model

默认：

```text
turn-mutable if envelope allows
```

即：

- instance identity 与 model identity 解耦；
- 在 Blueprint / MemberTemplate / Policy State 允许时，可在 turn 边界切换 model；
- conversation 仍属于同一 MemberInstance。

这为未来 router 提供基础。

---

## 11.3 tools / permissions

默认：

```text
runtime-mutable within envelope
```

修改只对后续执行生效。

例如：

```text
research
    |
    +-- permissive runtime
    |
    v
validation
    |
    +-- tighten tools / permissions
```

无需创建新 instance。

---

## 11.4 contextPolicy

默认：

```text
immutable after instance creation
```

因为：

```text
persistent
fresh_per_delegation
```

定义了 instance 历史如何解释。

在实例生命周期中切换会破坏 identity / continuation 语义。

---

# 12. 权限与能力边界

## 12.1 两类边界必须分离

vNext 需要明确区分：

### A. External Hard Policy

属于 DSH 或宿主环境的安全上限，例如：

```text
system policy
managed policy
project/workspace hard policy
tool availability
```

它们是：

> 所有人，包括 user，都不能通过 Team Blueprint 绕过的硬上限。

### B. Team Autonomy Boundary

包括：

```text
Blueprint Envelope
Member Envelope
Policy State Envelope
```

它们定义：

> 这个团队允许 agent 自治到什么程度。

---

## 12.2 修改权限主体

默认 authority：

```text
user
    can explicitly override Team autonomy boundary
    still subject to External Hard Policy

leader
    can mutate only inside allowed envelope

member instance
    cannot directly mutate itself
    may request leader

future router
    can mutate only inside allowed envelope

future workflow activator
    can mutate only inside allowed envelope
```

因此：

> Blueprint capability envelope 是 agent autonomy boundary，而不是 user authority boundary。

若 user 明确改变 session runtime policy，该 override 必须是 durable、可审计的 session fact，而不是隐藏的内存修改。

---

## 12.3 Effective Policy

概念上：

\[
P_{effective}
=
P_{external-hard}
\cap
P_{blueprint-snapshot}
\cap
P_{member}
\cap
P_{policy-state}
\cap
P_{instance-overlay}
\]

其中 deny / tightening 的具体合并规则需要继续服从 DSH permission engine 的安全原则；本文不提前规定代码层 precedence 算法。

---

# 13. Policy State

## 13.1 Policy State 的定义

Policy State 是：

> TeamSession 当前的运行治理状态，用于限制“现在允许怎样修改实例运行参数”。

它不表示任务流程。

例如：

```text
research
locked-validation
```

是合理 Policy State。

而：

```text
code-development
code-review
test
```

若其含义是“任务做到了哪一步”，则属于未来 Workflow State。

---

## 13.2 Policy State 的 scope

vNext 正式规定：

```text
PolicyState belongs to TeamSession
```

而不是：

```text
each MemberInstance has own PolicyState
```

因此：

```text
TeamSession.policyState = locked-validation
```

表示整个团队进入更严格的运行治理模式。

不同 template 仍可通过 MemberEnvelope 表现出不同限制。

---

## 13.3 Policy State 是可选能力

一个简单 Blueprint 不需要定义多个 Policy State。

缺省可以理解为：

```text
policyState = default
```

仅使用：

```text
Blueprint Envelope
+
Member Envelope
+
field default mutation semantics
```

因此 Policy State 不应成为所有团队配置的强制复杂度。

---

## 13.4 vNext 的切换权限

vNext 仅支持：

```text
user
leader
```

显式切换 TeamSession.policyState。

普通 teammate：

- 不自动推进；
- 不负责维护；
- 不因 completion 自动触发变化。

未来 workflow engine 是否成为合法 transition source，后续重新讨论。

---

# 14. Policy State 与 Workflow State 的严格分离

两套状态的作用完全不同。

## 14.1 Policy State

回答：

```text
现在允许改变什么？
```

例如：

```text
model 可以切换吗？
permission 可以放宽吗？
tools 只能收紧吗？
```

## 14.2 Future Workflow State

回答：

```text
任务当前在哪里？
下一步应该发生什么？
是否应该激活 reviewer？
```

例如：

```text
exploration
    -> development
    -> review
    -> validation
```

vNext 不实现：

- WorkflowState；
- transition trigger；
- workflow guard；
- activation effect；
- DAG；
- automatic teammate activation。

只保留 ActivationProvider 等扩展缝。

---

# 15. MemberInstance 生命周期

vNext 采用以下概念生命周期：

```text
CREATED
   |
   v
RUNNING
   |
   v
SETTLED
   | \
   |  \ resume/follow-up
   |   ------------> RUNNING
   |
   v
ARCHIVED
   |
   +---------------> RUNNING
       explicit restore

DISPOSED = terminal
```

---

## 15.1 CREATED

instance identity 已分配并完成 durable creation/binding，但尚未进入有效工作 turn。

---

## 15.2 RUNNING

存在进行中的 child execution / active turn。

---

## 15.3 SETTLED

当前任务完成或当前 turn 已结束，但：

- child session 仍存在；
- conversation context 可继续；
- instance 仍是主要活跃团队成员；
- follow-up 可重新进入 RUNNING。

---

## 15.4 ARCHIVED

表示：

> instance 当前退出主要工作集，但其 identity、历史和 context 仍有保留价值。

默认 UI 可隐藏或折叠，但：

- transcript 保留；
- instanceId 保留；
- 可以显式 restore；
- restore 后继续同一 instance。

---

## 15.5 DISPOSED

terminal state。

表示：

- 该 instance 已明确结束；
- 不允许 resume；
- 历史仍可审计；
- runtime 不再将其视为可恢复运行实体。

ARCHIVED 与 DISPOSED 必须严格区分。

---

# 16. Instance Context 与信息隔离

## 16.1 默认上下文原则

新 MemberInstance 的初始认知上下文默认仅来自：

```text
MemberTemplate persona
+
ActivationRequest prompt
+
explicitly attached context
```

不会自动继承：

```text
leader full transcript
sibling transcript
other group result
other instance context
```

这保持：

> 默认不共享，必要时显式共享。

---

## 16.2 不是完整信息流安全

vNext 不实现 leader-level noninterference。

即：

- leader 可以知道 route A/B/C；
- leader 可以显式把 B 的结论告诉 A；
- Team plugin 不分析 prompt 是否泄露 sibling 信息。

当前隔离目标限定为：

```text
filesystem isolation
tool / permission isolation
default context isolation
```

而不是强制信息流控制系统。

---

# 17. Workspace 与路线隔离

典型用途：

```text
researcher#route-A
workspace = worktree-A

researcher#route-B
workspace = worktree-B
```

Team plugin 负责：

- 保存 instance workspace；
- 将其作为 runtime / permission resolution 输入；
- 确保当前 instance 不因其他 instance workspace 改变而漂移。

Team plugin 不负责：

- 创建 Git branch；
- 创建 Git worktree；
- 自动 merge；
- 删除 workspace。

这些可由：

- 独立 tool；
- 专门 teammate/node；
- future router/workflow；

处理。

---

# 18. Concurrency 与资源配额

一旦 MemberTemplate 可生成任意多个 instance，Blueprint 必须能够定义资源边界。

概念上至少应支持：

```text
per-template maxConcurrent
per-template maxTotal
team maxConcurrent
possibly unlimited
```

其中：

- `maxConcurrent` 控制同时活动实例数量；
- `maxTotal` 控制 TeamSession 生命周期内可创建的总实例数。

这些 quota 属于 Blueprint 自治边界。

user 是否可以显式 override，遵循第 12 节 authority 规则。

---

# 19. Blueprint Revision 与冻结语义

## 19.1 TeamSession 绑定不可变 revision

TeamSession 创建时应持久绑定：

```text
blueprintId
revision
contentHash
resolved snapshot
```

之后 Blueprint 文件更新：

```text
rev17 -> rev18
```

不影响正在运行的：

```text
TeamSession -> rev17
```

新 TeamSession 使用 rev18。

vNext 不支持旧 TeamSession 主动升级 Blueprint revision。

---

## 19.2 Snapshot 的冻结范围

冻结所有 Blueprint-owned semantics，例如：

```text
leader template
member templates
base model declarations
tool declarations
Blueprint envelope
Member envelopes
Policy State definitions
Blueprint-owned permissions
quota declarations
```

---

## 19.3 不冻结外部环境

不冻结：

```text
system / managed hard policy
workspace/project hard policy
tool actual availability
model actual availability
provider availability
```

因此旧 session resume 时：

```text
Blueprint@17 says ALLOW
current managed policy says DENY

=> DENY
```

旧 Blueprint snapshot 不能绕过新的外部安全策略。

---

# 20. 持久化与 Event-Sourced 原则

vNext 继续采用：

> session log 是 durable source of truth，runtime 内存只是 projection / activation cache。

这与当前 TeamProjection 的方向一致。

## 20.1 需要持久化的事实类别

本文不固定最终事件名，但概念上必须能够表达：

```text
TeamSession bound to Blueprint revision
LeaderInstance identity
MemberInstance created
MemberInstance bound to MemberTemplate
resolved effective configuration snapshot
instance lifecycle transition
instance runtime overlay changed
PolicyState changed
user autonomy override
archive / restore / dispose
message / progress / control attribution by instance
```

---

## 20.2 Cold Resume 不依赖 live Blueprint catalog

TeamSession 已持久化：

```text
Blueprint snapshot
```

MemberInstance 已持久化其有效创建/bind 信息。

因此即使：

- Blueprint 被修改；
- Blueprint 被移动；
- 原文件暂时不存在；

旧 TeamSession 仍应能够解释自身历史。

是否允许“原 Blueprint 完全删除后仍恢复执行”涉及 catalog / security / product policy，可在 integration 阶段进一步讨论；但至少：

> session history 的语义必须可以离线解释。

---

# 21. Legacy `.dsh/teammates/` 兼容模型

vNext 不应立即删除现有 workspace roster 格式。

应提供一个 legacy adapter：

```text
.dsh/teammates/*
       |
       v
synthesized Legacy Team Blueprint
       |
       v
TeamSession snapshot
```

关键规则：

> legacy 文件只在 TeamSession 绑定/创建时解析为一个确定 snapshot，不再成为 standing-mount 上会随其他 session cwd 变化的共享 live roster。

因此：

- 旧格式仍可使用；
- 当前 roster drift 故障类被消除；
- 同 workspace 多 TeamSession 不互相覆盖；
- 不同 workspace 不互相污染。

legacy adapter 的具体弃用周期不在本文决定。

---

# 22. vNext 对当前 roster bug 的结构性修复

当前错误模型：

```text
Preset Standing Mount
        |
        +--> mutable TeamRegistry
                 |
                 +--> current workspace roster
```

多个 session：

```text
session A cwd=A
session B cwd=B
```

共同改写：

```text
current roster
```

vNext 中完全取消“current workspace roster”：

```text
RootSession A
   |
   +--> TeamSession A
           |
           +--> Blueprint@17 snapshot

RootSession B
   |
   +--> TeamSession B
           |
           +--> Blueprint@17 snapshot
```

因此：

```text
A 的 roster / templates
```

永远由：

```text
TeamSession A 的 Blueprint snapshot
```

决定，而不是由最近哪个 session 创建了 agent 决定。

这使 roster drift **按构造消失**。

---

# 23. 典型运行示例

## 23.1 跨 workspace 复用团队

```text
Blueprint: AIUED-ALGO@17
```

运行：

```text
D:/Projects/AIUED
    Session S1
    TeamSession T1
    Blueprint AIUED-ALGO@17

D:/Projects/Other
    Session S2
    TeamSession T2
    Blueprint AIUED-ALGO@17
```

T1 与 T2：

- share static Blueprint content；
- do not share runtime state；
- do not share roster mutation；
- do not share MemberInstances；
- do not share PolicyState；
- do not share transcript。

---

## 23.2 同 workspace 多团队

```text
D:/Projects/AIUED

S1 -> AIUED-ALGO@17
S2 -> AIUED-ALGO@17
S3 -> AIUED-SAMPLE@5
```

三个 TeamSession 互相独立。

---

## 23.3 同 template 多路线并行

Blueprint 中只有：

```text
algorithm-researcher
```

leader 发起：

```text
delegate new instance:
    label = Fourier
    groupId = route-fourier
    workspace = worktree-fourier

delegate new instance:
    label = Neural
    groupId = route-neural
    workspace = worktree-neural

delegate new instance:
    label = Baseline
    groupId = route-baseline
    workspace = worktree-baseline
```

得到：

```text
researcher#inst-A
researcher#inst-B
researcher#inst-C
```

三者独立 persistent。

发现新路线后：

```text
delegate new instance:
    template = algorithm-researcher
```

无需修改 Blueprint。

---

## 23.4 Model 动态变化

若：

```text
Blueprint envelope:
    model = bounded

MemberTemplate researcher:
    allowed models = [Qwen, StrongModel]

TeamSession.policyState:
    research
```

则：

```text
inst-A turn 1 -> Qwen
inst-A turn 2 -> StrongModel
inst-A turn 3 -> Qwen
```

可以保持同一个 instance identity 与 conversation。

如果切换：

```text
policyState = locked-validation
```

且该 state 声明 model immutable，则后续不能继续修改。

---

# 24. Blueprint 概念性配置示例

以下仅用于表达架构语义，**不是最终 schema**。

```yaml
blueprintId: aiued-algo
displayName: AIUED-ALGO
revision: 17

leader:
  id: leader
  persona: ...
  model:
    default: strong-model

members:

  algorithm-researcher:
    persona: ...
    model:
      default: qwen
      allowed:
        - qwen
        - strong-model

    workspace:
      mutation: creation-mutable

    permissions:
      mutation: bounded

    contextPolicy:
      default: persistent
      mutation: immutable

    instances:
      maxConcurrent: 8
      maxTotal: 32

  code-reviewer:
    persona: ...
    model:
      default: strong-model
      mutation: immutable

policyStates:

  research:
    model: inherit
    permissions: bounded

  locked-validation:
    model: immutable
    permissions: tighten-only

runtime:
  maxConcurrentInstances: 12
```

该示例只说明：

- Blueprint 完整包含 leader；
- member 是 template；
- template 可有 instance quota；
- mutation rule 可按字段声明；
- Policy State 是 TeamSession-level governance；
- Policy State 不负责自动 activation。

---

# 25. Future Extension Seams

vNext 必须有意留下扩展接口，但不能提前实现 workflow engine。

## 25.1 Router

未来 router 可以生成：

```text
ActivationRequest
```

或者：

```text
InstanceMutationRequest
```

但只能在：

```text
Blueprint Envelope
Member Envelope
PolicyState Envelope
```

内工作。

Router 不拥有特殊越权能力。

---

## 25.2 Workflow Activator

未来可以增加：

```text
WorkflowState
Transition
Guard
Effect
```

其中：

```text
activate member
```

effect 应调用同一个 ActivationProvider。

因此未来结构可能是：

```text
Workflow State Machine
        |
        v
Activation Effect
        |
        v
ActivationProvider
```

而不是 workflow engine 自己启动 subagent。

---

## 25.3 WorkstreamInstance

未来若路线级状态成为正式需求，可引入：

```text
WorkstreamInstance
    id
    workflowState
    member instance membership
    lifecycle
```

现有：

```text
groupId
```

作为迁移基础。

vNext 不提前规定 Workstream State 的 owner、transition source 或 completion semantics。

---

## 25.4 Worktree Tool / Workspace Node

未来独立组件可以：

```text
create worktree
    |
    v
return workspace path
    |
    v
ActivationRequest.workspace
```

Team runtime 不需要知道 workspace 是如何产生的。

---

# 26. 架构不变量

以下条目应作为后续 UI、API、实现设计和测试的硬约束。

1. **Team Blueprint 不等于 Agent Preset。**
2. **Blueprint identity 不等于 workspace、路径或 display name。**
3. **一个 root session 至多绑定一个 TeamSession。**
4. **一个 TeamSession 恰好绑定一个 Blueprint revision。**
5. **有效运行历史开始后，Blueprint binding 不可替换。**
6. **Blueprint revision 在 TeamSession 生命周期内冻结。**
7. **外部 hard policy 不随 Blueprint snapshot 冻结。**
8. **Leader 是唯一、特殊约束的 MemberInstance。**
9. **MemberTemplate 不是 runtime actor。**
10. **一个 MemberTemplate 可以同时产生多个 persistent MemberInstance。**
11. **所有 runtime 操作使用 instanceId 寻址。**
12. **groupId 不具有 identity、state、permission 或 lifecycle 语义。**
13. **MemberInstance workspace 在运行开始后默认冻结。**
14. **contextPolicy 在 instance 创建后默认冻结。**
15. **model 可以在 policy 允许时于 turn 间变化。**
16. **tools / permissions 可以在 policy 允许时影响后续执行。**
17. **leader / router / automation 永远不能越过 Team autonomy envelope。**
18. **user 可以显式越过 Team autonomy envelope，但不能越过 External Hard Policy。**
19. **PolicyState 属于 TeamSession。**
20. **PolicyState 只治理 mutation，不表示任务流程。**
21. **vNext PolicyState 只由 user / leader 显式切换。**
22. **新 MemberInstance 默认不继承 leader / sibling transcript。**
23. **所有 instance creation 统一经过 ActivationProvider。**
24. **session log / durable snapshot 是运行历史解释的 source of truth。**
25. **不同 TeamSession 之间不存在共享 mutable roster。**
26. **workspace 不决定 Team identity。**
27. **legacy roster 必须在 session binding 时 snapshot，不允许 live cross-session re-anchor。**

---

# 27. 明确不属于 vNext 的内容

为了防止下一版重新膨胀为 workflow engine，下列功能明确不进入本轮核心架构：

```text
formal WorkstreamInstance
route-level workflow state
automatic task-completion inference
automatic workflow transition
automatic teammate activation
DAG scheduler
arbitrary transition effects
direct state-machine tool execution
Git branch/worktree lifecycle
cross-route information-flow enforcement
Blueprint revision hot-upgrade of running TeamSession
instance conversation cloning
```

这些功能可以在未来版本基于本文保留的扩展缝独立设计。

---

# 28. 后续讨论必须解决、但本文有意不裁决的问题

下一阶段在进入详细开发计划前，需要单独讨论以下三组问题。

## 28.1 交互与用户心智模型

包括：

- 创建 session 时如何选择 Team Blueprint；
- 普通 Agent 与 Team 的入口如何区分；
- explicit create instance 与 delegate-and-create 如何呈现；
- template 与 instance 在模型工具中如何表达；
- archive / restore / dispose 的用户交互；
- Policy State 切换是否需要确认；
- user override autonomy envelope 如何显式呈现。

## 28.2 UI / Projection

包括：

- Blueprint catalog 页面；
- Blueprint editor；
- TeamSession runtime panel；
- MemberTemplate vs MemberInstance 的层级显示；
- groupId 的折叠展示；
- active / settled / archived instance；
- PolicyState；
- runtime overlay / effective config；
- approval / message / progress 如何迁移到 instance-first projection；
- 当前 TeamProjection 如何演化。

## 28.3 与 DSH 现有架构融合

包括：

- Team Blueprint catalog 应挂载在哪个 service 层；
- Agent Preset 与 Team runtime host 的关系；
- root agent composition 如何使用 LeaderTemplate；
- `ctx.team` 是保留、替换还是拆分；
- standing mount 是否仅保留无状态 infrastructure；
- TeamSession service scope；
- ActivationProvider 的 Context ownership；
- events 放入 leader log、child log或双方的规则；
- current team-channels / control registry 如何从 memberId 迁移为 instanceId；
- TeamProjection 的 projection schema；
- legacy team-local 的 adapter 位置；
- preset generation、session restore 与 Blueprint revision 的协作方式。

本文只规定这些设计必须满足前述架构不变量，不提前指定代码组织。

---

# 29. 当前版本到 vNext 的概念迁移

可将当前对象大致理解为：

```text
Current
--------------------------------
TeamMemberDefinition
    |
    +-- static definition
    +-- implicit runtime identity

TeamRegistry
    |
    +-- current roster

TeamOrchestrator
    |
    +-- leaderSessionId + memberId

child session
    |
    +-- team/member-bound
```

vNext：

```text
TeamBlueprint
    |
    +-- LeaderTemplate
    +-- MemberTemplates
    +-- envelopes
    +-- PolicyStates

TeamSession
    |
    +-- immutable Blueprint snapshot
    +-- policyState
    +-- defaultWorkspace
    |
    +-- LeaderInstance
    |
    +-- MemberInstances
            |
            +-- instanceId
            +-- templateId
            +-- child session
            +-- workspace
            +-- overlay
            +-- lifecycle
```

最关键的结构变化可以总结为：

```text
roster -> Blueprint snapshot
member -> template + instance
workspace-bound -> session-bound
single activation/member -> N instances/template
static policy -> bounded runtime overlay
implicit governance -> optional PolicyState
delegation-specific spawn -> unified ActivationProvider
```

---

# 30. 架构总结

vNext 的核心不是“给现有 Team Mode 增加更多工具”，而是重新定义其身份层次。

最终系统应当满足：

> **Team Blueprint 是稳定、完整、可复用的团队定义；TeamSession 是某个 root session 对一个 Blueprint revision 的不可变绑定；MemberTemplate 描述团队内可实例化的能力角色；MemberInstance 是实际拥有 workspace、conversation、runtime policy 与生命周期的执行实体。**

所有动态运行配置都通过受控 overlay 实现：

\[
EffectiveConfig
=
ExternalHardPolicy
\cap
BlueprintSnapshot
\cap
MemberTemplate
\cap
PolicyState
\oplus
InstanceOverlay
\]

其中 PolicyState 仅描述 TeamSession 当前的治理模式，不承担 workflow 职责。

通过这一模型：

1. 当前 roster drift 从根本上消失；
2. Team Blueprint 可以跨 workspace 复用；
3. 同 workspace 可以同时运行不同或相同团队；
4. 同一个 teammate template 可以并行生成任意多条受配额控制的探索路线；
5. model、permissions、tools 等可以在明确定义的自治边界中动态变化；
6. leader、未来 router 与未来 workflow activator 都可复用统一 ActivationProvider；
7. 不需要在本版本提前引入 Workstream / workflow engine 的复杂状态管理；
8. 当前基于 continuable child session、durable binding 和 log projection 的正确设计原则可以继续保留。

本文应作为后续**交互设计、UI 设计、与 DSH 现有架构融合设计**的上游约束文档；这些部分完成后，再进入文件级、package 级和阶段级的详细开发计划。

---

# 附录 A：当前代码基线参考

本文对当前版本事实的描述主要依据 `feat/agent-teams` 中：

- `docs/subsystems/team.zh.md`
- `packages/team/team/src/types.ts`
- `packages/team/team/src/index.ts`
- `packages/team/team-local/src/index.ts`
- `packages/team/team-runtime/src/orchestrator.ts`
- `packages/team/tool-team/src/tool-delegate.ts`
- `packages/team/tool-team/src/tool-list-teammates.ts`
- `packages/team/team-projection/*`
- 当前 roster drift 事故记录 `20260827_aiued-team_roster-drift.md`

本文中的 vNext 内容则来源于本轮需求审查与已经逐项确认的架构决策。

---

# 附录 B：决策状态摘要

**已冻结：**

- Team Blueprint 命名与独立抽象；
- Blueprint 包含完整 leader；
- Blueprint 强校验；
- session-bound team；
- one RootSession -> zero/one TeamSession；
- immutable Blueprint revision binding；
- Leader as special MemberInstance；
- MemberTemplate -> N persistent MemberInstances；
- instance-first runtime identity；
- optional `groupId` only；
- no formal Workstream in vNext；
- ActivationProvider；
- explicit + implicit creation；
- concurrency quota；
- bounded runtime overlay；
- per-field mutation lifecycle；
- workspace default freeze after start；
- model turn-mutable when allowed；
- tools/permissions runtime-mutable when allowed；
- contextPolicy immutable after create；
- user vs agent authority distinction；
- Blueprint-owned snapshot vs external hard policy distinction；
- TeamSession-scoped optional PolicyState；
- PolicyState user/leader explicit transition only in vNext；
- no WorkflowState / auto activation in vNext；
- instance lifecycle CREATED/RUNNING/SETTLED/ARCHIVED/DISPOSED；
- default context isolation；
- worktree externalization；
- legacy roster adapter；
- no hot Blueprint revision upgrade.

**留待下一阶段：**

- interaction；
- UI；
- final file/schema syntax；
- Cordis/package/service integration；
- detailed implementation plan。
