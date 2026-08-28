# DSH Agent Team vNext：无人值守集成、回退、开发与合并执行规格

**文档状态**：Authoritative Unattended Execution Specification  
**适用仓库**：`ArmourPiercer1/deepseek-harness`  
**稳定分支**：`feat/agent-teams`  
**工作目录**：`D:\AgentDev\deepseek-harness`  
**日期**：2026-08-29  
**用途**：交给本地总控 agent，以无人值守长任务方式执行。  

---

# 0. 本规格的权威性与使用方式

本规格用于纠正此前开发计划中“只审计 upstream、未要求把 upstream 真正合入工作分支”的缺陷。它覆盖：

1. 回退已经被中止的本地开发工作；
2. 从稳定分支建立隔离的新开发分支；
3. 拉取并合并最新官方 `upstream/master`；
4. 语义化解决合并冲突；
5. 在**合并后的真实代码基线**上重新建立实现基线；
6. 执行 Team vNext Phase 1–12 开发与测试；
7. 在受控 Gate 处重新检查 upstream drift；
8. 满足最终 PR Gate 后，才允许向 `feat/agent-teams` 提 PR；
9. PR CI 全绿、基线未漂移后，才允许 merge 到 `feat/agent-teams`。

本规格与以下冻结设计共同构成开发约束：

- `docs/active-plans/DSH_Agent_Team_vNext_Architecture_Baseline_20260827.md`
- `docs/active-plans/DSH_Agent_Team_vNext_Compatibility_Design_20260828.md`
- `docs/active-plans/DSH_Agent_Team_vNext_UI_Interaction_Design_20260828.md`

旧的：

- `docs/active-plans/DSH_Agent_Team_vNext_Development_Plan_20260828.md`

仍作为 Phase 1–12 的任务语义来源，但其原 Phase 0 被本规格的 **R0 / S0 / C0** 完整替代；若旧计划与本规格的 Git、upstream、Gate、回退、PR 规则冲突，以本规格为准。

## 0.1 语义冲突时的优先级

```text
Architecture Baseline
    >
Compatibility Design
    >
UI / Interaction Design
    >
本 Unattended Execution Specification
    >
旧 Development Plan
    >
局部实现便利
```

如果实现证据显示必须改变前三份冻结设计中的用户可观察语义：

> **STOP / FAIL CLOSED**。不得由无人值守 agent 自行修改需求后继续。

---

# 1. 已审计的当前代码状态

以下为生成本规格时从 GitHub 读取并确认的远端事实。

## 1.1 稳定分支远端 HEAD

```text
repository: ArmourPiercer1/deepseek-harness
branch:     feat/agent-teams
HEAD:       506191ba893ac55980dd09680c438710ab24095b
parent:     91775d879bcf94ee58bd3707caf843a8698b6779
```

`506191ba...` 的提交主题：

```text
docs(team-vnext): vNext plan set, unattended session router, lockfile baseline fix
```

相对父提交 `91775d...`，该 commit 主要增加/修改：

- `.gitattributes`
- 四份 Team vNext active-plan 文档
- `SESSION_ROUTER.md`
- `SESSION_ROUTER_LOG.md`
- `pnpm-lock.yaml`

**远端没有发现 `506191ba...` 之后的 vNext 正式代码提交。**

因此本规格把：

```text
origin/feat/agent-teams@506191ba893ac55980dd09680c438710ab24095b
```

定义为本次回退的**远端稳定锚点**。

## 1.2 官方 upstream 当前审计点

```text
repository: deepseek-ai/deepseek-harness
branch:     master
observed:   cd5ef8148158c3a752a658978873241fdf8e2bbc
release:    dsh@0.1.2-alpha.1 merge
```

**执行时不得硬编码只合并这个 SHA。** 本 SHA 只是审计参考。真正执行必须：

```text
git fetch upstream --prune --tags
UPSTREAM_HEAD = git rev-parse upstream/master
```

并冻结执行当时实际读取到的 `UPSTREAM_HEAD`。

## 1.3 当前分支相对 upstream 的漂移规模

远端审计结果：

```text
merge base: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
feat/agent-teams ahead of merge base: 36 commits
feat/agent-teams behind upstream master: 1079 commits
```

这意味着本任务不是普通的小规模 sync；必须把 upstream integration 当作独立工程阶段。

## 1.4 已确认 upstream 漂移涉及 Team vNext 的关键 seam

上游漂移已覆盖或修改了以下与 vNext 直接相关的区域：

- per-session AgentPreset composition；
- Session create / blank / fork / resume；
- model selection / provider-model-effort route；
- continuable subagent、ownership fence、child route selection；
- Conversation Node Assembler；
- Trajectory target-specific definitions；
- packed/session history transport；
- experimental Agent Teams；
- Host / API proxy / remote 迁移；
- Web client package/slot/runtime 结构；
- CI gate 与文档 gate。

因此：

> **所有 vNext 正式代码开发必须发生在 upstream merge 完成且 G-SYNC 通过之后。**

---

# 2. 运行实例安全边界——不可违反

本机存在两个独立 DSH 实例。

## 2.1 稳定实例——绝对禁止写入

```text
source:    D:\deepseek-harness
DSH_HOME:  C:\Users\user\.dsh
port:      3080
```

无人值守任务不得：

- 在 `D:\deepseek-harness` 执行 git 写操作；
- 在该目录运行 `pnpm install`；
- 修改 `.dsh` 中的 preset/session/settings；
- kill 3080 对应稳定进程；
- 清理稳定实例 node_modules；
- 将开发分支 checkout 到该目录。

## 2.2 开发实例——唯一允许工作位置

```text
source:    D:\AgentDev\deepseek-harness
DSH_HOME:  C:\Users\user\.dsh-dev
port:      3180
```

所有 git / build / unit / integration / GUI 开发均发生在：

```text
D:\AgentDev\deepseek-harness
```

对于自动化 smoke/test，优先使用测试框架自己的临时 Session store / DSH_HOME；不要为了测试污染真实用户的 `.dsh-dev` 会话历史。

## 2.3 起始环境硬检查

总控 agent 第一条写操作之前必须验证：

```powershell
$Repo = 'D:\AgentDev\deepseek-harness'
Set-Location $Repo

if ((Get-Location).Path -ne $Repo) { throw 'WRONG_REPOSITORY_PATH' }
if ((Get-Location).Path -eq 'D:\deepseek-harness') { throw 'STABLE_INSTANCE_FORBIDDEN' }

git rev-parse --show-toplevel
node --version
pnpm --version
```

并确认：

```text
Node: ^22.19.0 or >=24
pnpm: repository packageManager compatible
```

---

# 3. 无人值守总状态机

整个任务只能沿下面状态前进：

```text
R0  Interrupted-work forensic + rollback
 ↓
S0  Upstream integration branch + merge
 ↓
G-SYNC  merged repository baseline valid
 ↓
C0  Post-merge characterization / seam inventory
 ↓
G0
 ↓
P1 Blueprint Domain
 ↓ G1
P2 Durable Events/Projection
 ↓ G2
P3 Host Runtime/Compatibility/Policy
 ↓ G3
P4 Root Team Composition/Create
 ↓ G4
UPSTREAM DRIFT CHECKPOINT A
 ↓
P5 Member Activation/Provisioning
 ↓ G5
├─ P6 Member Runtime Mutation
├─ P7 Lifecycle/Control
└─ P9 Chat/Trajectory Ledger
 ↓ respective Gates
P8 Resume/Fork/Handoff
 ↓ G8
UPSTREAM DRIFT CHECKPOINT B
 ↓
P10 Web UI
 ↓ G10
P11 Legacy Cutover
 ↓ G11
P12 Hardening
 ↓ G12
FINAL UPSTREAM + STABLE DRIFT CHECK
 ↓
PR-GATE
 ↓
Open PR -> feat/agent-teams
 ↓
PR CI / review gate
 ↓
Merge commit into feat/agent-teams
```

任何 Gate 失败：

```text
STOP current forward progress
fix only within current Gate scope
rerun failed/relevant gates
```

不得“先继续后面 Phase，最后一起修”。

---

# 4. Phase R0 — 回退被中止的刚刚开发内容

## 4.1 目标

把当前本地开发目录恢复到：

```text
origin/feat/agent-teams
```

对应的远端稳定状态，同时：

- 不丢失中止工作证据；
- 不把中止工作混进新分支；
- 不回退已经存在于远端稳定分支的 `506191ba...` 文档提交；
- 不自动 cherry-pick 被中止的代码。

## 4.2 重要限制

ChatGPT 能审计 GitHub 远端，但无法看到此刻本地 worktree 的未提交内容。因此 R0 的本地取证不是可选动作，而是必要前置。

## 4.3 Step R0.1 — fetch origin，验证稳定锚点未被别人移动

```powershell
Set-Location 'D:\AgentDev\deepseek-harness'

git remote -v
git fetch origin --prune

$ExpectedStable = '506191ba893ac55980dd09680c438710ab24095b'
$ActualStable = (git rev-parse 'origin/feat/agent-teams').Trim()

if ($ActualStable -ne $ExpectedStable) {
    throw "STABLE_BRANCH_MOVED: expected=$ExpectedStable actual=$ActualStable"
}
```

### FAIL CLOSED

如果 `origin/feat/agent-teams` 不再是 `506191ba...`：

> **立即停止整个无人值守任务。** 不允许自动推断新 HEAD 是否“应该也算稳定”。

## 4.4 Step R0.2 — 记录本地状态

创建 repo 外的 recovery 目录：

```powershell
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Recovery = "D:\AgentDev\team-vnext-recovery\$Stamp"
New-Item -ItemType Directory -Force $Recovery | Out-Null
```

输出：

```powershell
git status --porcelain=v2 --branch | Out-File "$Recovery\status.txt" -Encoding utf8
git log --graph --decorate --oneline --all -n 100 | Out-File "$Recovery\log.txt" -Encoding utf8
git reflog -n 100 | Out-File "$Recovery\reflog.txt" -Encoding utf8
git diff --binary | Out-File "$Recovery\working-tree.patch" -Encoding utf8
git diff --cached --binary | Out-File "$Recovery\index.patch" -Encoding utf8
git ls-files --others --exclude-standard | Out-File "$Recovery\untracked.txt" -Encoding utf8
```

记录：

```powershell
$LocalHead = (git rev-parse HEAD).Trim()
$LocalBranch = (git branch --show-current).Trim()
"branch=$LocalBranch`nhead=$LocalHead`nstable=$ActualStable" |
    Out-File "$Recovery\identity.txt" -Encoding utf8
```

## 4.5 Step R0.3 — 建立 rescue ref

无论当前 HEAD 是否已经产生本地 commit，都创建 rescue branch：

```powershell
$RescueBranch = "rescue/team-vnext-interrupted-$Stamp"
git branch $RescueBranch HEAD
```

如果存在 dirty/untracked：

```powershell
$Dirty = git status --porcelain
if ($Dirty) {
    git stash push --include-untracked -m "team-vnext interrupted rescue $Stamp"
    git stash list | Out-File "$Recovery\stash-list.txt" -Encoding utf8
}
```

### 规则

- Rescue branch/stash **仅用于事故恢复和审计**；
- 后续 agent 不得自动 cherry-pick；
- 不得用 rescue 内容“补回一些看起来有用的代码”；
- 如后续确实要 salvage，必须在 merged-upstream baseline 上重新审查并重新实现/手工移植。

## 4.6 Step R0.4 — 恢复稳定分支

```powershell
git switch feat/agent-teams
git reset --hard origin/feat/agent-teams
git clean -fd
```

禁止：

```text
git clean -fdx
```

避免误删 ignored 的大体积环境/缓存/本地安全文件。

## 4.7 Step R0.5 — R0 验收

必须全部成立：

```powershell
if ((git rev-parse HEAD).Trim() -ne $ExpectedStable) { throw 'R0_HEAD_MISMATCH' }
if (git status --porcelain) { throw 'R0_WORKTREE_NOT_CLEAN' }
```

并记录：

```text
R0 PASS
stable = 506191ba...
rescue branch = ...
recovery directory = ...
```

---

# 5. Phase S0 — 创建隔离开发分支并真正合并 upstream

## 5.1 分支策略

稳定分支：

```text
feat/agent-teams
```

整个无人值守任务的主工作分支：

```text
feat/team-vnext-integration-20260829
```

禁止直接在 `feat/agent-teams` 上开发。

## 5.2 Step S0.1 — 从稳定 SHA 新建分支

```powershell
git switch -c feat/team-vnext-integration-20260829 `
    506191ba893ac55980dd09680c438710ab24095b

git push -u origin feat/team-vnext-integration-20260829
```

新分支 push 后，`feat/agent-teams` 保持不动。

## 5.3 Step S0.2 — 配置并验证 upstream remote

```powershell
$UpstreamUrl = 'https://github.com/deepseek-ai/deepseek-harness.git'

$Existing = git remote get-url upstream 2>$null
if (-not $Existing) {
    git remote add upstream $UpstreamUrl
} elseif ($Existing.Trim() -ne $UpstreamUrl) {
    throw "UPSTREAM_REMOTE_MISMATCH: $Existing"
}

git fetch upstream --prune --tags
```

冻结本轮上游：

```powershell
$UpstreamHead = (git rev-parse upstream/master).Trim()
$MergeBase = (git merge-base HEAD upstream/master).Trim()
$Divergence = git rev-list --left-right --count HEAD...upstream/master

"upstream=$UpstreamHead`nmergeBase=$MergeBase`ndivergence=$Divergence" |
    Out-File "$Recovery\upstream-baseline.txt" -Encoding utf8
```

当前审计参考值应大致看到：

```text
merge base around b150a551...
Team side ~36 commits
upstream side ~1079 commits
```

执行时以实时输出为准。

## 5.4 Step S0.3 — 合并前冲突预览

先不改 worktree：

```powershell
$Base = (git merge-base HEAD upstream/master).Trim()
git merge-tree $Base HEAD upstream/master |
    Out-File "$Recovery\merge-tree-preview.txt" -Encoding utf8
```

生成 high-risk 路径清单，至少检查：

```text
packages/preset/agent-presets/**
packages/api/session-controller/**
packages/host/**
packages/subagent/**
packages/core/agent/**
packages/core/session/**
packages/context/persona/** or current persona owner
packages/client/runtime/**
packages/client/ui-conversation/**
packages/client/ui-trajectory/**
packages/client/ui-agent-preset/**
packages/client/ui-model-selection/**
packages/client/ui-workspace/**
packages/experimental/agent-team/**
packages/team/**
apps/cli/**
apps/web/**
package.json
pnpm-lock.yaml
tsconfig*.json
scripts/run-gates.ts
.agents/notes/**
docs/**
```

## 5.5 Step S0.4 — 真实 merge，但先不提交

```powershell
git merge --no-ff --no-commit upstream/master
```

如果无冲突，也不要立即 commit；先执行下面的 semantic verification。

---

# 6. Upstream merge 冲突解决规则——必须机械遵守

禁止 whole-repository：

```text
ours wins
或
theirs wins
```

禁止对关键目录使用：

```text
git checkout --ours packages/host
git checkout --theirs packages/subagent
```

## 6.1 分类 A：DSH core / Host / Session / Subagent / Client Runtime

典型路径：

```text
packages/core/**
packages/api/**
packages/host/**
packages/subagent/**
packages/preset/**
packages/client/runtime/**
```

### 规则

**upstream 当前语义是底座。**

步骤：

1. 先理解 upstream 当前文件/测试/Agent Note 的 owner contract；
2. 保留 upstream 新 API、生命周期、ownership、持久化、类型；
3. 再把 Team 分支真正仍需要的最小 Team delta 重放到新 seam；
4. 若 Team delta 的旧实现已被 upstream 新 primitive 替代，删除旧 delta，而不是强行保留；
5. 不得恢复旧 standing AgentPreset / shared mutable roster 架构。

### 特别关注

- per-Agent AgentPreset mount；
- `CreateAgentOptions.setup`；
- subagent direct-parent ownership；
- child AgentOptions/model route；
- Session model selection；
- fork/resume；
- packed history；
- Conversation assembler；
- client Session ownership。

## 6.2 分类 B：Team 自有包

典型：

```text
packages/team/**
packages/client/ui-team/**
packages/bundle/team/**
examples/team-agent/**
```

### 规则

保留当前 Team 用户价值，但适配 upstream seam：

```text
persistent continuable child
control / progress
Timeline
Team Tab
per-event markers
session navigation
```

不要保护已知错误结构：

```text
mutable current TeamRegistry authority
one template = one instance
workspace-following shared roster
Team = AgentPreset
```

## 6.3 分类 C：Host / Web 上的 Team integration patch

典型：

```text
packages/host/apiproxy/**
packages/client/ui-workspace/**
packages/client/runtime/**
apps/web/**
```

### 规则

必须 semantic merge：

- 以 upstream 新 RPC/slot/object model 为准；
- 将 Team 功能挂到当前 owner seam；
- 不重新引入已被 upstream 删除的旧 gateway/interface；
- 不通过 DOM/私有 API 临时复制新的核心 contract，除非 UI baseline 已明确允许降级。

## 6.4 分类 D：package manifests / root package.json

### root `package.json`

优先保留 upstream：

- version；
- scripts；
- dependency upgrades；
- 新 gate；
- Node memory workaround；
- 新 expected/docs/i18n checks。

然后仅重新加入 Team 分支确实需要的 package/workspace dependency。

## 6.5 分类 E：`pnpm-lock.yaml`

不要手工拼锁文件冲突。

优先：

1. 根据最终 package manifests 解决；
2. 取 upstream lock 作为起点；
3. `pnpm install` 重新生成一致 lock；
4. 检查没有意外 dependency downgrade。

## 6.6 分类 F：generated catalogs / graphs / API artifacts

包括但不限于：

```text
config catalog
tool catalog
module graph
persistence catalog
client catalog
Cordis API/catalog
scoped events
```

### 规则

**不手工解决生成结果内容。**

保留 source-of-truth 代码后，运行 upstream 当前 generator，再提交生成结果。

## 6.7 分类 G：`.agents/notes/**` 与双语配对

upstream 在这 1079 commits 中对大量 Agent Notes 做了 archival/move/format 更新。

规则：

- upstream 已 archived 的旧 note 不得被 Team merge“搬回 implemented”；
- Team 自己新增且仍是 current authority 的 Team notes保留；
- 链接跟随 upstream 新位置；
- bilingual pairing 冲突使用仓库当前工具处理；
- 不为“少改几个冲突”编辑 archived note 内容。

必要时运行：

```powershell
pnpm run resolve-translation-pairing-conflicts
pnpm run verify-translation-pairing
```

## 6.8 分类 H：四份冻结 vNext active plans

以下必须保留：

```text
DSH_Agent_Team_vNext_Architecture_Baseline_20260827.md
DSH_Agent_Team_vNext_Compatibility_Design_20260828.md
DSH_Agent_Team_vNext_UI_Interaction_Design_20260828.md
本执行规格
```

如果 upstream 事实变化只影响“技术接线”，更新 implementation baseline，不改用户语义。

如果 upstream 新行为与冻结语义真正冲突：

> STOP，输出 semantic conflict 报告。

---

# 7. Merge resolve 完成后的静态清理

在 commit merge 之前执行：

```powershell
# 无冲突标记
$Markers = git grep -n -E '^(<<<<<<<|=======|>>>>>>>)' -- .
if ($Markers) { throw 'UNRESOLVED_CONFLICT_MARKERS' }

# whitespace
if (git diff --check) { throw 'DIFF_CHECK_FAILED' }

# 查看 merge 状态
git status
```

然后：

```powershell
pnpm install
pnpm run clean
```

如果 package generator / tsconfig generator 已变化，按 upstream 当前脚本生成后再继续。

---

# 8. Gate G-SYNC — 上游集成必须先证明没有破坏仓库

**任何 vNext 新 runtime/schema 代码都不能在 G-SYNC 前开始。**

## 8.1 第一层：编译和静态

```powershell
pnpm run typecheck
pnpm run lint
pnpm run build
```

## 8.2 第二层：Team 现有行为 targeted suite

合并后先发现真实 Team test/package 路径：

```powershell
Get-ChildItem packages\team -Recurse -Filter '*.spec.ts*'
Get-ChildItem packages\client\ui-team -Recurse -Filter '*.spec.ts*'
Get-ChildItem apps\cli\tests -Filter '*team*'
Get-ChildItem examples\team-agent\tests -Recurse -Filter '*.ts'
```

然后至少运行：

```text
packages/team/** tests
packages/client/ui-team/** tests
Team CLI tests
Team keyless/example snapshot tests
```

验收目标不是 vNext，而是：

- 当前 legacy Team 仍可创建 persistent child；
- control/progress 可用；
- Team projection 可重建；
- Timeline/markers/member navigation 不被 merge 破坏；
- 已知 roster drift bug 允许作为 known-bad fixture 存在，但不得引入新的 silent behavior。

## 8.3 第三层：Repo-wide local aggregate

由于这是 1079-commit upstream integration，属于明确允许跑全量本地 gate 的 repo-wide 变更：

```powershell
pnpm run check:all
```

当前 upstream `check:all` 至少覆盖：

- unit tests；
- snapshot；
- expected output；
- build；
- Web build；
- hygiene leaves；
- docs sync leaves；
- module graph；
- runtime closure；
- Cordis config；
- client domain graph；
- duplication。

## 8.4 Windows blocking gate

本机为 Windows，执行：

```powershell
pnpm run check:ci:windows-blocking
```

如果该 gate 需要当前环境不存在的外部依赖，必须区分：

```text
unsupported environment / explicitly skipped
```

与：

```text
actual product failure
```

后者禁止忽略。

## 8.5 G-SYNC Exit Criteria

全部满足：

- merge conflict = 0；
- compile/typecheck/lint/build pass；
- existing Team targeted tests pass，或每个 baseline failure 有先验证据证明 merge 前已存在；
- `pnpm run check:all` pass；
- Windows blocking gate pass 或有明确环境级不可运行记录；
- 没有为了通过 merge 删除 Team 用户价值；
- 没有引入 vNext 新 durable schema；
- merge 后 code owner/seam 与 upstream 当前实现一致。

只有此时执行 merge commit：

```powershell
git add -A
git diff --cached --check
git commit -m "merge: sync upstream master into team vNext integration"
git push origin feat/team-vnext-integration-20260829
```

记录 merge commit SHA 与 `UPSTREAM_HEAD`。

---

# 9. Phase C0 — 合并后的实现基线与旧行为 Characterization

旧 Development Plan 的 Phase 0 从这里开始，但必须基于**已经 merge 的代码**。

## C0.1 建立 `implementation-baseline.md`

创建：

```text
docs/active-plans/team-vnext-implementation-baseline.md
```

逐项记录：

```text
fact
owner package/path
current API/service/event
current test evidence
Team vNext use
compatibility risk
upstream SHA
integration merge SHA
```

至少覆盖：

- AgentPreset per-Agent mount；
- Agent creation `setup`；
- Session create / blank reuse；
- Session preset switching；
- Session model selection；
- subagent addressed ownership；
- continuable setup registry；
- child route/AgentOptions；
- fork；
- resume；
- session-query/current surface；
- Conversation assembler；
- Trajectory definitions；
- persistence stores；
- experimental Agent Teams；
- UI slots/New Session intent。

## C0.2 Legacy Team characterization tests

补齐/更新 tests，明确标记：

```text
LEGACY_EXPECTED
LEGACY_KNOWN_BAD
```

必须固定仍需保留的价值：

- persistent continuable member；
- followup；
- control；
- progress；
- Team projection；
- Timeline；
- Chat Team markers；
- member session navigation；
- cold read/resume relevant behavior。

roster drift 应有 regression reproduction 或 deterministic fixture。

## C0.3 建立 vNext invariant test harness

至少：

- Root/child event inspection；
- fake Blueprint catalog；
- capability probes；
- TeamSession projection fold；
- crash/fault injection；
- persistence cross-backend runner；
- child ownership fixture；
- fork seed fixture。

## G0 Exit Criteria

- 所有后续会用到的 DSH seam 都基于 merge 后源码确认；
- upstream/merge SHA 固定；
- legacy Team tests 当前状态已知；
- vNext test helpers 就绪；
- 还没有引入新 durable TeamSession schema。

G0 commit 后 push。

---

# 10. Phase 1 — Team Blueprint Domain & Catalog

## T1.1 Blueprint schema

定义：

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

验证：

- exactly one Leader；
- stable unique templateId；
- known typed requirement domain；
- requirement vs immutable deny contradiction；
- legal PolicyState；
- valid quota；
- Blueprint 不包含 Cordis/plugin composition。

## T1.2 Snapshot resolver

输出 immutable `ResolvedBlueprintSnapshot`：

- deterministic normalize；
- canonical serialization；
- stable content hash；
- detached immutable data。

测试：

- round-trip；
- equal semantic content；
- revision/contentHash cases；
- source path改变不意外改变 semantic identity。

## T1.3 TeamBlueprintCatalog

source groups：

```text
Project
Global
Legacy
```

要求：

- no silent shadow；
- id/source/revision identity；
- current revision；
- older revision lookup；
- diagnostics。

## T1.4 Legacy adapter skeleton

`.dsh/teammates/*` -> one-shot `LegacyWorkspaceTeamBlueprint`。

此时不得删除旧 watcher。

## G1

必须通过：

- schema validation；
- catalog collision；
- immutable/hash；
- legacy parse；
- no Agent/Session coupling。

---

# 11. Phase 2 — Durable Team Vocabulary & Projection

## T2.1 Durable events

至少：

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

Root-owned event：

```text
teamSessionId = rootSessionId
```

必须考虑：

- branded ids；
- event read compatibility；
- ignorable/known-event policy according to current upstream；
- fork filtering；
- unknown Team event presentation。

## T2.2 Root TeamSession fold

`RootSessionLog -> TeamSessionProjection`

包含：

- snapshot；
- defaultWorkspace；
- PolicyState；
- readiness；
- overrides；
- instances；
- lifecycle；
- acknowledged warnings。

必须忽略：

```text
copied event.teamSessionId != current root id
```

作为 current Team authority。

## T2.3 Child binding

Child durable facts：

```text
rootSessionId
instanceId
templateId
creation config
workspace
Blueprint revision/hash
```

建立 root-child integrity checker。

## T2.4 Persistence tests

穿过当前 upstream 真正支持的 persistence backends：

- persist；
- cold fold；
- mismatch；
- fork seed；
- malformed fail closed；
- unknown event handling。

## G2

Root log 可独立重建 TeamSession，不依赖 mutable TeamRegistry。

---

# 12. Phase 3 — Host Team Runtime / Compatibility / Policy

## T3.1 TeamSessionRuntime

Host service responsibilities：

- resolve Team root；
- expose projection；
- durable commands；
- admission gate；
- PolicyState；
- user/autonomy overrides；
- instance address validation。

禁止独立 DB、Blueprint mutation、AgentPreset ownership。

## T3.2 Typed capability probes

只做已冻结 domain：

```text
tools
skills
mcpServers
models/providers
persona/runtime-context
```

## T3.3 Compatibility resolver

输出：

```text
structuralErrors[]
warnings[]
warningKeys[]
```

覆盖：

- contradiction；
- missing MCP；
- missing route；
- persona/runtime-context；
- dedupe；
- capability recovery。

## T3.4 Team admission gate

统一 domain check，覆盖：

```text
root prompt
member activation
delegate
member followup
member resume
```

出现 warning 后已经 in-flight 的 work 不强制中止。

## T3.5 Team policy resolver

输入层：

```text
Blueprint
MemberTemplate
PolicyState
Template Autonomy Overlay
Instance Autonomy Overlay
Explicit User Override
External hard policy / actual capability
```

必须证明：

- User Override > PolicyState；
- autonomy overlay stored-but-suppressed；
- external hard deny不可越过；
- capability absent不可凭 allow 创造；
- provenance 完整。

## G3

Host-only tests 能证明 runtime / compatibility / policy，不依赖 UI。

---

# 13. Phase 4 — Persona Override & Root Team Creation

## T4.1 generic persona text override

对当前 upstream persona owner 做最小 generic seam：

- no Team import；
- preserve complete/includeRuntimeContext；
- scoped cleanup；
- no post-assemble hack。

## T4.2 TeamRootSetup

first model request 前安装：

- Team bind；
- Leader persona；
- Team leader tools/surface；
- policy guard；
- compatibility；
- needed projections。

## T4.3 Team create route

Team Intent first Send：**fresh create only**。

Structural error：rollback。  
Warning：publish TeamSession -> `AWAITING_ACK` -> prompt retained。

## T4.4 Blank Team preset switch

允许 iff：

```text
no root turn
AND
no Member provisioning ever started
```

switch 后：

- Team overlay survives；
- Blueprint unchanged；
- rerun compatibility。

## T4.5 blank reuse fence

```text
team-session/bound -> never ordinary blank reusable
Team Intent -> never adopt preexisting ordinary blank
```

## G4

Host E2E 必须：

1. happy path；
2. warning -> ack -> first prompt；
3. warning -> preset change -> repair；
4. structural rollback；
5. bound blank reopenable；
6. ordinary New Session cannot hijack；
7. Team Intent cannot convert ordinary blank；
8. root first turn locks preset；
9. first member provisioning also locks preset。

---

# 14. Upstream Drift Checkpoint A — G4 后强制执行

```powershell
git fetch upstream --prune --tags
$NewUpstream = (git rev-parse upstream/master).Trim()
```

如果 `NewUpstream == recorded upstream SHA`：记录 no drift，继续。

如果 upstream 已移动，比较：

```powershell
git diff --name-only $RecordedUpstream..$NewUpstream
```

### Relevant seam path

只要变化包含任一：

```text
packages/preset/**
packages/api/session-controller/**
packages/host/**
packages/subagent/**
packages/core/agent/**
packages/core/session/**
packages/context/**
packages/client/runtime/**
packages/client/ui-conversation/**
packages/client/ui-trajectory/**
packages/client/ui-agent-preset/**
packages/client/ui-model-selection/**
packages/client/ui-workspace/**
packages/experimental/agent-team/**
scripts/run-gates.ts
package.json
pnpm-lock.yaml
```

则必须在当前 integration branch：

```text
merge latest upstream/master
resolve under same policy
rerun G-SYNC + G0–G4 affected tests
```

如果只有明显无关区域，可记录 deferred drift，但 G8/Final 仍会再次检查。

---

# 15. Phase 5 — ActivationProvider & Member Provisioning

## T5.1 TeamActivationProvider

唯一创建入口：

```text
activate(request)
```

Request 至少：

- root/teamSessionId；
- templateId；
- label?；
- groupId?；
- workspace override?；
- model override?；
- activation prompt；
- attached context；
- source；
- idempotency key。

负责：

- gate；
- template；
- quota；
- effective config；
- capability；
- stable instanceId；
- provisioning transaction；
- child start；
- root final commit。

## T5.2 Continuable child setup

使用 upstream 当前 continuable child setup seam，fresh/cold 都安装：

- binding；
- inherited root AgentPreset composition；
- persona；
- member Team tools；
- policy guard；
- model route；
- context policy。

## T5.3 Crash-safe provisioning

fault points：

```text
root provisioning before child
child created before root final edge
duplicate retry
each durability flush boundary
```

## T5.4 Instance-first addressing

所有 runtime control：

```text
(rootSessionId, instanceId)
```

`templateId` 不是运行时唯一 identity；`groupId` 永不作为 identity。

## T5.5 quota

team/per-template `maxConcurrent` / `maxTotal`，并测试 race。

## G5

- same Template -> N instances；
- duplicate labels allowed；
- opaque id；
- cold resume；
- recovery；
- quota；
- idempotency；
- root-child integrity。

---

# 16. Phase 6 — Member Model Mutation & Runtime Overrides

## T6.1 Team-owned child model control

不得开放 generic addressed-subagent `session.selectModel`。

专用 Team command：

```text
updateMemberModel(instanceId, provider, model, effort?)
```

要求：

- root authority；
- instance membership；
- route validation；
- durable override；
- next request boundary；
- in-flight unchanged；
- generic ownership fence仍保持拒绝。

## T6.2 Template session defaults

只影响未来 instances。

## T6.3 User Override / Autonomy Overlay 分离

必须 durable 且 provenance 不混淆。

## T6.4 effective config query

Host 输出：

```text
value
source
suppressed?
unavailable?
deniedBy?
```

client 不自己复算 policy。

## G6

必须通过动态 route、in-flight isolation、PolicyState suppress、User override precedence、reset、future-only template default、generic subagent fence regression。

---

# 17. Phase 7 — Lifecycle / Control

## T7.1 lifecycle command state machine

```text
resume
archive
restore
dispose
```

集中验证。

## T7.2 quiesce pipeline

RUNNING -> Archive/Dispose：

```text
close new admission
interrupt current turn
drain descendant activations
wait/observe settlement
release resident child
append lifecycle transition
```

禁止先 append ARCHIVED 再停 agent。

## T7.3 restore

同 instanceId / same child Session。

## T7.4 instance-addressed control channels

control request、leader authority、pending decision、cold recovery 使用 instanceId。

## G7

- archive running；
- dispose running；
- descendants drained；
- restore same instance；
- disposed cannot resume；
- transcript retained；
- control survives reconnect/cold projection。

---

# 18. Phase 9 — Chat / Trajectory Team Ledger（G5 后可与 P6/P7 并行）

## T9.1 Chat generic Team ledger

匹配：

```text
team-session/*
team-instance/*
```

原则：

```text
1 durable Team event = 1 collapsed Chat node
```

known event 专用 renderer，unknown event generic fallback。

## T9.2 Trajectory Team definition

每个 Team event 在该 Session 第一视角可观察：

- type；
- seq；
- location；
- time；
- instance/template；
- payload；
- correlation。

Trajectory 不读取 Chat final node。

## T9.3 pagination/prepend

测试 historical prepend、unknown event、before-first-turn、turn/step placement、fork inherited history。

## G9

每个属于当前 Session log 的 durable Team event：

```text
1 Chat node
AND
1 Trajectory observable record
```

第一版不做 aggregation。

---

# 19. Phase 8 — Resume / Fork / Handoff

在依赖的 G5/G6/G7 基础上执行。

## T8.1 Root Team resume

恢复：

- AgentPreset；
- Blueprint snapshot；
- TeamRootSetup；
- projection；
- compatibility rerun；
- resident reconciliation。

## T8.2 Root Team fork

Root fork：

```text
new root TeamSession
same Blueprint snapshot
new TeamSessionId = new root SessionId
MemberInstances = empty
```

旧 copied Team events 不成为新 current Team state。

## T8.3 Member Session fork

Member Session fork -> ordinary independent AgentSession，默认不 Team-bind。

## T8.4 TeamHandoffSummarizer

读取 source canonical current surface；不执行 source compaction；不 mutate source；使用独立 summarization route。

## T8.5 Start Team from Here

```text
source surface freeze
-> summarize
-> fresh Team create
-> persist sourced handoff context
-> compatibility
-> first prompt
```

summary failure 必须提供 Retry / Continue without handoff / Cancel；不得 silent continue。

## G8

cold resume、Blueprint immutable snapshot、environment drift warning、root/member fork、handoff source unchanged、replay reconstructable、summary failure explicit 全部通过。

---

# 20. Upstream Drift Checkpoint B — G8 后

执行与 Checkpoint A 相同流程。

如果 upstream 相关 seam 已变化，必须 merge 最新 upstream，然后至少重新跑：

```text
G-SYNC
G0 relevant seam characterization
G3 compatibility/policy
G4 root creation
G5 activation
G6 model ownership
G7 lifecycle if subagent changed
G8 resume/fork/handoff
G9 if conversation/history changed
```

不能因为“已经开发很多了”而推迟到 PR 前一次性解决。

---

# 21. Phase 10 — Web UI vNext

## T10.1 New Session Agent/Team mode

- Agent/Team toggle；
- Blueprint picker；
- AgentPreset secondary；
- Team Intent；
- first Send fresh materialization；
- pending prompt retention；
- revision race。

## T10.2 Compatibility UI

- creation warning；
- AWAITING_ACK；
- provisional Sidebar title；
- Header badge；
- Change AgentPreset when composition-mutable；
- Change model/config；
- Continue Anyway；
- acknowledged degraded state；
- domain gate blocker。

## T10.3 Header + Dock

Header：Blueprint/revision/PolicyState/compat/current perspective/count。  
Dock：compact status/navigation only。

## T10.4 Timeline

保留既有 zoom/pan/hover/navigation；对象模型升级为：

```text
Template
  -> Instance sublane
  -> multiple RUNNING intervals
```

## T10.5 Members / detail

- Template group；
- multi-instance；
- create；
- archived disclosure；
- contextual detail；
- Open Session；
- lifecycle action。

## T10.6 Effective config / override editor

read-effective-first，显示 provenance、suppressed/unavailable/denied；再 configure/reset；Member model selector 使用 Team command。

## T10.7 Activity / Progress

保留 telemetry；不得把它升级成 authoritative Workflow/task DAG。

## T10.8 Events

Root Team ledger chronological view、filter、Session navigation、unknown event。

## T10.9 Member Session shared Team view

Member Session 仍有：

```text
Chat / Trajectory / Team
```

Team tab显示同一 TeamSession并高亮 current instance。

## T10.10 Ordinary Session Team zero-state / Start Team from Here

完整 handoff UI 与 failure choices。

## G10 Web scenarios

至少：

1. create happy；
2. warning repair；
3. warning continue；
4. multi-instance；
5. dynamic member model；
6. PolicyState suppress；
7. archive/restore/dispose；
8. member navigation；
9. timeline multi-run；
10. root/member Chat/Trajectory events；
11. Start Team from Here；
12. reconnect/cold projection。

---

# 22. Phase 11 — Legacy Cutover

只在 G10 后执行。

## T11.1 Legacy Blueprint adapter complete

`.dsh/teammates` 只在 Team creation 时 snapshot once。

## T11.2 role AgentPreset migration

旧 role preset 内容迁移到 Blueprint roles；普通 composition 迁到 generic `team` 或 custom AgentPreset。

## T11.3 删除旧 mutable authority

移除 production dependency：

- `ctx.team` current mutable definitions；
- `team-local` watcher runtime authority；
- cwd mutation reload；
- home silent fallback；
- stale-empty semantics。

如果需要旧 API，只允许 read-only adapter from current TeamSession projection；不得第二真源。

## T11.4 generic `team` AgentPreset 清理

移除 Team Runtime-essential rows，仅保留普通 Team-friendly Agent composition。

## G11

- roster drift regression；
- same workspace/different Blueprint isolation；
- same Blueprint/different workspace isolation；
- legacy snapshot once；
- no watcher mutation；
- grep 无 production mutable TeamRegistry authority。

---

# 23. Phase 12 — Hardening / Performance / Docs

## T12.1 recovery matrix

```text
crash around provisioning flush
cold root/child
provider unavailable
MCP disappears
AgentPreset source changed
model route disappears
connection reset
projection prepend
```

## T12.2 race matrix

```text
simultaneous activation
same idempotency key
quota race
model override while running
PolicyState + User Override race
archive with queued followup
compat warning appears during work
Blueprint revision changes during intent
reconnect stale generation
```

## T12.3 performance

至少验证：

- dormant Team Runtime；
- 100+ durable events Chat/Trajectory；
- 10–50 instances Timeline；
- projection append；
- no all-child-log refresh；
- no watcher leak；
- agent/resource release。

## T12.4 docs

更新 architecture/compat/UI/config/tool/migration/README/examples，并删除旧心智模型。

## G12

所有 recovery/race/perf/docs evidence 完整。

---

# 24. 每个 Task / Gate 的提交纪律

## 24.1 Task commit

每个 Task 1 个或少数几个 reviewable commits。

禁止一个 commit 同时：

- durable schema；
- Host lifecycle；
- UI rewrite；
- legacy deletion；
- unrelated cleanup。

## 24.2 Gate commit / execution log

在：

```text
docs/active-plans/TEAM_VNEXT_EXECUTION_LOG.md
```

只在 Gate 通过时追加：

```markdown
## Gate Gx
- branch HEAD:
- upstream base:
- origin/feat/agent-teams base:
- commands:
- result:
- known skips and why:
- architecture review:
- next permitted phase:
```

不要每个测试行都制造 log commit；每个 Gate 一个 evidence commit 即可。

## 24.3 标准任务报告

每项必须记录：

```markdown
### Changed
### Preserved invariants
### Tests
### Failure/race cases
### Known limitations
### Gate evidence
### No-scope-creep
```

---

# 25. 无人值守任务的 STOP / FAIL-CLOSED 条件

发生任一项立即停止，不得自行“合理猜测”继续：

1. `origin/feat/agent-teams` 在 R0 或 final base check 中不是预期 base，且无法证明移动来自本任务批准的 PR；
2. 工作目录不是 `D:\AgentDev\deepseek-harness`；
3. 任何命令将写入 `D:\deepseek-harness` / `.dsh` / 3080；
4. upstream 新 API 与冻结用户语义产生真正矛盾；
5. 合并冲突必须通过改变冻结需求才能解；
6. root/child durable state无法 fail-closed；
7. generic subagent ownership 必须被放宽才能实现 Team model control；
8. 需要修改 agent-loop core 且没有现有 seam 不足的明确证据；
9. handoff只能通过 mutate source session 才能实现；
10. test failure 被判断为“应该没事”但没有 baseline/上游证据；
11. 需要删除/重写用户实际 `.dsh-dev` session 数据才能通过测试；
12. 需要 secret/credential 才能通过一个本应 keyless 的 required gate；
13. merge conflict marker、dirty generated artifacts、stale lockfile 无法清理；
14. rescue interrupted code被认为“可能有用”但尚未在新 upstream 基线上重新审查。

---

# 26. 最终 PR 前的强制基线同步

G12 通过后，不得立即提 PR。

## 26.1 fetch 两个 remote

```powershell
git fetch origin --prune
git fetch upstream --prune --tags
```

## 26.2 稳定分支 drift

```powershell
$StableNow = (git rev-parse origin/feat/agent-teams).Trim()
```

如果仍是最初稳定 base，继续。

如果 stable 已移动：

- 先检查是否为本项目之外合法新增；
- merge `origin/feat/agent-teams` 到 integration branch；
- 禁止 rebase 重写长任务历史；
- rerun affected Gate + Final Gate。

## 26.3 upstream drift

最终 PR 前要求 integration branch **合并执行时最新 upstream/master**，不再允许 deferred unrelated drift。

如果 upstream master 已移动：

```text
merge upstream/master
resolve
rerun G-SYNC
rerun所有受影响 Gate
rerun Final Gate
```

---

# 27. PR-GATE — 只有以下测试全部通过才允许提 PR

目标：

```text
head: feat/team-vnext-integration-20260829
base: feat/agent-teams
```

## 27.1 Git integrity

必须：

```powershell
if (git status --porcelain) { throw 'PR_DIRTY_TREE' }

git merge-base --is-ancestor origin/feat/agent-teams HEAD
if ($LASTEXITCODE -ne 0) { throw 'STABLE_NOT_ANCESTOR' }

git merge-base --is-ancestor upstream/master HEAD
if ($LASTEXITCODE -ne 0) { throw 'LATEST_UPSTREAM_NOT_ANCESTOR' }
```

无 conflict marker；`git diff --check` clean。

## 27.2 Clean install reproducibility

在独立 final-verification worktree 或 clean clone 验证；不得依赖开发 worktree 残留 build artifact。

建议：

```powershell
$Verify = 'D:\AgentDev\deepseek-harness-pr-verify'
if (Test-Path $Verify) { throw 'VERIFY_PATH_ALREADY_EXISTS' }
git worktree add --detach $Verify HEAD
Set-Location $Verify
pnpm install --frozen-lockfile
pnpm run clean
```

## 27.3 Required repository-wide gates

在 clean verification worktree：

```powershell
pnpm run check:all
pnpm run check:ci
pnpm run check:ci:windows-blocking
```

说明：

- `check:all`：完整本地 repo aggregate；
- `check:ci`：包含 CI primary 的 coverage/static/snapshot/docs/build 等 gate；
- `check:ci:windows-blocking`：Windows blocking signal。

如果 upstream 当前脚本调整了 aggregate 名称，以 merge 后 `package.json` / `scripts/run-gates.ts` 为 authority，必须记录实际替代命令。

## 27.4 Required Team-focused gates

即使 repo aggregate 通过，也单独要求 Team evidence：

```text
Blueprint schema/catalog
TeamSession projection/persistence
Compatibility/admission
Root create/warning/preset switch
multi-instance provisioning/recovery
member model ownership
lifecycle quiesce/drain
resume/fork/handoff
Chat/Trajectory Team ledger
Web Team UI
legacy roster drift regression
```

执行实际 package tests + keyless assembled application snapshot/e2e。

## 27.5 GUI / Web

必须：

```powershell
pnpm run test:gui
```

以及 upstream 当前的 Web snapshot/build gate；如果 `check:all/check:ci` 没有覆盖 Team Web scenario，额外运行：

```powershell
pnpm run test:web
```

## 27.6 Snapshot

Team 用户可观察行为必须有 keyless assembled snapshot，不能只靠 unit/mock。

至少覆盖：

- Team create；
- multi-instance；
- lifecycle；
- Chat Team event；
- compatibility warning/ack；
- Start Team from Here（若 snapshot harness 能表达）。

## 27.7 Real API tests

`pnpm run test:e2e` 若没有 API key 可 self-skip；它不是无 key 环境下的 PR blocker。

但是任何本应 keyless 的 Team test 不得因为缺 key而 skip。

## 27.8 Final execution report

创建：

```text
docs/active-plans/TEAM_VNEXT_FINAL_EXECUTION_REPORT.md
```

包含：

- initial stable SHA；
- initial upstream observed SHA；
- actual initial merged upstream SHA；
- drift checkpoint merges；
- final upstream SHA；
- final integration SHA；
- all Gate commits；
- commands and pass/fail；
- skipped optional tests；
- known limitations；
- migration notes；
- rescue branch/stash existence；
- confirmation that 3080 stable instance untouched。

PR-GATE 只有在该 report 写完、重新跑 doc gate 通过后才算 PASS。

---

# 28. 创建 PR 的条件与内容

只有 PR-GATE PASS 后允许创建：

```text
base: feat/agent-teams
head: feat/team-vnext-integration-20260829
```

PR 必须说明：

1. upstream integration SHA；
2. 原 branch 1079-commit drift 已消化；
3. conflict resolution policy；
4. Team vNext architecture changes；
5. migration/cutover；
6. Gate evidence；
7. recovery/fault-injection；
8. Web/snapshot evidence；
9. known limitations；
10. 不触碰稳定 3080 实例。

---

# 29. PR 提交后仍不能立即 merge

## 29.1 Required CI

所有 required CI checks 必须 green。

因为当前 GitHub `feat/agent-teams` 未必配置 branch protection，所以：

> “GitHub 没阻止 merge”不等于“允许 merge”。

## 29.2 PR review self-audit

总控 agent 在 merge 前必须重新审查 diff：

### Authority
- no second Team truth source；
- no mutable current roster authority。

### Scope
- Team Host backend 不藏入 AgentPreset；
- no cross-session registry leak。

### Durability
- observable state logged；
- live/cold same semantics。

### Ownership
- no generic child model/session ownership bypass。

### Policy
- User Override / Autonomy Overlay distinct。

### History
- every Team durable event visible in Chat + Trajectory；
- unknown event not silently dropped。

### Failure
- no silent fallback；
- provisioning recoverable；
- lifecycle truthful。

## 29.3 Final remote movement check

PR CI 结束后再次：

```powershell
git fetch origin --prune
git fetch upstream --prune
```

如果：

```text
origin/feat/agent-teams moved
or
upstream/master moved
```

则 PR branch 必须重新 integrate 并重新跑 relevant/final CI；不得直接 merge stale head。

---

# 30. 允许 merge 到 `feat/agent-teams` 的最终条件

必须同时：

```text
PR-GATE PASS
AND
required CI green
AND
origin/feat/agent-teams is ancestor of PR head
AND
latest upstream/master is ancestor of PR head
AND
final semantic self-review PASS
AND
worktree clean
AND
no unresolved review comments that affect correctness
```

## 30.1 Merge strategy

推荐：

```text
Merge commit
```

禁止默认 squash 整个长分支，因为该分支包含：

- 一个或多个真实 upstream merge parent；
- 分阶段 Gate commits；
- 可审计的 Team vNext implementation history。

不推荐最终 rebase 1079+ upstream integration 后的长任务历史。

## 30.2 Merge 后验证

merge 后：

```powershell
git fetch origin --prune
git switch feat/agent-teams
git reset --hard origin/feat/agent-teams
```

验证：

```powershell
git merge-base --is-ancestor upstream/master origin/feat/agent-teams
git log --oneline --decorate -n 30
```

只做 read-only/clean verification；不要在稳定 branch 继续新开发。

---

# 31. 无人值守恢复协议

如果 agent / DSH / Windows / terminal 中途退出：

1. 不根据聊天记忆猜阶段；
2. 读取：
   - `TEAM_VNEXT_EXECUTION_LOG.md`
   - git branch/HEAD/status；
   - latest Gate commit；
3. `git fetch origin` 但不要立刻 merge；
4. 确认当前 branch 必须是 integration branch；
5. 如果 worktree dirty，先判断是否是上一次未完成 Task；
6. 只从最后一个 PASS Gate继续；
7. 如果处于 merge conflict 状态，继续该 merge；禁止 abort 后跳过 upstream；
8. 如果无法证明当前状态属于哪个 Gate，STOP。

---

# 32. 禁止的快捷操作

无人值守 agent 不得：

1. 在 `feat/agent-teams` 直接开发；
2. 为“省冲突”跳过 upstream merge；
3. rebase 后 force push 稳定分支；
4. whole-dir ours/theirs 解决 core 冲突；
5. 手工拼 generated catalog；
6. 手工拼 lockfile；
7. 把 upstream archived notes 恢复到 implemented；
8. 恢复 `Team = AgentPreset`；
9. 在 Blueprint 塞 Cordis composition；
10. 开放 generic child `session.selectModel`；
11. compatibility 只做 UI disable；
12. Archive 只改 enum；
13. handoff mutate source Session；
14. fork 时把旧 Team event 当新 Team state；
15. 删除 unknown Team durable event；
16. 在 replacement 完成前删除 legacy safety net；
17. 自动重新使用 rescue branch 中被中止的代码；
18. 为了测试触碰 3080 稳定实例。

---

# 33. 最终 Definition of Done

只有以下全部存在，才能宣布 Team vNext 完成并允许合入稳定 Team 分支：

```text
Latest upstream integrated
+
Reusable immutable Team Blueprint
+
Root-bound TeamSession
+
Template -> N persistent MemberInstances
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
Team-wide compatibility admission gate
+
truthful archive/restore/dispose
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
+
repo-wide CI/coverage/snapshot/docs/build pass
+
Windows blocking gate pass
+
final upstream/stable drift check pass
```

任何一项缺失：

> **不得 merge 到 `feat/agent-teams`。**

---

# 34. 给总控 agent 的一句话执行指令

> 从 `D:\AgentDev\deepseek-harness` 开始，先把本地中止工作完整取证并回退到 `origin/feat/agent-teams@506191ba893ac55980dd09680c438710ab24095b`；从该 SHA 新建 `feat/team-vnext-integration-20260829`，真实 fetch+merge 执行时最新 `upstream/master`，按本规格的冲突分类语义化解决并通过 G-SYNC；之后只在合并后的代码上执行 C0、G0、Phase 1–12 和 drift checkpoints。所有 Gate 有 durable evidence；任何冻结语义冲突、stable branch 意外移动或测试无法解释时 fail closed。只有 final upstream/stable 均已包含、clean-room `check:all + check:ci + Windows blocking + Team focused + Web/snapshot` 全部通过、PR CI 全绿后，才允许用 merge commit 将开发分支合入 `feat/agent-teams`。
