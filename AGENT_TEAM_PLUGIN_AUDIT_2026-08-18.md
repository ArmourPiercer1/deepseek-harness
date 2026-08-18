# Agent Team 插件进度审计与偏离登记

审计日期：2026-08-18。本文档是 [主开发计划](AGENT_TEAM_PLUGIN_PLAN.md) 的附属文档：主文档保留完整的代码设计与 Phase 设计，阶段性审计、决策与执行计划记录于此并通过链接索引。

**审计方法**：源码逐项核对 + `packages/team` 全量测试（19 文件 / 100 测试全部通过）+ 全库 grep 验证（bundle 挂载、config-catalog 条目、skill seam 能力）。审计确认执行未严格按 Phase 顺序：Phase 5 的文档/bundle/note 与 Phase 1-3 并行推进，Phase 4 整体跳过（其依赖的 permission seam 是独立轨道），Phase 1 尾部与 Phase 3 消息通道被留在后面。

## Phase 状态总表

| Phase | 状态 | 结论 |
|---|---|---|
| Phase 0 技术验证 | ✅ 已吸收 | 无独立 PoC 产物；验证点（persona/toolFilter/model 注入、settled 通知）由 Phase 2/3 测试覆盖 |
| Phase 1 定义与加载 | 🟡 部分完成（5/7） | 缺 1.6 workspace enablement、1.7 maxContextTokens；discovery 与热重载无直接单测 |
| Phase 2 运行时与委派 | ✅ 实质完成 | 含两处**未经批准的决策性偏离**（2.6、2.9，见偏离登记表） |
| Phase 3 消息与控制 | 🟡 部分完成 | 缺 3.1 完整消息通道、3.3 plan 审批分支、control request 持久化 |
| Phase 4 精细化权限 | ❌ 未开始 | 零代码零测试；前置 permission seam 接线亦未完成 |
| Phase 5 集成与产品化 | 🟡 部分完成 | 缺 5.2 Web、5.3 CLI、5.4 cookbook；bundle 无 shipped 挂载与集成测试 |

## 逐 Phase 明细

**Phase 1**：1.1 类型 ✅、1.2 解析器 ✅、1.3 registry ✅（服务名偏离 D3，已追认）、1.4 discovery ✅（`$DSH_HOME/teammates` + `.dsh/teammates`，workspace 优先，带 debounce 热重载；**无 discovery.spec**）、1.5 leader 定义 ✅、1.6 ❌、1.7 ❌（README 已声明推迟到 compaction 层）。

**Phase 2**：2.1 ✅、2.2 ✅、2.3 ✅（含冷恢复）、2.4 ✅（2026-08-18 修复补齐；实现偏离 D5 已记录于 [release blockers note](.agents/notes/implemented/bug-fix/2026-08-18-team-runtime-release-blockers.md)）、2.5 ✅、2.6 ⚠️ 移除（偏离 D1）、2.7 ✅（DSH 内置）、2.8 ✅、2.9 ⚠️ 强制未实现（偏离 D2）。

**Phase 3**：3.1 🟡（仅 leader→在跑 teammate 与 teammate→leader 两向；缺结构化队列、teammate↔teammate、非活跃目标投递；tool-team README limitation 措辞已落后于代码）、3.2 ✅、3.3 🟡（list/decide ✅；决策集收窄为 `allow_once/deny/escalate_to_user`，计划的 `approve_plan`/`request_revision` 未实现）、3.4 ✅（含超时配置属主化，2026-08-18 修复）、3.5 ✅（事件名偏离 D4，已追认）。额外欠账：control request 跨进程持久化未实现（restart 丢失、冷恢复自动 deny）。

**Phase 5**：5.1 🟡（包与 patch 存在、`apps/cli` 依赖携带；但全库 grep 确认**没有任何 shipped profile/preset/example 挂载该 bundle**，计划 S11 端到端集成测试不存在）、5.2 ❌、5.3 ❌、5.4 🟡（package README ✅、subsystem 页 ✅、config-catalog 条目 ✅；cookbook `docs/cookbook/adding-agent-team.md` ❌ 缺失）、5.5 ✅、5.6 ✅（主计划 §4.6 + `events.ts` 单一接触面纪律）。

## 偏离登记表

| # | 偏离 | 记录位置 | 批准状态与处置 |
|---|---|---|---|
| D1 | 2.6 skill 过滤被移除，理由"不存在 per-scope skill catalog API" | feature note（2026-08-14） | ⚠️ 未批准。2026-08-18 复查证实理由不成立（`SkillRegistry` 为 scope 分层注册表），疑似行为漂移。**用户决策（2026-08-18）：恢复实现**，见第二轮计划 N3/N4/N5 |
| D2 | 2.9 leader 默认 tools 加载期校验未实现，"not enforced at runtime" | `constants.ts` JSDoc + feature note | ⚠️ 未批准。理由部分成立（leader 由 preset 组合，无运行时落点；硬校验受激活顺序阻碍不可行），但程序上构成漂移。**用户决策（2026-08-18）：B+C 方案**（启动诊断 + 正式记录），见第二轮计划 N10 |
| D3 | 服务名 `ctx.teamDefinitions` → `ctx.team` | 实现 | **已追认（2026-08-18）**，主计划已更新为 shipped 名称 |
| D4 | 事件名与计划 §3.5 不同（`team/message`、`team/progress`、`team/control-request`、`team/control-decision`） | `events.ts` + feature note | **已追认（2026-08-18）**，主计划已更新为 shipped 名称 |
| D5 | `fresh_per_delegation` 用 `startContinuable` 而非 one-shot | [release blockers note](.agents/notes/implemented/bug-fix/2026-08-18-team-runtime-release-blockers.md) | ✅ 同 commit Agent Note 记录 |

## D1/D2 复查证据摘要

**D1**：`packages/skill/skill/src/index.ts` 的 `SkillRegistry` 使用 `ScopedLayers<SkillLayer>` 按调用上下文作用域分层；`ctx.skills.list({ scope: agent })` 合并全局层与观察者作用域链，最近层同名条目完全遮蔽远层（tools registry 的 shadowing 规则）；`tool-skill` 的 catalog 渲染与 `skill` tool 加载均按 agent scope 消费。可行实现路径与 2.5 MCP 过滤同构：恢复 `skills[]` 字段 + child scope 对 `skill` tool 挂 scoped `tools.guard()`（加载边界强制）+ catalog 可见性调研。

**D2**：选项 A（加载期硬校验）受插件激活顺序阻碍——`read/grep/glob/todo_write/web_search` 来自其它工具插件，可能在 team 之后注册，且当前无"组合完成"钩子，评估为不可行。选项 B（启动诊断：leader 定义加载时比对已注册工具，缺失记 warning）时序可行——team-local 异步加载定义通常晚于工具注册。选项 C（追认 metadata-only 定位并修正文档措辞）。

## 用户决策记录（2026-08-18）

1. **D1 / skill 过滤**：恢复实现。
2. **D2 / leader 默认 tools**：采用 B+C 方案（启动诊断 + 正式记录）。
3. **消息通道（计划 3.1）**：本轮仅开发 leader 中转方案；结构化队列设为后期升级内容，本轮保留接口。
4. **plan 审批分支（计划 3.3）**：保留，本轮实现。
5. **control request 持久化**：采用最小化方案。
6. **v1 范围**：5.2 Web 与 5.3 CLI 暂不纳入；本轮仅补齐底座，集成与产品化下一轮。
7. **D3/D4**：追认并更新文档。

## 后续计划

第二轮开发的细化任务切分、难度与能力评估、分发策略见 [第二轮开发计划](AGENT_TEAM_PLUGIN_ROUND2_PLAN.md)。
