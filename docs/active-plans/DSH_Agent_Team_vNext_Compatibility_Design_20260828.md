# DSH Agent Team vNext：兼容性设计基线（修订版）

**状态**：Frozen Compatibility Baseline  
**适用目标**：`ArmourPiercer1/deepseek-harness`，Team Mode vNext  
**目标分支**：`feat/agent-teams`（开发前应先同步/核对上游 `master`）  
**日期**：2026-08-28  
**取代文档**：`DSH_Agent_Team_vNext_Compatibility_Architecture_Baseline_20260827.md`

> 本文档是 Team Mode vNext 的兼容性权威基线。  
> 本地 agent 在实现过程中不得以“实现方便”为理由改变本文列出的对象边界、生命周期、权限优先级、持久化权威或 UI 可观察语义。  
> 如果代码事实与本文冲突，先记录证据并阻塞对应 Gate；不要自行重新解释需求。

---

# 0. 文档目的

本文档只回答一个问题：

> **怎样把已经冻结的 Team Blueprint / TeamSession / MemberInstance 架构放进当前 DSH，而不破坏 DSH 原有 Session、AgentPreset、Subagent、Model Selection、Conversation、Trajectory、Persistence 等契约？**

它不是 UI 规范，也不是开发步骤。UI 见：

- `DSH_Agent_Team_vNext_UI_Interaction_Design_20260828.md`

开发顺序与验收见：

- `DSH_Agent_Team_vNext_Development_Plan_20260828.md`

核心对象模型仍以此前的 Team vNext Architecture Baseline 为上游语义来源；本文只保留实现兼容性所需的最小摘要。

---

# 1. 不可修改的核心对象关系

```text
TeamBlueprint
    │
    ├─ immutable revision
    ├─ LeaderTemplate
    ├─ MemberTemplates
    ├─ capability requirements
    ├─ policy / mutation envelope
    └─ PolicyState definitions
            │
            ▼
Root Session
    │
    ├─ AgentPreset binding
    └─ optional TeamSession binding
            │
            ├─ id = Root SessionId
            ├─ immutable Blueprint snapshot
            ├─ defaultWorkspace
            ├─ currentPolicyState
            ├─ durable user/session overrides
            ├─ LeaderInstance = Root Agent itself
            └─ MemberInstances
                    │
                    ├─ opaque instanceId
                    ├─ templateId
                    ├─ label
                    ├─ groupId?
                    ├─ workspace
                    ├─ runtime overlays
                    ├─ childSessionId
                    └─ lifecycle
```

必须保持：

\[
\boxed{\text{AgentPreset} \perp \text{TeamSession}}
\]

即两者是同一个 Root Session 上的正交绑定，不是继承关系。

---

# 2. 当前 DSH 事实基线：实现前必须以此为准

## 2.1 AgentPreset 是 per-Agent / per-Session composition

当前 DSH AgentPreset 不是“同 preset 默认共享一份 standing composition”。

当前正式模型是：

```text
Agent factory setup(agentCtx)
    ↓
mount selected AgentPreset cordis.yml
    ↓
registrations land in this Agent scope
```

默认每个 Session/Agent 独立 mount composition；只有 preset 作者显式使用 Cordis isolate/shared realm 时才产生共享实例。

因此旧 Team roster drift 的根因必须描述为：

```text
旧 Team preset
    +
Team 自己的 mutable shared realm / TeamRegistry
    +
team-local cwd-driven reload
    ↓
跨 Session roster 漂移
```

而不是“AgentPreset 天生跨 Session 共享”。

### 实现要求

- 新 Team Runtime 不得再次在 AgentPreset 内建立“当前 Team roster”的共享 mutable realm。
- AgentPreset 只提供 ordinary agent composition。
- TeamSession durable state 必须 session-bound。

---

## 2.2 Model routing 不属于 AgentPreset

当前 DSH 把以下内容分开：

```text
AgentPreset
    → tools
    → persona assembly
    → prompt sections
    → compaction
    → ordinary delegation/tool composition

ModelSelection
    → provider
    → model
    → reasoningEffort
```

模型选择属于独立 per-Agent route，Host 通过 LLM registry 与 session-local model selection 管理。

因此后续文档与代码禁止写：

```text
AgentPreset owns provider/model
```

正确模型：

\[
C_{\text{substrate}}
=
C_{\text{AgentComposition}}
+
C_{\text{LLMRoute}}
+
C_{\text{HostCapabilities}}
+
C_{\text{TeamRuntime}}
\]

Blueprint 的 model/provider requirement 必须 probe LLM route，而不是读取 AgentPreset manifest。

---

# 3. Team Mode 与 AgentPreset 的正式边界

## 3.1 Team Mode 不是 AgentPreset

用户可以创建：

```text
AgentPreset = standard
TeamBlueprint = AIUED-ALGO
```

也可以：

```text
AgentPreset = minimal
TeamBlueprint = AIUED-ALGO
```

是否满足 Blueprint requirements 由 compatibility resolver 判断。

禁止重新引入：

```text
agentPreset == team
→ 才代表 Team Mode
```

这种隐式语义。

---

## 3.2 Generic `team` AgentPreset 的定位

允许继续保留一个名为 `team` 的普通 AgentPreset，定位为：

> 推荐的 Team-friendly ordinary composition。

它可以拥有：

- 常用 tools；
- 合适的 persona assembly defaults；
- `complete = false`；
- `includeRuntimeContext = true`；
- 常用 ordinary delegation / skills / MCP consumer；
- 适合 Team Leader 的默认 agent-facing capability surface。

但它**不得**包含使 TeamSession 成立所必需的 Team Runtime rows：

```text
team-registry
team-local
team-runtime
team-channels
tool-team
```

TeamSession 必须在其他 AgentPreset 上仍可成立。

---

# 4. Team Runtime 的 Host / Agent 分层

正式分层：

```text
Team Host Backend
────────────────────────────────
TeamBlueprintCatalog
TeamSession projection/fold
TeamActivationProvider
compatibility resolver
lifecycle/control
provisioning/recovery
durable event vocabulary
Team handoff summarizer

Team Agent Surface
────────────────────────────────
leader persona text override
leader Team tools
member Team tools
Team-facing prompt/context
effective Team policy materialization
model-facing status/progress
```

依赖方向：

```text
Agent Surface → Host Backend
```

Host backend：

- deployment 常驻；
- 0 个 TeamSession 时 dormant；
- 不依赖某个 AgentPreset 是否 mount Team plugin。

Agent-facing Team tools：

- Root TeamSession scope 才注册 leader tools；
- Member child scope 才注册 member tools；
- ordinary AgentSession 不获得 Team coordination tools。

---

# 5. Root TeamSession 的创建边界

## 5.1 使用官方 `CreateAgentOptions.setup`

vNext 不新增 DSH core root-agent creation contributor registry。

优先采用当前正式 seam：

```text
ctx.agents.create({
    ...,
    setup(agentCtx) {
        install session/model support
        mount AgentPreset
        TeamRootSetup(agentCtx)
    }
})
```

如 Host 当前已有组合 setup，Team integration 只在 Host/session-controller/apiproxy 组合层追加 TeamRootSetup。

禁止：

- post-publication 偷偷重构成 Team；
- first prompt 后补 Team identity；
- 修改 AgentLoop 只为 Team creation。

---

## 5.2 Team Intent 不复用已有普通 blank Host Session

这是正式兼容性不变量。

普通 Agent New Session 可以继续遵循 DSH 自己的 blank-session reuse。

但 Team Intent：

```text
Team Intent
    ↓ first Send
fresh Root Session creation
```

不得采用：

```text
existing ordinary blank Agent
→ post-hoc convert to Team
```

原因：Team Blueprint bind、persona override、Team tools、compatibility preflight 等必须在正确创建事务中安装。

---

## 5.3 Team-bound blank Session 不进入 ordinary blank reuse

只要 Root log 已包含有效：

```text
team-session/bound
```

则：

```text
blankReusable = false
```

即使它从未产生 `turn/start`。

这类 Session 可能因为 compatibility warning 停留在：

```text
AWAITING_COMPATIBILITY_ACK
```

它必须保持可重新打开，不能被普通 `New Session` 接管。

---

# 6. `team-session/bound` 与 TeamSession identity

TeamSession 不拥有独立 UUID：

\[
\boxed{\text{TeamSessionId}=\text{RootSessionId}}
\]

首个权威 durable Team fact：

```text
team-session/bound {
    teamSessionId: rootSessionId
    blueprintId
    revision
    contentHash
    resolvedBlueprintSnapshot
    defaultWorkspace
    initialPolicyState
}
```

Root Session log 是判断：

```text
is this a TeamSession?
```

的唯一 durable authority。

不要在 SessionHeader 再增加另一份 `teamBlueprint` authority。

---

# 7. Blueprint bind 与 AgentPreset switch

## 7.1 Blueprint bind

一旦 `team-session/bound` commit：

```text
TeamBlueprint immutable
```

即使 root 尚未执行第一轮，也不能原地 rebind Blueprint。

用户要换 Blueprint：

```text
create another Team Intent / TeamSession
```

禁止实现：

```text
team-session/rebound
```

作为 vNext 常规能力。

---

## 7.2 AgentPreset 可切换窗口

此前“blank TeamSession 可切 AgentPreset”修正为更精确的不变量：

\[
\boxed{
PresetSwitchAllowed
=
RootHasNoTurn
\land
NoMemberProvisioningEverStarted
}
\]

允许发生：

- TeamSession 已 bind；
- compatibility warning 已出现；
- user 已 acknowledged 某些 warning；
- PolicyState 已切换；
- handoff summary 已存在；

仍可以切 AgentPreset，只要：

```text
root no turn
AND
no team-instance/provisioning ever started
```

每次切换后必须：

```text
re-run compatibility preflight
```

一旦以下任一发生：

```text
first root turn
OR
first MemberInstance provisioning
```

AgentPreset 对该 TeamSession 永久锁定。

---

# 8. Leader persona 与 AgentPreset persona assembly

## 8.1 所有权

Team Blueprint owns：

```text
LeaderTemplate.persona text
MemberTemplate.persona text
```

AgentPreset / `dsh-persona` owns：

```text
complete
includeRuntimeContext
future persona assembly semantics
```

---

## 8.2 Persona text override seam

不要 fork/copypaste `dsh-persona`。

对 `dsh-persona` 做最小、通用扩展：

```text
effective persona text
=
agent/session scoped personaTextOverride
?? preset configured text
```

Team Root/Member setup 消费该 generic override。

该 seam 不得 import Team types 或认识 TeamSession。

默认 Team identity composition：

```text
replace persona text
```

但内部数据结构要为 future：

```text
replace | prepend | append | inherit
```

保留扩展缝。

---

# 9. MemberInstance 与 continuable child

## 9.1 基础 composition

vNext：

```text
MemberInstance base composition
=
Root AgentPreset
```

MemberInstance 再叠加：

- MemberTemplate persona；
- workspace；
- model route；
- Team policy；
- Team runtime tools；
- context policy；
- instance override。

vNext 不支持 per-member AgentPreset selector。

---

## 9.2 Generic Subagent 与 MemberInstance 并存

```text
Team MemberInstance
    ∈ TeamSession

Generic DSH Subagent
    ∉ TeamSession
```

MemberInstance 可在 ordinary tool policy 允许时启动 generic subagent/workflow。

generic helper：

- 不进入 Team roster；
- 不获得 Team MemberInstance identity；
- 不受 MemberTemplate lifecycle 直接管理；
- 但当所属 MemberInstance Archive/Dispose 需要 quiesce 时，必须 drain 它所拥有的 resident descendants。

---

# 10. Member model routing

## 10.1 保留 turn-mutable 语义

已经冻结：

```text
MemberInstance model
=
turn-mutable
```

即同一个 persistent MemberInstance 可以在不同 turn 之间改变：

```text
provider/model/reasoningEffort
```

只要 policy 与外部 capability 允许。

---

## 10.2 禁止走 generic addressed-subagent `session.selectModel`

DSH generic addressed-subagent ownership 明确禁止普通 Agent-bound session model control。

因此 Team UI 不得：

```text
session.selectModel(memberChildSessionId)
```

绕过 direct-parent ownership。

必须提供 Team-owned path：

```text
Team UI / Team tool
    ↓
TeamSessionRuntime
    ↓
validate TeamSession + instance + parent ownership
    ↓
record durable MemberInstance model override
    ↓
apply through child Agent/model-selection seam
    ↓
effective at next request boundary
```

若底层当前缺少可安全复用的 setter，可做最小 Host/model integration 扩展；禁止因此把产品语义降级为 creation-only，除非实现证据经 Gate 明确证明不可行并由用户重新裁决。

---

# 11. Capability Contract

## 11.1 Requirement 与 Policy 分离

```text
Requirement
    = expected capability exists

Policy
    = if capability exists, whether this role may use it
```

禁止把 requirement 当 plugin installation request。

例如：

```yaml
simulator:
  requires:
    mcpServers: [abtem]

  mcpServers:
    allow: [abtem]
```

前者参与 compatibility，后者参与 effective policy。

---

## 11.2 Typed requirement domains

vNext 只支持可以真实 probe 的 domain，例如：

```text
tools
skills
mcpServers
model/provider routes
persona/runtime-context properties
```

未知 requirement domain：

```text
Blueprint validation error
```

而不是“永远 warning”。

---

## 11.3 Structural Error vs Requirement Warning

Structural Error：

- Blueprint schema/semantic contradiction；
- Team Runtime backend 缺失；
- ActivationProvider 缺失；
- Team durable persistence 不可用；
- continuable child capability不可用；
- intrinsic leader/member Team surface 无法建立；
- persona identity text 无法注入。

结果：

```text
TeamSession cannot be created/resumed as operational Team
```

Requirement Warning：

- ordinary tool/skill/MCP/model route 缺失；
- persona assembly 条件不理想；
- Blueprint 预期能力当前不存在。

结果：

```text
user may Continue Anyway
```

不引入 required/recommended/optional severity taxonomy。

---

# 12. Compatibility Gate：Team admission gate

Compatibility Gate 不是仅仅：

```text
block root session.prompt
```

正式定义：

> 当存在尚未处理的新 compatibility warning 时，暂停 **新的 Team work admission**。

`AWAITING_COMPATIBILITY_ACK` 时阻止：

- Root 新 user prompt；
- Leader 新 delegate/create；
- 新 MemberInstance activation；
- MemberInstance 新 human/model follow-up；
- SETTLED Member 的 Resume；
- 其他会产生新 Team work 的入口。

但：

```text
already admitted/in-flight work
```

不强制中断。

形式：

```text
warning detected at t0

work admitted before t0
    → allowed to settle

new admission after t0
    → blocked until acknowledgment/config repair
```

Compatibility Gate 与 PolicyState 严格不同：

```text
Compatibility Gate = readiness/admission
PolicyState        = runtime governance envelope
```

---

# 13. Warning acknowledgment

用户 `Continue Anyway` 后：

```text
durable acknowledgment
```

至少关联：

```text
requirement owner
capability id
```

同一 mismatch 在当前 TeamSession 不重复阻塞。

如果：

- AgentPreset blank switch；
- cold resume 后 AgentPreset/host capability 改变；
- runtime capability topology 改变；

产生新 mismatch，则重新进入 gate。

Acknowledged mismatch 不消失，只进入：

```text
Degraded / acknowledged
```

状态供 UI 查询。

---

# 14. Policy、Autonomy Overlay 与 User Override

这里必须使用精确术语。

## 14.1 Autonomy Overlay

由：

- leader；
- member（经 leader approval/request）；
- future router；
- future workflow activator；

在 Blueprint envelope 内产生的 agent/runtime override。

它受：

```text
Blueprint envelope
Member envelope
PolicyState envelope
```

限制。

PolicyState 改变时，Autonomy Overlay 可以：

```text
stored but temporarily suppressed
```

不要 destructive delete。

---

## 14.2 Explicit Human User Override

用户在 GUI/明确 API 中设置的 durable override。

它高于 Team autonomy envelope 与 PolicyState，但仍不能超过：

- external hard policy；
- capability existence。

因此：

```text
PolicyState change
```

不得 suppress explicit User Override。

---

## 14.3 Effective Team Policy

禁止把各 Team 层分别 materialize 为不可逆 DSH monotonic restriction。

先在 Team domain resolve：

```text
P_TeamResolved
=
Resolve(
  Blueprint,
  MemberTemplate,
  PolicyState,
  Template Autonomy Overlay,
  Instance Autonomy Overlay,
  Explicit User Override
)
```

然后：

\[
P_{\text{effective}}
=
P_{\text{external-hard}}
\cap
P_{\text{capability-exists}}
\cap
P_{\text{TeamResolved}}
\]

若 dynamic update：

- replace resolved Team guard；
- 或让 dynamic guard 读取最新 projection；

不要堆叠一串只能收紧、无法被 User Override 放宽的旧 restriction。

---

# 15. TeamSession durable authority

## 15.1 Root log

Root Session log 是 TeamSession 的 authoritative event store：

```text
team-session/bound
team-session/policy-state-changed
team-session/compatibility-acknowledged
team-session/user-override-*
team-instance/provisioning
team-instance/created
team-instance/state-changed
team-instance/overlay-*
team-instance/archived
team-instance/disposed
...
```

Runtime：

```text
TeamSessionRuntime = Fold(RootSessionLog)
```

内存 registry/cache 不是第二真源。

---

## 15.2 Child log

Member child Session log 是该 MemberInstance 自我恢复的 authority：

- member binding；
- templateId / instanceId；
- Team root id；
- effective creation config；
- persona/policy install evidence；
- actual first-person model/tool/user history。

Root 与 child 都记录：

```text
instanceId ↔ childSessionId
```

用于 integrity check。

不一致时 fail closed/diagnostic，不猜测。

---

# 16. Provisioning transaction

MemberInstance 创建跨 Root/child 两份 log，无法成为 ACID transaction。

内部状态：

```text
PROVISIONING
    ├─ success → MemberInstance CREATED
    └─ failure → PROVISIONING_FAILED
```

`PROVISIONING_FAILED` 不是用户可见 Member lifecycle；failed provisioning 不生成正式 MemberInstance。

推荐事务顺序：

```text
Root:
  append + flush team-instance/provisioning

create child

Child:
  durable binding
  accepted initial context/prompt
  flush

Root:
  append team-instance/created
```

Recovery 必须处理：

```text
root provisioning exists / child absent
child exists / root final edge absent
```

并支持：

- reconciliation；
- idempotent retry；
- orphan cleanup；
- stable provisioning identity。

---

# 17. Member lifecycle 与 quiesce

用户可见 lifecycle：

```text
CREATED
  ↓
RUNNING
  ↓
SETTLED
  ├─→ RUNNING
  └─→ ARCHIVED
        └─→ RUNNING (restore)

active/settled/archived
  → DISPOSED
```

## 17.1 Archive RUNNING

不得只改 enum。

流程：

```text
close new admission
↓
interrupt current member turn
↓
drain resident generic descendants
↓
release resident child activation/handle as appropriate
↓
ARCHIVED
```

历史 Session 不删除。

---

## 17.2 Dispose

同样先 quiesce/drain，再：

```text
DISPOSED
```

含义：

- Instance 不可 restore；
- 不再是 active runtime object；
- transcript / Session log / Trajectory 仍保留；
- Team ledger 仍保留历史引用。

---

# 18. Resume

UI 不在 resume 时重新传 Blueprint id。

流程：

```text
resume(rootSessionId)
    ↓
load durable Session
    ↓
fold team-session/bound
    ↓
absent → ordinary resume
present → restore immutable Blueprint snapshot
          rebuild AgentPreset under DSH native semantics
          TeamRootSetup.restore
          rerun compatibility
```

Blueprint 使用 log snapshot，不读取“当前 Blueprint 文件的最新 revision”替换旧 snapshot。

AgentPreset 遵循 DSH 自己的 durable preset-id / composition semantics，不在 Team 中复制整个 preset snapshot。

---

# 19. Fork

必须区分 Root TeamSession 与 Member child Session。

## 19.1 Fork Team Root

```text
Parent Team Root P
  Blueprint snapshot R
  instances A/B

fork
    ↓

New Root C
  new TeamSession id = C
  same Blueprint snapshot R
  MemberInstances = empty
```

复制 prefix 中的旧 Team events保留原：

```text
teamSessionId = P
```

新 Team projection 必须忽略这些继承历史作为当前 runtime state。

新的：

```text
team-session/bound(teamSessionId=C, same snapshot)
```

建立新 Team。

---

## 19.2 Fork Member child Session

默认：

```text
ordinary independent AgentSession
```

不是：

- 原 Team 的新 Member；
- 新 TeamSession；
- 自动 Leader。

它只保留 DSH 普通 fork 的历史/lineage 语义。

---

# 20. `Start Team from Here`：one-shot handoff

从 meaningful ordinary AgentSession A 启动 Team：

```text
A
  ↓ Start Team from Here
Team Intent B
```

B：

- workspace 默认继承 A.workspace；
- 记录 sourceSessionId 用于 provenance/navigation；
- 用户选择 Blueprint；
- AgentPreset 使用 Team-friendly default，允许在创建前修改；
- 不复制 A 的 runtime state；
- 不让 B 获得 A 的 history search/read 权限。

---

## 20.1 Handoff summary

vNext 提供一次性“足够好的语境”：

```text
read frozen canonical surface(A)
    ↓
one-shot handoff summarization
    ↓
frozen sourced context
    ↓
persist into B before first model request
```

不能调用：

```text
compactNow(A)
```

因为正常 compaction 会改变 A 自己的 surface。

应复用 Session query / canonical surface projection 读取语义。

---

## 20.2 Handoff summarizer route

Handoff summarizer 使用独立 host-level summarization route。

不要绑定：

- Blueprint leader model；
- MemberTemplate model；
- AgentPreset model（本就不属于 preset）。

原因：Team compatibility 问题不能阻止用户生成交接摘要并进入配置/修复界面。

若 summarization 失败：

```text
Retry
Continue without handoff
Cancel
```

禁止静默无摘要继续。

---

# 21. Conversation / Trajectory 可重建性

用户要求：

> 每个 durable Team event 都必须可从会话历史观察；Chat 默认折叠；Trajectory 必须能够重建当前 Session 第一视角。

实现应利用当前 DSH ConversationNodeAssembler target-specific definitions。

对 Team event family：

```text
team-session/*
team-instance/*
```

建议至少提供：

```text
TeamLedger Chat Definition
TeamLedger Trajectory Definition
```

原则：

\[
1\ durable\ TeamEvent
\Rightarrow
1\ addressable\ ledger\ node
\]

第一版不做 N→1 event aggregation。

Known event：

- 专用 renderer。

未知未来 Team event：

- generic fallback；
- 至少显示 type / seq / time / raw-safe payload；
- 不静默丢弃。

---

# 22. Team-wide ledger 与 child first-person log

Team Tab 的跨 Session Team Events / Timeline 以 Root Team log 为协调 authority。

不要通过：

```text
root log + child A log + child B log
```

按 timestamp 硬 merge 出虚假 total order。

规则：

```text
Team-wide coordination fact
→ canonical Root Team event

Member first-person execution fact
→ child Session event
```

因此：

```text
Team Tab
    = Root TeamSession projection

Member Chat/Trajectory
    = child first-person Session
```

二者通过 instanceId / childSessionId 导航关联。

---

# 23. Blueprint Catalog 与 Legacy

删除“当前 TeamRegistry”概念，拆成：

```text
TeamBlueprintCatalog
TeamSessionRuntime
```

Legacy：

```text
.dsh/teammates/*
    ↓
LegacyWorkspaceTeamBlueprint
    ↓
snapshot once at TeamSession creation
```

不得恢复：

- live cwd watcher；
- home fallback shadow；
- empty parse 保留 stale roster；
- shared definitions[] mutation。

旧：

```text
aiued-team / aieo-team role AgentPreset
```

只作为 migration input，不再是一等 Team identity。

---

# 24. 官方 Experimental Agent Teams 的边界

当前官方存在私有 experimental Agent Teams，已占用部分 vocabulary，例如：

```text
ctx.agentTeams
team/member
team/message/*
team/task/*
```

vNext：

- 不依赖 private experimental API；
- 不复制其 roster/task DAG 语义；
- 避免 namespace 冲突。

新 durable domain 推荐：

```text
team-session/*
team-instance/*
team-blueprint/*
```

未来官方 promotion 后再评估 adapter。

---

# 25. 最终 Host / Scope 矩阵

| 层 | 生命周期 | 权威内容 | 不应拥有 |
|---|---|---|---|
| Host / Deployment | process | Blueprint catalog、Team runtime services、ActivationProvider、compatibility、LLM registry、session query | 当前某 Session 的 mutable roster |
| AgentPreset subtree | per Agent/Session | ordinary tools、persona assembly semantics、prompt sections、compaction、ordinary delegation composition | Team identity、Blueprint、Member roster、provider/model route |
| Root Agent scope | per root Agent | model selection、Team root surface、persona text override、resolved Team guard | Blueprint source mutation |
| Root Session log | durable | TeamSession binding、snapshot、governance、membership/lifecycle、coordination ledger | child first-person transcript |
| Member child Agent | per activation/resume | inherited AgentPreset + member overlay + Team member surface | independent Team authority |
| Member child Session log | durable | child binding、first-person Chat/Trajectory/model/tool history | Team-wide total order |

---

# 26. 兼容性硬不变量清单

本地 agent 在代码 review 时逐条核对：

1. Team Mode != AgentPreset。
2. Team Blueprint != AgentPreset。
3. AgentPreset 与 TeamSession 正交。
4. AgentPreset 默认 per-Agent composition。
5. Model/provider/effort 不归 AgentPreset 所有。
6. Generic `team` preset 不是 Team runtime dependency。
7. Team Blueprint 不包含 Cordis/plugin composition。
8. Team Intent 不复用已有普通 blank Host Session。
9. `team-session/bound` 后该 Session 不可被 ordinary blank reuse。
10. TeamSessionId = RootSessionId。
11. Blueprint bind 后不可原地切换。
12. AgentPreset 仅在 root 无 turn 且从未开始 Member provisioning 时可切换。
13. Leader/Member persona identity text 属于 Blueprint。
14. persona assembly semantics 属于 AgentPreset/dsh-persona。
15. MemberInstance 默认继承 Root AgentPreset。
16. vNext 不支持 per-member AgentPreset。
17. Member model 保持 turn-mutable，但走 Team-authorized path。
18. Generic Subagent 与 Team MemberInstance additive 共存。
19. Requirement != Policy。
20. Requirement 只使用可 probe typed domains。
21. Structural Error 不可 ignore。
22. Requirement Warning 可 Continue Anyway。
23. Compatibility Gate 阻止全部新 Team work admission，但不回滚已在途工作。
24. Explicit User Override 高于 Team autonomy/PolicyState。
25. Autonomy Overlay 受 PolicyState envelope；可以 stored-but-suppressed。
26. Team-owned policies 先 resolve，再 materialize 到 DSH restriction。
27. User Override 不能创造不存在 capability。
28. User Override 不能越过 external hard policy。
29. Root log 是 TeamSession durable authority。
30. Child log 是 Member first-person/self-binding authority。
31. Member provisioning 有跨日志 recovery transaction。
32. Archive/Dispose 必须 quiesce/drain 后才改变 lifecycle。
33. Dispose 不删除历史。
34. Resume 从 durable Blueprint snapshot 恢复。
35. Root Team fork → same snapshot + empty MemberInstances。
36. Member child fork → ordinary AgentSession。
37. Start Team from Here 只提供 one-shot frozen summary，不授予 source-session live retrieval。
38. Handoff summarizer 独立于 Team role model。
39. 所有 durable Team events 在 Chat/Trajectory 中必须有可观察 fallback。
40. Team-wide ledger 使用 Root Team log authority。
41. Mutable current-team TeamRegistry 删除。
42. vNext 不依赖官方 private experimental Agent Teams。
43. 不新增 DSH core creation registry；先使用官方 setup seam。
44. 新能力若要求突破上述边界，必须停在 Gate 并回报，不得自行扩大 scope。

---

# 27. 明确不进入 vNext

- WorkstreamInstance；
- WorkflowState；
- task DAG；
- router-driven automatic activation（只留接口）；
- Blueprint hot upgrade/rebind；
- per-member AgentPreset；
- worktree lifecycle；
- Team 独立数据库；
-跨进程 distributed Team transaction；
-跨 Session live history search/read；
-官方 experimental Agent Teams adapter；
-任意 capability severity taxonomy；
-未知 capability plugin registry；
-自动写回 Blueprint 的 runtime override；
-删除 disposed member transcript；
-跨 child log timestamp 合并成 authoritative total order。

---

# 28. 开发时的冲突处理规则

如果实现 agent 发现 DSH 当前源码与本文假设不同：

1. 保存最小可复现证据：路径、接口、测试或官方 note；
2. 判断是：
   - 技术接线变化；
   - 还是会改变用户可观察语义；
3. 技术接线变化：允许采用最小推荐实现，不需要重新开需求；
4. 语义变化：停止对应任务，不跨 Gate；
5. 不得通过：
   - 隐式 fallback；
   - silent downgrade；
   - 临时删除功能；
   - 扩大 core patch；
   来“先让测试过”。

本文档优先于旧 Team Mode 现状；DSH core 的正式契约优先于旧 Team plugin 内部实现。
