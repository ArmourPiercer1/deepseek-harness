# 设计共识：`permission` 能力接缝 + MCP 融合挂载（面向工程控制环境的可托付团队工作流）

> 状态：**设计共识已达成**（经 grilling 逐题确认），待评审后进入实现规划。
> 来源：对 PilotDeck / oh-my-opencode / Claude Code 权限模型的核实分析（见 `team-mode-feature-gap-analysis.md` + Claude Code 官方文档抽取）。
> 目标场景：**工程控制环境**，重点在**参数级权限控制**与**持久化团队工作流**。不限于 coding。
> 对应特征差距文档的：§9-A（低成本天然契合）+ §9-B（中成本新 seam）。

---

## 0. 一页纸总览

新增一个**独立的 `permission` 能力接缝插件**（Service Definition + Engine Provider + Guard Consumer），
team 插件通过 `inject: ['permission']` 依赖它；`ask` 复用现有 user-approval / leader rendezvous；
`fs-sandbox` 作为并列的 OS 兜底层不变。同时新增 **MCP 融合挂载**：成员级常驻 MCP + skill 声明依赖，
统一注册表集中 server 定义，懒启停 + 可选预热，随子会话生命周期起停。

三层纵深防御：
```
permission（工具调用语义策略：规则+模式，可托付/可审计）
        └─ ask ─▶ user-approval / team rendezvous（人在环兑现）
fs-sandbox（OS 强制兜底：workspace-write 根 / landlock）
```

---

## 1. 已确认的决策清单（逐题）

| 编号 | 决策点 | 结论 |
|---|---|---|
| Q1 | 落点平面 | **两段式**：先团队层可用，选择器匹配抽成独立纯函数模块为宿主层复用留接口 → 最终演化为 Q3 的独立插件 |
| Q2 | 规则表示 | **字符串规则皮 + 结构化 IR 核**（对齐 Claude Code）；**要 managed 不可覆盖层**；最小三层 managed→project→teammate，**deny 跨层绝对** |
| Q3 | 引擎落点 | **上 B**：抽象为**独立 `permission` 插件**，team 作为其**依赖**；主 agent + 单发子代理 + team 三者共用；`ask` **复用现有 rendezvous**；**规则学习推迟** |
| 架构边界 | 拆分粒度 | **规则层 + 模式层 = 同一个 `permission` 插件**（一次 `evaluate()` 裁决，不互拆）；**`permission` 与 `fs-sandbox` 分离并列**为纵深两层；`permission` **依赖 user-approval** 兑现 ask |
| Q4 | 默认判定 | **per-scope 权限模式**：`enforce`（未命中=deny，白名单，受控 teammate 默认）+ `default`（未命中=allow，黑名单，主 agent）；模式作 config 枚举，per-scope 绑定，**managed 可锁上限**（如全局禁 bypass）；**managed deny 在所有模式下绝对兜底** |
| Q5 | MCP 来源 | **双来源汇聚**：成员级 `mcpServers`（常驻，2b）∪ skill **只声明 MCP 依赖名**（按需，2c，**不内联 server 配置**）；server 定义集中在**统一注册表**受 managed/project 分层管控；并集去重；**未定义即加载期 fail-loud `MCP_SERVER_NOT_FOUND`** |
| Q6 | MCP 生命周期 | **先 B 后 C**：B=引用计数懒启停 + 引用共享连接；C=per-scope 独立实例（强化档）。`maxPerSessionMcpInstances` 上限 + 懒启动/空闲断开超时**做成 config 字段（第一步即立好）**。采纳 **`warmup: eager\|lazy` 预热档**：eager 冷恢复/首次委派时后台并行预连；失败三步降级 |
| Q7 | 持久化落点 | **分层独立文件**：managed→受保护策略文件、project→项目级、teammate→`.md` 内联；加载按层合并（数组并集去重、deny 跨层绝对）；**规则学习写回（destination）按"可写回"定形但第一步只读不实现**；**每次 `evaluate` 落 `permission/decision` 审计 session event**（硬需求） |
| Q8-1 | 冷恢复规则快照 | **混合**：teammate 内联规则进 `member-bound` 快照（自包含冻结）；**managed/project 恢复时重读**（组织策略保持"活"，收紧的 deny 立即约束旧会话）；managed 缺失则 **fail-loud 拒绝恢复** |
| Q8-2 | 冷恢复 MCP | **懒重建 + 可选 eager 预热**：恢复只重建"可用 MCP 依赖声明"，实际连接按引用计数懒启；`eager` 者后台并行预连 |
| 附 | leader 不可达 | `ask` 无法裁决 → **fail-closed deny**，reason 明确"**非最终否决，请先推进其他工作、稍后自主重试**"；落审计事件；重试用 **(i) 纯提示**（不建重试调度） |

---

## 2. `permission` 能力接缝（包结构）

```
packages/permission/
  permission/            # Service Definition（仅类型+接口，发布 service → 属 host 组合）
    - evaluate(toolCall, context) → PermissionDecision
    - 类型：RuleIR, RuleLayer, PermissionMode, PermissionDecision, MatchedRule
  permission-engine/     # Service Provider（实现）
    - 字符串规则 → IR 解析
    - 四类匹配器（见 §3）
    - deny>ask>allow 跨层裁决 + managed 绝对 + 模式兜底
    - 每次判定产出 permission/decision 审计事件
  tool-permission-guard/ # Consumer：tools/pre-execute，给主 agent + 单发子代理
  # team 插件（既有）改为 inject: ['permission']，把 installApprovalHook 的按名 gate
  #   换成 permission.evaluate；ask → 现有 leader rendezvous
```

**dsh 约束对照**（全部满足）：
- C1 能力接缝三件套完整（Definition/Provider/Consumer）；发布 service 落 host 组合。
- C2 注册即效果：Consumer/监听器/MCP 连接均 `ctx.effect()`/`ctx.on()` 返回 disposer，HMR 可卸。
- C3 在 `evaluate()`（做决定那步）强制；executor 层测拒绝 + 纯函数单测双保险；**不靠监听器顺序**。
- C4 模型可见⟺有日志：`permission/decision` 审计事件 + 冷恢复 `member-bound` 快照可重建。
- C5 真实 cordis.yml 组合测试（team × 多层规则 × 拒绝路径）。
- C6 不硬编码：权限模式、规则来源层、MCP 上限/超时/warmup 均 config 字段。

---

## 3. 规则语言（对外字符串 / 对内 IR，四类匹配器对齐 Claude Code）

对外作者面（可进版本库、可 diff、可评审）：
```yaml
permissions:
  deny:  ["Bash(rm -rf *)", "Read(//**/.env)", "mcp__*"]
  ask:   ["Bash(git push:*)", "pwsh(Remove-Item *)"]
  allow: ["Bash(git status:*)", "mcp__postgres__query"]
permissionMode: enforce            # enforce | default（起步两档；readonly/bypass 预留枚举）
```

四类匹配器（对内 IR 分派，直接复用 Claude Code 踩过的坑）：
1. **命令**（Bash / pwsh）：AST/分隔符拆分（`&&`/`||`/`;`/`|`/newline 各子命令独立匹配）、wrapper 剥离、pwsh 别名归一（`gci/ls/dir`）；**主内容字段 `command` 禁用 `param:value`**（防复合命令绕过）。
2. **路径**（Read/Edit/Write…）：gitignore 语义 + 锚点 `//`(绝对) `~`(home) `/`(相对配置源)；Windows 归一 `C:\→/c/`；注意 allow 单段深度不对称坑。
3. **MCP**：`mcp__server` / `mcp__server__tool` / `mcp__server__*` 前缀；与 dsh 现有 guard 对齐但升级为分层规则。
4. **通用参数**：`Tool(param:value)`（deny/ask 用于长尾工具的顶层标量字段；主内容字段除外）。

裁决顺序：**deny → ask → allow → 模式兜底**（未命中：enforce=deny / default=allow）。**managed 层 deny 任何模式绝对生效、不可被下层 allow 覆盖。**

---

## 4. MCP 融合挂载

- **来源**：成员级 `mcpServers`（常驻）∪ 启用 skill 的 `requiresMcp` 依赖名（按需）；server 真实定义（command/args/endpoint/凭据）集中在**统一注册表**（全局/项目，受 managed/project 分层管控）。skill **只声明依赖名，不内联配置**（避免凭据散落/漂移，去掉 oh-my-opencode 缺点，保留其按需优点）。
- **校验**：加载期对照注册表 catalog，未定义 → fail-loud `MCP_SERVER_NOT_FOUND`。
- **可见性**：最终可用 MCP 工具 = 汇聚集合，再经 `permission` 的 `mcp__server` 规则过滤。
- **生命周期（先 B）**：引用计数懒启停——有成员引用即连、全释放即断；同名 server 成员间共享连接；连接是带 disposer 的 `ctx.effect()`，随子会话销毁而断。
  - **预热 `warmup: eager|lazy`**（config）：eager 在冷恢复/首次委派时**后台并行预连**（与 teammate 工作并行），消除首次调用的 spawn/握手/`tools/list` 延迟；失败三步降级：① teammate 侧回退 lazy 继续干活 → ② 上报 leader + UI（进度/审计事件）→ ③ 真用到仍失败则该工具 fail-closed 并说明原因。
  - config 字段（第一步即立）：`maxPerSessionMcpInstances`、懒启动超时、空闲断开超时、`warmup` 默认档。
- **强化（后 C）**：per-scope 独立实例（进程/状态/凭据隔离）+ 实例池/上限/回收，作为 B 之上的替换档，不返工。

---

## 5. 持久化与冷恢复

- **分层文件**：managed（受保护策略）/ project（项目级）/ teammate（`.md` 内联）；加载合并=数组并集去重 + deny 跨层绝对。
- **审计**：每次 `evaluate` 落 `permission/decision`（toolName, decision, matchedRule, layer, memberId, mode, cause）——工程控制环境事后可追责的硬需求。
- **规则学习**：写回 destination（session/project/…）**按可写回定形，第一步只读不实现**；session 级学习天然映射 session event。
- **冷恢复**：
  - 规则：teammate 内联进 `member-bound` 快照冻结；managed/project 恢复时重读（保持"活"）；managed 缺失 fail-loud 拒绝恢复。
  - MCP：恢复重建依赖声明，连接懒启（eager 者后台并行预连）。
  - leader 不可达的 `ask` → fail-closed deny + 明确"非最终否决、稍后自主重试"（纯提示，不建重试调度）+ 审计。

---

## 6. 分阶段交付（建议顺序，待实现规划细化）

**阶段 1（§9-A→B 桥，最小可托付底座）**
- `permission` 三件套（Definition/Provider/Guard Consumer），四类匹配器，deny>ask>allow + enforce/default 模式 + managed 绝对。
- team 改 inject permission；installApprovalHook 换成 evaluate；ask 复用 rendezvous。
- `permission/decision` 审计事件；分层文件加载与合并（只读）。
- 冷恢复规则快照（8-1 混合）。
- 组合测试：受控 teammate enforce 白名单拒绝路径、managed deny 跨层、主 agent default。

**阶段 2（MCP 融合 B）**
- 统一注册表 catalog 校验（fail-loud）；成员级∪skill 依赖汇聚；引用计数懒启停（disposer 生命周期）；上限/超时/warmup config；eager 预热 + 三步降级。

**阶段 3（强化）**
- 规则学习写回（addRules/destination + 并发/持久化）；MCP per-scope 独立实例（C）；权限模式扩展（readonly/bypass）；hook 桥作为 permission Consumer 叠加。

---

## 7. 待实现阶段再定的开放项（非阻塞本设计）
- `permission/decision` 事件的确切字段与是否 `ignorable`。
- 分层文件的确切路径与 managed 层的物理保护方式（只读/所有权）。
- warmup 失败上报走 `team/progress` 扩展还是新事件族。
- pwsh-AST 解析的实现依赖（复用现有 shell 包能力 vs 自建）。
