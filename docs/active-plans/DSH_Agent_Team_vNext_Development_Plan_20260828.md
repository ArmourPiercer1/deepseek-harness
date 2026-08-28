# DSH Agent Team vNext：详细开发计划

**状态**：Execution Plan / Agent-operable  
**目标仓库**：`ArmourPiercer1/deepseek-harness`  
**目标开发线**：`feat/agent-teams`  
**日期**：2026-08-28

**强制上游文档：**

1. `DSH_Agent_Team_vNext_Compatibility_Design_20260828.md`
2. `DSH_Agent_Team_vNext_UI_Interaction_Design_20260828.md`
3. 既有核心架构基线 `DSH_Agent_Team_vNext_Architecture_Baseline_20260827.md`

> 本计划供本地 agent 直接执行。  
> 所有任务必须遵守 Gate；不得跨 Gate 批量“顺手重构”。  
> 如果任务发现会改变上述文档的用户可观察语义，应停止并报告证据，而不是自行调整需求。

---

# 0. 执行原则

## 0.1 优先级

```text
Correct semantics
    >
Durability / recovery
    >
Compatibility with DSH
    >
UI completeness
    >
Refactoring elegance
```

---

## 0.2 开发策略

采用“**strangler replacement**”：

```text
old Team implementation
        │
        ├─ 保持可运行、补 characterization tests
        │
        ▼
new host/backend primitives
        │
        ▼
new TeamSession projection + activation
        │
        ▼
new agent surfaces
        │
        ▼
new UI
        │
        ▼
legacy adapter
        │
        ▼
delete obsolete shared roster paths
```

不要先大删旧代码再重新搭。

---

## 0.3 Commit 原则

每个 Task 建议一个或少数几个可独立 review 的 commit。

禁止一个 commit 同时：

- 改 durable schema；
- 改 Host lifecycle；
- 重做 UI；
- 删除 legacy；
- 大规模 rename。

建议 commit 前缀：

```text
team-vnext:
team-blueprint:
team-runtime:
team-ui:
team-compat:
team-legacy:
```

---

# 1. 模型/人员分派约定

本计划用两维难度：

```text
R = reasoning / architecture difficulty
C = code / integration difficulty
```

等级：

```text
Low / Medium / High / Very High
```

建议角色：

| 角色 | 适合任务 |
|---|---|
| Architect / strongest model | durable semantics、cross-session transactions、Host integration、review Gate |
| Senior executor | package refactor、typed APIs、projection、tests |
| Fast executor | mechanical moves、schemas、fixtures、UI components under frozen contract |
| Reviewer | invariant audit、race/recovery tests、diff review |

任何 **Very High R** 任务不得只由 fast executor 独立决定语义。

---

# 2. 当前包处置图

以 `feat/agent-teams` 当前 Team 包为基线。

| 当前包/区域 | vNext 处置 | 目标 |
|---|---|---|
| `packages/team/team/` | **REPLACE** | 删除 mutable current roster TeamRegistry；转为 Blueprint types/catalog 或拆新包 |
| `packages/team/team-local/` | **LEGACY** | 改成 `.dsh/teammates → LegacyWorkspaceTeamBlueprint` 一次性 adapter |
| `packages/team/team-runtime/` | **MAJOR REFACTOR** | Host TeamSessionRuntime + ActivationProvider + compatibility + recovery |
| `packages/team/team-channels/` | **KEEP + REFACTOR** | 保留 host-level control channel 思路，改成 instance-addressed |
| `packages/team/tool-team/` | **REWRITE SURFACE** | root/member scoped Team tools；instance-first addressing |
| `packages/team/team-projection/` | **MAJOR REFACTOR** | Root TeamSession fold + child binding projections + UI projection |
| `packages/bundle/team/` | **REFACTOR** | Host backend bundle；不再依赖 `agentPreset=team` |
| `ui-team` / client Team package | **EVOLVE** | 保留 Timeline/Members/Events 骨架，升级对象模型 |
| `dsh-persona` | **SMALL PATCH** | generic agent/session persona text override seam |
| Host session controller / apiproxy | **SMALL INTEGRATION PATCH** | Team create/resume/fork、gate、fresh Team Intent |
| model-selection integration | **SMALL EXTENSION IF NEEDED** | Team-authorized Member next-request model override |
| Conversation/Trajectory client | **EXTEND** | Team ledger definitions/fallback renderers |

具体路径在 Phase 0 通过 repo inventory 固化；若上游 package rename，以功能 owner 为准。

---

# 3. Phase 0 — Baseline Sync & Characterization

**目标**：确认当前分支真实代码与上游最新 DSH 契约，建立“不改行为”的测试安全网。

**Gate G0：基线已知且可重复**

---

## T0.1 同步/比较上游 AgentPreset、Session、Subagent、Conversation 架构

**R：High / C：Low**  
**建议**：Architect

### 内容

核对至少：

- AgentPreset per-Agent mount；
- `CreateAgentOptions.setup` / resume setup；
- session blank reuse；
- model selection；
- subagent addressed ownership；
- continuable setup registry；
- conversation assembler；
- trajectory target definitions；
- session fork；
- persistence backends。

### 输出

`docs/team-vnext/implementation-baseline.md`，列：

```text
fact
path
API
test evidence
impact on Team vNext
```

### 验收

- 不依赖旧讨论记忆；
- 每个将被 Team 使用的 seam 有源码路径；
- 记录 branch 与 upstream commit。

---

## T0.2 Characterization tests：旧 Team 行为

**R：Medium / C：High**  
**建议**：Senior executor

覆盖：

- current leader/team tools；
- continuable member create/followup；
- current timeline/events projection；
- team control approval；
- cold resume；
- member child setup；
- roster drift regression reproduction（若可自动化）。

### 目标

不是保护旧 bug，而是固定仍需保留的用户价值：

- persistent child；
- control；
- progress；
- timeline；
- session navigation。

### 验收

测试可以明确区分：

```text
legacy expected behavior
legacy known-bad behavior
```

---

## T0.3 建立 vNext invariant test helpers

**R：High / C：Medium**

创建测试辅助：

- Root/child event inspection；
- fold TeamSession projection；
- fake Blueprint catalog；
- fake capability probes；
- crash/recovery harness；
- fake Session storage cross-backend runner。

### G0 Exit Criteria

- upstream seam inventory 完成；
- 当前 Team tests 全绿或已记录 baseline failure；
- roster drift/blank reuse/subagent ownership 等关键边界有 regression fixture；
- 未开始 durable schema 迁移。

---

# 4. Phase 1 — Domain Types & Blueprint Catalog

**目标**：先建立纯数据/验证层，不碰 Agent lifecycle。

**Gate G1：Blueprint 与 TeamSession domain 可独立测试**

---

## T1.1 定义 Team Blueprint schema

**R：High / C：Medium**  
**建议**：Architect + Senior

包含：

```text
blueprintId
displayName
revision
contentHash
source
LeaderTemplate
MemberTemplates
requirements
policy envelopes
PolicyStates
quota declarations
```

### 强制验证

- exactly one Leader；
- stable unique templateId；
- internal requirement vs immutable deny contradiction；
- known typed requirement domains；
- legal PolicyState envelopes；
- quota valid；
- no Cordis/plugin composition fields。

---

## T1.2 Blueprint snapshot resolver

输入：

```text
catalog record
```

输出：

```text
ResolvedBlueprintSnapshot
```

必须 deterministic/canonical。

实现：

- normalized data；
- stable content hash；
- detached immutable snapshot。

测试：

- serialization round-trip；
- equivalent content hash；
- revision differs/content same cases；
- source changes不改变 semantic hash 的预期要明确。

---

## T1.3 TeamBlueprintCatalog

支持：

```text
Project
Global
Legacy
```

要求：

- 同 displayName 不 silent shadow；
- identity by id/source/revision；
- current revision；
- older revision lookup；
- validation diagnostics。

不要在此层持有“当前 Session 的当前 Blueprint”。

---

## T1.4 Legacy adapter skeleton

仅解析：

```text
.dsh/teammates/*
```

为：

```text
LegacyWorkspaceTeamBlueprint
```

此阶段不删除 `team-local` watcher，先建立新 adapter tests。

### G1 Exit Criteria

- Blueprint schema/validation tests；
- catalog source collision tests；
- immutable snapshot/hash tests；
- Legacy input可生成一次性 Blueprint；
- 无 Agent/Session runtime coupling。

---

# 5. Phase 2 — Durable Vocabulary & Projections

**目标**：建立 TeamSession event-sourced truth。

**Gate G2：Root log 可完整 fold TeamSession；无 mutable TeamRegistry 参与**

---

## T2.1 Durable event vocabulary

建议 namespace：

```text
team-session/*
team-instance/*
```

首批至少：

```text
team-session/bound
team-session/policy-state-changed
team-session/compatibility-acknowledged
team-session/user-override-updated

team-instance/provisioning
team-instance/created
team-instance/state-changed
team-instance/autonomy-overlay-updated
team-instance/user-override-updated
team-instance/archived
team-instance/disposed
```

所有 Root-owned Team event 携：

```text
teamSessionId = rootSessionId
```

考虑：

- event version；
- stable ids；
- fork filtering；
- unknown event presentation。

---

## T2.2 Root TeamSession projection

实现 fold：

```text
RootSessionLog
→ TeamSessionProjection
```

输出至少：

```text
bound?
snapshot
defaultWorkspace
PolicyState
readiness/compatibility
template overrides
instances
instance lifecycle
overrides
acknowledged warnings
```

必须 ignore：

```text
fork inherited Team events whose teamSessionId != current root id
```

---

## T2.3 Child Member binding projection

Child log 记录/fold：

```text
rootSessionId
instanceId
templateId
creation config
workspace
Blueprint hash/revision
```

提供 root-child integrity checker。

---

## T2.4 Persistence cross-backend tests

至少真实穿过项目支持的 persistence backends。

验证：

- event persisted；
- cold fold；
- root-child binding；
- unknown event；
- fork seed；
- malformed/mismatch fail closed。

### G2 Exit Criteria

- 一个纯构造 Root log 能 fold 出完整 TeamSession；
- 无 `ctx.team.definitions[]` 作为 authority；
- Root/child binding mismatch 有显式诊断；
- fork inherited old Team events不激活新 Team state。

---

# 6. Phase 3 — Team Host Backend & Compatibility Resolver

**目标**：建立 host-level Team subsystem，但暂不暴露最终 UI。

**Gate G3：Host 可创建/恢复 TeamSession domain state，并正确阻止 invalid admission**

---

## T3.1 TeamSessionRuntime service

职责：

- resolve root TeamSession；
- expose projection；
- apply durable Team commands；
- readiness gate；
- PolicyState；
- user/autonomy overrides；
- instance address validation。

禁止：

- own independent DB；
- mutate Blueprint source；
- own AgentPreset composition。

---

## T3.2 Capability probe registry / typed resolver

不是 arbitrary plugin registry；实现有限 typed probes：

```text
tools
skills
mcpServers
models/providers
persona/runtime-context
```

输出：

```text
satisfied
missing
unavailable
denied
diagnostic
owner/template
```

---

## T3.3 Compatibility resolver

输入：

```text
Blueprint snapshot
actual Root Agent/Host capabilities
current Team policy
```

输出：

```text
structuralErrors[]
warnings[]
warningKeys[]
```

测试：

- Blueprint contradiction；
- missing MCP；
- missing model route；
- persona complete/runtime-context mismatch；
- warnings dedupe；
- capability恢复。

---

## T3.4 Team admission gate

统一检查函数：

```text
assertTeamAdmissionAllowed(teamSession, operationKind)
```

覆盖：

```text
root prompt
member activation
delegate
member followup
resume member
```

已经在 flight 的任务不取消。

不要只在 Web UI disable。

---

## T3.5 Resolved Team policy engine

实现：

```text
Blueprint
MemberTemplate
PolicyState
Template Autonomy Overlay
Instance Autonomy Overlay
Explicit User Override
```

输出：

```text
effective policy + provenance
```

测试重点：

- User override 高于 PolicyState；
- autonomy overlay stored-but-suppressed；
- capability absent不可被 allow 创造；
- external hard deny不可越过；
- PolicyState round-trip 恢复 overlay。

### G3 Exit Criteria

- Host-only tests 可对一个 fake Root Session apply Team commands；
- compatibility gate 从 domain 层拒绝所有新 admission；
- policy provenance 可用于 UI；
- warning acknowledge durable。

---

# 7. Phase 4 — Persona Override & Root Team Creation Integration

**目标**：让 Root TeamSession 在第一次 model request 前完整 compose。

**Gate G4：Root Team happy path / warning path / preset-switch path 全部成立**

---

## T4.1 `dsh-persona` generic text override seam

**R：High / C：Low**

最小 generic API，概念：

```text
register/resolve agent-scoped persona text override
```

要求：

- no Team import；
- preserves complete/includeRuntimeContext；
- agent-scope cleanup；
- tests for normal persona + complete=true；
- no post-assemble hack。

---

## T4.2 TeamRootSetup

安装：

- TeamSession bind；
- Leader persona text；
- intrinsic Team leader surface；
- resolved Team guard；
- compatibility probes；
- projection registrations needed in agent scope。

必须在 first model request 前完成。

---

## T4.3 Host Team create route

扩展现有 session creation wire，支持 optional：

```text
teamBlueprintSelection
```

但 Team Intent first Send 必须 fresh-create。

输出：

```text
sessionId
agentPreset
team readiness
warnings
```

Structural Error：

- creation rollback / no healthy TeamSession。

Requirement Warning：

- publish TeamSession；
- AWAITING_ACK；
- first prompt retained/not admitted。

---

## T4.4 Blank Team preset switch

条件：

```text
no root turn
AND
no Member provisioning ever
```

实现：

- switch AgentPreset；
- TeamRoot overlay survives/reinstalls；
- rerun compatibility；
- Blueprint unchanged。

测试：

- switch fixes warning；
- failed preset mount restores old；
- member provisioning之后拒绝 switch。

---

## T4.5 Team-bound blank reuse fence

修改 New Session reuse eligibility：

```text
team-session/bound
→ never ordinary reusable blank
```

Team Intent：

```text
never adopt preexisting blank
```

### G4 Exit Criteria

E2E Host tests：

1. Team happy path；
2. warning → ack → first prompt；
3. warning → switch preset → warning clears；
4. structural error rollback；
5. bound blank appears durable/reopenable；
6. ordinary New Session不能 hijack Team blank；
7. Team Intent不会 convert ordinary blank；
8. first root turn locks preset；
9. first member provisioning also locks preset（可在后续 activation 接好后补完整 test）。

---

# 8. Phase 5 — ActivationProvider & Member Provisioning

**目标**：完成 Template→N persistent MemberInstances。

**Gate G5：Member create/recovery/addressing/lifecycle durable**

---

## T5.1 TeamActivationProvider service

唯一实例创建入口：

```text
activate(request)
```

Request：

```text
teamSessionId/rootSessionId
templateId
label?
groupId?
workspace override?
model override?
activation prompt
attached context
source: leader|user|future-router|automation
idempotency key
```

负责：

- readiness gate；
- template resolve；
- quota；
- effective config；
- capability check；
- stable instanceId；
- provisioning transaction；
- child start；
- root final commit。

---

## T5.2 Continuable child Team setup

复用当前官方：

```text
subagents.registerContinuableSetup(...)
```

在 fresh/cold child 安装：

- Member binding；
- inherited Root AgentPreset composition；
- Member persona text；
- Team member tools；
- Team policy guard；
- model route support；
- context policy。

---

## T5.3 Provisioning recovery

显式实现：

```text
root provisioning / no child
child / no root final edge
duplicate retry
crash at each flush boundary
```

建议 fault-injection tests。

---

## T5.4 Instance-first addressing

所有 runtime control：

```text
(teamSession/rootSessionId, instanceId)
```

templateId 只用于：

- catalog；
- create；
- defaults；
- policy lookup。

groupId never identity。

---

## T5.5 Quotas

实现：

```text
team maxConcurrent
team maxTotal
per-template maxConcurrent
per-template maxTotal
```

错误必须 typed、可 UI 展示。

### G5 Exit Criteria

- 一个 Template 同时创建多个实例；
- instanceId 不依赖 label；
- cold resume；
- crash recovery；
- quota；
- no duplicate member on retry；
- root/child log integrity；
- old one-member-per-template limitation gone。

---

# 9. Phase 6 — Member Model Mutation & Runtime Overrides

**目标**：完成已冻结的 turn-mutable model / runtime policy。

**Gate G6：Member 可安全动态改模型和权限，而不绕过 subagent ownership**

---

## T6.1 Team-owned Member model control

实现专用 Host/Team command：

```text
updateMemberModel(instanceId, provider, model, effort?)
```

要求：

- validate TeamSession/root authority；
- validate instance belongs to root；
- validate LLM route；
- durable Team user/autonomy override；
- next request boundary生效；
- in-flight request不改变；
- addressed generic session API仍继续拒绝 child control。

---

## T6.2 Template-local Session defaults

Data/Host commands：

```text
updateTemplateSessionDefaults(templateId, patch)
```

只影响未来 instances。

---

## T6.3 Instance user/autonomy overrides

分别 durable：

```text
User Override
Autonomy Overlay
```

不能混成一个 source。

---

## T6.4 Effective config/provenance query

为 UI 提供：

```text
value
source
suppressed?
unavailable?
deniedBy?
```

不要让 client 复算 policy。

### G6 Exit Criteria

- RUNNING member 改模型，当前 step 不变，下一 turn 使用新 route；
- PolicyState suppress autonomy overlay；
- user override不被 suppress；
- reset override；
- template default只影响 new instances；
- generic subagent model API ownership fence仍绿。

---

# 10. Phase 7 — Lifecycle, Control, Archive/Restore/Dispose

**目标**：让 runtime lifecycle 与真实 child activity 一致。

**Gate G7：不存在“UI ARCHIVED 但 agent 仍在跑”**

---

## T7.1 Lifecycle command service

实现：

```text
resume instance
archive instance
restore instance
dispose instance
```

状态机验证集中，不散落 tools/UI。

---

## T7.2 Quiesce pipeline

Archive/Dispose RUNNING：

```text
close Team admission for instance
interrupt current turn
drain descendant activations
wait/observe settlement boundary
release resident member activation
append lifecycle transition
```

定义 timeout/diagnostic policy，但禁止 lifecycle event 先于实际 quiesce 完成。

---

## T7.3 Restore

ARCHIVED：

```text
restore same instanceId / childSession
```

不创建新 context clone。

---

## T7.4 Team channels/control instance-addressing

重构 `team-channels`：

- control request → instanceId；
- leader authority；
- pending decision；
- durable coordination event；
- cold recovery。

### G7 Exit Criteria

- RUNNING Archive test；
- RUNNING Dispose test；
- descendants drain；
- Restore same instance；
- DISPOSED cannot resume；
- transcript retained；
- control request survives reconnect/cold projection。

---

# 11. Phase 8 — Fork, Resume, Handoff

**目标**：完成复杂 session lifecycle compatibility。

**Gate G8：Root/Member fork、cold resume、Start Team from Here 语义精确**

---

## T8.1 Root Team resume

恢复：

- AgentPreset via DSH；
- Blueprint snapshot via Root log；
- TeamRootSetup；
- Team projection；
- compatibility rerun；
- resident member reconciliation。

---

## T8.2 Root Team fork

修改 Host fork path：

```text
if source root has current TeamSession:
  create ordinary fork seed
  plus new TeamRootSetup
  plus new team-session/bound(newRootId, same snapshot)
```

新 Team：

```text
MemberInstances = empty
```

旧 copied Team events因 old teamSessionId 被 projection 忽略。

---

## T8.3 Member Session fork

确保 addressed Member fork 继续生成：

```text
ordinary independent AgentSession
```

不自动 Team-bind。

---

## T8.4 TeamHandoffSummarizer

Host service：

```text
summarize(sourceSessionSurface)
```

读取 canonical current surface；不 mutate source。

配置独立 summarization route。

---

## T8.5 Start Team from Here materialization

流程：

```text
source A
↓
freeze/read surface
↓
summarize
↓
fresh create Team B
↓
persist sourced handoff context
↓
compatibility
↓
first prompt
```

失败选项：

```text
Retry
Continue without handoff
Cancel
```

### G8 Exit Criteria

- cold resume same Blueprint snapshot；
- changed current Blueprint file不影响 old Session；
- changed ordinary environment触发新 warning；
- Root fork new Team empty roster；
- Member fork ordinary Agent；
- handoff does not modify source；
- handoff replay reconstructable；
- handoff summary failure不 silent continue。

---

# 12. Phase 9 — Team Durable Event Presentation in Chat & Trajectory

**目标**：满足完整历史与第一视角重建。

**Gate G9：每个 durable Team event 都有可观察 Node**

---

## T9.1 Generic Team Ledger Chat Definition

Matcher 覆盖：

```text
team-session/*
team-instance/*
```

按 event seq 形成独立 Context/Node。

Known events：

- specialized title/detail。

Unknown：

- generic fallback。

默认折叠。

---

## T9.2 Trajectory Team Definition

同 event family，target = trajectory。

显示：

- type；
- seq；
- location；
- timestamp；
- instance/template；
- payload/detail；
- correlation。

不要读取 Chat final nodes。

---

## T9.3 Pagination/prepend tests

验证：

- historical page prepend；
- unknown Team event；
- event location around turns/steps；
- event before first turn；
- fork inherited events仍可历史查看但不成为 current Team state。

### G9 Exit Criteria

\[
1 durable Team event
\rightarrow
1 Chat node
\land
1 Trajectory-observable record
\]

对当前 Session 实际所属事件成立。

第一版无 aggregation。

---

# 13. Phase 10 — Team UI vNext

**目标**：在保留现有 UI 骨架的前提下接入新对象/控制面。

**Gate G10：完整用户主路径可 Web 操作**

可并行拆多个前端任务。

---

## T10.1 New Session Agent/Team mode

**R：Medium / C：High**

- Agent/Team toggle；
- Blueprint picker；
- AgentPreset secondary；
- Team Intent state；
- first Send fresh materialization；
- pending prompt retention；
- Blueprint revision race UI。

---

## T10.2 Compatibility UI

- creation warning；
- AWAITING_ACK；
- Sidebar provisional title；
- Header badge；
- Change AgentPreset；
- Change model/config；
- Continue Anyway；
- degraded acknowledged list；
- gate blocker。

---

## T10.3 Team Header + Dock

Header：

- Blueprint/revision；
- PolicyState；
- compatibility；
- current perspective；
- counts。

Dock：

- compact status only；
- Open Team。

---

## T10.4 Timeline upgrade

保留现有 interaction，换对象模型：

```text
Template
  → Instance sublane
  → multiple RUNNING intervals
```

Archive/Dispose history retained。

---

## T10.5 Members & contextual detail

- Template group；
- multi-instance；
- create；
- archived disclosure；
- current perspective；
- contextual detail；
- Open Session；
- lifecycle actions。

---

## T10.6 Effective config + provenance / override editor

- read-effective-first；
- source labels；
- suppressed autonomy overlay；
- unavailable vs denied；
- configure；
- reset；
- Member model selector。

---

## T10.7 Activity / Progress

旧 Task Board 改语义，不引入 Workflow authority。

---

## T10.8 Events

Root Team ledger：

- chronological；
- filters；
- related Session navigation；
- generic unknown events。

---

## T10.9 Member Session shared Team view

Member Session：

```text
Chat / Trajectory / Team
```

Team view显示同一 TeamSession并高亮 current instance。

---

## T10.10 Ordinary Session Team zero-state + Start Team from Here

- zero-state；
- handoff flow；
- source marker；
- failure choices。

### G10 Exit Criteria

Playwright/component scenarios：

1. create Team happy path；
2. warning + repair；
3. warning + continue；
4. multi-instance；
5. dynamic member model；
6. PolicyState suppress；
7. archive/restore/dispose；
8. member navigation；
9. timeline multi-run；
10. root/member Chat/Trajectory Team events；
11. Start Team from Here handoff；
12. reconnect/cold UI projection。

---

# 14. Phase 11 — Legacy Migration & Old Runtime Removal

**目标**：删除造成 roster drift 的旧权威路径。

**Gate G11：新 Team runtime 不再依赖旧 mutable roster**

---

## T11.1 `.dsh/teammates` legacy adapter 完成

创建 Team Intent 时可选择 Legacy Blueprint。

只 snapshot 一次。

---

## T11.2 Role AgentPreset migration

提供文档/可选迁移 helper：

```text
aiued-team role persona
→ Blueprint LeaderTemplate

old teammate definitions
→ MemberTemplates

ordinary agent composition
→ generic `team`/custom AgentPreset
```

---

## T11.3 删除/封存旧 TeamRegistry live state

删除：

- `ctx.team` current mutable definitions；
- `team-local` watcher as runtime authority；
- cwd mutation reload；
- home silent fallback；
- stale-empty semantics。

若旧 API 仍有 compatibility consumers：

```text
read-only adapter
```

只允许从 current TeamSession projection 映射，不建立第二 authority。

---

## T11.4 Generic `team` AgentPreset 清理

移除其中 Team Runtime-essential rows。

保留普通 Team-friendly composition。

### G11 Exit Criteria

- roster drift incident regression test；
- 两个 Session 同 Workspace/不同 Blueprint 不互相污染；
- 两个 Workspace 同 Blueprint 独立；
- legacy loads snapshot once；
- no watcher mutations；
- grep 无 mutable current TeamRegistry production dependency。

---

# 15. Phase 12 — Hardening, Performance, Documentation

**Gate G12：Release Candidate**

---

## T12.1 Recovery matrix

自动测试矩阵：

```text
crash before/after each provisioning flush
cold root / cold child
provider unavailable
MCP disappears
AgentPreset source changed
model route disappears
connection reset
projection page prepend
```

---

## T12.2 Concurrency/race

至少：

- simultaneous instance activation；
- same idempotency key；
- quota race；
- model override while running；
- PolicyState + user override race；
- archive while followup queued；
- compatibility warning appears during work；
- catalog revision changes during Team Intent；
- reconnect stale response generation。

---

## T12.3 Performance

重点不是先优化，而是确保无明显退化：

- Team Runtime dormant cost；
- 100+ durable Team event Chat/Trajectory；
- Timeline 10–50 instances；
- projection append complexity；
- no O(all child logs) Team refresh；
- no watcher leak；
- agent/resource release。

---

## T12.4 Documentation

更新：

- architecture；
- compatibility；
- UI；
- config catalog；
- tool docs；
- migration；
- README；
- examples。

文档必须删除旧：

```text
Team = AgentPreset
one member id = one persistent instance
TeamRegistry current roster
```

心智模型。

---

# 16. Gate 汇总

| Gate | 必须证明 |
|---|---|
| G0 | 当前 DSH seam 与旧 Team behavior 被 characterization |
| G1 | Blueprint/catalog/schema 完整 |
| G2 | Root log 可独立 fold TeamSession |
| G3 | Host runtime/compatibility/policy 成立 |
| G4 | Root Team create/warning/preset-switch 正确 |
| G5 | Template→N Member provisioning/recovery 正确 |
| G6 | dynamic model/overrides 不绕过 ownership |
| G7 | lifecycle 与真实 child activity 一致 |
| G8 | resume/fork/handoff 正确 |
| G9 | Chat/Trajectory 完整重建 Team events |
| G10 | Web 主路径完整 |
| G11 | 旧 mutable roster authority 删除 |
| G12 | recovery/race/performance/doc release-ready |

任何 Gate 未通过，不进入下一个涉及其语义的 Phase。

UI 中不依赖某 Gate 的纯 presentation 子任务可提前做 mock，但不得 merge 为 production path。

---

# 17. 推荐并行任务拓扑

```text
Phase 0
  ↓
Phase 1 ─────────────┐
  ↓                  │
Phase 2              │
  ↓                  │
Phase 3              │
  ↓                  │
Phase 4              │
  ↓                  │
Phase 5              │
  ├──── Phase 6      │
  ├──── Phase 7      │
  └──── Phase 9      │
         │           │
Phase 8 ─┤           │
         ↓           │
      Phase 10 ◄─────┘
         ↓
      Phase 11
         ↓
      Phase 12
```

可并行：

- G5 后：model override / lifecycle / Team event presentation；
- UI component skeleton 可在 Host contract frozen 后并行；
- legacy removal 必须晚于主 runtime/UI replacement。

---

# 18. 建议子代理任务包

以下适合作为独立 subagent work packages。

## WP-A：Blueprint Domain

包含 T1.1–T1.3。  
**R High / C Medium**

Prompt重点：

- no runtime；
- pure deterministic types；
- exhaustive validation；
- tests first。

---

## WP-B：Durable Events + Projection

T2.1–T2.4。  
**R Very High / C High**

必须高级模型。

输出：

- schema；
- fold；
- persistence tests；
- fork filtering；
- child binding integrity。

---

## WP-C：Compatibility/Policy Engine

T3.2–T3.5。  
**R Very High / C High**

禁止与 UI 混做。

---

## WP-D：Persona + Root Setup

T4.1–T4.4。  
**R High / C High**

重点避免复制 persona implementation。

---

## WP-E：Activation/Provisioning

T5.1–T5.5。  
**R Very High / C Very High**

这是 vNext 风险最高任务包之一。

必须包含 fault injection。

---

## WP-F：Member Runtime Mutation

Phase 6。  
**R Very High / C High**

重点：

- subagent ownership；
- next request model selection；
- provenance。

---

## WP-G：Lifecycle/Control

Phase 7。  
**R High / C High**

重点 quiesce/drain。

---

## WP-H：Fork/Resume/Handoff

Phase 8。  
**R Very High / C High**

三个能力可以拆：

- H1 resume；
- H2 fork；
- H3 handoff。

---

## WP-I：Conversation/Trajectory Team Ledger

Phase 9。  
**R Medium / C High**

使用 target-specific Conversation Definitions。

---

## WP-J：New Session + Compatibility UI

T10.1–T10.3。  
**R High / C High**

必须等 Host wire contract 稳定。

---

## WP-K：Team Tab Runtime UI

T10.4–T10.9。  
可再拆：

- Timeline；
- Members/detail；
- override；
- events/activity。

**R Medium / C High**

---

## WP-L：Legacy Removal

Phase 11。  
**R Medium / C Medium**

必须最后做，不允许提前删 safety net。

---

# 19. 每个任务的标准交付模板

本地 agent 完成任何 Task 时必须报告：

```markdown
## Task <ID>

### Changed
- files...
- APIs...

### Preserved invariants
- ...

### Tests
- unit
- integration
- e2e

### Failure / race cases covered
- ...

### Known limitations
- ...

### Gate evidence
- why this task satisfies its gate criteria

### No-scope-creep check
- confirms no frozen semantic changed
```

若发现架构冲突：

```markdown
### BLOCKED — semantic conflict

Observed:
...

Evidence:
path / test / API

Frozen rule affected:
...

Minimal options:
A...
B...

No implementation beyond this boundary was merged.
```

---

# 20. 强制测试场景清单

发布前至少覆盖以下端到端语义。

## Creation

- standard + Blueprint；
- minimal + Blueprint warning；
- Change AgentPreset before first turn；
- Team Intent fresh-create；
- Team bound blank not reused；
- structural failure rollback。

## Compatibility

- warnings all collected；
- Continue Anyway durable；
- new mismatch after resume；
- gate blocks root/member/new activation；
- in-flight work not cancelled。

## Instances

- same Template N instances；
- duplicate labels allowed；
- opaque id addressing；
- quotas；
- groupId no identity semantics。

## Overrides

- User > PolicyState；
- autonomy overlay suppressed/restored；
- external hard deny；
- missing capability remains unavailable；
- Template defaults future-only。

## Models

- member creation model；
- member next-turn route change；
- invalid route rejection；
- current in-flight request unchanged；
- cold resume retains consumed/logged route semantics。

## Lifecycle

- settle/resume；
- archive running；
- restore；
- dispose running；
- descendants drained；
- disposed history retained。

## Persistence

- JSONL/SQLite or all supported stores；
- root-child mismatch；
- crash provisioning；
- cold root/member；
- idempotent retry。

## Fork

- root Team fork same snapshot/empty roster；
- inherited old Team events ignored as current state；
- member fork ordinary Agent。

## Handoff

- source canonical surface；
- summary persisted；
- source unmodified；
- failure explicit；
- no live recall in target。

## UI/history

- every Team event Chat disclosure；
- every Team event Trajectory record；
- unknown event fallback；
- Timeline multiple run intervals；
- member Session shared Team view；
- AWAITING_ACK Sidebar recovery；
- reconnect races。

---

# 21. 代码审查检查表

Reviewer 对每个 Phase 重点问：

### Authority
- 是否产生了第二真源？
- 是否又出现 mutable current roster？

### Scope
- Host service 是否错误塞入 AgentPreset？
- Agent registration 是否泄漏到其他 Session？

### Durability
- 用户可观察状态是否只有内存版本？
- cold resume 是否与 live path 同义？

### Ownership
- 是否绕过 subagent direct-parent authority？
- Team model control 是否走专用 authorized path？

### Policy
- 是否把 User Override 与 autonomy overlay 混淆？
- 是否错误堆叠 monotonic restriction？

### History
- Team durable event 是否可 Chat/Trajectory 观察？
- unknown event 是否被丢弃？

### Failure
- 是否 silent fallback？
- partial provisioning 是否可 recovery？
- UI stale response 是否覆盖新状态？

---

# 22. 失败时禁止的“快捷修复”

禁止：

1. 恢复 `Team = agentPreset=team`；
2. 在 Blueprint 里塞 Cordis plugin config；
3. 为了动态 member model 直接开放 generic child `session.selectModel`；
4. compatibility 只在 UI disable；
5. Root/child state mismatch 时猜一个继续；
6. handoff 失败静默无上下文继续；
7. 为了 fork 简单把所有旧 Team events 当新 Team state；
8. PolicyState 切换删除 User Override；
9. Archive 只改 state 不停 agent；
10. 为了过测试删除 unknown Team events；
11. 先删除 legacy runtime 再补 replacement；
12. 增加 core-wide hook，除非现有 setup seam有已证实不可解决的问题。

---

# 23. Definition of Done

vNext 完成不是“UI 能看到多个 teammate”。

必须同时满足：

```text
Reusable immutable Team Blueprint
+
Root session-bound TeamSession
+
Template → N persistent MemberInstances
+
instance-first addressing
+
durable event-sourced Team state
+
crash-safe provisioning
+
cold resume
+
dynamic model/runtime override
+
correct policy precedence
+
compatibility gate
+
archive/restore/dispose truthfulness
+
Root/Member fork semantics
+
one-shot Start Team handoff
+
Chat/Trajectory full Team event observability
+
Team Tab vNext control plane
+
legacy roster drift authority removed
```

任何一项缺失，不应宣布 vNext architecture complete。

---

# 24. 最终执行顺序建议

本地主 agent 应按：

```text
1. G0 baseline
2. G1 Blueprint
3. G2 durable projection
4. G3 Host policy/compat
5. G4 Root composition
6. G5 Member activation
7. 并行 G6/G7/G9
8. G8 resume/fork/handoff
9. G10 UI integration
10. G11 legacy cutover
11. G12 hardening
```

每过一个 Gate，先做一次 architecture reviewer pass，再进入下一阶段。

不要在第一次实现中同时追求 future Router、Workflow、Workstream 或 worktree 自动管理。
