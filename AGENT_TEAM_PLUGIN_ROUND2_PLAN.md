# Agent Team 插件第二轮开发计划

制订日期：2026-08-18。本文档是 [主开发计划](AGENT_TEAM_PLUGIN_PLAN.md) 的附属文档，依据 [2026-08-18 进度审计](AGENT_TEAM_PLUGIN_AUDIT_2026-08-18.md) 与用户当日决策制订，供审批后向子代理分发。

## 本轮范围

- **纳入**：Phase 1 缺失项（1.6、1.7 设计、测试补齐）、Phase 3 缺失项（3.1 leader 中转、3.3 plan 审批、持久化最小方案）、Phase 2 偏离纠正（D1 恢复、D2 诊断）。
- **不纳入**（决策 6：本轮仅补齐底座）：5.2 Web 面板、5.3 CLI、5.4 cookbook、Phase 4 精细化权限、bundle shipped 挂载与集成测试——留待产品化轮次。
- **执行约束**：不新增 session 事件类型（词汇表耦合纪律，见主计划 §4.6）；durable 载荷变更必须冷恢复兼容；每项非平凡改动同 PR 附 Agent Note（中英双语 + 配对记录）。

## 子任务切分

难度分级：低（单文件/纯测试，规格明确）｜中（跨 2-3 文件，需理解一个 seam）｜高（跨包、durable 边界或需要设计判断）。
执行者建议：**27b** = qiyuan-self · qwen3.8-27b（处方式指令）；**thinking** = gemini-3.7-flash-thinking（设计或复杂集成）；**父级** = 我直接执行。

### N1 — discovery 与热重载测试补齐（审计发现）

| 项 | 内容 |
|---|---|
| 目标 | 为 `discoverTeamMembers`/`deduplicateDefinitions` 与 team-local 热重载补直接单测 |
| 文件域 | `packages/team/team-local/tests/`（新增 discovery.spec.ts、watch.spec.ts） |
| 要点 | 双目录扫描、workspace 优先去重、ENOENT 静默、abort 传播；fake timers 覆盖 debounce 与 watcher 清理（fiber dispose 后无定时器残留） |
| 难度 | 低 | 能力需求 | 27b |
| 依赖 | 无 |
| 验收 | 新测试覆盖上述路径且全绿；不改 src |

### N2 — Workspace enablement（计划 1.6）

| 项 | 内容 |
|---|---|
| 目标 | per-workspace teammate 启用/禁用，持久化于用户设置，注册前过滤 |
| 文件域 | `packages/team/team-local/src/`（enablement store + 加载过滤）、`packages/team/team-local/tests/`、README 双语 |
| 要点 | 先调研 `dsh-settings` seam（`packages/settings/`）的读写 API 与 per-workspace 键语义；enablement 以 workspace 路径为键；禁用的定义不进入 `ctx.team`；挂在现有热重载路径上，启停变更无需重启 |
| 难度 | 中 | 能力需求 | 27b（指令中附 settings seam 文件清单） |
| 依赖 | 无（与 N3 共享 team-local 目录但文件不相交） |
| 验收 | 禁用后 `list_teammates`/`delegate_to_teammate` 不可见该 teammate；状态跨进程持久；README 双语同步并记录配对 |

### N3 — skill 过滤恢复：字段与 durable 载荷（D1 第一步）

| 项 | 内容 |
|---|---|
| 目标 | 恢复 `TeamMemberDefinition.skills[]`：类型、解析、校验、`team/member-bound` 载荷 |
| 文件域 | `packages/team/team/src/types.ts`、`packages/team/team-local/src/parser.ts` + validation、`packages/team/tool-team/src/tool-delegate.ts`（bound 载荷）、对应 tests |
| 要点 | `skills?: readonly string[]`（缺省 = 不限制）；frontmatter `skills:` 列表解析；**冷恢复兼容**：旧日志 `team/member-bound` 无该字段时按"不限制"降级，不得拒读 |
| 难度 | 中 | 能力需求 | 27b |
| 依赖 | 无 |
| 验收 | 解析/校验/载荷测试齐全；旧载荷（无 skills）冷恢复测试通过；不触碰 events.ts 的事件类型声明（仅 types.ts 的 payload 类型扩展） |

### N4 — skill 过滤恢复：child scope 加载边界强制（D1 第二步）

| 项 | 内容 |
|---|---|
| 目标 | teammate 子会话内对 `skill` tool 挂 scoped `tools.guard()`，拒绝 `args.name` 不在 `definition.skills` 中的加载 |
| 文件域 | `packages/team/team-runtime/src/member-setup.ts`（guard 安装，与 MCP guard 并列）、新增 guard 模块、tests |
| 要点 | 与 `createMcpGuard` 完全同构：从 `team/member-bound` 读 skills 策略，经 `childCtx.tools.guard()` 安装，disposer 随组合移除；无 skills 策略时不安装；实现前先读 `mcp-guard.ts` 与 `member-setup.spec.ts` 模式 |
| 难度 | 中 | 能力需求 | 27b |
| 依赖 | N3（需要 skills 字段进 bound 载荷） |
| 验收 | 允许名单内可加载、名单外被拒（经 tool executor 测试拒绝，非纯 guard 单测）；冷恢复后 guard 重装；HMR 处置测试 |

### N5 — skill catalog 可见性调研（D1 第三步）

| 项 | 内容 |
|---|---|
| 目标 | 判定 teammate 的 prompt catalog 能否按 scope 过滤；产出结论与方案 |
| 文件域 | 只读调研：`packages/skill/tool-skill/src/index.ts`（catalog 贡献路径）、`packages/core/system-prompt/`、`packages/scope/` |
| 要点 | catalog 是否经 merge-extensible waterfall、child scope 能否变换该 section；若可行给出接线点，若不可行记录"加载边界强制 + catalog 全量可见"为已知限制（写入 tool-team README limitations） |
| 难度 | 中（调研） | 能力需求 | thinking 或父级 |
| 依赖 | 无（与 N3/N4 并行，不阻塞） |
| 产出 | 调研结论（并入 N4 的 README/Agent Note 或单列） |

### N6 — 消息通道：leader→非活跃 teammate 投递（3.1 子项 1）

| 项 | 内容 |
|---|---|
| 目标 | `send_team_message` 允许 leader 向已 settled/冷的 teammate 投递（`subagents.followup` 冷恢复能力），仅"从未委派过"报错 |
| 文件域 | `packages/team/tool-team/src/tool-send-message.ts`、`send-message.spec.ts` |
| 要点 | 当前以 orchestrator activation 状态为闸——改为：有 activation（非 disposed）走现有路径；已 disposed 但存在 durable 子会话记录的，经 followup 冷恢复投递；需要"从未委派"的判定依据（orchestrator 历史记录）；复用 `tool-delegate.ts` 的 `deliverFollowup` 语义 |
| 难度 | 中 | 能力需求 | 27b |
| 依赖 | 无 |
| 验收 | 三种目标状态（在跑/settled/从未委派）行为各有测试；disposed 语义明确（shutdown 后是否仍可投递——**实现前需父级裁决，默认：disposed 视同从未委派之外的可冷恢复状态**） |

### N7 — 消息通道：teammate↔teammate leader 中转 + 投递抽象接口（3.1 子项 2/3）

| 项 | 内容 |
|---|---|
| 目标 | teammate 间消息经 leader 中转；把投递实现收敛到抽象接口后，为后期结构化队列升级保留替换面 |
| 文件域 | `packages/team/tool-team/src/tool-send-message.ts`、`packages/team/team/src/types.ts`（`TeamMessageData` 扩展）、README 双语 |
| 要点 | teammate 调 `send_team_message` 时 `reportFrom` 消息携带 `to` 字段，leader 侧呈现为"转发请求"（模型可见文本说明中转语义）；`TeamMessageData` 增加可选中转字段（payload 扩展，不新增事件类型）；**接口保留**：把"投递一步"抽为模块内显式函数边界（输入 = 发送者/目标/内容，输出 = 投递结果），结构化队列升级时仅替换该边界实现；重写 tool-team README 过时的 limitation 条目（双语 + 配对记录） |
| 难度 | 高 | 能力需求 | thinking（跨工具语义 + durable payload + 接口设计）；实现可回落 27b |
| 依赖 | N6（同文件） |
| 验收 | teammate→teammate 经 leader 中转的端到端测试（Loader 组合）；`TeamMessageData` 扩展冷恢复兼容；README limitation 与实现一致 |

### N8 — control request 持久化最小方案（R2.3）

| 项 | 内容 |
|---|---|
| 目标 | 重启不再静默丢失 pending 审批：请求已有 `team/control-request` 事件持久化；冷恢复时对无配对的请求显式 deny 并在双方留痕 |
| 文件域 | `packages/team/team-runtime/src/`（冷恢复钩子）或 `tool-team`（leader 侧对账）、tests |
| 要点 | 冷恢复读取子会话 `team/control-request` 与 leader 会话 `team/control-decision` 配对；未决请求追加 `team/control-decision`（decision: deny，reason 标注 restart 语义）并通知 leader；**不重建 waiter**（完整恢复超出最小方案） |
| 难度 | 中 | 能力需求 | 27b |
| 依赖 | 无 |
| 验收 | 模拟重启（持久化→新组合恢复）后未决请求被显式 deny 且事件留痕；已决请求不重复处理 |

### N9 — plan 审批分支（3.3，决策 4 保留）

| 项 | 内容 |
|---|---|
| 目标 | 实现 `approve_plan`/`request_revision`：teammate 提交 plan → leader 审批/退回 → teammate 继续或修订 |
| 文件域 | `packages/team/team/src/types.ts`（control request 增加请求类别字段）、`approval-setup.ts` 或新 plan 提交机制、`tool-control.ts`、tests |
| 要点 | **设计先行**：teammate 如何提交 plan（新工具 vs 复用 control 通道 + 请求类别判别）、plan 内容以什么 durable 形式留存、`request_revision` 后 teammate 如何收到退回意见；设计由父级产出后再分发实现；payload 扩展不新增事件类型 |
| 难度 | 高 | 能力需求 | thinking（设计）→ 27b（实现，处方式） |
| 依赖 | 设计文档；与 N3/N7 同触 types.ts，排在其后 |
| 验收 | plan 提交→批准→执行、提交→退回→修订两条路径的集成测试；冷恢复兼容 |

### N10 — leader 默认 tools 启动诊断（D2，B+C 方案）

| 项 | 内容 |
|---|---|
| 目标 | leader 定义加载时比对已注册工具，`DEFAULT_LEADER_TOOLS` 缺失项记 warning（不 fail）；正式记录 metadata-only 定位 |
| 文件域 | `packages/team/team-local/src/`（诊断逻辑）、`AGENT_TEAM_PLUGIN_PLAN.md` §2.9 措辞修正、feature note、Agent Note |
| 要点 | 诊断在定义成功注册后运行（此时工具插件通常已注册）；仅 warning 级，不阻断加载；Agent Note 记录 B+C 决策与被否决的 A 方案（激活顺序阻碍） |
| 难度 | 低-中 | 能力需求 | 27b |
| 依赖 | 无 |
| 验收 | 缺失工具产生 warning 的测试；文档三处（计划 §2.9、feature note、新 Agent Note）一致 |

### N11 — maxContextTokens 设计（计划 1.7）

| 项 | 内容 |
|---|---|
| 目标 | 产出设计文档：compaction 层预算（默认路线）vs `AgentOptions` 扩展；确定注入点后再进入实现轮次 |
| 文件域 | 只读调研：`packages/compaction/`、`packages/core/agent/`（AgentOptions）、`packages/context/` |
| 难度 | 中（设计） | 能力需求 | thinking 或父级 |
| 依赖 | 无 | 产出 | 设计节并入下一轮计划或独立 proposed Agent Note |
| 说明 | **本轮只出设计，不实现**（决策 6：先补底座） |

### N12 — 文档收尾（父级执行）

D3/D4 追认后的主文档更新、feature note D1 表述修正、配对重录。大部分已随本计划制订完成（见下"文档状态"），剩余在审批通过后随第一批提交。

## 依赖图与分发批次

```
批次 A（并行）:  N1  N2  N3  N6  N10  N5(调研)  N11(设计)
批次 B（依赖后）: N4 ← N3        N7 ← N6        N8（独立，可并入 A 或 B）
批次 C（设计后）: N9 ← 父级设计文档
```

分发策略：批次 A 中 N1/N2/N3/N6/N10 五个实现包并行（文件域已核对互斥），N5/N11 调研设计包并行不占代码面；批次 B 在对应前置验收后分发；N9 待父级设计定稿。执行者：实现包用 qiyuan-self · qwen3.8-27b（处方式指令），N7 与 N9 设计、N5/N11 调研用 thinking 级模型或父级。父级负责逐包验收（焦点测试 + typecheck + lint + 配对 + Agent Note），每批验收后合并提交。

## 文档状态

| 文档 | 状态 |
|---|---|
| `AGENT_TEAM_PLUGIN_PLAN.md` | 主文档：移除审计/轮次计划正文，保留 Phase 与代码设计；新增附属文档索引节；D3（§1.3 服务名）、D4（§3.5 事件名）已按追认更新为 shipped 名称 |
| `AGENT_TEAM_PLUGIN_AUDIT_2026-08-18.md` | 新增：审计记录 + 偏离登记 + 决策记录 |
| `AGENT_TEAM_PLUGIN_ROUND2_PLAN.md` | 本文档，待审批 |
| feature note（2026-08-14） | D1 失实表述已修正为"待恢复"并链接本计划（双语 + 配对重录） |
