# Team-mode 特征对比：PilotDeck / oh-my-opencode vs dsh

> 分析对象：`references/PilotDeck-acc-preview`、`references/oh-my-opencode`
> 基线：dsh `packages/team/*`（team / team-local / team-runtime / team-channels / tool-team）
> 目的：列出这两个参考实现里、dsh **尚未实现**或**只做了一半**的团队/子代理特征，供决策是否迁移。
> 说明：作者场景不限于 coding，下面每项都标注"与非 coding 场景的相关性"。

---

## 0. 先厘清三者的定位差异（决定了哪些特征"值得抄"）

| 项目 | 本质 | 团队模型 |
|---|---|---|
| **oh-my-opencode** | OpenCode 的插件层（"oh-my-zsh for OpenCode"），纯 coding 编排 | 固定的 10 个内置专家 agent + `delegate_task`（category/skill 组合）+ background-agent 并行 |
| **PilotDeck** | 独立的**个人助理/自动化平台**（非 coding 为主：邮件、笔记、日程、浏览器、通讯渠道） | leader + 用户自定义 teammate（`.md`），带 per-teammate 工具/技能/插件/MCP 作用域 + per-workspace 启用 + cron/always-on 自主运行 |
| **dsh** | 通用 agent harness | leader + teammate（`.md`），已有委派/成员绑定/审批 rendezvous/双向消息/进度板/冷恢复 |

**关键结论**：dsh 的 team 与 **PilotDeck 的 `src/agent/team` 几乎同源**（TeamControlChannels / TeamMessageChannels / TeamProgressStore / TeammateToolScope 一一对应）。所以 dsh 缺的不是"团队骨架"，而是 PilotDeck 在骨架之外多出来的**能力作用域系统**和**自主运行层**。oh-my-opencode 则贡献了一套完全不同的思路：**category 预设 + skill 携带 MCP**。

---

## 1. Subagent 限权（工具/权限作用域）

### 1a. dsh 现状
- `TeamToolPolicy { allow?, deny? }`：**纯工具名**白/黑名单（`parser.ts` / `types.ts`）。
- `TEAMMATE_DENIED_TOOLS`：硬编码禁止 teammate 用 `delegate_to_teammate` / `team_control` / `list_teammates`。
- `requiresApproval: [...]`：teammate 执行某工具前挂起，走 leader `team_control` 审批 rendezvous。
- 沙箱层另有 `SandboxPolicyService`（按 session.cwd 定 workspace-write 根），但**与 team 定义解耦**。

### 1b. oh-my-opencode（`src/agents/`）
- 每个 agent 工厂用 `createAgentToolRestrictions(tools)`（黑名单）或 `createAgentToolAllowlist(tools)`（白名单）。
- 固定角色的能力矩阵：`oracle`/`explore`/`librarian` 禁 write/edit/delegate（只读顾问）；`multimodal-looker` 只允许 read；`Sisyphus-Junior` 禁 `task`/`delegate_task`（防止无限委派）。
- **仍是工具名级别**，粒度与 dsh 相当，但把"只读顾问 / 叶子执行者"做成了固定角色约定。

### 1c. PilotDeck（`src/permission/protocol/types.ts`）—— **dsh 明显缺失**
- **`ToolCallSelector`（v2 结构化选择器）**：权限规则不止 tool 名，还能对**具体参数**加条件：
  - `bash.command` + `executableEquals` / `argvPrefix`（限定可执行文件、限定 argv 前缀）
  - `write_file.file_path` / `read_file.file_path` / `grep.path` + `pathEquals` / `pathWithin`（限定路径子树）
- **三态行为** `allow | deny | ask`（dsh 只有 allow/deny + 独立的 requiresApproval）。
- **规则来源分级** `user | project | session | policy | cli`，`deny` 恒优先。
- **`ask` → 交互式授权**，且 `allow_session` 选项能把一次授权**学习成会话规则**（下次自动放行）。
- teammate 侧 `TeammateToolProfile = { mode: "inherit" } | { mode: "custom", tools, constraints:{allow,deny} }`，constraints 就是编译后的 `ToolCallSelector[]`。

> **非 coding 相关性：高。** "允许这个助理只能读 `~/Notes`、只能对 `trello` MCP 写、bash 只能跑 `gh`"这类需求，dsh 目前无法表达——只能整体允许/禁止一个工具。参数级 allow/deny/ask 是把"团队限权"从 coding 玩具升级为可托付真实权限的关键。

---

## 2. 单独挂载 MCP（per-teammate / per-skill MCP）

### 2a. dsh 现状 —— **只做了"过滤"，没有"挂载/隔离"**
- `TeamMcpPolicy { servers: string[] }` + `createMcpGuard`：运行时**按工具名前缀 `mcp__<server>__` 拒绝**不在白名单里的 MCP 工具。
- 即：所有 MCP server 仍是**全局挂载**的，dsh 只是**遮蔽**了 teammate 看不该看的那些工具名。
- 没有"这个 teammate 独享一组 MCP server 进程 / 独立配置 / 独立凭据"的概念。

### 2b. PilotDeck —— **per-teammate MCP 作用域注入**（`TeammateExtensionResolver.listMcpInstructions`）
- teammate 定义里 `mcpServers: string[]`。
- `TeammateExtensionResolver` 从全局插件运行时**过滤出该 teammate 允许的 `McpServerInstruction`**，只把这些注入它的会话（commands / skills / mcp 三者都按 teammate 过滤）。
- 配合 `TeammateToolScope` 双重把关：server 允许 **且** 具体 MCP 工具在 `tools` 白名单里才保留。
- 有 `MCP_SERVER_NOT_FOUND` 诊断：teammate 引用不存在的 MCP server 会在校验期报错（见 §5 catalog）。
- 仍是"从全局池里挑"，但比 dsh 多了**注入指令级**的作用域，而非仅运行时遮蔽。

### 2c. oh-my-opencode —— **skill 自带 MCP（三层 MCP 架构）** ⭐ 最有意思的差异
- `AGENTS.md` 明确"三层 MCP"：① 内置（Exa 搜索 / context7 文档 / grep_app）② Claude Code 兼容 `.mcp.json`（`${VAR}` 展开）③ **Skill-embedded：skill 的 YAML frontmatter 里直接声明 MCP**。
- 例（`category-skill-guide.md`）：
  ```markdown
  ---
  name: my-skill
  mcp:
    my-mcp: { command: npx, args: ["-y", "my-mcp-server"] }
  ---
  ```
  当 `delegate_task(load_skills=["playwright"])` 加载该 skill 时，其 `@playwright/mcp` **随之自动挂载**（"auto-executed"），任务结束即随 skill 卸载。
- 即：MCP 的生命周期**绑定到"当前加载了哪个 skill"**，而不是绑定到 agent 定义或全局配置。

> **非 coding 相关性：高，且两种范式可选。**
> - PilotDeck 范式 = "给某个助理固定分配一组 MCP"（长期人格：邮件助理常驻 himalaya MCP）。
> - oh-my-opencode 范式 = "临时按需拉起 MCP"（一次性任务：这次要发推 → 加载 twitter skill 顺带拉起其 MCP）。
> dsh 现在两种都没有——只能全局挂 MCP 再遮蔽。**这是最值得决策的一块。**

---

## 3. Skills（技能）

### 3a. dsh 现状 —— **team 层完全没有 skill 概念**
- `grep skill packages/team` = 0 命中。teammate 只有一段 `prompt`（persona）。
- dsh 主体有 skill provider（`packages/skill`），但**没有接到 team**：teammate 无法声明"我启用哪些 skill"，leader 也无法在委派时"加载 skill"。

### 3b. oh-my-opencode —— **skill = 注入知识 + 可携带 MCP**，委派时 `load_skills`
- `delegate_task(category=..., load_skills=[...], prompt=...)`：skill 的正文**前置注入**到子代理系统提示；若 skill 带 `mcp:` 则一并挂载。
- 内置 skill：`git-master`、`playwright`（带 MCP）、`frontend-ui-ux`。可放 `.opencode/skills/` 或 `~/.claude/skills/` 自定义。
- `disabled_skills` 全局禁用。skill 有 description，模型据此自选。

### 3c. PilotDeck —— **skill = Anthropic 风格能力包，per-teammate 白名单**
- `skills/<name>/SKILL.md`：`name` + `description` frontmatter + prose body + 可带 `runtime/` 脚本（如 pptx、pdf、docx、browser-use…共 30+ 个，绝大多数**非 coding**：apple-notes、trello、notion、weather、himalaya 邮件…）。
- teammate 定义 `skills: string[]`；`TeammateExtensionResolver.listSkills` 只把该 teammate 声明的 skill 注入。
- 有 `find-skills` / `skill-creator` 元技能，`SKILL_NOT_FOUND` 校验。

> **非 coding 相关性：非常高。** PilotDeck 的 skill 目录几乎就是"个人助理能力清单"。这套 = dsh 已有的 skill provider + "teammate 可声明 skill 子集" + "skill 可携带 MCP"。**迁移成本相对低**（dsh 已有 skill 基建），主要是把 skill 作用域接进 team 定义。

---

## 4. Category / 模型预设（oh-my-opencode 独有范式）

### dsh 现状
- teammate 可覆盖 `provider` / `model` / `maxTokens`（单一 per-request 输出上限）。
- **没有** category、temperature、top_p、thinking budget、reasoningEffort、textVerbosity 等采样/推理预设，也没有"按任务类型自动选模型/参数"的抽象。

### oh-my-opencode `CategoryConfig`（`category-skill-guide.md` §6）
- 内置 category：`visual-engineering`(Gemini3Pro) / `ultrabrain`(GPT5.2-codex xhigh) / `artistry` / `quick`(Haiku) / `writing`(Flash) / `unspecified-low|high`。
- 每个 category 是一套**预设**：`model` + `variant` + `temperature` + `top_p` + `prompt_append` + `thinking{budgetTokens}` + `reasoningEffort` + `textVerbosity` + `tools{禁用某工具}` + `maxTokens` + `is_unstable_agent`。
- `delegate_task(category="ultrabrain", ...)` → 由固定的 `Sisyphus-Junior` 执行器套用该预设跑。
- 用户可在 `oh-my-opencode.json` 覆盖/新增 category。

> **非 coding 相关性：中。** "写作用低成本高创意模型、推理用高 reasoning 模型"这种**按任务类型切模型/采样参数**的想法通用。dsh 现在只能靠"为每种任务预建一个 teammate.md"近似。是否要独立的 category 抽象，取决于你是否想要"同一个 teammate 按任务动态换档"。

---

## 5. 能力校验 + per-workspace 启用（PilotDeck，dsh 缺）

### PilotDeck `src/extension/teammates/`
- **Capability catalog 校验**（`TeammateCatalog` = {tools, plugins, skills, mcpServers}）：teammate 引用的每个 tool/plugin/skill/mcpServer 都对照当前 workspace 的可用清单校验，产出结构化诊断 `TOOL_NOT_FOUND` / `PLUGIN_NOT_FOUND` / `SKILL_NOT_FOUND` / `MCP_SERVER_NOT_FOUND` / `MODEL_NOT_FOUND`。
- **Per-workspace 启用**（`TeammateEnablementDocument`，schemaVersion 2）：`workspaces[path][teammateId] = TeammateWorkspaceBinding { enabled, toolProfile: inherit|custom, contextPolicy }`，带 **revision 乐观锁**（`expectedRevision` 防并发写冲突）。
- **Gateway/CRUD 工具**：`teammates.list/read/create/write/delete`、`enablement.get/set`、`workspaceBindings.get/set`——即"用工具管理团队成员"，而非只靠手改 `.md`。

### dsh 现状
- teammate 从目录扫描 `.md` 静态加载；**无 catalog 校验**（引用不存在的 MCP/skill 不会在加载期报错，只在运行时 guard 拦）；**无 per-workspace 启用**（团队是全局的，靠换 DSH_HOME 隔离）；**无 CRUD 工具**（手改文件）。

> **非 coding 相关性：中高。** 多 workspace/多产品线时，"这个项目启用哪几个助理、每个助理这里用 inherit 还是 custom 权限"很实用。乐观锁 + 诊断是把它做成产品的工程细节。

---

## 6. 调度 / 常驻自主运行（PilotDeck 独有，dsh 完全没有）

### PilotDeck `src/cron/` + `src/always-on/`
- **Cron 定时代理**：`CronCreateTool/ListTool/StopTool/DeleteTool` + `CronScheduler`/`CronTaskStore`/`CronTimezone`——让某个（团队）任务**按 cron 表达式定时自主触发**。
- **Always-on 自主循环**：`DiscoveryScheduler` + `WorkCycleStore` + `DiscoveryPlanStore/ReportStore`——代理**持续自主发现工作→定计划→执行→出报告**（Plan/Report contract 化）。
- **工作区隔离 provider**：`GitWorktreeProvider` / `SnapshotCopyProvider` + `WorkspaceApply`——自主运行在**隔离工作副本**里跑，产出再 apply 回来（防止常驻代理污染主工作区）。
- **渠道租约** `ChannelLeaseRegistry` + `SignalWatcher`：绑定通讯渠道、监听外部信号触发。

### dsh 现状
- 无 cron、无 always-on、无自主发现循环、无 worktree/snapshot 隔离执行、无渠道触发。dsh 的 team 是**人在环、单次委派驱动**的。

> **非 coding 相关性：极高——这正是"非 coding 个人助理"的核心。** "每天早上汇总邮件/新闻""监控某渠道有消息就处理"这类，dsh 现在做不了。但这是**最大的一块工程**（涉及持久调度、隔离执行、渠道接入），应作为独立方向单独立项，而非顺手迁移。

---

## 7. 并行 / 后台 / 恢复 / 委派深度

| 能力 | dsh | oh-my-opencode | PilotDeck |
|---|---|---|---|
| 后台委派 | ✅ teammate 后台跑，`reportFrom` 唤醒 leader | ✅ `run_in_background` + `background_output`/`background_cancel` + `background-agent/manager.ts`(1335行) 管并发/生命周期 | ✅ TeammateSessionRuntime + 委派实例 key |
| 并行多委派 | ✅（多 teammate 各自后台） | ✅ 强约束"并行优先"（反模式：顺序调用） | ✅ |
| follow-up / resume | ✅ `action:"follow_up"` 续会话；冷恢复靠 `team/member-bound` 重建策略 | ✅ `delegate_task(resume="ses_...")` | ✅ `contextPolicy: persistent|fresh_per_delegation` + 实例 key |
| 委派深度控制 | ✅ `TEAMMATE_DENIED_TOOLS` 禁 teammate 再委派 | ✅ `Sisyphus-Junior` 禁 task/delegate（叶子） | ✅ `TEAMMATE_FORBIDDEN_TOOLS` 禁 delegate |
| "永不轻信子代理" 核验 | ⚠️ 靠 leader.md prompt 约定 | ✅ 制度化：orchestrator 必须跑 project 级 lsp_diagnostics/全测试/读实际改动文件 | 部分（Report contract） |
| learnings 传递 | ⚠️ 无显式机制 | ✅ 明确"从子代理响应抽取 learnings 传给后续所有子代理" | 部分 |
| 双向消息 / 审批 / 进度板 | ✅ 三者齐全（与 PilotDeck 同源） | ⚠️ 无对等的"teammate→leader 请求审批" rendezvous | ✅ 三者齐全 |

> 这一栏 dsh 大体**已达标或同源**。真正缺的小项：**learnings 显式跨子代理传递**、**制度化的"不轻信"核验流程**（目前只在 prompt 里说）。相关性中，且实现便宜（prompt/工具约定层面）。

---

## 8. 汇总表：dsh 尚未实现 / 半实现的特征

| # | 特征 | 来源 | dsh 现状 | 迁移成本 | 非coding相关性 | 建议优先级 |
|---|---|---|---|---|---|---|
| 1 | **参数级权限 allow/deny/ask（ToolCallSelector）** | PilotDeck | 仅工具名 allow/deny | 中 | 高 | ★★★ |
| 2 | **skill 携带 MCP，按需自动挂载** | oh-my-opencode | 无 | 中 | 高 | ★★★ |
| 3 | **per-teammate skill 作用域**（teammate 声明 skill 子集） | 两者 | team 无 skill 概念（但主体有 skill 基建） | 低-中 | 高 | ★★★ |
| 4 | **per-teammate MCP 作用域注入**（非仅运行时遮蔽） | PilotDeck | 仅前缀 guard 遮蔽 | 中 | 高 | ★★☆ |
| 5 | **能力 catalog 校验**（引用不存在的 tool/skill/mcp 即报错） | PilotDeck | 无（运行时才拦） | 低 | 中高 | ★★☆ |
| 6 | **per-workspace 团队启用 + inherit/custom + 乐观锁** | PilotDeck | 全局，靠换 HOME 隔离 | 中 | 中高 | ★★☆ |
| 7 | **teammate CRUD 工具**（工具管理团队而非手改 md） | PilotDeck | 手改 `.md` | 低 | 中 | ★★☆ |
| 8 | **category / 采样&推理预设**（temp/top_p/thinking/reasoningEffort/按任务切档） | oh-my-opencode | 仅 provider/model/maxTokens | 中 | 中 | ★★☆ |
| 9 | **maxContextTokens 与 maxOutputTokens 分离** | PilotDeck | 只有单一 maxTokens | 低 | 中 | ★☆☆ |
| 10 | **learnings 跨子代理显式传递** | oh-my-opencode | 无 | 低 | 中 | ★☆☆ |
| 11 | **制度化"不轻信子代理"核验流程** | oh-my-opencode | 仅 prompt 约定 | 低 | 中 | ★☆☆ |
| 12 | **cron 定时代理** | PilotDeck | 无 | 高 | 极高 | 独立立项 |
| 13 | **always-on 自主发现循环 + 隔离执行(worktree/snapshot)** | PilotDeck | 无 | 高 | 极高 | 独立立项 |
| 14 | **渠道租约 / 外部信号触发** | PilotDeck | 无 | 高 | 高 | 独立立项 |
| 15 | 固定"只读顾问/叶子执行者"角色约定 | oh-my-opencode | 可用现有 allow/deny 表达 | 极低 | 低 | 可选 |
| 16 | **有界子代理预设**（explore/verify/plan，各带工具白名单 + `maxSubagentDepth` 深度上限） | PilotDeck | subagents 有深度概念但无"预设+每预设白名单"套件 | 低 | 中 | ★★☆ |
| 17 | **per-session MCP 进程隔离**（独立 McpRuntime 实例 / perSession 浏览器 profile / maxPerSessionMcpInstances），是 #4 的强化版 | PilotDeck | 无（全局连接 + guard 遮蔽） | 中高 | 高 | ★★☆ |
| 18 | **按角色/场景自动模型路由**（主↔子不同模型、autoOrchestrate、tokenSaver 分档，~70% 成本节省） | PilotDeck | 仅手动 per-teammate model | 中 | 中 | ★★☆ |
| 19 | **团队审批增加 approve_plan / request_revision 两档**（leader 审阅 teammate 计划再放行/打回） | PilotDeck | 仅 allow_once/deny/escalate | 低 | 中 | ★★☆ |
| 20 | **后台 OS 任务 ring-buffer 输出存储**（`task_*` 分离进程 + `TaskOutputStore`） | PilotDeck | `Pwsh` 后台 job，无 ring-buffer 抽象 | 低 | 低 | ★☆☆ |

> 注：#17 是 #4 的"强隔离"版本；若做 #4 建议直接按 #17 的进程隔离目标设计，避免二次返工。
> 注：oh-my-opencode 的"skill 携带 MCP"（#2）在 PilotDeck **不存在**——PilotDeck 的 MCP 在 plugin.json 声明、由 teammate include-list 过滤（#4/#17）。两种范式互补：一个是"技能临时拉 MCP"，一个是"成员固定分配并隔离 MCP"。

---

## 9. 迁移可能性与必要性的分层讨论

**A. 低成本、与 dsh 架构天然契合（建议优先）**
- #3 per-teammate skill 作用域、#5 catalog 校验、#7 CRUD 工具、#9 双 token、#10/#11 核验&learnings：dsh 已有 skill provider、parser、诊断管线，主要是"把作用域字段接进 team 定义 + 校验"。属于 capability-seam 内的增量，符合 AGENTS.md"registrations are effects"。

**B. 中成本、需要新 seam（值得做，需设计）**
- #1 参数级权限：与 dsh 现有 `SandboxPolicyService` / interaction 审批栈有重叠，**关键是别造第二套权限系统**——应评估是把 ToolCallSelector 融进现有 sandbox-policy，还是在 team 层薄封装。
- #2 skill 携带 MCP / #4 per-teammate MCP 注入：dsh 目前 MCP 全局挂载 + guard 遮蔽。要做"按 skill/teammate 动态挂载/卸载 MCP"需要 MCP 生命周期能力（连接/断开随 fiber），是新 seam。**这是最能提升非 coding 实用性的一块，但也最需要想清楚 MCP 进程/凭据的作用域模型。**
- #6 per-workspace 启用、#8 category：清晰但需新配置面与 UI。

**C. 高成本、独立产品方向（不建议"顺手迁移"）**
- #12/#13/#14 cron / always-on / 渠道：这是 PilotDeck"个人助理平台"的立身之本，涉及持久调度、隔离执行、外部渠道接入、自主循环安全。对"非 coding 场景"价值最高，但应作为 dsh 的**独立 roadmap 项**评估，而不是塞进现有 team 插件。

**必要性提示（供你判断，不替你决策）**
- 若目标是"可托付真实权限的多助理"→ #1 参数级权限 + #2/#4 MCP 作用域 是门槛。
- 若目标是"丰富的非 coding 能力"→ #2/#3 skill+MCP 生态复用（PilotDeck 那 30+ 非 coding skill 的范式）收益最大。
- 若目标是"无人值守/定时自主"→ 必须走 C 类独立立项。
- 若只是"让现有 coding team 更好用"→ dsh 其实已接近 oh-my-opencode/PilotDeck 的 team 骨架，补 #3/#10/#11 即可。

---

## 10. 深挖补充（第二轮源码核实，修正/加深若干机制）

以下几点在第二轮 PilotDeck 源码通读后确认或修正，供精确决策：

**(a) PilotDeck 有三条互不相同的委派链路，不要混为一谈**
1. **Subagents**（`agent`/`Task` 工具 → `SubAgentSession`）：**有界**、单次 5 字段汇报、自带 AgentLoop；4 个内置预设 `general-purpose/explore/plan/verify`，**每个预设有自己的工具白名单**（`builtinSubagentTypes.ts:76-134`）；**委派深度上限** `maxSubagentDepth`（默认 1）；继承权限规则 + router；并行、批量兄弟。→ 这条最接近 dsh 现有的 `subagents` 能力。
2. **Team/Teammates**（`delegate_to_teammate`/`send_team_message`/`team_progress`）：即"真正的团队"，本文前面各节讨论的对象。
3. **Background OS tasks**（`task_*` 分离的 shell 进程，ring-buffer `TaskOutputStore`）：**不是 agent**，是后台系统进程。dsh 的 `Pwsh run_in_background` 大致对应，但没有 ring-buffer 输出存储抽象。

> 迁移含义：dsh 现在把"子代理"和"团队成员"统一到 subagents+team 之上；PilotDeck 显式区分**有界子代理（预设+深度上限）**与**长活团队成员**。若要引入"预设化的有界子代理"（如只读 explore/verify 叶子，带独立工具白名单+深度上限），这是一个清晰、低成本的增量。

**(b) 修正 per-skill MCP 的归属**：**PilotDeck 的 skill 不携带 MCP**（`SKILL.md` 只有 name/description/assets，三作用域 builtin/user/project，无 mcp/tools/permission frontmatter）。"skill 自带 MCP"这一范式**仅 oh-my-opencode 有**（frontmatter `mcp:` 块）。PilotDeck 的 MCP **在三处声明**：全局 `mcp.json`、项目 `.pilotdeck/mcp.json`、插件 `plugin.json` 的 `mcpServers`（`parsePluginMcpServers.ts` 解析、`PluginRuntime.mcpServers()` 聚合）；teammate/Leader 的 `mcpServers[]` 是**对上述已声明 server 的 allowlist（白名单过滤）**，本身不声明/不定义 server。

**(c) PilotDeck 的 per-teammate MCP 隔离比我先前说的更强**：不只是"注入过滤"，还有**真正的进程级隔离**——`McpRuntime` 为 process-local，`perSession:true` 的浏览器 profile 按会话独立，`gateway.maxPerSessionMcpInstances` 限制每会话 MCP 实例数。也就是 teammate 拿到的是**独立的 MCP 运行实例**，而非共享全局连接。→ 这比 dsh 的"全局挂载 + 前缀 guard 遮蔽"强一个量级，也是 #4 的真实工程内容。

**(d) 一个重要"未完成"警示**：PilotDeck 声明了 `PermissionRuleContribution` 但**没有任何 consumer**——即 products/skills **目前无法贡献权限规则**。若你打算抄"skill/product 自带权限规则"，参考实现本身也还没做完，需自行设计 consumer 侧。

**(e) 路由层（dsh 无对应）**：`router/scenario/subagentDetector.ts` 通过 `<pilotdeck-subagent-model>` 标签/缺失 `agent` 工具来识别子代理，**主代理与子代理路由到不同模型**（README 称约 70% 成本节省）；`tokenSaver` 分档；`autoOrchestrate` 编排模式（白名单 `agent/read_file/grep/glob/read_skill`，把实际编辑委派给边缘模型）。→ 这是"用便宜模型跑子任务、贵模型只做编排"的成本优化，dsh 目前靠手动为每个 teammate 指定 model 近似，但没有**自动按角色/场景路由**。属于 §4 category 的近亲，优先级中。

**(f) 渠道与钩子规模**（对应 §6/#14）：PilotDeck 有 **20+ 渠道适配器**（telegram/discord/slack/whatsapp/wecom/feishu/dingtalk/qq/matrix/signal/sms/email/homeassistant/webhook/api-server/cli/tui…）经 `ChannelAdapter`+`SessionMapper` 绑定到 Gateway 会话；**27 个生命周期钩子事件**（含 `SubagentStart/Stop`、`PreToolUse`、`PermissionRequest`）。dsh 无渠道层；钩子方面 dsh 有 `packages/hooks`（Claude Code/Codex 桥）但事件面更窄。

**(g) products/ 澄清**（对应"personas"）：PilotDeck 的 `products/` 是**部署覆盖层**（plugins/ + `config/pilotdeck.yaml` overlay + brand/），**不是同时并存的多人格**。多人格来自 **Teammates+Leader**。→ 这与 dsh 的 preset 覆盖模型一致，不构成新特征。

**(h) 团队审批决策比 dsh 多两档**：PilotDeck `TeamControlCoordinator` 的 leader 决策集为 `allow_once / deny / approve_plan / request_revision / escalate_to_user`（含**计划批准/打回重做**），且**重启后持久化+对账**。dsh 现为 `allow_once / deny / escalate_to_user`（`TeamControlDecision`）。补 `approve_plan`/`request_revision` 是低成本增量，对"leader 审阅 teammate 计划再放行"很实用。

---

## 附：一手核实的关键文件（供复查）
- dsh: `packages/team/team/src/{types,constants}.ts`、`team-runtime/src/{mcp-guard,member-setup}.ts`、`team-local/src/parser.ts`、`tool-team/src/tool-delegate.ts`
- PilotDeck: `src/agent/team/{types,TeammateToolScope,TeammateExtensionResolver}.ts`、`src/extension/teammates/types.ts`、`src/permission/protocol/types.ts`、`src/{cron,always-on}/`（文件清单）、`products/_example/config/pilotdeck.yaml`
- oh-my-opencode: `docs/category-skill-guide.md`、`src/agents/AGENTS.md`、`AGENTS.md`(三层 MCP)、`skills/*/SKILL.md`
