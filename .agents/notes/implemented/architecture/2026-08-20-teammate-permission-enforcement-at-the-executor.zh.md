# Agent Note: 在执行器上强制 teammate 权限

Status: implemented

[English](2026-08-20-teammate-permission-enforcement-at-the-executor.md) | 中文

## 问题

[权限 seam](2026-08-15-permission-seam-and-mcp-fusion.md) 的第一阶段要求 teammate 的权限决策在执行它的操作处被强制：deny 路径必须透过执行器可观察，而不是透过 schema 缺席或提示词过滤，因为持有工具的调用方可以绕过其他任何关卡。本阶段之前存在的团队审批钩子是以遗留 `requiresApproval` frontmatter 列表为键的名字过滤：列在其中的工具挂起待 leader 裁决，其余所有工具不经审视直接通过。这个形状根本无法表达引擎的策略——未匹配调用没有模式回退，没有 managed 或 project 层，任意工具没有 `deny` 或 `allow` 规则——而且一个被改名的工具会无声地逃过名字过滤。[分层规则加载 note](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md) 已交付分层规则加载与冷恢复快照，但没有任何东西消费它们：恢复的规则状态只被存储、只被测试读取。

## 决定

`dsh-team-runtime` 硬注入 `permission`（`inject: ['permission']`），并在每个绑定的 teammate 子会话上安装强制钩子；遗留的 `requiresApproval` 列表不再把关任何东西。

- **注入是硬的。** [分层规则加载 note](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md) 记录了这个权衡中当时选定的松 `ctx.get` 一侧；本阶段在本轮的产品决定（强制必须在团队受策略运行的任何地方在场）下反转了那个决定。后果是显影的而非静默的：插件只在组合了 permission engine 行的地方激活，因此没有 engine 的组合会把 team-runtime 行显示为 pending，而不是带着看不见的策略缺口运行。没有任何已发布的组合携带 engine 行（本轮不允许新增依赖），因此已发布 team 预设的 team-runtime 行保持惰性，直到某个部署把 engine 与其组合到一起。
- **钩子就是决策点。** 绑定子会话上的每个 `tools/pre-execute` 调用都由 `permission.evaluate` 评估，对照该成员恢复的规则分层（[成员设置贡献](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md) 在全新创建与冷恢复时启动的加载）与该成员的模式 `bound.permissionMode ?? 'enforce'`。钩子不过滤工具 schema：被拒绝的调用是一次已分发的调用，由执行器以引擎对模型可见的理由结算。
- **评估输入。** 模式来自持久的 `team/member-bound` 快照（未声明时为 `enforce`，因此字段存在之前写入的载荷读作受控默认）。路径基址把引擎的锚点解析到子会话自身 scope：`/` 对会话 cwd（该 scope 的设置上下文）、`~` 对 `$DSH_HOME`、`//` 对文件系统根。策略每个子会话只编译一次；引擎编译诊断路由到 `ctx.logger`（`error:` 前缀到 `error`，其余到 `warn`）。
- **在提交点审计。** 每次评估都追加既有的 `permission/decision` 会话事件（引擎的 `PermissionDecisionData`，无新字段、无新事件类型）：结果、工具、模式恒在；行动成员、裁决规则的 raw 字符串与层、deny 原因在适用时在。从未到达引擎的调用——没有安装规则状态，或策略加载被拒绝（managed 失效、层文件格式错误）——直接拒绝且不留审计，因为没有决策可记录；加载失败在它浮现之处记入日志。
- **`ask` 走 leader 会合。** 无新事件类型：子会话记录 `team/control-request`，创建一个控制注册表条目，并以字节稳定的复核文本唤醒 leader（脚本化 leader 工具解析的就是它）。`allow_once` / `approve_plan` 通过继续 pre-execute 链恢复被挂起的执行，`deny` 与 `request_revision` 以理由结算该调用，`escalate_to_user` 把请求上抛给用户。等待期间落地的中止把调用结算为拒绝并对账注册表条目。当根本没有任何可达的 leader——没有父会话、没有会合服务、或唤醒失败——该 ask 结算为一个带 `cause: 'leader_unreachable'` 的已审计 deny，其理由明确说明这并非最终裁决。
- **`requiresApproval` 是遗留字段。** `dsh-team-local` 仍解析它并快照进 `team/member-bound`，以兼容既有定义与冷恢复，但强制点从不读取它；同一工具的 `ask` 规则才是现行机制。

## 曾考虑的方案

**保留名字关卡并扩展它。** 在 `requiresApproval` 列表周围加上 `deny` / `allow` / 模式处理，可以保留无 engine 也能激活，但关卡仍然只枚举"哪些要问"：未匹配调用归模型自理，managed 与 project 层无处安放，关卡覆盖面就是某一份 frontmatter 列表碰巧列了什么。在执行器上用引擎完整规则集强制才是本阶段的要求；名字关卡退役。

**松 `ctx.get`、仅在场时安装钩子。** 没有 engine 的组合那样能激活，子会话却带着静默未强制的策略运行——正是 seam 验收标准禁止的看不见缺口。硬注入把可见性移到组合本身。

**为 ask 流程新增会话事件。** 会合已经持久记录了它的请求与决定并唤醒 leader；平行的事件对会复制那条轨迹，并违反本阶段无新事件类型的约束。

**fail-closed 的拒绝也审计。** `permission/decision` 记录是引擎的决策记录；加载失败与无策略的拒绝先于任何评估。把它们记入日志（带成员 id 与加载错误）让故障可诊断，而不假装引擎做了决定。

## 后果

- deny 路径在真实组合下、在执行器处可观察：team-runtime 的 `permission-enforcement` Loader 组合测试启动完整行集（session、llm、tools、system-prompt、agent、agent-loop、subagent + spawn provider、persistence、team、team-local、team-runtime、team-channels、tool-team、permission-engine，外加测试专用的脚本化 LLM 与 probe 工具），并断言三种结果——enforce 模式未匹配调用以模式理由被拒绝且工具仍留在子会话 schema、`ask` 规则在会合处挂起并在 leader 真实 `team_control` 决定后恢复、managed `deny` 在 `default` 模式下穿透 teammate `allow`。
- 规则语法限制是 fixture 可见的事实：裸 `Tool` 名只对引擎已知家族（command、path、`mcp__`）可解析，任何其他工具取 `Tool(param:value)` 说明符，解析不出匹配器的规则会被带诊断地丢弃——记载于 `dsh-team-local` README。
- 每个带绑定事件的 teammate 会话为每次已评估调用携带一条 `permission/decision`，按会话日志规则为读取必需。
- 冷恢复兼容不变：无 `permissionMode` 的绑定载荷读作 `enforce`，无 `rules` 的载荷只加载文件层。
- 基于已发布 profile 的 M6 team-agent e2e 被硬注入作废：该组合不携带 engine 行，因此 team-runtime 行为 pending、其 ask 挂起永不发生、其快照必须在本轮集成把 engine 行组合进 profile 后重新录制（manifest + lockfile 接线，超出本阶段文件域）。
- 组合接线缺口作为已知限制记载于 `dsh-team-runtime` 与 `dsh-permission-engine` README。

## 相关

- [权限 seam 与 MCP 融合](2026-08-15-permission-seam-and-mcp-fusion.md) 提案拥有更宽的 seam；其第一阶段（决策面）随本 note 完成——执行器上的 evaluate、走 leader 会合的 ask、enforce 默认、提交点的审计——并为后续阶段（MCP 生命周期、规则学习）保持活跃。
- [分层规则加载 note](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md) 交付了本阶段消费的加载器、文件格式、失败关闭契约与持久快照；其松 `ctx.get` 决定被本 note 反转，其被拒的硬注入方案就是交付的设计。
- [工具权限守卫 note](2026-08-20-tool-permission-guard-resolves-permission-per-call.md) 拥有守卫的每调用服务解析——同一硬激活语义下的另一个 `permission` 消费者。
- `dsh-team-runtime` README 记载强制点，`dsh-team-local` README 记载 frontmatter 字段与规则语法，[adding-agent-team 手册](../../../../docs/cookbook/adding-agent-team.md) 记载分步编写路径。
