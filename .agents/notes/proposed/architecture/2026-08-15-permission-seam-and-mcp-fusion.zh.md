# Agent Note: The permission seam — parameter-level tool rules and fused MCP mounting for controlled team workflows

[English](2026-08-15-permission-seam-and-mcp-fusion.md) | 中文

Status: proposed

## Problem

DeepSeek Harness 目前只能按工具名限制团队成员的工具。`TeamToolPolicy` 携带 `allow`/`deny` 名单，`TEAMMATE_DENIED_TOOLS` 硬编码三个协调工具，`createMcpGuard` 按 `mcp__<server>__` 前缀遮蔽 MCP 工具名。一个被允许 `pwsh` 的成员可以运行任意命令；一个被允许 `write` 的成员可以写任意路径。无法表达"这个 teammate 可以跑 `git status` 但不能 `rm -rf`""可以读仓库但绝不能读 `.env`""可以调用 `postgres` MCP 的 query 工具但不能用其他 server"。对于一个把真实权限托付给 teammate 的工程控制环境，名字级的门禁不是一个可托付的基座。

MCP 访问有同样的形状缺口。每个 MCP server 都是全局挂载的，唯一的按成员控制是名字遮蔽。成员无法被分配一组稳定、持久化的 MCP server，skill 无法在一次任务期间拉入它所需的 MCP，未使用的 server 也无法保持断开以让它的工具描述不占用无关会话的 context。两种有用的模式——成员持久化的 MCP 集合（稳定、可审计）和 skill 按需拉起的 MCP（随任务加载）——都缺失，而拥有它们的参考实现要么把 server 凭据散落进可复制的 skill 文件（oh-my-opencode），要么止步于对共享连接的名单过滤（PilotDeck）。

这些缺口位于 [agent 团队插件](../../implemented/feature/2026-08-14-agent-team-plugin.md) 已经拥有的边界上，但它们并非团队专属：一个主 agent 和一个单发委派子代理需要同样的参数级权限。委派子代理还额外运行在 [审批固定为 `'never'`](../../implemented/feature/2026-08-10-subagent-approval-pinned-never.md) 之下，所以对它们而言，做决定的权威必须是一个规则引擎，而不是一个交互式提示。

## Proposal

引入一个 `permission` 能力接缝，作为一组独立的包，被团队插件、主 agent 和单发委派子代理共同消费。融合 MCP 挂载，让一个成员的持久化 server 和一个 skill 声明的依赖汇聚成一个惰性管理的、按作用域的 MCP 集合。分阶段交付，让可托付的团队控制底座先落地，通用引擎和 MCP 隔离随后跟进而不返工。

### `permission` 接缝及其边界

三个包构成这个接缝：

- `packages/permission/permission` —— Service Definition：`evaluate(toolCall, context)` 返回 `deny | ask | allow`，以及规则中间表示（IR）、规则层、权限模式类型。发布 service 的这一行属于 host 组合。
- `packages/permission/permission-engine` —— Service Provider：字符串规则解析为 IR、下述四类匹配器、`deny > ask > allow` 分层裁决（含绝对的 managed 层）、权限模式兜底和审计事件。
- `packages/permission/tool-permission-guard` —— 一个 `tools/pre-execute` Consumer，为主 agent 和单发委派子代理应用 `evaluate`。

团队插件改为 `inject: ['permission']`：它的 `installApprovalHook` 不再按工具名门禁，而是调用 `evaluate`。`ask` 结果复用现有的 leader rendezvous（在 `team/control-request` 上的挂起-唤醒-裁决循环），而不是新建通道。

这个接缝位于 OS 底座之上、而非之内。`permission` 引擎决定一个工具调用是否可以发起；[子进程沙箱](../../implemented/feature/2026-07-06-sandbox.md) 和 `fs-sandbox` 仍是一个并列的 OS 级兜底，物理地约束一个已发起的调用。`ask` 结果对主 agent 经现有 [审批接缝](../../implemented/feature/2026-07-06-approval-seam.md) 交付、对 teammate 经 leader rendezvous 交付。`permission` 依赖审批接缝来兑现 `ask`；它不吸收审批接缝，也不与沙箱合并。

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

未命中的调用由一个按作用域的权限模式裁决，它是一个 config 枚举。先落两种模式：`enforce`（未命中 ⇒ `deny`，白名单；受控 teammate 的默认）和 `default`（未命中 ⇒ `allow`，黑名单；给主 agent）。`readonly` 和 `bypass` 是为将来预留的枚举值。模式按作用域绑定——主 agent 的模式来自 host 或 project 配置，teammate 在 `.md` frontmatter 里声明自己的——managed 层可以为模式设上限（例如全舰队禁止 `bypass`）。managed 的 `deny` 在每种模式下仍然生效，所以一个组织的 `deny: Read(//**/.env)` 连一个 `default` 模式的主 agent 也兜底。

### 规则分层、持久化与审计

规则从分层文件加载：managed（一个受保护的策略文件）、project（一个项目级文件）和 teammate（`.md` frontmatter）。加载对数组值的规则集合并去重，并保持 `deny` 跨层绝对。规则学习——把一次被批准的 `ask` 写回一个选定的目的地（`session`/`project`/…）——此刻只在文件格式中定形而不在第一阶段实现；一条 session 级的学习规则映射为一个 session event。

每次 `evaluate` 追加一条 `permission/decision` 审计 session event，携带工具名、决策、命中的规则、层、成员 id、模式和原因。一个工程控制环境必须能够事后重建谁在哪条规则下被允许或拒绝了哪个操作。

### 融合的 MCP 挂载

一个成员可用的 MCP 集合汇聚两个来源：成员级 `mcpServers`（持久、始终分配）和成员已启用 skill 声明的 MCP 依赖名。skill 只声明依赖名；真正的 server 定义——命令、参数、端点、凭据——存放在一个由 managed 和 project 层管控的 MCP 注册表里。这保留了 oh-my-opencode 的按需加载而不把凭据散落进可复制的 skill 文件，也保留了 PilotDeck 的单一可审计来源。汇聚结果去重，在加载时对照注册表 catalog 校验（未定义的 server 以 `MCP_SERVER_NOT_FOUND` fail-loud），再经 `permission` 引擎的 `mcp__server` 规则过滤。

MCP 生命周期分两阶段交付。阶段 B：引用计数的懒启停——注册表 server 在有任一活跃成员引用它时连接、在所有引用释放时断开，同名 server 共享一个连接；每个连接是一个绑定到子会话的 `ctx.effect()` disposer。一个 `warmup: eager | lazy` 的 config 设置让 eager server 在冷恢复和首次委派时后台预连、与 teammate 的工作并行，使首次调用不必付进程 spawn、MCP `initialize` 握手和 `tools/list` 的延迟；eager 预热失败按三步降级——teammate 侧回退到 lazy 并继续工作、失败上报给 leader 和 UI、仍无法连上其 MCP 的工具带原因 fail-closed。阶段 C：按作用域的独立实例，用于进程、状态和凭据隔离，替换共享连接而不返工生命周期。`maxPerSessionMcpInstances`、懒启动超时、空闲断开超时和默认 `warmup` 值从第一阶段起就是 config 字段。

### 冷恢复

一个被恢复的 teammate 会话从持久的 `team/member-bound` 事件重建它的策略，不依赖父进程的活注册表。teammate 内联规则被快照进那个事件并随会话冻结，所以一个被删除的成员文件不会破坏恢复。managed 和 project 层在恢复时被重读，所以一个组织收紧的 `deny` 立即约束一个进行中的被恢复会话；缺失的 managed 文件 fail-loud 并拒绝恢复。MCP 恢复只重建可用依赖声明；连接懒启动，一个 `eager` server 在后台预连。当一个 `ask` 因 leader 会话不可达而无法裁决时，`permission` 以一个 `deny` fail-closed，其原因明确说明这不是最终否决——teammate 应推进其他工作并稍后自行重试该操作——且该决策被审计。

### 交付阶段

- 阶段 1（可托付的底座）：`permission` 三件套、四类匹配器、带 `enforce`/`default` 模式和绝对 managed 层的 `deny > ask > allow`；团队插件注入 `permission`，`installApprovalHook` 调用 `evaluate`，`ask` 复用 rendezvous；`permission/decision` 审计事件；分层文件加载与合并（只读）；冷恢复规则快照。
- 阶段 2（MCP 融合 B）：注册表 catalog 校验、成员 ∪ skill 依赖汇聚、带 `ctx.effect()` 生命周期的引用计数懒启停、上限与超时 config、以及带三步降级的 eager 预热。
- 阶段 3（强化）：带写回目的地及其持久化与并发的规则学习；按作用域的独立 MCP 实例；`readonly`/`bypass` 模式；Claude Code 和 Codex hook 桥作为 `permission` 消费者。

## Alternatives considered

**只扩展团队层，不新建接缝。** 就地扩展 `TeamToolPolicy` 和 `installApprovalHook` 交付最快，但参数级权限并非团队专属——主 agent 和单发委派子代理需要同样的规则——且一个活在单个 `tools/pre-execute` 监听器里的规则引擎没有可被消费的 Service Definition、依赖监听器顺序而非做决定的那一点（包不变量将其判为非强制），并会在将来被重做成一个 service。被否决，改用接缝，并分阶段以让团队层的成果仍然先落地。

**单一的全局默认判定。** 全局 `allow` 默认（仅黑名单）符合今日行为，但让一个工程控制环境离一条缺失的 `deny` 就等于开放一个工具；全局 `deny` 默认（仅白名单）安全但瘫痪主 agent。按作用域的权限模式让受控 teammate 跑 `enforce`、主 agent 跑 `default`，managed `deny` 为两者兜底。

**用结构化 JSON 选择器作为作者书写形式（PilotDeck 的 `ToolCallSelector`）。** 结构化选择器精确且易于程序化构造，但必须被人评审、纳入版本控制、跨层合并的规则以字符串形式可读得多；引擎在内部保留结构化 IR 用于匹配与审计，作者书写字符串。

**skill 携带内联 MCP server 定义（oh-my-opencode）。** 让 skill 的 frontmatter 定义 MCP server 带来按需加载，但一个 MCP server 定义是部署敏感的——命令、端点、凭据——绝不能散落进可复制的 skill 文件，那会漂移、泄露并逃出 managed 管控。skill 只声明依赖名；定义留在一个受管控的注册表里。

**把 `permission` 并入 `fs-sandbox`。** 两者回答不同的问题——一个工具调用是否可以发起，与一个已发起的调用是否被物理约束——且独立演化，所以它们是一个纵深防御栈的两个并列层，而非一个包。

**从一开始就用按作用域的 MCP 实例（跳过阶段 B）。** 完全的进程隔离是最强形式，但它的实例池、按会话上限和失败恢复很复杂，而第一阶段的需求是按需启停并让无关 MCP 不进一个会话的 context——引用计数的共享连接已经满足这些。独立实例形式将来替换共享连接而不返工生命周期。

**eager 预热作为按 MCP 的脚本。** 预连一个 MCP 不需要按 server 一个脚本：启动命令已经在注册表里，所以预热就是引擎更早地、并行地发起已有的连接。按 MCP 的脚本会重新引入注册表所消除的散落配置问题。

## Acceptance criteria

- 一个 `enforce` 模式的受控 teammate 被拒绝一个不命中任何 allow 规则的工具调用，且该拒绝在 executor 处可观测，而非仅从工具 schema 中缺席。
- 一条 managed 层 `deny` 阻断一个 teammate 或 project `allow` 本会允许的调用，在 `enforce` 和 `default` 两种模式下都如此。
- 一个 `Bash`/`pwsh` 复合命令在任一子命令命中 `deny` 规则时被拒绝；一条针对主内容字段的 `param:value` 规则被忽略并带一个加载期警告。
- 每次 `evaluate` 追加一条 `permission/decision` 事件，其字段可重建该决策，且一个被恢复的 teammate 会话从 `team/member-bound` 重新推导 teammate 内联规则、同时重读 managed 和 project 层。
- 一个成员可用的 MCP 集合是其 `mcpServers` 与其已启用 skill 声明依赖的去重并集；一个未定义的 server 在加载时以 `MCP_SERVER_NOT_FOUND` fail-loud。
- 一个阶段 B 的注册表 server 在首次活跃引用时连接、在所有引用释放时断开；一个 `eager` server 在冷恢复时预连；一次失败的 eager 预热降级到 lazy 而不使 teammate 失败。
- `maxPerSessionMcpInstances`、懒启动与空闲断开超时、以及默认 `warmup` 值是 config 字段。
- 一个真实的 cordis.yml 组合测试演练 enforce 模式拒绝、managed 跨层拒绝和主 agent default 路径。

## Risks

- **第二套权限系统。** 若 `permission` 与 `fs-sandbox` 模糊，决策就分裂到两个所有者。边界是明确的：`permission` 决定发起、沙箱约束执行，且只有 `permission` 产出 `deny`/`ask`/`allow`。
- **规则脆弱性。** 命令参数模式是尽力而为的——一个复合命令、一个变量或多余空格可以规避一个朴素模式，正如 Claude Code 所记录。引擎以子命令拆分和 wrapper 剥离来缓解，而 managed `deny` 加上 OS 沙箱才是真正的兜底；规则语言本身不被呈现为一道安全边界。
- **MCP 生命周期正确性。** 引用计数启停、冷恢复重连和 eager 预热触及进程生命周期，一个泄露或双重释放的连接是缺陷；每个连接是单个 `ctx.effect()` disposer，预热失败降级而非崩溃。
- **冷恢复的策略陈旧对可用性。** 重读 managed 层让一个被恢复的会话保持最新，但把恢复耦合到文件可用性；一个缺失的 managed 文件使恢复 fail-closed，一个受控环境宁可如此也不带着一份失效的策略运行。
- **分阶段成本。** 三个阶段比一个耗时更长，但第一阶段交付可托付的团队控制底座，后续阶段替换部件而不返工 IR 模块或生命周期，前提是阶段 1 的接口按复用定形。
