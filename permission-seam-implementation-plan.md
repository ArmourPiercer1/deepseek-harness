# 实施计划：`permission` 能力接缝 + MCP 融合挂载

> 配套文档：设计决策见 Agent Note `implemented/architecture/2026-08-15-permission-seam-and-mcp-fusion.md`（含中文版）。
> 本文件是**任务级工序计划**（不属于 Agent Note——按 docs/AGENTS.md，acceptance-task checklist / migration steps 不进 Note 正文）。
> 范围：特征差距文档 §9-A + §9-B。分三阶段；每阶段可独立评审、独立交付。
> 约定：所有贡献走 `ctx.effect()`/`ctx.on()` 返回 disposer；每包 owns `./invariant`；每个产品可见插件配真实 cordis.yml 组合测试。

---

## 0. 前置核实（已完成，供实现者复用）

| 事实 | 出处 |
|---|---|
| 工具管线：`tools/pre-execute`（异步 waterfall，返回 `PreToolDecision = allow\|deny{reason}\|ask{reason?}` 或 `next()`）→ 审批 `ask` 段（`allowed-once` 缓存）→ 同步 `ToolGuard`（只 deny）→ 执行体 | `packages/core/tools/src/index.ts` L588-591, L1101-1124, L1364+ |
| `ToolExecution` 暴露 frozen `arguments`（JSON）、`name`、`agent`、`signal` | 同上 L1364-1416 |
| team 审批已是 scoped `ctx.on('tools/pre-execute')`：按名 gate → `team/control-request` → `subagents.reportFrom(wakeup)` → `teamControl.decide` | `packages/team/team-runtime/src/approval-setup.ts` |
| 委派携带 `delegationEvents:[{type:'team/member-bound',data}]`，冷恢复经 `registerContinuableSetup` 读该事件重建 | `tool-team/src/tool-delegate.ts` L157-173；`team-runtime/src/member-setup.ts` |
| MCP guard 现状：`ctx.tools.guard(createMcpGuard(policy))`，按 `mcp__server__` 前缀遮蔽 | `team-runtime/src/mcp-guard.ts` |
| 包结构：`package.json` 导出 `./invariant`；`ctx.invariants.register(PACKAGE_NAME, install)`；tsconfig extends base、rootDir src、注册进一个 aggregate | `packages/team/*`、packages/AGENTS.md |
| 审批兑现：`user-approval` 包（主 agent 的 `ask` 通道） | `packages/interaction/user-approval` |
| 委派子代理审批固定 `'never'`（故对子代理，规则引擎=唯一决策权威） | Note `implemented/feature/2026-08-10-subagent-approval-pinned-never.md` |

**沙箱注意**：`pnpm run verify-agent-note-format` 等 tsx/esbuild 门在当前会话因 esbuild 需 spawn worker 而 `EPERM`；CI 拥有这些信号。本地以 `pnpm run build` / `vitest` 覆盖（若同样受限，交由 CI）。

---

## 阶段 1 — 可托付的团队控制底座（§9-A→B 桥）

目标：受控 teammate 能被参数级规则拒绝；managed deny 跨层绝对；主 agent/单发子代理经同一引擎受管控；每次判定可审计；冷恢复保留策略。

### 1.1 新包骨架（三件套）
- [ ] 建 `packages/permission/permission/`（Service Definition）
  - `src/types.ts`（仅类型）：`RuleIR`、`RuleLayer`（`managed|project|teammate`）、`PermissionMode`（`enforce|default|readonly|bypass`，后两者预留）、`PermissionDecision`（`{kind:'deny',reason}|{kind:'ask',reason?}|{kind:'allow'}` + `matchedRule?`、`layer?`、`cause?`）、`ToolCallView`（`{name, arguments}`）、`PermissionContext`（`{mode, memberId?, layers}`）。
  - `src/index.ts`：Service 接口 `evaluate(call: ToolCallView, ctx: PermissionContext): PermissionDecision`；`declare module` 合并 `Context` 服务声明 `permission`。
  - `package.json` 导出 `.`、`./invariant`；`src/invariant.ts`：`No runtime invariant:` 理由（纯定义包无运行时关系）或对事件关系的检查。
  - tsconfig：extends base、rootDir src、references 依赖、注册进对应 aggregate。
- [ ] 建 `packages/permission/permission-engine/`（Provider）——见 1.2–1.5。
- [ ] 建 `packages/permission/tool-permission-guard/`（Consumer）——见 1.6。
- [ ] `packages/README.md` 增 `permission/` 组说明；三个包各写 README（config/语义/限制/Model Experience）。

### 1.2 规则解析（字符串 → IR）
- [ ] `parseRule(str): RuleIR`：识别 `Tool` / `Tool(specifier)`；分派四类：命令(Bash/pwsh)、路径(Read/Edit/Write…)、MCP(`mcp__…`)、通用(`Tool(param:value)`)。
- [ ] 命令 specifier：`:*` 尾缀 = 尾通配；`*` 任意（含空格）；尾部 ` *` 词边界；主内容字段 `command` 用 `param:value` → **加载期警告并忽略**（照抄 Claude Code 防呆）。
- [ ] 路径 specifier：锚点 `//`(FS 根)/`~`(home)/`/`(相对配置源)/相对 cwd；gitignore 语义；记录 allow 单段深度不对称行为。
- [ ] 单测：每类 specifier 的正/负样例（含 Claude Code 文档里的坑：复合命令、wrapper、变量、多余空格）。

### 1.3 四类匹配器（纯函数，无副作用）
- [ ] 命令匹配：按 `&&|`||`|;|`|`|`|&|&`|newline 拆子命令，逐个独立匹配；剥离固定 wrapper 集（`timeout/time/nice/nohup/stdbuf/command/builtin` 等）；pwsh 别名归一（`gci/ls/dir`）。复用 `packages/shell` 现有 AST 能力（先调研，见开放项）。
- [ ] 路径匹配：gitignore 引擎；Windows `C:\`→`/c/` 归一；符号链接双路径校验（allow 需两者皆匹配、deny 任一匹配）。
- [ ] MCP 匹配：`mcp__server` / `mcp__server__tool` / `mcp__server__*` 前缀。
- [ ] 通用参数匹配：顶层标量字段 `param:value`（`*` 通配），排除主内容字段。
- [ ] 单测：每匹配器最小/精确/超长边界。

### 1.4 分层裁决 + 模式兜底（`evaluate` 的核心，C3 在此强制）
- [ ] 合并分层规则集：数组并集去重；保留来源 `layer`。
- [ ] 裁决顺序 `deny → ask → allow → 模式兜底`；首个匹配定结果。
- [ ] managed `deny` 绝对：任何模式、任何下层 `allow` 不可覆盖。
- [ ] 模式兜底：未命中 → `enforce`=deny / `default`=allow；`readonly/bypass` 抛"未实现"占位。
- [ ] 单测：deny 覆盖 allow、managed 跨层、模式分叉、未命中兜底。

### 1.5 审计事件
- [ ] 定义 session event `permission/decision`（字段：`toolName, decision, matchedRule?, layer?, memberId?, mode, cause?`）；JSDoc 带 `@mode`/`@param`；定 `ignorable` 与否。
- [ ] `evaluate` 成功产出决策后**在 commit 点**追加事件（publish state only at commit point）。
- [ ] 单测 + 组合测试断言事件可重建决策（C4）。

### 1.6 主 agent / 单发子代理 Consumer
- [ ] `tool-permission-guard`：`ctx.on('tools/pre-execute', ...)` 调 `ctx.get('permission').evaluate(...)`；`allow`→`next()`，`deny`→`{kind:'deny'}`，`ask`→`{kind:'ask'}`（经 user-approval 兑现）。
- [ ] 模式/规则来源来自 host/project config（C6：config 字段，非硬编码）。
- [ ] `ctx.effect` 注册 + disposer；HMR-safety 测试（dispose fiber 观察移除）。

### 1.7 团队插件接入
- [ ] team 相关包 `inject: ['permission']`。
- [ ] 改 `installApprovalHook`：把 `gated.has(exec.name)` 的按名 gate 换成 `permission.evaluate(view, {mode, memberId, layers})`；`ask`→**复用现有 leader rendezvous**（`team/control-request`→`reportFrom(wakeup)`→`teamControl` 裁决）不变。
- [ ] `TeamMemberDefinition`/`parser.ts` 增 `permissionMode` 与 `permissions{allow,ask,deny}` frontmatter 字段；`TeamMemberBoundData` 增对应快照字段。
- [ ] 保留现有 `requiresApproval`（作为 `ask` 规则的语义子集或迁移为 `ask:[...]`——迁移策略见开放项）。

### 1.8 分层文件加载（只读）
- [ ] managed（受保护策略文件）/ project（项目级）/ teammate（`.md` frontmatter）三源加载与合并。
- [ ] 加载期 fail-loud：格式错误、managed 缺失。
- [ ] managed 层物理保护方式（只读/所有权）——见开放项，先定路径与读取。

### 1.9 冷恢复（规则快照，8-1 混合）
- [ ] teammate 内联规则快照进 `team/member-bound`（自包含冻结）。
- [ ] 恢复时 managed/project **重读**（保持"活"）；managed 缺失 fail-loud 拒绝恢复。
- [ ] leader 不可达的 `ask` → fail-closed `deny`，reason 明确"非最终否决、稍后自主重试"（纯提示）；落审计。
- [ ] 组合测试：冷恢复后 enforce 规则仍生效、managed 收紧立即约束。

### 1.10 阶段 1 验收（对应 Note Acceptance criteria 前 4 条）
- [ ] 真实 cordis.yml 组合测试：enforce 拒绝（executor 层可观测）、managed 跨层 deny、主 agent default 路径、复合命令子命令 deny、`param:value` 主内容字段被忽略+警告、`permission/decision` 事件重建。
- [ ] `pnpm run build` / `vitest run packages/permission packages/team` / `oxlint` / 各包 `./invariant` 门（CI 拥有 tsx/esbuild 门）。
- [ ] Note 保持与实现一致（proposed→implemented 迁移时改写 Proposal 为 Decision）。

---

## 阶段 2 — MCP 融合（生命周期 B）

目标：成员级常驻 ∪ skill 声明依赖汇聚；引用计数懒启停；eager 预热 + 三步降级；上限/超时 config。

### 2.1 统一 MCP 注册表 + catalog 校验
- [ ] 定位/建立统一 MCP 注册表（server 定义：command/args/endpoint/凭据），受 managed/project 分层管控（复用现有 mcp 客户端插件的注册？见开放项）。
- [ ] 加载期对成员级 `mcpServers` ∪ skill `requiresMcp` 依赖名做 catalog 校验；未定义 → `MCP_SERVER_NOT_FOUND` fail-loud。

### 2.2 来源汇聚 + skill 依赖声明
- [ ] skill 定义增 `requiresMcp: [server-name…]`（只声明名，不内联配置）。
- [ ] 汇聚：成员可用 MCP = `mcpServers` ∪ (已启用 skill 的 `requiresMcp`)，去重。
- [ ] 汇聚结果再经 `permission` 的 `mcp__server` 规则过滤（阶段 1 引擎复用）。

### 2.3 引用计数懒启停（`ctx.effect` 生命周期）
- [ ] 每个注册表 server：有活跃成员引用即连接、全释放即断开；同名共享一个连接。
- [ ] 每连接 = 一个绑定子会话的 `ctx.effect()` disposer（reversible side effect）。
- [ ] config 字段（此阶段立齐）：`maxPerSessionMcpInstances`、懒启动超时、空闲断开超时、默认 `warmup`。

### 2.4 eager 预热 + 三步降级
- [ ] `warmup: eager|lazy`（per-server 或 per-scope config）。
- [ ] eager：冷恢复/首次委派时后台并行预连（与 teammate 工作并行）——引擎按注册表已有定义主动发起连接（**非**每 MCP 脚本）。
- [ ] 失败三步降级：① teammate 侧回退 lazy 继续工作 → ② 上报 leader + UI（`team/progress` 扩展或新事件族，见开放项）→ ③ 真用到仍失败 → 该工具 fail-closed 带原因。
- [ ] 冷恢复 MCP：只重建可用依赖声明，连接懒启，eager 者后台预连。

### 2.5 阶段 2 验收（对应 Note Acceptance 后 3 条）
- [ ] 组合测试：首次引用连接、全释放断开、eager 冷恢复预连、eager 失败降级不使 teammate 失败、未定义 server fail-loud、config 字段生效。

---

## 阶段 3 — 强化

- [ ] **规则学习写回**：`ask` 被批准后按 destination（`session|project|…`）写回；session 级 = session event；project 级 = 文件写入（并发/持久化/乐观锁）。文件格式阶段 1 已按"可写回"定形，此处只补写入。
- [ ] **MCP per-scope 独立实例（C）**：进程/状态/凭据隔离；实例池 + `maxPerSessionMcpInstances` 回收；替换共享连接而不返工生命周期。
- [ ] **权限模式扩展**：实现 `readonly` / `bypass`（含 managed 锁 `bypass` 的 `disableBypass` 等价开关）。
- [ ] **hook 桥作为 permission 消费者**：Codex/CC `PreToolUse` 叠加到引擎之上；内化"hook 不能绕过 deny/ask"（引擎是地板）。

---

## 依赖与顺序

```
阶段1（permission 三件套 + team 接入 + 审计 + 冷恢复）
   └─▶ 阶段2（MCP 融合 B，复用阶段1引擎的 mcp__server 过滤）
          └─▶ 阶段3（规则学习 / per-scope 实例 / 模式扩展 / hook 桥）
```
阶段 1 的 `evaluate` 纯函数 IR 模块与 Service 接口必须按"被阶段 2/3 复用"定形，避免返工。

---

## 开放项（实现阶段再定，非阻塞设计）
- `permission/decision` 事件确切字段与 `ignorable`。
- 分层文件确切路径 + managed 层物理保护（只读/ACL/所有权）。
- 命令匹配复用 `packages/shell` 的 pwsh/bash AST 能力 vs 自建（先调研 shell 包导出面）。
- 统一 MCP 注册表：复用现有 mcp 客户端插件注册 vs 新建；凭据经 `credentials` 包引用。
- `requiresApproval` → `ask` 规则的迁移路径（保留旧字段兼容 or 一次性迁移）。
- warmup 失败上报走 `team/progress` 扩展 vs 新事件族。
- skill `requiresMcp` 声明落在 skill 定义的哪个字段（对齐 `packages/skill` 现有 frontmatter）。

---

## 验证命令（每阶段收尾）
- `pnpm run build`（tsc + tsdown）
- `pnpm run test`（或 `vitest run packages/permission packages/team`）
- `pnpm run lint`（oxlint）
- `pnpm run verify-package-invariants` / `verify-agent-note-format` / `verify-translation-pairing`（CI 拥有 tsx/esbuild 门；本地受沙箱限制时交由 CI）
- 真实组合测试（每阶段各自的 cordis.yml 断言 model-visible/durable 输出）
