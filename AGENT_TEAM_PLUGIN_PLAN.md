# Agent Team 插件开发计划

## 一、PilotDeck Agent Team Mode 功能分析

### 1.1 核心架构

PilotDeck 的 agent team mode 由以下关键模块构成（源码位于 `references/PilotDeck-acc-preview`）：

| 模块 | 路径 | 职责 |
|---|---|---|
| `TeammateManager` | `src/extension/teammates/` | 全局 teammate 定义的 CRUD 和校验（从 `$PILOT_HOME/teammates/*.md` 加载） |
| `TeammateEnablementStore` | `src/extension/teammates/` | 每工作区启用/禁用 teammate 的持久化 |
| `TeammateSessionRuntime` | `src/agent/team/` | 运行时会话管理，拥有 `delegate()` / `sendMessage()` / `readProgress()` / `controlRequest()` 等 API |
| `TeammateToolScope` | `src/agent/team/` | 对每个 teammate 实施 tool allowlist/denylist 过滤（clone 主 registry，逐项 unregister） |
| `TeammateExtensionResolver` | `src/agent/team/` | 按 teammate 定义过滤 plugins、skills、MCP servers |
| `TeamControlCoordinator` | `src/agent/team/` | teammate 向 leader 发起权限请求或提交 plan 供审批，leader 作出 allow/deny/approve/revision 决策 |
| `TeamMessageCoordinator` | `src/agent/team/` | leader ↔ teammate 之间的显式消息传递队列 |
| `TeamProgressStore` | `src/agent/team/` | 结构化任务进度持久化（v2，durable JSON） |
| `SubAgentSession` | `src/agent/sub/` | 底层 fork 执行器：clone 父 config/dependencies、scope tool registry、注入 system prompt、独立 AgentLoop |
| `TeamLeaderControlTurnScheduler` | `src/agent/team/` | Control request 触发合成 leader turn |
| `TeamMessageDeliveryScheduler` | `src/agent/team/` | 消息投递调度，busy-retry with backoff |
| `SessionRouter` | `src/agent/session/` | 按 channelKey 管理 AgentSession 实例，`getOrCreate` / `beginTurn` / `endTurn` / `abort` |

### 1.2 Teammate 定义格式

每个 teammate 是一个 Markdown 文件（YAML frontmatter + prompt body）：

```yaml
---
schemaVersion: 1
id: backend
name: Backend Engineer
description: 负责后端 RPC、launcher 执行
model: deepseek-v4-flash-0731
maxContextTokens: 160000
maxOutputTokens: 16000
tools: [read_file, write_file, edit_file, grep, glob, bash]
plugins: []
skills: []
mcpServers: []
---

你负责 M2、M3、M4 ...（角色系统提示词 body）
```

**关键字段**:

- `id` / `name` / `description` — 标识与展示
- `model` — 独立模型配置
- `maxContextTokens` / `maxOutputTokens` — 上下文窗口与输出长度控制
- `tools` — tool allowlist（只允许使用列出的工具）
- `plugins` / `skills` / `mcpServers` — 扩展资源过滤
- prompt body（frontmatter 之后的 Markdown）— 角色系统 prompt

### 1.3 精细化权限控制

| 维度 | PilotDeck 实现 |
|---|---|
| Tool 可见性 | `TeammateToolScope.scopeTeammateTools()` — clone registry + allowlist 过滤 + 禁止 `delegate_to_teammate` / `agent` / `ask_user_question` |
| MCP server 挂载 | `mcpServers` allowlist → `TeammateExtensionResolver.listMcpInstructions()` 过滤 ⚠️ **已知缺陷**：teammate 经常检测不到 MCP 挂载，此实现不可复用 |
| Skills 加载 | `skills` allowlist → `TeammateExtensionResolver.listSkills()` 过滤 |
| Plugins | `plugins` allowlist → `TeammateExtensionResolver.listCommands()` 过滤 |
| 文件读写范围 | `ToolCallSelector` 条件匹配（`pathEquals` / `pathWithin` / `executableEquals` / `argvPrefix`）→ `CompiledTeammateToolConstraints.allow/deny` |
| 权限审批 | `TeamControlCoordinator` → leader 审批 teammate 的敏感操作（allow_once / deny / approve_plan / request_revision / escalate_to_user） |
| 模型配置 | `model` 字段 per-teammate；leader 可通过 `leader-workspace-overrides.json` 覆盖自身配置 |
| 上下文窗口 | `maxContextTokens` / `maxOutputTokens` per-teammate |

### 1.4 任务委派协议

PilotDeck 有两层委派模型：

**Layer 1 — Fork subagents**（`src/agent/sub/`）：同步单线程 fork，使用 `SubAgentSession`，按 preset（general-purpose/explore/plan/verify）scope tool registry，返回 5-field 报告（Scope/Result/Key files/Files changed/Issues）。

**Layer 2 — Team delegation**（主要，异步）：三个 Leader-only tools：

| Tool | 作用 |
|---|---|
| `delegate_to_teammate` | `run` / `follow_up` / `shutdown` + control actions (allow_once/deny/approve_plan/request_revision/escalate_to_user)；run/follow_up **后台异步执行，立即返回** `dispatched` |
| `send_team_message` | Leader → teammate 或 teammate → leader 的自由文本消息 |
| `team_progress` | 结构化任务进度板（create/update items） |

**Leader 工具锁定**：Leader 在 team mode 下只能使用 `TEAM_MODE_CORE_TOOLS`（`delegate_to_teammate`、`send_team_message`、`team_progress`）+ 配置的 `leaderExtraTools`。由 `filterTeamModeTools` 和 `ToolRuntime` 双重执行（违规触发 `team_mode_violation`）。

**委派执行流程**：

```
Leader ─── delegate(teammateId, action="run", prompt, taskId, permission) ───→ TeammateSessionRuntime
              │                                                                      │
              │ ←── { status: "dispatched" }（异步立即返回）                              │
              │                                                                      │
              │   compileTeammateBinding() → 组装 teammate system prompt               │
              │   SessionRouter.getOrCreate({channelKey:"team"})                      │
              │     → 按 `leaderSessionId::teammate::id` 获取/创建 AgentSession        │
              │   runTeammateTurn() → 独立 agent turn                                 │
              │     (scoped tools/model/prompt, leader's permission snapshot)         │
              │                                                                      │
              │ ←── idle 消息 (completed/failed/cancelled)                             │
              │     via TeamMessageCoordinator → synthetic leader turn                │
```

- **并发控制**: `inFlight` set + `teammateInFlightTurns` keyed set + `SessionRouter.beginTurn/endTurn` 防止同一 teammate 并发 turn
- **消息投递**: `TeamMessageDeliveryScheduler` — durable pending 队列，busy-retry with backoff；投递给 teammate = `follow_up` turn（`<team-message>` 块包装）；投递给 Leader = synthetic `runMode:"team"` turn
- **Control/Plan 审批**: teammate 的 `PermissionRequest` → `TeamControlCoordinator` → durable request → synthetic control turn 给 Leader → Leader 通过 `delegate_to_teammate` control actions 响应 → `escalate_to_user` 转人工

### 1.5 Leader 配置

> **⚠️ 我们的实现不采用此限制。** PilotDeck 将 Leader 锁定为纯协调角色（仅 3 个 core tools + `leaderExtraTools`），不允许做领域工作。我们的 agent-team 插件中，Leader 采用与 teammate **相同的定义格式和配置粒度**，允许用户按需让 Leader 承担领域工作。Leader 默认自动获得 10 个 team 控制 tools（不可移除），用户配置的额外 tools 与默认 tools 合并。

PilotDeck 原始设计：Leader 不是 teammate，而是独立的全局定义（`$PILOT_HOME/leader.md`，可选）。Leader 拥有三个 team-control tool（`delegate_to_teammate`、`send_team_message`、`team_progress`），不做领域工作。配置优先级：**workspace override > global leader.md > agent defaults**。

Leader workspace override 文件 `leader-workspace-overrides.json`（schemaVersion 1）按工作区路径映射 `{ model?, maxContextTokens?, maxOutputTokens?, toolProfile?, prompt?, plugins?, skills?, mcpServers? }`。

### 1.6 Workspace Binding 与启用控制

- `workspace-enablement.json`（schemaVersion 2）— 按工作区路径映射每个 teammate 的 binding：
  - `TeammateWorkspaceBinding { enabled, toolProfile, contextPolicy? }`
  - `toolProfile`: `{mode:"inherit"}` 或 `{mode:"custom", tools:[], constraints:{allow,deny}}`
  - `contextPolicy`: `"persistent"` | `"fresh_per_delegation"`
- 工作区路径经 `realpath` + 平台规范化（Windows lowercase + NFC）
- 写入通过 `GlobalTeammateMutationLock` 跨进程互斥 + SHA-256 `revision` 乐观锁
- 禁用 teammate 保留 binding 配置（constraints 不丢失）
- 删除 teammate 同步清理所有工作区的 binding

### 1.7 Session 身份策略

- `persistent` → 稳定 session key `leader::teammate::<id>`，跨委派复用
- `fresh_per_delegation` → 每次 `run` 分配新 UUID session key，`follow_up` 复用当前 key 直到下次 `run`

### 1.8 Token 限制优先级

`maxContextTokens` / `maxOutputTokens` 解析优先级：**env override > teammate definition > leader config > agent defaults > model catalog**

---

## 一·附、oh-my-opencode 参考分析

oh-my-opencode（源码位于 `references/oh-my-opencode`）是 OpenCode 的插件，采用了不同于 PilotDeck 的编排模型。

### 架构对比

| 维度 | PilotDeck Agent Team | oh-my-opencode |
|---|---|---|
| **编排模型** | Leader-Teammate 显式控制面（`delegate_to_teammate` tool） | Agent Registry + Category-based 委派（`delegate_task` tool） |
| **Agent 定义** | Markdown frontmatter（`$PILOT_HOME/teammates/*.md`）| TypeScript factory functions（`createXXXAgent(model)`）|
| **角色关系** | Leader 不做领域工作，只协调 | Sisyphus（主 agent）+ Atlas（orchestrator）+ 专家 agents |

> **我们的设计差异**：Leader 采用与 teammate 同等粒度的配置（model/tools/skills/mcpServers/maxTokens），允许承担领域工作。Leader 默认自动获得 10 个 team 控制 tools，用户配置的额外 tools 与之合并。
| **Tool 限制** | Per-teammate allowlist + deny ToolCallSelector 条件 | Per-agent denylist（`AGENT_RESTRICTIONS` 硬编码 map）|
| **模型配置** | Per-teammate `model` 字段 | Per-agent factory 参数 + fallback chain |
| **上下文策略** | `persistent` vs `fresh_per_delegation`（会话级） | session_id 复用 vs 新建（无显式 policy） |
| **权限审批** | `TeamControlCoordinator`（teammate → leader 审批链） | 无 agent↔agent 审批；统一走 OpenCode permission system |
| **消息通道** | `TeamMessageCoordinator`（双向结构化消息队列） | 无 inter-agent 消息；通过 tool result 传递信息 |
| **并发控制** | `inFlight` set，同一 teammate 同一时间一个 turn | `ConcurrencyManager`，per-provider/model 限制 |
| **进度追踪** | `TeamProgressStore`（结构化 task items） | `todo_write` tool + `boulder.json`（plan-level state） |
| **Skill 加载** | Per-teammate `skills[]` allowlist | Per-delegation `load_skills[]`（注入 prompt 前缀） |
| **MCP 过滤** | Per-teammate `mcpServers[]` allowlist | 无 per-agent MCP 过滤 |

### 值得借鉴的 oh-my-opencode 设计

1. **Category-based 委派**：`delegate_task` 通过 `category`（domain routing）或 `subagent_type`（direct agent）两种模式委派，互斥选择。DSH 插件可支持按 teammate id 直接委派 + 按 domain category 自动路由两种模式。

2. **Skill 注入模式**：`load_skills` 参数在 delegation 时动态注入技能内容到 subagent prompt（`skillContent` 前缀），而非静态配置。DSH 插件可在 `delegate_to_teammate` tool 中支持 `override_skills` 参数。

3. **Session 复用**：`session_id` 参数允许继续已有 session（`client.session.prompt()`），保留完整上下文。这与 DSH continuable subagent 的 `followup()` 天然契合。

4. **Background + foreground 双模**：`run_in_background: true|false` 参数控制是否异步执行。DSH 的 continuable subagent 天然支持 background（`startContinuable()` 后 leader 继续工作），可在 tool 参数中暴露此选项。

5. **Agent metadata for prompt generation**：每个 agent 声明 `AgentPromptMetadata`（category, cost, triggers, useWhen, avoidWhen），Sisyphus 的 prompt 由 `dynamic-agent-prompt-builder` 动态生成 delegation table。DSH 插件可将 teammate 定义的 `description` 字段用于类似的动态 prompt 注入。

### PilotDeck 已知问题（借鉴时需规避）

- **MCP 加载缺陷**：⚠️ **高优先级规避项**。Teammate 的 MCP server 挂载检测存在已知 bug，teammate 经常检测不到已配置的 MCP 挂载。`TeammateExtensionResolver.listMcpInstructions()` 和相关 MCP 过滤代码**禁止参考/复用**，必须基于 DSH 的 `ToolRestriction` 机制独立实现 per-agent MCP 过滤
- **消息投递竞态**：`TeamMessageDeliveryScheduler` 的 busy-retry 依赖 transcript dedup 检查，restart 后 reconcile 可能丢失 in-flight 消息
- **Control request 持久化**：persisted requests 在 restart 后被 cancel（waiter 丢失），无法恢复进行中的审批
- **Session key 碰撞**：`persistent` mode 使用 `leader::teammate::<id>` 作为稳定 key，多 leader session 场景下可能冲突
- **Tool registry clone**：`scopeTeammateTools` 对整个 registry 做 clone + unregister，性能随 tool 数量线性增长
- **并发守卫不充分**：`inFlight` set 是内存态，process crash 后无法恢复，可能导致 teammate 卡在 "already running" 状态

**DSH 规避策略**：
- **MCP 过滤独立实现**：基于 DSH `ToolRestriction`（声明式 allow/deny by tool name）过滤 `mcp__*` 工具，不参考 PilotDeck 的 `TeammateExtensionResolver` 代码
- 使用 DSH 的 `ToolRestriction`（声明式 allow/deny）而非 clone + unregister
- 使用 DSH 的 durable session log 而非内存态 in-flight tracking
- 使用 DSH 的 continuable subagent activation manager（自动处理 process restart 后的 cold resume）
- 审批通道使用 `tools/pre-execute` waterfall 挂起（Cordis effect-scoped，自动 cleanup）而非独立 coordinator store

---

## 二、DeepSeek Harness 底层架构能力现状

### 2.1 已有的可复用基础

> 以下分析基于对 DSH 源码的深度审查（`docs/subsystems/subagent.md`、`core.md`、`tools.md`、`scope.md`、`system-prompt.md`，以及 `packages/subagent/`、`packages/core/scope/`、`packages/core/tools/`、`packages/preset/`、`packages/mcp/`、`packages/skill/`、`packages/fs/` 的实现）。

**基础原语：per-agent scope（`packages/core/scope/`）**

所有 per-agent 能力隔离建立在一个原语上：`createScope(ctx, key)` → `ScopeKey`。Agent 本身就是自己的 scope key（`createScope(loopCtx, this)`），`agent.ctx` 是 agent 的 scoped context。通过 `agent.ctx` 注册的任何贡献都是 agent-local 的。`ScopedLayers` 管理 global + per-scope overlay，读取时合并 `[global, ...chainLayers(scope)]`，最近 scope 优先。这是 per-agent tools、prompts、skills、model routing、event filtering 的统一机制。

| DSH 能力 | 对应需求 | 评估 |
|---|---|---|
| **Subagent seam** (`ctx.subagents`) | 子 agent 生命周期管理 | ✅ 丰富——支持 one-shot / continuable，多 provider (spawn/fork/acp/claude-code/codex)，持久化，`startContinuable()` / `followup()` / `interrupt()` / `reportFrom()` |
| **Tool restriction** (`ToolRestriction`) | Per-agent tool 过滤 | ✅ 已有 allow/deny name list 过滤，`SubagentStartRequest.toolFilter` 已支持，通过 `registerContinuableSetup()` 可注入 scoped restriction |
| **Persona per-agent** | Per-agent 角色 prompt | ✅ `SubagentStartRequest.persona` 已支持——注册 scoped `deployment:persona` section |
| **Depth limit** | 防止无限递归 | ✅ `SubagentStartRequest.maxDepth` |
| **MCP client** (`dsh-mcp-client`) | MCP server 桥接 | ✅ 多实例，每实例一个 MCP server，tool 名 `mcp__<serverName>__<rawName>` |
| **Skill registry** (`ctx.skills`) | Skill 管理 | ✅ 多 provider，scoped layer |
| **Agent preset** (`ctx.agentPresets`) | 组合不同 agent 配置 | ✅ 每 preset 一个 `cordis.yml`，per-session 挂载 |
| **Scoped registration** (`dsh-scope`) | Per-agent 注册隔离 | ✅ `agent.ctx` 提供 scope context，`ScopedLayers` 管理 per-scope 注册 |
| **System prompt assembly** (`ctx.systemPrompt`) | Per-agent prompt section | ✅ Scoped section/context，per-agent shadow |
| **AgentOptions** | Per-agent model config | ✅ `provider` / `model` / `maxTokens`（maxTokens = output tokens） |
| **Continuable subagent** | Persistent teammate session | ✅ `startContinuable()` → 持久化 session，`followup()` 恢复，cold resume 支持 |
| **Report channel** | Teammate → leader 报告 | ✅ `reportFrom()` quiet/wakeup 两种投递模式 |
| **Subagent settled notice** | Teammate 完成通知 | ✅ Activation settle 时自动向 direct parent 发送 `subagent-settled` notice |
| **Filesystem policy** (`ctx.fs`, `fs/*` events) | 文件系统隔离 | ✅ `fs/write-intent` / `fs/edit-intent` waterfall 可注入 per-scope 决策 |
| **Permission/approval** (`ctx.interaction`) | 操作审批 | ✅ 已有 approval capability + permission commands |
| **Settings** (`ctx.settings`) | 用户配置存储 | ✅ 已有 settings capability |
| **Workflow engine** | 大规模并发编排 | ✅ Worker-thread script（面向无状态 fan-out） |

### 2.2 缺失项（需要插件补齐或底层微扩展）

| # | 缺失项 | 说明 | 优先级 | 建议方案 |
|---|---|---|---|---|
| G1 | **Team 成员定义层** | DSH 没有"team member 定义"概念——角色配置从何加载。我们采用统一的 `TeamMemberDefinition` 类型（`role: "leader" \| "teammate"`），Leader 和 teammate 共用相同的配置粒度 | 核心 | **插件新建**: team member definition registry + Markdown/YAML loader |
| G2 | **Team 编排层** | 无 leader 驱动的委派调度器、无 `delegate_to_teammate` tool | 核心 | **插件新建**: team orchestrator + model-facing delegation tool |
| G3 | **Per-member MCP 过滤** | `mcp-client` 注册到全局 `ctx.tools`，无 per-scope MCP 过滤。MCP 工具命名为 `mcp__<serverName>__<rawName>`；启动时枚举工具会漏掉晚连接或重连后新增的 MCP 工具。⚠️ PilotDeck 的 MCP 过滤实现有已知 bug，**禁止参考其代码** | 高 | **独立实现**：每次 `system-prompt/assemble` 动态移除未授权 MCP schemas，并用 per-scope `tools.guard()` 拒绝绕过 prompt 的执行；策略由 durable `team/member-bound` composition metadata 在首次创建和 cold resume 前安装 |
| G4 | **Per-teammate Skill 过滤** | Skill registry 支持 scope layering（per-agent scope 可见不同 skill set），但无第一类 per-agent allowlist/denylist API。子 agent 通过 `composeFrom` 继承父 preset 的全部 skills，无 skill filter 机制 | 中 | **插件层面**: 在 child agent scope 中注入过滤后的 skill catalog（scoped section 或 `tools/pre-execute` 拦截 skill tool） |
| G5 | **Per-teammate 上下文窗口** (`maxContextTokens`) | `AgentOptions` 只有 `maxTokens` (output)，无 context token 限制 | 中 | Phase 1 先用 `maxTokens` 覆盖 output；如需 context 限制，通过 compaction 策略或后续 PR 扩展 `AgentOptions` |
| G6 | **Leader 审批协调器** | DSH `ctx.interaction` 是 human↔agent 审批，缺少 agent↔agent 审批通道（teammate 请求 leader 批准） | 高 | **插件新建**: team control coordinator，teammate 的 `tools/pre-execute` 挂起 → leader followup → resume |
| G7 | **Team 消息通道** | 需要结构化 leader↔teammate 消息队列（区别于 continuable subagent 的 followup 原语） | 高 | **插件新建**: `send_team_message` tool + session event 持久化，底层复用 `followup()` / `reportFrom()` |
| G8 | **任务进度追踪** | DSH `ctx.goals` 是单 agent goal，无 team-wide task progress | 中 | **插件新建**: `team_progress` tool + session event |
| G9 | **上下文重载策略** (`fresh_per_delegation`) | Continuable subagent 天然 persistent，但缺少"每次 delegation 重置上下文"选项 | 中 | **插件层面**: `fresh` = 每次启新 one-shot subagent；`persistent` = continuable subagent followup |
| G10 | **Workspace binding / enablement** | DSH profile 无 per-workspace × per-teammate 启用控制 | 低 | **插件层面**: 利用 `ctx.settings` 存储 per-workspace teammate enablement |
| G11 | **Tool 条件化约束** (pathWithin, executableEquals) | DSH `ToolRestriction` 只有 allow/deny name list，无条件匹配 | 低(Phase 4) | 通过 `tools/pre-execute` waterfall 注入 per-teammate path/command 条件检查 |

---

## 三、具体开发计划

### Phase 0: 技术验证（PoC）

**目标**: 最小可运行的 leader + 1 teammate 委派循环

**范围**:

1. 创建一个 function plugin `dsh-agent-team`，作为 Cordis entry
2. 硬编码一个 teammate 定义（先不做 Markdown 加载）
3. Leader agent 通过 `delegate_to_teammate` tool 将任务委派给 teammate
4. Teammate 以 continuable subagent 形态运行：
   - 使用 `SubagentStartRequest.persona` 注入角色 prompt
   - 使用 `SubagentStartRequest.toolFilter` 限制可用 tools
   - 使用 `AgentOptions.model` 设置独立模型
5. Teammate 完成后通过 settled notice 自动通知 leader

**产出**: 最小 PoC plugin + 一组 vitest 单元测试

**验证点**: teammate 确实使用了指定的 persona/tools/model，leader 确实收到了 teammate 的完成通知

---

### Phase 1: Teammate 定义与加载系统 [对应 G1, G5, G10]

**包结构**: `packages/team/team/`（Service Definition）+ `packages/team/team-local/`（本地定义加载）

| 任务 | 描述 | 对应缺失 |
|---|---|---|
| 1.1 定义 `TeamMemberDefinition` 类型 | 统一类型，`role`(`"leader"` \| `"teammate"`)、`id`、`name`、`description`、`prompt`、`model`、`maxTokens`、`tools`(allow/deny)、`skills[]`、`mcpServers[]`、`contextPolicy`、源文件路径。Leader 和 teammate 共用同一类型，仅 `role` 字段区分 | G1 |
| 1.2 Markdown 解析器 | YAML frontmatter (`---` 分隔) + Markdown body → `TeamMemberDefinition`；校验 schemaVersion、必填字段、字段类型 | G1 |
| 1.3 Team member registry service | `ctx.team` Service（shipped 名称，原名 `ctx.teamDefinitions` 已追认变更）— `list()` / `get(id)` / `getLeader()` / `validate()`；effect-scoped，HMR-safe | G1 |
| 1.4 Filesystem discovery provider | 从 `$DSH_HOME/teammates/` 和项目级 `.dsh/teammates/` 扫描 `.md` 文件加载（leader 定义可放在同一目录，以 `role: leader` 区分） | G1 |
| 1.5 Leader 定义 | Leader 采用与 teammate 相同的 Markdown 定义格式，支持全部配置字段。Leader 默认自动获得 10 个 team 控制 tools（`DEFAULT_LEADER_TOOLS` 常量），用户配置的 `tools` 字段与默认 tools 合并（`effectiveTools = DEFAULT_LEADER_TOOLS ∪ definition.tools`），确保 team 控制能力不可被误移除 | G1 |
| 1.6 Workspace enablement | 利用 `ctx.settings` 存储 per-workspace teammate enablement（启用/禁用/tool profile 覆盖）| G10 |
| 1.7 `maxContextTokens` 处理 | 如果 `AgentOptions` 不支持，则在 plugin 层通过 compaction 或 prompt-assembly budget 实现等效限制 | G5 |

**测试**: unit tests (definition parsing, validation) + REAL-composition test (loader → registry → list)

---

### Phase 2: Team 运行时与委派系统 [对应 G2, G3, G4, G9]

**包结构**: `packages/team/team-runtime/`

| 任务 | 描述 | 对应缺失 |
|---|---|---|
| 2.1 `TeamOrchestrator` | Session-scoped service，管理当前 session 的所有 teammate activations，维护 in-flight set | G2 |
| 2.2 `delegate_to_teammate` tool | `defineTool` 注册的 model-facing tool：参数 `teammateId`, `action`(run/follow_up/shutdown), `prompt`, `taskId`；仅 leader 可调用（teammate 的 deny list 包含此 tool）。Leader 本身可使用全部已配置的 tools + 10 个默认 team 控制 tools；UI render intent: `card` | G2 |
| 2.3 Teammate session 构建 | 利用 `ctx.subagents.startContinuable()` 创建：注入 persona (prompt body), tool restriction (from definition.tools), AgentOptions (model/maxTokens)。Team 插件通过自定义 `team/member-bound` session event 持久化完整 member 策略（包括 maxTokens、mcpServers allow、skills allow），cold resume 时从 session log 重建而非依赖 continuable descriptor（descriptor 故意不持久化 maxTokens） | G2 |
| 2.4 Context policy | `persistent` → `followup()` 到同一 continuable child；`fresh_per_delegation` → 每次新建 one-shot subagent (`ctx.subagents.start()`) | G9 |
| 2.5 Per-member MCP 过滤 | **独立实现（禁止参考 PilotDeck MCP 代码）**。采用双重策略防止 MCP 工具泄漏：(1) per-scope `tools.guard()` 动态拒绝不在 `definition.mcpServers` 中的 `mcp__<server>__*` 执行（不依赖启动时枚举，覆盖 MCP 晚连接/重连后新增工具）；(2) scoped `tools/pre-execute` waterfall deny 匹配项。基于 DSH 原生 `ToolGuard` + `ToolRestriction` 机制 | G3 |
| 2.6 Per-teammate Skill 过滤 | 在 child agent scope 中注册过滤后的 skill catalog prompt section（仅包含 `definition.skills` 中的 skills） | G4 |
| 2.7 Teammate idle 通知 | 监听 `subagent/end` 事件 → 自动向 leader 注入 `subagent-settled` notice（DSH 已内置） | — |
| 2.8 Teammate 禁止递归委派 | Teammate 的 `ToolRestriction.deny` 中包含 `delegate_to_teammate`、`team_control`、`list_teammates`，防止 teammate 再委派或操作 team 控制面 | — |
| 2.9 Leader 默认 tools | 定义 `DEFAULT_LEADER_TOOLS` 常量（10 个 tools：`delegate_to_teammate`、`send_team_message`、`team_progress`、`team_control`、`list_teammates`、`read`、`grep`、`glob`、`todo_write`、`web_search`），Leader 的 effective tools = `DEFAULT_LEADER_TOOLS ∪ definition.tools`。默认 tools 不可通过配置移除，保证 team 控制能力。插件加载时校验所有默认 tools 是否已注册，任何缺失导致加载失败 | — |

**测试**: unit tests (orchestrator state machine) + REAL-composition test (leader delegates → teammate runs → leader receives notice)

---

### Phase 3: Team 消息与控制通道 [对应 G6, G7, G8]

**包结构**: `packages/team/team-channels/`

| 任务 | 描述 | 对应缺失 |
|---|---|---|
| 3.1 `send_team_message` tool | Teammate 调用 → `reportFrom(child, content, { delivery: 'wakeup' })`；Leader 调用 → `followup(parent, childId, content)` | G7 |
| 3.2 `team_progress` tool | 读写结构化任务进度 (items: `{ id, subject, status, summary, teammateId }`)；持久化为 session event | G8 |
| 3.3 `team_control` tool (leader-only) | Leader 处理 teammate 的权限/plan 审批请求：list/read/decide(allow_once/deny/approve_plan/request_revision/escalate_to_user) | G6 |
| 3.4 Team control coordinator | Teammate 的 `tools/pre-execute` listener → 匹配 per-teammate constraints → 创建 control request → 挂起等待 → leader followup → resume/reject | G6 |
| 3.5 Team message session events | `SessionEventMap` 声明（shipped 名称，已追认）：`team/message`, `team/progress`, `team/control-request`, `team/control-decision`（另有委派所需的 `team/member-bound`） | G7 |

**测试**: unit tests (control coordinator state machine, message routing) + REAL-composition test (teammate hits permission → leader approves → teammate resumes)

---

### Phase 4: 精细化权限约束 [对应 G11]

> **状态（2026-08-20，M4）**：本节原设计（4.1–4.3 经 `tools/pre-execute` / `fs/write-intent` / `fs/edit-intent` waterfall 注入 per-teammate 决策）已被 [permission seam note](.agents/notes/implemented/architecture/2026-08-15-permission-seam-and-mcp-fusion.md) 取代：参数级规则引擎（path/command/MCP/param 四类 matcher、`deny > ask > allow` 分层解析、per-scope 权限模式）在 `tools/pre-execute` 执行器边界统一裁决，`fs-observation-policy` 的两个 waterfall 决策槽保持独占不动。Stage 1 已实现（逐条测试映射见 note 的 Testing 节）；Stage 2（MCP 融合）与 Stage 3（加固）暂缓。下文任务表保留作历史参照。

**扩展**: `packages/team/team-runtime/` 内新增

| 任务 | 描述 | 对应缺失 |
|---|---|---|
| 4.1 条件化 tool 约束 | 在 child agent 的 `tools/pre-execute` waterfall 中注入 per-teammate 条件匹配器：`pathWithin(dir)` 限制文件操作范围、`executableEquals(cmd)` 限制可执行命令 | G11 |
| 4.2 Per-teammate filesystem policy | 通过 `fs/write-intent` / `fs/edit-intent` waterfall 注入 scope-filtered 路径决策 | G11 |
| 4.3 Per-teammate permission snapshot | 将 leader 当前 permission mode + rules 快照传递给 teammate session，teammate 在此基础上叠加自身约束 | G11 |

**测试**: unit tests (condition matching) + REAL-composition test (teammate write to forbidden path → denied)

---

### Phase 5: 集成与产品化

| 任务 | 描述 |
|---|---|
| 5.1 Bundle packaging | 打包为 `dsh-bundle-team` bundle，**路线 A 随 harness 版本耦合发布**（与 `dsh-session` 同版本配套，见 4.6）。已存在 `packages/bundle/team/` |
| 5.2 Web client 集成 | Team progress panel（`ConversationNodeDefinition`），teammate 状态显示，message timeline |
| 5.3 CLI 集成 | `dsh teammate list` / `dsh teammate add <file>` / `dsh teammate enable <id>` / `dsh teammate disable <id>` |
| 5.4 Documentation | Package README、config-catalog entries、cookbook guide（`docs/cookbook/adding-agent-team.md`） |
| 5.5 Agent Note | 决策记录：为什么选择 continuable subagent 而非独立 session、per-teammate scope 实现选择 |
| 5.6 独立化迁移接口 | 保持 team 事件声明集中于 `events.ts` 单一接触面（见 4.6），不在其它模块散布词汇表假设。**独立发布本身推迟**到基座支持运行时事件注册面后 |

---

## 四、技术决策要点

### 4.1 插件形态

- **Team member definition registry** → **Service subclass** (default export extends Service)，提供 `ctx.teamDefinitions`
- **Team runtime/orchestrator/tools** → **function plugin** (named exports, no default export)，session-scoped 行为

### 4.2 Leader 统一配置与默认 tools

**决策**：Leader 与 teammate 共用 `TeamMemberDefinition` 类型（仅 `role` 字段区分），不采用 PilotDeck 的 Leader 工具锁定。

**理由**：PilotDeck 将 Leader 锁定为纯协调角色（`TEAM_MODE_CORE_TOOLS` only），限制了灵活性。用户可能希望 Leader 在协调之外也承担特定领域工作（如代码审查、文档编写、测试执行等）。统一定义格式降低了认知负担和配置复杂度。

**安全保障**：Leader 默认自动获得 10 个 team 控制 tools（不可通过配置移除），防止不当配置导致 team 无法运行：

| # | 默认 Tool | 用途 | 不可移除理由 |
|---|---|---|---|
| 1 | `delegate_to_teammate` | 委派任务给 teammate | team 编排核心 |
| 2 | `send_team_message` | 发送 team 消息 | team 通信核心 |
| 3 | `team_progress` | 读写任务进度 | team 状态管理 |
| 4 | `team_control` | 审批 teammate 请求 | team 权限控制 |
| 5 | `list_teammates` | 列出可用 teammates | team 发现 |
| 6 | `read` | 读取文件 | 编排决策依据 |
| 7 | `grep` | 搜索文件内容 | 编排决策依据 |
| 8 | `glob` | 搜索文件路径 | 编排决策依据 |
| 9 | `todo_write` | 任务列表管理 | 工作追踪 |
| 10 | `web_search` | 信息检索 | 研究与决策 |

`effectiveTools = DEFAULT_LEADER_TOOLS ∪ definition.tools`（合并，非替换）

### 4.3 MCP 过滤独立实现

**决策**：Per-agent MCP 过滤基于 DSH 原生 `ToolRestriction` 机制独立实现，禁止参考/复用 PilotDeck 的 `TeammateExtensionResolver.listMcpInstructions()` 代码。

**理由**：PilotDeck 的 teammate MCP 挂载检测存在已知 bug（teammate 经常检测不到 MCP 挂载），其实现不可靠。DSH 的 `ToolRestriction`（声明式 allow/deny by tool name）提供了更可靠的 name-based 过滤机制。

### 4.4 复用 vs 新建决策矩阵

| 需求 | 复用 DSH 现有机制 | 新建理由 |
|---|---|---|
| Teammate agent 生命周期 | ✅ `ctx.subagents` continuable/one-shot | — |
| Per-agent tool filter | ✅ `ToolRestriction` + `registerContinuableSetup()` | — |
| Per-agent persona | ✅ `SubagentStartRequest.persona` | — |
| Per-agent model | ✅ `AgentOptions.provider/model/maxTokens` | — |
| Teammate → leader 报告 | ✅ `reportFrom()` + settled notice | — |
| Leader → teammate 消息 | ✅ `followup()` | — |
| Teammate 定义加载 | — | DSH 无 team member 概念 |
| Leader 定义加载 | — | 与 teammate 共用 `TeamMemberDefinition`，统一 loader |
| Team progress | — | DSH goal 是单 agent 的 |
| Leader 审批通道 | — | DSH interaction 是 human↔agent |
| Workspace enablement | ✅ `ctx.settings` 存储 | 需要 thin layer |

### 4.5 DSH 合规性检查清单

- [ ] function plugin 无 default export
- [ ] Service subclass 有 default export
- [ ] 所有 registry 贡献通过 `ctx.effect()` / `ctx.on()` 注册，返回 disposer
- [ ] HMR-safety test 覆盖每个 registry contribution
- [ ] REAL-composition test（boot `cordis.yml` 通过 Loader）
- [ ] 新 session event → `SessionEventMap` 声明 merging，`@mode` 和 `@param` JSDoc
- [ ] tool schema 符合 `defineTool` contract，UI render intent 显式声明
- [ ] Config 字段通过 schemastery 验证，无硬编码 tunables
- [ ] 不使用 default export 的 function plugin 中的 `inject` 列出依赖
- [ ] README + JSDoc + Agent Note 同步
- [ ] `./invariant` 注册或 empty-with-reason
- [ ] 文件以恰好一个 trailing newline 结尾

### 4.6 发布策略与独立化迁移接口

**决策**：team mode 采用**路线 A——随 harness 版本耦合发布**（`dsh-bundle-team` 与 `@deepseek-ai/dsh-session` 同版本配套），暂不作为真正独立的第三方插件发布。同时在代码结构上**保留独立化迁移接口**，待 dsh 基座支持运行时会话事件类型注册后，再将其转为单独插件。

**背景（唯一运行时耦合）**：team 的 5 个持久化事件（`team/member-bound` / `message` / `progress` / `control-request` / `control-decision`）通过声明合并并入 `@deepseek-ai/dsh-session/types` 的 `SessionEventMap`，并由 `gen-persistence-catalog` 生成进核心包 `packages/core/session/src/known-event-types.ts` 的运行时词汇表。持久化读取路径（`session-persistence` coordinator 的 `assertEventsSupported`）对词汇表之外、且未标 `ignorable` 的事件会拒绝解读日志。由于 `team/member-bound` 是冷恢复依据、不能 ignorable，team 日志的可读性依赖"宿主 harness 的词汇表认识 team 事件"。当前基座**不存在**让仓库外插件在运行时注册事件类型的机制（`known-event-types.ts` 注释明确该注册面"被推迟到出现这类消费者为止"）。

**除该点外无其它运行时耦合**：插件区域外的代码零反向 import team 包；`apps/`、`examples/` 零引用；team 各包仅依赖公开 seam（dsh-session / dsh-tools / dsh-agent / dsh-subagent / dsh-system-prompt）与 vendored 框架（cordis / schemastery）。

**保留的迁移接口**（降低未来独立化成本）：

- 全部 team 事件的声明与 payload 类型**集中于单一模块** `packages/team/team/src/events.ts`——这是与基座词汇表的唯一接触面。独立化时只需把该模块从"声明合并 + 生成词汇表"改为"挂载时向注册面登记"，不触及 team 其它代码。
- 不在 team 其它模块散布对事件词汇表机制的假设；冷恢复读取 `team/member-bound` 的逻辑（`team-runtime/src/member-setup.ts`）只依赖事件内容本身，不依赖词汇表如何被认识。
- 保持 team 事件 payload 类型自包含（均在 `packages/team/team/src/types.ts`），不依赖核心内部类型。

**为何暂不采用路线 B（真正独立发布）**：需先在基座实现"会话事件类型运行时注册面"（核心层改动，非 team 插件自身可完成）。在基座具备该能力前，路线 A 以版本对齐消化耦合，成本最低。

**触发独立化的条件**：dsh 基座提供运行时会话事件注册能力后，将 team 事件改为运行时注册，解除对生成词汇表的依赖，即可作为独立插件发布。届时 `packages/core/session/src/known-event-types.ts` 中的 `team/*` 条目与 `docs/persistence-catalog.md` 的 team 事件随之移除。

---

## 五、依赖与风险

| 风险 | 缓解措施 |
|---|---|
| Leader 不当配置导致 team 无法运行 | `DEFAULT_LEADER_TOOLS`（10 个）不可通过配置移除，`effectiveTools = DEFAULT_LEADER_TOOLS ∪ definition.tools` 合并策略保证 team 控制能力始终存在 |
| PilotDeck MCP 过滤 bug 传播 | MCP per-agent 过滤完全独立实现，基于 DSH 的 `ToolRestriction` 机制，禁止参考 PilotDeck `TeammateExtensionResolver` 代码 |
| `AgentOptions` 无 `maxContextTokens` 字段 | Phase 1 先用 `maxTokens` 覆盖 output tokens；context 限制通过 compaction 策略实现；后续可提 PR 扩展 `AgentOptions` |
| MCP tool per-scope 过滤需要动态策略 | 不使用启动时枚举 deny list（会漏掉晚连接/重连后新增工具）；改用 per-scope `tools.guard()` 在每次执行时动态检查 `mcp__<server>__*` 前缀是否在 allowlist 中，覆盖全部运行时变化 |
| Teammate 敏感操作审批挂起 agent loop | `tools/pre-execute` waterfall 返回 promise 可以挂起执行；leader 通过 `followup()` 传递决策后 resolve。需要注意超时处理 |
| 多 teammate 并发 in-flight | Continuable subagent 已支持并发 activation；在 team orchestrator 层限制同一 teammate 同时只有一个 in-flight delegation（与 PilotDeck 行为一致） |
| Teammate 重新委派形成递归 | Teammate 的 tool restriction 显式 deny `delegate_to_teammate`；`maxDepth` 提供额外保护 |
| Cold resume 后 team state 恢复 | Continuable subagent 的 descriptor 持久化 provider/model/persona/toolFilter；team progress 通过 session event 恢复 |
| team 事件词汇表耦合核心、阻碍独立发布 | 采用路线 A 随 harness 版本耦合发布消化（见 4.6）；事件声明集中于 `events.ts` 单一接触面，待基座提供运行时事件注册面后再独立化。team 插件**不得**在 `events.ts` 之外引用词汇表机制 |

---

## 六、详细编码计划

> 本节将 §三 的高层 Phase 0–5 细分为可直接编码的模块、文件、接口契约、测试要求，并预分配 subagent 编码任务与模型。

### 6.0 Package 总览与组别

新增 `packages/team/` 组，在 `packages/README.md` 追加行。npm scope 一律 `@deepseek-ai/dsh-<pkg>`。

| Package | npm 名 | 插件形态 | `ctx.*` key | 角色 |
|---|---|---|---|---|
| `packages/team/team/` | `dsh-team` | Service subclass (default export) | `ctx.team` | **Service Definition**：类型、事件、抽象接口 |
| `packages/team/team-local/` | `dsh-team-local` | function plugin | — | **Service Provider**：本地 Markdown 定义加载 |
| `packages/team/team-runtime/` | `dsh-team-runtime` | function plugin | — | **Consumer**：运行时编排、委派 tools、MCP/skill 过滤 |
| `packages/team/team-channels/` | `dsh-team-channels` | function plugin | — | **Consumer**：消息通道、进度追踪、审批协调器 |
| `packages/team/tool-team/` | `dsh-tool-team` | function plugin | — | **Consumer**：model-facing team tools 统一注册 |
| `packages/bundle/team/` | `dsh-bundle-team` | bundle manifest | — | 安装入口，`cordis.yml` 聚合上述 5 个包 |

依赖方向（下层不依赖上层）：
```
dsh-bundle-team
  ├─ dsh-tool-team         ← 注册所有 team tools
  ├─ dsh-team-channels     ← 消息/进度/审批
  ├─ dsh-team-runtime      ← 编排/委派/过滤
  ├─ dsh-team-local        ← Markdown loader
  └─ dsh-team              ← Service Definition (types + events)
       └─ dsh-subagent, dsh-tools, dsh-agent, dsh-session (peer)
```

---

### 6.1 Package 1: `dsh-team`（Service Definition）

**路径**: `packages/team/team/`

#### 6.1.1 文件清单

```
src/
  index.ts          — TeamRegistry Service subclass (default export), ctx.team
  types.ts          — TeamMemberDefinition, TeamMemberRole, TeamToolPolicy, TeamSkillPolicy, TeamMcpPolicy, TeamContextPolicy
  events.ts         — SessionEventMap declaration merging: team/* events
  brand.ts          — TeamMemberId branded type
  invariant.ts      — runtime invariant (or explained empty)
  constants.ts      — DEFAULT_LEADER_TOOLS, TEAM_SESSION_EVENT_TYPES
tests/
  types.spec.ts     — type-level tests (expectTypeOf)
  brand.spec.ts     — brand round-trip
  constants.spec.ts — DEFAULT_LEADER_TOOLS completeness assertion
README.md
package.json
tsconfig.json
```

#### 6.1.2 核心 TypeScript 接口

```typescript
// brand.ts
import { Branded } from '@deepseek-ai/dsh-brand'
export type TeamMemberId = Branded<'TeamMemberId'>
export const TeamMemberId = Branded.create<TeamMemberId>()

// types.ts
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { TeamMemberId } from './brand.ts'

export type TeamMemberRole = 'leader' | 'teammate'

export type TeamContextPolicy = 'persistent' | 'fresh_per_delegation'

export interface TeamToolPolicy {
  /** allow/deny name list; 与 ToolRestriction 对齐 */
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

export interface TeamMcpPolicy {
  /** 仅列出此 member 可访问的 MCP server names。未列出的全部 deny */
  readonly servers: readonly string[]
}

export interface TeamSkillPolicy {
  /** 仅列出此 member 可加载的 skill names。未列出的不出现在 catalog */
  readonly allow: readonly string[]
}

export interface TeamMemberDefinition {
  readonly id: TeamMemberId
  readonly role: TeamMemberRole
  readonly name: string
  readonly description: string
  /** Markdown body → persona prompt */
  readonly prompt: string
  /** LLM provider route (e.g. 'deepseek-official', 'Qiyuan-Inter') */
  readonly provider?: string
  /** Model id for this member */
  readonly model?: string
  /** Max output tokens */
  readonly maxTokens?: number
  /** Tool allow/deny policy */
  readonly tools?: TeamToolPolicy
  /** Skill filter policy */
  readonly skills?: TeamSkillPolicy
  /** MCP server access policy */
  readonly mcpServers?: TeamMcpPolicy
  /** Context window reload strategy */
  readonly contextPolicy?: TeamContextPolicy
  /** Source file path (diagnostic only, not persisted) */
  readonly sourcePath?: string
}

// events.ts — SessionEventMap merging
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable binding of a child session to a team member definition.
     * Appended once in the child's initial turn. Carries the full effective
     * policy so cold resume reconstructs without the parent's live registry.
     * @mode append
     * @param data - the member id, role, and resolved policy snapshot.
     */
    'team/member-bound': TeamMemberBoundData
    /**
     * Team progress item created or updated.
     * @mode append
     * @param data - the progress entry.
     */
    'team/progress': TeamProgressData
    /**
     * Control request from a teammate to the leader.
     * @mode append
     * @param data - request id, teammate, tool name, and reason.
     */
    'team/control-request': TeamControlRequestData
    /**
     * Leader's decision on a control request.
     * @mode append
     * @param data - request id and decision.
     */
    'team/control-decision': TeamControlDecisionData
  }
}

export interface TeamMemberBoundData {
  readonly memberId: TeamMemberId
  readonly role: TeamMemberRole
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
  readonly tools?: TeamToolPolicy
  readonly skills?: TeamSkillPolicy
  readonly mcpServers?: TeamMcpPolicy
  readonly contextPolicy?: TeamContextPolicy
}

export interface TeamProgressData {
  readonly taskId: string
  readonly subject: string
  readonly status: 'pending' | 'in_progress' | 'completed' | 'blocked'
  readonly summary?: string
  readonly memberId: TeamMemberId
}

export interface TeamControlRequestData {
  readonly requestId: string
  readonly memberId: TeamMemberId
  readonly toolName: string
  readonly reason: string
  readonly arguments?: Record<string, unknown>
}

export type TeamControlDecision = 'allow_once' | 'deny' | 'escalate_to_user'

export interface TeamControlDecisionData {
  readonly requestId: string
  readonly decision: TeamControlDecision
  readonly reason?: string
}

// constants.ts
/**
 * The 10 tools every leader receives unconditionally.
 * Plugin load fails if any is absent from the global tool registry.
 */
export const DEFAULT_LEADER_TOOLS = [
  'delegate_to_teammate',
  'send_team_message',
  'team_progress',
  'team_control',
  'list_teammates',
  'read',
  'grep',
  'glob',
  'todo_write',
  'web_search',
] as const satisfies readonly string[]

// index.ts — Service Definition
import { Service } from '@deepseek-ai/cordis'
import type { TeamMemberDefinition, TeamMemberBoundData } from './types.ts'
import type { TeamMemberId } from './brand.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    team: TeamRegistry
  }
}

export default abstract class TeamRegistry extends Service {
  constructor(ctx: Context) { super(ctx, 'team') }

  /** List all loaded member definitions. */
  abstract list(): readonly TeamMemberDefinition[]
  /** Get one member by id. */
  abstract get(id: TeamMemberId): TeamMemberDefinition | undefined
  /** Get the leader definition. Exactly one leader must exist. */
  abstract getLeader(): TeamMemberDefinition
  /** Validate all definitions; throws on conflict. */
  abstract validate(): void
  /** Resolve effective tools for a member (leader gets DEFAULT_LEADER_TOOLS merged). */
  abstract effectiveToolPolicy(member: TeamMemberDefinition): ToolRestriction
}
```

#### 6.1.3 测试要求

| 测试类 | 覆盖点 |
|---|---|
| `constants.spec.ts` | `DEFAULT_LEADER_TOOLS` 长度 = 10；每个名称是合法 tool name 格式 |
| `types.spec.ts` | `TeamMemberDefinition` 类型兼容性（expectTypeOf） |
| `brand.spec.ts` | `TeamMemberId` 构造 / 解构 round-trip |

---

### 6.2 Package 2: `dsh-team-local`（Service Provider — Markdown 加载）

**路径**: `packages/team/team-local/`

#### 6.2.1 文件清单

```
src/
  index.ts          — function plugin: apply(ctx, config)
  parser.ts         — YAML frontmatter + Markdown body → TeamMemberDefinition
  discovery.ts      — filesystem scan: $DSH_HOME/teammates/ + .dsh/teammates/
  validation.ts     — cross-definition validation (unique ids, exactly one leader)
  config.ts         — Config schema (schemastery)
  invariant.ts      — empty (validation in discovery)
tests/
  parser.spec.ts    — frontmatter parsing: valid / invalid / edge cases
  discovery.spec.ts — mock fs scan → definition list
  validation.spec.ts — duplicate id / no leader / multi-leader rejection
  loader-composition.spec.ts — REAL-composition: cordis.yml → Loader → ctx.team.list()
  fixtures/
    valid-leader.md
    valid-teammate.md
    invalid-no-role.md
    invalid-bad-model.md
README.md
package.json
tsconfig.json
```

#### 6.2.2 Markdown 定义格式

```markdown
---
schemaVersion: 1
id: backend-dev
role: teammate
name: Backend Developer
description: Handles server-side logic, API design, and database operations.
provider: Qiyuan-Inter
model: deepseek-v4-flash-0731
maxTokens: 16384
tools:
  allow: [read, edit, write, grep, glob, pwsh]
skills:
  allow: [codebase-design, tdd, diagnosing-bugs]
mcpServers:
  servers: [postgres-mcp, redis-mcp]
contextPolicy: persistent
---

You are a senior backend developer specializing in Node.js and TypeScript...
(rest of the Markdown body becomes the persona prompt)
```

#### 6.2.3 核心接口

```typescript
// parser.ts
export interface ParseResult {
  readonly definition: TeamMemberDefinition
  readonly diagnostics: readonly ParseDiagnostic[]
}
export interface ParseDiagnostic {
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly line?: number
}
/**
 * Parse one Markdown file into a TeamMemberDefinition.
 * @param content - raw UTF-8 file content.
 * @param sourcePath - filesystem path for diagnostics.
 * @returns parsed definition and any diagnostics.
 * @throws when schemaVersion is unsupported or required fields are missing.
 */
export function parseTeamMemberMarkdown(
  content: string,
  sourcePath: string,
): ParseResult

// discovery.ts
export interface DiscoveryOptions {
  readonly homePath: string
  readonly workspacePath?: string
  readonly signal?: AbortSignal
}
/**
 * Scan configured directories for .md teammate definitions.
 * @returns all discovered definitions in stable order.
 */
export function discoverTeamMembers(
  options: DiscoveryOptions,
): Promise<readonly ParseResult[]>

// validation.ts
/**
 * Cross-validate a set of definitions.
 * @throws on duplicate ids, missing leader, or multiple leaders.
 */
export function validateTeamDefinitions(
  definitions: readonly TeamMemberDefinition[],
): void
```

#### 6.2.4 测试要求

| 测试类 | 覆盖点 |
|---|---|
| `parser.spec.ts` | 合法 leader/teammate 定义解析；缺少必填字段报 error diagnostic；未知 schemaVersion 报错；空 prompt body 报 warning |
| `discovery.spec.ts` | 多目录扫描去重（同 id 后者覆盖前者）；忽略非 `.md` 文件；空目录返回空数组 |
| `validation.spec.ts` | 重复 id → Error；无 leader → Error；多个 leader → Error；合法集合 → 无抛出 |
| `loader-composition.spec.ts` | REAL-composition: `cordis.yml` 加载 `dsh-team` + `dsh-team-local` → `ctx.team.list()` 返回 fixtures 中的定义 |

---

### 6.3 Package 3: `dsh-team-runtime`（Consumer — 编排与委派）

**路径**: `packages/team/team-runtime/`

#### 6.3.1 文件清单

```
src/
  index.ts              — function plugin: apply(ctx, config)
  orchestrator.ts       — TeamOrchestrator: session-scoped activation manager
  delegation.ts         — delegate_to_teammate 委派逻辑
  mcp-guard.ts          — per-member MCP tool guard (动态 prefix matching)
  skill-filter.ts       — per-member skill catalog 过滤
  tool-policy.ts        — leader effective tools + teammate deny list 构建
  member-setup.ts       — registerContinuableSetup contribution: 从 session log team/member-bound 事件恢复策略
  cold-resume.ts        — cold resume: 从 team/member-bound session event 重建 per-member composition
  config.ts             — Config schema
  invariant.ts          — DEFAULT_LEADER_TOOLS 存在性校验
tests/
  orchestrator.spec.ts  — activation state machine: start → running → settled → disposed
  delegation.spec.ts    — delegate happy path / unknown teammate / depth exceeded
  mcp-guard.spec.ts     — guard admits allowed servers, denies others, handles late-registered tools
  skill-filter.spec.ts  — allowed skills appear, others hidden
  tool-policy.spec.ts   — leader effective = default ∪ config; teammate deny includes team tools
  member-setup.spec.ts  — continuable setup contribution installs guard + restriction from session event
  cold-resume.spec.ts   — persisted team/member-bound → restored composition
  composition.spec.ts   — REAL-composition: leader delegates → teammate runs → leader receives settled notice
README.md
package.json
tsconfig.json
```

#### 6.3.2 核心接口

```typescript
// orchestrator.ts
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TeamMemberId } from '@deepseek-ai/dsh-team'

export interface TeammateActivation {
  readonly memberId: TeamMemberId
  readonly childSessionId: SessionId
  readonly status: 'running' | 'settled' | 'disposed'
}

/**
 * Session-scoped orchestrator managing teammate activations.
 * At most one active delegation per teammate at any time.
 */
export class TeamOrchestrator {
  /**
   * Start or resume a teammate as a continuable subagent.
   * @param leader - the delegating leader agent.
   * @param memberId - which teammate to activate.
   * @param prompt - the delegation task content.
   * @param signal - cancellation from the tool execution.
   * @returns the child session id and accepted message id.
   * @throws when the teammate is already in-flight or unknown.
   */
  delegate(
    leader: Agent,
    memberId: TeamMemberId,
    prompt: string,
    signal: AbortSignal,
  ): Promise<TeammateActivation>

  /** Follow up with an existing teammate activation. */
  followUp(
    leader: Agent,
    memberId: TeamMemberId,
    content: string,
    signal: AbortSignal,
  ): Promise<void>

  /** List all current activations. */
  activations(): readonly TeammateActivation[]

  /** Get activation by member id. */
  activation(memberId: TeamMemberId): TeammateActivation | undefined
}

// mcp-guard.ts
import type { ToolGuard } from '@deepseek-ai/dsh-tools'
import type { TeamMcpPolicy } from '@deepseek-ai/dsh-team'

/**
 * Create a ToolGuard that dynamically denies MCP tools not in the member's
 * mcpServers allowlist. Checks tool name prefix `mcp__<server>__` at
 * execution time, covering late-connected and reconnected MCP servers.
 *
 * @param policy - the member's MCP policy (allowed server names).
 * @returns a ToolGuard suitable for `ctx.tools.guard()`.
 */
export function createMcpGuard(policy: TeamMcpPolicy): ToolGuard

// skill-filter.ts
/**
 * Install a scoped skill catalog filter on a child agent context.
 * Skills not in the allow list are excluded from the agent/pre-step
 * catalog injection.
 *
 * @param childCtx - the child's unpublished scoped context.
 * @param allowedSkills - skill names the member may use.
 * @returns disposer revoking the filter.
 */
export function installSkillFilter(
  childCtx: Context,
  allowedSkills: readonly string[],
): () => void

// tool-policy.ts
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'

/**
 * Build the effective ToolRestriction for a member.
 * - Leader: allow = DEFAULT_LEADER_TOOLS ∪ definition.tools.allow;
 *   deny = definition.tools.deny (DEFAULT_LEADER_TOOLS never denied)
 * - Teammate: allow/deny from definition.tools;
 *   deny always includes team control tools (delegate_to_teammate, etc.)
 */
export function buildToolRestriction(
  member: TeamMemberDefinition,
): ToolRestriction

// member-setup.ts
import type { ContinuableSetupContribution } from '@deepseek-ai/dsh-subagent'

/**
 * A ContinuableSetupContribution that reads the team/member-bound event
 * from the child session log and reinstalls the member's composition:
 * MCP guard, skill filter, tool restriction, and maxTokens.
 *
 * If no team/member-bound event exists in the child log, the contribution
 * is a no-op (the child is not a team member).
 */
export function teamMemberSetupContribution(): ContinuableSetupContribution
```

#### 6.3.3 MCP Guard 实现要点

```typescript
// mcp-guard.ts 核心逻辑（伪代码）
const MCP_PREFIX = 'mcp__'

export function createMcpGuard(policy: TeamMcpPolicy): ToolGuard {
  const allowedPrefixes = new Set(
    policy.servers.map(server => `${MCP_PREFIX}${server}__`)
  )
  // ToolGuard: return denial reason string or undefined (allow)
  return (exec: ToolExecution): string | undefined => {
    const name = exec.name
    if (!name.startsWith(MCP_PREFIX)) return undefined // 非 MCP tool → 不管
    // 检查是否匹配任何允许的 server prefix
    for (const prefix of allowedPrefixes) {
      if (name.startsWith(prefix)) return undefined // 在 allowlist → 放行
    }
    // 提取 server name 用于诊断消息
    const serverEnd = name.indexOf('__', MCP_PREFIX.length)
    const server = serverEnd > 0 ? name.slice(MCP_PREFIX.length, serverEnd) : '(unknown)'
    return `MCP server "${server}" is not authorized for this team member`
  }
}
```

**关键设计**：guard 在每次 tool execution 时动态评估 tool name prefix，不依赖启动时枚举。MCP server 晚连接/重连/添加新 tool 均被覆盖。

#### 6.3.4 Cold Resume 流程

```
child session log 包含:
  [0] subagent/descriptor  (provider, model, persona, toolFilter — DSH 原生)
  [1] team/member-bound    (memberId, role, maxTokens, mcpServers, skills — team 扩展)

Cold resume 路径:
  1. SubagentContinuationManager.coldResume() 恢复 descriptor → 安装 persona + toolFilter
  2. registerContinuableSetup contribution (teamMemberSetupContribution) 被调用:
     a. 从 child session log 读取 team/member-bound 事件
     b. 如存在 → 安装 MCP guard, skill filter, maxTokens override
     c. 如不存在 → no-op（非 team member child）
```

#### 6.3.5 测试要求

| 测试类 | 覆盖点 |
|---|---|
| `orchestrator.spec.ts` | 首次委派创建 activation；重复委派同一 teammate → 拒绝；settled 后再委派 → 创建新 activation |
| `delegation.spec.ts` | 委派已知 teammate → 调用 startContinuable；委派未知 id → 抛错；contextPolicy=fresh → 每次 one-shot |
| `mcp-guard.spec.ts` | 允许的 server 的 tool → undefined (allow)；未授权 server → denial reason string；非 MCP tool → undefined；空 policy → 拒绝所有 MCP；MCP 工具名格式 `mcp__server__tool` 提取正确 |
| `skill-filter.spec.ts` | 允许的 skill → 出现在 catalog；未允许的 → 不出现；空 allow → 无 skill |
| `tool-policy.spec.ts` | leader effective 包含 10 个默认 + config 追加；teammate deny 包含 `delegate_to_teammate` 等；leader deny config 不可移除默认 tools |
| `member-setup.spec.ts` | 有 team/member-bound → 安装 guard + filter；无 → no-op disposer |
| `cold-resume.spec.ts` | 持久化 → 恢复 → guard/filter/maxTokens 一致 |
| `composition.spec.ts` | REAL-composition: Loader boot → leader 委派 teammate → teammate 执行 → settled notice 到达 leader |

---

### 6.4 Package 4: `dsh-team-channels`（Consumer — 消息与控制）

**路径**: `packages/team/team-channels/`

#### 6.4.1 文件清单

```
src/
  index.ts                  — function plugin: apply(ctx, config)
  control-coordinator.ts    — 审批挂起/恢复状态机
  progress-store.ts         — team progress session-event 读写
  config.ts                 — Config (controlRequestTimeoutMs)
  invariant.ts
tests/
  control-coordinator.spec.ts — 创建 request → 挂起 → leader decide → resume/reject
  progress-store.spec.ts      — write → read → update → list
  timeout.spec.ts             — 审批超时 → 自动 deny
  composition.spec.ts         — REAL-composition: teammate → permission request → leader approve → teammate resume
README.md
package.json
tsconfig.json
```

#### 6.4.2 核心接口

```typescript
// control-coordinator.ts
import type { TeamControlRequestData, TeamControlDecision } from '@deepseek-ai/dsh-team'

export interface PendingControlRequest {
  readonly data: TeamControlRequestData
  readonly resolve: (decision: TeamControlDecision) => void
  readonly createdAt: number
}

/**
 * Manages the lifecycle of teammate → leader approval requests.
 *
 * Flow:
 * 1. Teammate calls a restricted tool
 * 2. tools/pre-execute listener creates a control request and returns a Promise
 * 3. Request is logged as team/control-request session event
 * 4. Leader receives the request via settled notice or message
 * 5. Leader calls team_control tool with decision
 * 6. Decision is logged as team/control-decision session event
 * 7. Original tools/pre-execute Promise resolves → tool proceeds or is denied
 */
export class TeamControlCoordinator {
  /** Create a pending request and return its settlement promise. */
  createRequest(data: TeamControlRequestData): Promise<TeamControlDecision>

  /** Settle a pending request with the leader's decision. */
  decide(requestId: string, decision: TeamControlDecision, reason?: string): void

  /** List pending requests. */
  pending(): readonly PendingControlRequest[]

  /** Time out and auto-deny expired requests. */
  sweep(now: number, timeoutMs: number): void
}

// progress-store.ts
import type { Session } from '@deepseek-ai/dsh-session'
import type { TeamProgressData } from '@deepseek-ai/dsh-team'

/**
 * Read/write team progress backed by session events.
 * All mutations append team/progress events; reads fold them.
 */
export class TeamProgressStore {
  constructor(session: Session)

  /** Upsert a progress entry. */
  update(entry: TeamProgressData): void

  /** Read all progress entries, folded by taskId. */
  list(): readonly TeamProgressData[]

  /** Read one entry. */
  get(taskId: string): TeamProgressData | undefined
}
```

#### 6.4.3 测试要求

| 测试类 | 覆盖点 |
|---|---|
| `control-coordinator.spec.ts` | createRequest → pending 增加；decide → Promise resolves；重复 decide → 忽略；decide 未知 id → 抛错 |
| `progress-store.spec.ts` | update → get 返回最新；list 按 taskId 去重取最新；从 session events 恢复 |
| `timeout.spec.ts` | 超时 sweep → 自动 deny + Promise resolves deny |
| `composition.spec.ts` | REAL-composition: 端到端审批流 |

---

### 6.5 Package 5: `dsh-tool-team`（Consumer — Model-facing Tools）

**路径**: `packages/team/tool-team/`

#### 6.5.1 文件清单

```
src/
  index.ts                  — function plugin: apply(ctx, config)
  tool-delegate.ts          — delegate_to_teammate tool definition
  tool-send-message.ts      — send_team_message tool definition
  tool-progress.ts          — team_progress tool definition
  tool-control.ts           — team_control tool definition (leader-only)
  tool-list-teammates.ts    — list_teammates tool definition
  config.ts                 — Config schema
  invariant.ts
tests/
  tool-delegate.spec.ts
  tool-send-message.spec.ts
  tool-progress.spec.ts
  tool-control.spec.ts
  tool-list-teammates.spec.ts
  loader-composition.spec.ts
README.md
package.json
tsconfig.json
```

#### 6.5.2 Tool Schema 设计

```typescript
// tool-delegate.ts
defineTool({
  name: 'delegate_to_teammate',
  description: 'Delegate a task to a teammate. The teammate works in the background and reports back when done.',
  parameters: {
    teammate_id: { type: 'string', required: true, description: 'The teammate id from list_teammates.' },
    prompt: { type: 'string', required: true, description: 'The complete task description for the teammate.' },
    action: {
      type: 'string', required: false,
      description: 'Action: "run" starts or follows up (default), "shutdown" stops the teammate.',
      enum: ['run', 'follow_up', 'shutdown'],
    },
  },
  // UI render intent: generic (card-style)
})

// tool-list-teammates.ts
defineTool({
  name: 'list_teammates',
  description: 'List all available teammates with their roles, capabilities, and current status.',
  parameters: {},
  // Returns: { teammates: [{ id, name, description, status, model }] }
})

// tool-send-message.ts
defineTool({
  name: 'send_team_message',
  description: 'Send a message to a teammate (from leader) or report to leader (from teammate).',
  parameters: {
    target_id: { type: 'string', required: true, description: 'The teammate or leader id.' },
    message: { type: 'string', required: true, description: 'The message content.' },
  },
})

// tool-progress.ts
defineTool({
  name: 'team_progress',
  description: 'Read or update the team task progress board.',
  parameters: {
    action: { type: 'string', required: true, enum: ['list', 'update'], description: 'List all tasks or update one.' },
    task_id: { type: 'string', required: false, description: 'Required for update.' },
    subject: { type: 'string', required: false },
    status: { type: 'string', required: false, enum: ['pending', 'in_progress', 'completed', 'blocked'] },
    summary: { type: 'string', required: false },
  },
})

// tool-control.ts
defineTool({
  name: 'team_control',
  description: 'Review and decide on pending teammate permission requests.',
  parameters: {
    action: { type: 'string', required: true, enum: ['list', 'decide'], description: 'List pending or decide one.' },
    request_id: { type: 'string', required: false, description: 'Required for decide.' },
    decision: { type: 'string', required: false, enum: ['allow_once', 'deny', 'escalate_to_user'] },
    reason: { type: 'string', required: false },
  },
})
```

---

### 6.6 Package 6: `dsh-bundle-team`（Bundle Manifest）

**路径**: `packages/bundle/team/`

#### 6.6.1 文件清单

```
cordis.yml      — 聚合 5 个包的 plugin 配置
package.json
README.md
```

#### 6.6.2 cordis.yml 结构

```yaml
plugins:
  - name: '@deepseek-ai/dsh-team'
  - name: '@deepseek-ai/dsh-team-local'
    config:
      homePath: !!js process.env.DSH_HOME ?? ''
  - name: '@deepseek-ai/dsh-team-runtime'
  - name: '@deepseek-ai/dsh-team-channels'
    config:
      controlRequestTimeoutMs: 120000
  - name: '@deepseek-ai/dsh-tool-team'
```

---

### 6.7 Subagent 编码任务分配

> 编码工作在 DeepSeek Harness 下执行（而非 Codex），利用 DSH 的 subagent 能力（`SubagentStartRequest.agentOptions`）为子代理指定独立模型。以下分配利用 `Qiyuan-Inter/deepseek-v4-flash-0731`（**主力模型**，开发能力更强，承担复杂推理与核心实现任务）和 `Qiyuan-Inter/gpt-5.6-luna`（**辅助模型**，承担简单/模板化任务）。
>
> **前提**：`Qiyuan-Inter` 作为 provider route 必须在 `cordis.yml` 中通过 `dsh-llm-pi-ai` 配置注册。代码不硬编码 provider route——使用 `TeamMemberDefinition.provider` / `.model` 字段从定义文件传入。
>
> **执行环境说明**：DSH subagent 通过 `ctx.subagents.startContinuable()` 启动 in-process 子 agent，每个子 agent 可通过 `agentOptions.provider` / `agentOptions.model` 使用不同的 LLM 后端。编码 subagent 使用 spawn provider（不继承父上下文），以独立工作区文件为协作媒介。

#### 6.7.1 任务分配表

| # | 编码任务 | 推荐模型 | 分配理由 |
|---|---|---|---|
| S1 | `dsh-team` Service Definition（types + events + constants + Service 抽象类） | `deepseek-v4-flash-0731` | 接口设计是所有包的基础，需要深度推理和架构一致性保证 |
| S2 | `dsh-team-local` Markdown 解析器 + 校验 | `gpt-5.6-luna` | 成熟的 YAML/Markdown 解析，逻辑直接，模板化程度高 |
| S3 | `dsh-team-local` filesystem discovery + Service 实现 | `gpt-5.6-luna` | 文件扫描逻辑简单，主要是 fs 操作和 Service 模板填充 |
| S4 | `dsh-team-runtime` orchestrator + delegation | `deepseek-v4-flash-0731` | 核心状态机，需要正确处理并发/取消/生命周期，是 runtime 的中枢 |
| S5 | `dsh-team-runtime` MCP guard | `gpt-5.6-luna` | 逻辑简洁的 prefix matching guard，遵循固定模式 |
| S6 | `dsh-team-runtime` skill-filter + tool-policy | `gpt-5.6-luna` | 组合现有 DSH 原语（`tools.restrict` / `tools.guard`），逻辑直接 |
| S7 | `dsh-team-runtime` member-setup + cold-resume | `deepseek-v4-flash-0731` | 涉及 session log 事件重建、`registerContinuableSetup()` 集成和 `team/member-bound` 持久化 |
| S8 | `dsh-team-channels` control coordinator | `deepseek-v4-flash-0731` | 异步挂起/恢复状态机，需要正确处理 Promise 生命周期和超时清理 |
| S9 | `dsh-team-channels` progress store | `gpt-5.6-luna` | session event CRUD，逻辑简单，模式固定 |
| S10 | `dsh-tool-team` 5 个 tool definitions | `gpt-5.6-luna` | 遵循 `defineTool` 模板，每个 tool 独立，模板化程度高 |
| S11 | `dsh-bundle-team` + integration tests | `deepseek-v4-flash-0731` | 端到端集成验证，需要理解全局架构和跨包交互 |
| S12 | REAL-composition tests（跨包） | `deepseek-v4-flash-0731` | 验证包间交互，需要深度理解 Loader + scope + agent lifecycle |
| S13 | README + JSDoc + Agent Note 同步 | `gpt-5.6-luna` | 文档编写任务，模式化程度高 |

#### 6.7.2 并行编码分组

```
Wave 1 (无依赖):
  S1: dsh-team types/events/constants          ← deepseek-v4-flash-0731 (主力)

Wave 2 (依赖 S1 的类型):
  S2: parser + validation                      ← gpt-5.6-luna (辅助)
  S3: discovery + Service impl                 ← gpt-5.6-luna (辅助)
  S5: MCP guard                                ← gpt-5.6-luna (辅助)
  S6: skill-filter + tool-policy               ← gpt-5.6-luna (辅助)
  S10: 5 个 tool definitions                    ← gpt-5.6-luna (辅助)

Wave 3 (依赖 Wave 2):
  S4: orchestrator + delegation                ← deepseek-v4-flash-0731 (主力)
  S7: member-setup + cold-resume               ← deepseek-v4-flash-0731 (主力)
  S8: control coordinator                      ← deepseek-v4-flash-0731 (主力)
  S9: progress store                           ← gpt-5.6-luna (辅助)

Wave 4 (全部就绪):
  S11: bundle + integration tests              ← deepseek-v4-flash-0731 (主力)
  S12: REAL-composition tests                  ← deepseek-v4-flash-0731 (主力)
  S13: docs                                    ← gpt-5.6-luna (辅助)
```

> **模型分配统计**：`deepseek-v4-flash-0731`（主力）承担 7 项任务（S1/S4/S7/S8/S11/S12 + Wave 3/4 中的核心任务），`gpt-5.6-luna`（辅助）承担 6 项任务（S2/S3/S5/S6/S9/S10/S13 中的模板化任务）。
>
> **DSH 执行模型**：每个 Wave 内的任务通过 DSH 的 `subagent` / `workflow` tool 并行分派。Wave 间存在编译依赖，前一 Wave 全部完成后才启动下一 Wave。每个 subagent 的 `agentOptions` 指定独立的 `provider: 'Qiyuan-Inter'` + `model`。

#### 6.7.3 代码审查职责

| 审查层 | 审查者模型 | 审查内容 |
|---|---|---|
| 接口契约审查 | `deepseek-v4-flash-0731` | 所有 `dsh-team` types.ts 变更；跨包依赖正确性 |
| 实现审查 | `deepseek-v4-flash-0731` | orchestrator 状态机；control coordinator 异步正确性；cold resume 完整性 |
| 合规审查 | `gpt-5.6-luna` | DSH 合规清单（§4.5）；plugin 形态正确性；invariant 注册 |
| 测试审查 | `gpt-5.6-luna` | 覆盖率；boundary 案例；REAL-composition 正确性 |

---

### 6.8 测试策略总览

#### 6.8.1 测试层次

| 层次 | 框架 | 覆盖目标 | 位置 |
|---|---|---|---|
| Unit | vitest | 每个模块的 exported function 独立行为 | `packages/team/*/tests/*.spec.ts` |
| REAL-composition | vitest + Loader | 多包通过 `cordis.yml` 组合后的集成行为 | `packages/team/*/tests/*-composition.spec.ts` |
| Snapshot | ACP headless | 端到端 leader-teammate 交互 transcript | `tests/snapshot/team-*.ts` |

#### 6.8.2 Mock 策略

| 被 mock 对象 | Mock 方式 | 原因 |
|---|---|---|
| `ctx.subagents` | 注入 mock provider (参考 `test-subagent-mock/`) | 避免真实 agent loop |
| `ctx.llm` | mock adapter (参考 `test-llm-mock/`) | 避免 API 调用 |
| `ctx.tools` | 真实 ToolRuntime + mock tool definitions | 验证 guard/restriction 行为 |
| `ctx.skills` | 真实 SkillRegistry + mock provider | 验证 filter 行为 |
| Filesystem | memfs 或 temp dir | parser/discovery 测试 |

#### 6.8.3 关键 Invariant 测试

每个包的 `invariant.ts` 或测试中验证：

1. **`dsh-team`**: `DEFAULT_LEADER_TOOLS` 的 10 个名称在全局 tool registry 中全部存在（composition 测试）
2. **`dsh-team-runtime`**: leader 的 effective ToolRestriction 永远包含 `DEFAULT_LEADER_TOOLS`；teammate 的 deny 永远包含 team control tools
3. **`dsh-team-runtime`**: MCP guard 对非 `mcp__` 前缀 tool 永远返回 undefined
4. **`dsh-team-channels`**: 每个 `team/control-request` 事件最终对应恰好一个 `team/control-decision` 事件（timeout 视为 auto-deny）
5. **`dsh-team-local`**: 加载完成后恰好一个 `role: 'leader'` 定义

---

### 6.9 DSH 合规验证矩阵

| 检查项 | 适用包 | 验证方式 |
|---|---|---|
| function plugin 无 default export | `team-local`, `team-runtime`, `team-channels`, `tool-team` | 静态分析 + 构建 |
| Service subclass 有 default export | `team` | 静态分析 + 构建 |
| 注册通过 `ctx.effect()` / `ctx.on()` | 全部 | Code review + HMR test |
| HMR-safety | 全部 | 专项 HMR test: 热替换后 disposer 执行、重注册成功 |
| `SessionEventMap` 声明 merging | `team` (events.ts) | TypeScript 编译 + 类型测试 |
| `defineTool` contract + UI render intent | `tool-team` | 构建 + tool schema snapshot |
| schemastery Config | `team-local`, `team-runtime`, `team-channels`, `tool-team` | Config 校验测试 |
| `inject` 列出依赖 | 全部 function plugins | Code review |
| README + Model Experience | 全部 | `verify-package-readme-model-experience` gate |
| `./invariant` | 全部 | 每包有 `invariant.ts`（注册或 explained empty） |
| trailing newline | 全部 | `git diff --cached --check` |
| Agent Note | — | 随代码 PR 提交 |

---

### 6.10 Qiyuan-Inter Provider 配置指引

`Qiyuan-Inter` 作为 provider route 在 DSH 中无内置注册。使用前需在 `cordis.yml` 中通过 `dsh-llm-pi-ai` 声明：

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      Qiyuan-Inter:
        displayName: Qiyuan Inter
        apiKeyEnv: QIYUAN_INTER_API_KEY
        api: openai-completions
        baseURL: https://api.qiyuan-inter.example/v1
        models:
          - id: gpt-5.6-luna
            contextWindow: 200000
            maxTokens: 32768
          - id: deepseek-v4-flash-0731
            contextWindow: 131072
            maxTokens: 16384
```

Teammate 定义的 `provider: Qiyuan-Inter` + `model: deepseek-v4-flash-0731` 通过 `AgentOptions` 传递到 `ctx.subagents.startContinuable()` 的 `request.agentOptions`，DSH 的 `resolveChildAgentOptions()` 将其覆盖到子 agent。

**模型能力分级**（当前提供商实际表现）：
- `deepseek-v4-flash-0731`：**主力开发模型**，代码生成、架构推理、复杂状态机实现能力强
- `gpt-5.6-luna`：**辅助模型**，适合模板化编码（解析器、guard、tool 定义、文档）

**Runtime 校验**：`dsh-team-runtime` 在首次委派时调用 `ctx.llm.resolveModelInfo(provider, model)` 验证 route 可用。失败时抛出明确错误，而非静默回退到默认 provider。

---

## 七、进度审计与阶段计划（索引）

主文档保留完整的代码设计与 Phase 设计；阶段性审计、决策与执行计划存放于附属文档，按时间线索引：

| 日期 | 文档 | 内容 |
|---|---|---|
| 2026-08-18 | [进度审计与偏离登记](AGENT_TEAM_PLUGIN_AUDIT_2026-08-18.md) | Phase 状态审计、偏离登记表（D1-D5）、用户决策记录 |
| 2026-08-18 | [第二轮开发计划](AGENT_TEAM_PLUGIN_ROUND2_PLAN.md) | Phase 1/3 缺失项补齐、偏离纠正、子任务切分与分发策略 |
| 2026-08-19 | [第三轮开发计划（产品化轮）](AGENT_TEAM_PLUGIN_ROUND3_PLAN.md) | Phase 4（permission seam Stage 1）+ 5.1–5.4 任务包切分（M1–M9）、路由与升级策略；2026-08-19 确认 |

已追认的实现偏离（详见审计文档偏离登记表）：服务名为 `ctx.team`（原计划 `ctx.teamDefinitions`）；session 事件名为 `team/message`、`team/progress`、`team/control-request`、`team/control-decision`（原计划 §3.5 的 `team/message-sent` 等名称未采用）。
