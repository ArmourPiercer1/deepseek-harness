# Agent Note: The permission seam — parameter-level tool rules and fused MCP mounting for controlled team workflows

[English](2026-08-15-permission-seam-and-mcp-fusion.md) | 中文

Status: implemented

## 问题

DeepSeek Harness 目前只能按工具名限制团队成员的工具。`TeamToolPolicy` 携带 `allow`/`deny` 名单，`TEAMMATE_DENIED_TOOLS` 硬编码三个协调工具，`createMcpGuard` 按 `mcp__<server>__` 前缀遮蔽 MCP 工具名。一个被允许 `pwsh` 的成员可以运行任意命令；一个被允许 `write` 的成员可以写任意路径。无法表达"这个 teammate 可以跑 `git status` 但不能 `rm -rf`""可以读仓库但绝不能读 `.env`""可以调用 `postgres` MCP 的 query 工具但不能用其他 server"。对于一个把真实权限托付给 teammate 的工程控制环境，名字级的门禁不是一个可托付的基座。

MCP 访问有同样的形状缺口。每个 MCP server 都是全局挂载的，唯一的按成员控制是名字遮蔽。成员无法被分配一组稳定、持久化的 MCP server，skill 无法在一次任务期间拉入它所需的 MCP，未使用的 server 也无法保持断开以让它的工具描述不占用无关会话的 context。两种有用的模式——成员持久化的 MCP 集合（稳定、可审计）和 skill 按需拉起的 MCP（随任务加载）——都缺失，而拥有它们的参考实现要么把 server 凭据散落进可复制的 skill 文件（oh-my-opencode），要么止步于对共享连接的名单过滤（PilotDeck）。

这些缺口位于 [agent 团队插件](../feature/2026-08-14-agent-team-plugin.md) 已经拥有的边界上，但它们并非团队专属：一个主 agent 和一个单发委派子代理需要同样的参数级权限。委派子代理还额外运行在 [审批固定为 `'never'`](../feature/2026-08-10-subagent-approval-pinned-never.md) 之下，所以对它们而言，做决定的权威必须是一个规则引擎，而不是一个交互式提示。

## 决定

seam 的第一阶段已交付：`permission` 能力决定一个工具调用是否可以发出，被团队插件、主 agent 和单发委派子代理共同消费。第二阶段与第三阶段（融合的 MCP 挂载、加固）尚未建成；其范围记录在下文「暂缓」一节。

### `permission` 接缝及其边界

三个包构成这个接缝：

- `packages/permission/permission` —— Service Definition：`evaluate(toolCall, context)` 返回 `deny | ask | allow`，以及规则中间表示（IR）、规则层、权限模式类型。发布 service 的这一行属于 host 组合。
- `packages/permission/permission-engine` —— Service Provider：字符串规则解析为 IR、下述四类匹配器、`deny > ask > allow` 分层裁决（managed 层绝对）与权限模式兜底。`compile` 与 `evaluate` 保持纯函数；由消费者在提交点追加 `permission/decision` 审计事件。
- `packages/permission/tool-permission-guard` —— 一个 `tools/pre-execute` Consumer，为主 agent 和单发委派子代理应用 `evaluate`；其按调用的 service 解析由 [tool permission guard note](2026-08-20-tool-permission-guard-resolves-permission-per-call.md) 拥有。

团队插件硬注入 `permission`，并在每个绑定的 teammate 子会话上安装强制钩子，取代遗留的 `requiresApproval` 名字关卡：每个 `tools/pre-execute` 调用都在执行器上、在该成员的模式下被评估，`ask` 结果复用现有的 leader 会合（在 `team/control-request` 上的挂起-唤醒-裁决循环），而不是新建通道。[teammate 权限强制 note](2026-08-20-teammate-permission-enforcement-at-the-executor.md) 拥有该阶段。

这个接缝位于 OS 底座之上、而非之内。`permission` 引擎决定一个工具调用是否可以发起；[子进程沙箱](../feature/2026-07-06-sandbox.md) 和 `fs-sandbox` 仍是一个并列的 OS 级兜底，物理地约束一个已发起的调用。`ask` 结果对主 agent 经现有[审批接缝](../feature/2026-07-06-approval-seam.md) 交付、对 teammate 经 leader 会合交付。`permission` 依赖审批接缝来兑现 `ask`；它不吸收审批接缝，也不与沙箱合并。

规则层、匹配器引擎和权限模式兜底不是分开的包：它们是同一个 `evaluate` 的组成部分，必须在做决定的那一点产出单一决策，因此无法拆分而不制造这个接缝正要消除的优先级歧义。

### 规则语言：作者书写字符串，结构化 IR 内核

规则以 Claude Code 风格的字符串书写，供人评审、diff 并纳入版本控制，再解析为引擎匹配与审计所用的结构化 IR：

```yaml
permissions:
  deny:  ["Bash(rm -rf *)", "Read(//**/.env)", "mcp__*"]
  ask:   ["Bash(git push:*)", "pwsh(Remove-Item *)"]
  allow: ["Bash(git status:*)", "mcp__postgres__query"]
permissionMode: enforce            # enforce | default (readonly/bypass reserved)
```

IR 分派到四类匹配器，对齐 Claude Code 记录的行为及其记录的失败模式：

1. **命令**（Bash / pwsh）：在 `&&`、`||`、`;`、`|`、`|&`、`&` 和换行处拆分复合命令并对每个子命令独立匹配；剥离固定的 wrapper 集合；归一化 pwsh 别名。主内容字段（`command`）不能被 `param:value` 规则匹配，因为复合命令会绕过它。
2. **路径**（Read / Edit / Write 及读改家族）：gitignore 语义，带 `//`（文件系统根）、`~`（home）和 `/`（相对规则的配置源）锚点；Windows 路径归一为 POSIX（`C:\` → `/c/`）。
3. **MCP**：`mcp__server`、`mcp__server__tool` 和 `mcp__server__*` 前缀。
4. **通用参数**：`Tool(param:value)`，针对长尾工具的顶层标量输入字段，绝不针对主内容字段。

裁决顺序为 `deny → ask → allow → 模式兜底`。managed 层的 `deny` 在每种模式下都绝对，不能被下层的 `allow` 覆盖。

### 权限模式与默认判定

未命中的调用由一个按作用域的权限模式裁决，它是一个 config 枚举。两种模式已交付：`enforce`（未命中 ⇒ `deny`，白名单；受控 teammate 的默认）和 `default`（未命中 ⇒ `allow`，黑名单；给主 agent）。`readonly` 和 `bypass` 是预留的枚举值；引擎将它们拒绝为未实现，而不是静默放行一个调用。模式按作用域绑定——主 agent 的模式来自 host 或 project 配置，teammate 在 `.md` frontmatter 里声明自己的——managed 层可以为模式设上限（例如全舰队禁止 `bypass`）。managed 的 `deny` 在每种模式下仍然生效，所以一个组织的 `deny: Read(//**/.env)` 连一个 `default` 模式的主 agent 也兜底。

### 规则分层、持久化与审计

规则从分层文件加载：managed（一个受保护的策略文件）、project（一个项目级文件）和 teammate（成员定义的 `permissions` frontmatter），经由 [分层规则加载 note](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md) 拥有的只读加载器，并带其 fail-closed 契约：一个 scope 绑定时在场却缺失的 managed 文件被拒绝而非跳过，一个格式错误的层文件使加载失败。加载把数组值的规则集连接起来并去重，`deny` 跨层保持绝对。规则学习（第三阶段）被塑造成这个文件形状的产物但尚未实现；会话级学到的规则需要映射到会话事件。

每个被评估的调用都追加一个 `permission/decision` 审计会话事件，让会话日志可以重建决策：工具名、结果与模式恒在；行动成员、裁决规则的 raw 字符串与层、deny 原因在适用时在。第三轮 D8 步骤核对了该载荷与审计所需字段；结论记录在下文一节。

## 审计事件兼容性（第三轮 D8，只读）

第三轮计划要求在事件可被复用之前，逐字段核对 `permission/decision` 载荷与 Stage 1 审计必须携带的字段。该核对是只读的：没有修改任何事件结构，D8 下复用还是暂停的决定归父级做出；本节记录结论而非决定。

| Stage 1 审计字段 | `PermissionDecisionData` 中的载荷字段 | 在场性 |
|---|---|---|
| tool | `toolName: string` | 恒在 |
| decision | `decision: 'allow' \| 'ask' \| 'deny'` | 恒在 |
| matched rule | `matchedRuleRaw?: string` | 当由规则而非模式兜底裁决时 |
| layer | `layer?: 'managed' \| 'project' \| 'teammate'` | 与 matched rule 同在 |
| member | `memberId?: string` | 当调用来自 teammate 时 |
| mode | `mode: PermissionMode` | 恒在 |
| cause | `cause?: 'rule' \| 'mode' \| 'leader_unreachable'` | 当决策为 deny 时 |

载荷兼容：它携带审计所需的每一个字段，可选字段在不适用时按设计省略。该事件是一个纯 JSON 的 `SessionEventMap` 成员，冷恢复与旧日志回放读取它不需要格式变更，也没有触碰任何既有事件结构。一处前提更正留档：第三轮计划把词汇表条目归于上游 `interaction/permission-presets` 的声明，但上游只声明了 `permission/preset`；`permission/decision` 经由本轮 `@deepseek-ai/dsh-permission` 的声明进入生成的事件词汇表，git 历史中不存在更早的上游声明。

## 曾考虑的方案

**在原地扩展名字级过滤。** 给 `TeamToolPolicy` 加条件匹配器可以让改动保持局部，但该策略是按成员的 denylist：没有分层、没有绝对的 managed、没有审计轨迹，扩展只会让第二套决策系统长在沙箱旁边，而不是长成文档记载的单一接缝。

**规则只进会话日志。** 持久事件让决策可审计，但不可重新评估：引擎需要规则集作为可编译的数据，而不是转录稿里的散文。日志记录结果；规则文件拥有策略。

**专用的权限进程。** 进程外引擎隔离了规则评估，但每个工具调用都要为一次裁决支付一次往返，且进程边界给审批流增加了一个必须与真实 deny 区分开的失败模式。引擎是进程内的纯代码；隔离并不是重点。

**带 eager 预热的按成员 MCP server。** 在会话启动时挂载每个成员的 server 让工具立即可用，但为一个成员从不调用的 server 支付连接成本与 context，并把工具描述泄漏进无关会话。惰性引用计数挂载让未使用的 server 保持断开；成员集合与 skill 集合合并为一个按作用域的并集（第二阶段，暂缓）。

**单一全局权限模式。** 整个会话共用一个模式无法表达接缝要点的拆分：受控 teammate 运行 `enforce`，而委派给它的主 agent 运行 `default`。模式按作用域绑定，managed 层可以为它设上限。

**fail-closed 且拒绝不留审计。** 一个不留日志行的被拒调用破坏可重建性契约——会话日志必须能回答"什么被允许、提示或拒绝，依据哪条规则、哪一层、哪个成员、哪个模式"。审计事件因此是接缝的一部分，而不是附加件。

**把接缝折进 `fs-sandbox`。** 文件系统沙箱已经拥有 OS 级约束；在那里加入规则评估会把"这是否允许"的两个所有者合并，让决策与约束之间的边界不可见。接缝保持在 OS 底座之上作为独立能力。

## 后果

- 双系统风险以边界而非合并解决：`permission` 决定发起，沙箱约束执行，只有 `permission` 产出 `deny`/`ask`/`allow`。强制点是做决定的那个操作，由一个真实组合测试钉住——透过执行器拒绝、工具仍留在 schema 里（[teammate 权限强制 note](2026-08-20-teammate-permission-enforcement-at-the-executor.md)）。
- 规则脆弱性是常设限制：命令参数模式是尽力而为的——一个复合命令、一个变量或多余空格可以规避一个朴素模式，正如 Claude Code 所记录。引擎以子命令拆分和 wrapper 剥离来缓解，而 managed `deny` 加上 OS 沙箱才是真正的兜底；规则语言本身不被呈现为一道安全边界。
- 冷恢复把可用性耦合到 managed 文件：重读 managed 层让一个被恢复的会话保持最新，而缺失的 managed 文件使恢复 fail-closed，一个受控环境宁可如此也不带着一份失效的策略运行（[分层规则加载 note](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md)）。
- 分阶段成本被接受：第一阶段交付可托付的团队控制底座；后续阶段替换部件而不返工 IR 模块或（尚未建成的）MCP 生命周期，前提是阶段 1 的接口保持按复用定形。

## 暂缓

第二阶段（融合的 MCP 挂载）与第三阶段（加固）尚未建成；其验收项（「测试」一节的 5–7）按设计没有测试映射：

- **第二阶段 —— 融合的 MCP 挂载。** 带加载时校验的注册表目录、成员可用的 MCP 集合为其 `mcpServers` 与其启用 skill 声明依赖的去重并集、引用计数的惰性启停（每个连接是单个 `ctx.effect()` disposer）、`maxPerSessionMcpInstances` 与懒启动/空闲断开超时和默认 `warmup` 值这些 config 字段、以及带三步降级的 eager 预热。一个未定义的 server 在加载时以 `MCP_SERVER_NOT_FOUND` fail-loud。
- **第三阶段 —— 加固。** 带回写目标及其持久化与并发的规则学习、按作用域的专用 MCP 实例、`readonly`/`bypass` 模式、以及作为 `permission` 消费者的 Claude Code 与 Codex hook 桥。

## 测试

提案的八条验收标准映射到这些测试；第 5–7 条属第二阶段范围，暂缓：

1. `enforce` 模式 teammate 未命中规则时在执行器被拒绝，工具仍留在 schema 里可观察 —— `packages/team/team-runtime/tests/permission-enforcement.loader-composition.spec.ts`（"denies an unmatched call of an enforce-mode teammate at the executor, audited, with the tool still in the schema"）。
2. managed 层 `deny` 挡住一个 teammate 或 project `allow` 本会放行的调用，`enforce` 与 `default` 两种模式皆是 —— `packages/permission/permission-engine/tests/load.spec.ts`（"deny absoluteness across the merged layers"，两种模式的 teammate allow）、`packages/permission/permission-engine/tests/evaluate.spec.ts`（managed deny 压过 project allow，两种模式）、以及 team-runtime 组合测试在 `default` 模式下的 managed-deny 用例。
3. `Bash`/`pwsh` 复合命令在任一子命令命中 `deny` 规则时被拒绝；针对主内容字段的 `param:value` 规则被忽略并留下加载时告警 —— `packages/permission/permission-engine/tests/evaluate.spec.ts`（Bash 与 pwsh 的复合命令拒绝）、`packages/permission/permission-engine/tests/match-command.spec.ts`（子命令拆分、wrapper 剥离、别名归一）、`packages/permission/permission-engine/tests/parse.spec.ts`（解析级告警）、`packages/permission/permission/tests/permission.loader-composition.spec.ts`（加载时 `compile` 诊断中的告警）、`packages/permission/tool-permission-guard/tests/guard.loader-composition.spec.ts`（首次编译时到 logger 的告警）。
4. 每次 `evaluate` 追加一个字段可重建决策的 `permission/decision` 事件；恢复的 teammate 会话从 `team/member-bound` 重推 teammate 内联规则并重读 managed 与 project 层 —— `packages/permission/permission-engine/tests/audit.spec.ts`（字段映射与追加）、guard 与 team-runtime 组合测试（每次决策后从会话日志读回的审计）、`packages/team/team-runtime/tests/member-setup.spec.ts`（"rule-layer recovery on setup"：快照加重读、pre-rules 冷恢复、managed 失效拒绝）。
5. （第二阶段）成员 MCP 集合并集与 `MCP_SERVER_NOT_FOUND` —— 暂缓；无映射。
6. （第二阶段）引用计数启停、冷恢复重连与 eager 预热降级 —— 暂缓；无映射。
7. （第二阶段）`maxPerSessionMcpInstances`、懒启动与空闲断开超时、默认 `warmup` 值作为 config 字段 —— 暂缓；无映射。
8. 一个真实的 cordis.yml 组合测试演练 enforce 模式拒绝、managed 跨层拒绝和主 agent default 路径 —— team-runtime 的 `permission-enforcement` 组合测试（第 1、2 条）与 `packages/permission/tool-permission-guard/tests/guard.loader-composition.spec.ts`（"applies the mode config default and allows an unmatched call in default mode"）。

## 相关

- [teammate 权限强制 note](2026-08-20-teammate-permission-enforcement-at-the-executor.md) 交付本 note 规定的团队决策面：执行器上的 evaluate、走 leader 会合的 ask、enforce 默认、提交点的审计。
- [分层规则加载 note](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md) 交付加载器、规则文件格式、fail-closed 契约与强制钩子消费的持久快照。
- [tool permission guard note](2026-08-20-tool-permission-guard-resolves-permission-per-call.md) 在同一硬激活语义下拥有守卫的按调用 service 解析。
- [agent 团队插件](../feature/2026-08-14-agent-team-plugin.md) note 拥有本 seam 扩展的团队能力。
- [permission 子系统页](../../../../docs/subsystems/permission.md) 与 [adding-agent-team 手册](../../../../docs/cookbook/adding-agent-team.md) 记录已交付的面。
