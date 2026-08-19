# Agent Team 插件第三轮开发计划（产品化轮）

制订日期：2026-08-19。本文档是 [主开发计划](AGENT_TEAM_PLUGIN_PLAN.md) 的附属文档，依据 [2026-08-18 进度审计](AGENT_TEAM_PLUGIN_AUDIT_2026-08-18.md)、[第二轮计划](AGENT_TEAM_PLUGIN_ROUND2_PLAN.md) 的排除清单（决策 6"留待产品化轮次"项）与 [permission seam 提案](.agents/notes/proposed/architecture/2026-08-15-permission-seam-and-mcp-fusion.md) 制订。**2026-08-19 已确认**：三个决策项均采纳建议方案；批次不变；任务包路由按"任务包路由与升级"执行。

## 制订前勘察结论

以下事实来自 2026-08-19 对合并后代码库的实地勘察，是任务切分的前提：

1. **Phase 4 的原设计已被 permission seam 提案取代。** 主计划 §三 Phase 4 设想在 `fs/write-intent` / `fs/edit-intent` waterfall 注入 per-teammate 决策；勘察确认 `fs-observation-policy` 独占这两个 waterfall 的唯一决策槽且不调用 `next()`（`packages/fs/fs-observation-policy/src/index.ts` 注释与"第二个 decider 不可达"测试为证），原路径不可行。[permission seam 提案](.agents/notes/proposed/architecture/2026-08-15-permission-seam-and-mcp-fusion.md) 以参数级规则引擎（path/command/MCP/param 四类 matcher、`deny > ask > allow` 分层解析、per-scope permission mode）覆盖了 4.1/4.2/4.3 的全部意图，本轮按其 Stage 1 执行。
2. **permission 包已部分建成（本地工作，上游没有）。** `packages/permission/` 三个包均已存在：`permission-engine` 完整（解析、四类 matcher、resolve、audit，8 个测试文件）；`permission`（Service Definition）与 `tool-permission-guard`（Consumer）有源码与 README 但无测试；team 插件尚未接入（`team-runtime` 无任何 permission 引用）。note 状态为 proposed。
3. **审计事件类型已在词汇表内。** 上游 `interaction/permission-presets` 已声明 `permission/decision` 与 `permission/preset` 两个 `SessionEventMap` 成员，生成词汇表已含二者——Stage 1 的审计事件可复用，**无需新增 session 事件类型**（payload 兼容性需在设计阶段验证，见 D8）。
4. **Web 面板已有起点。** `packages/client/ui-team` 已存在（本地提交 `584cd8e73f`），但只有 `TeamSettingsSection`（设置页 teammate 启用面）；进度面板、teammate 状态、消息时间线未做。可参照的同类 client 包：`ui-subagent`、`ui-workflow-run`、`ui-goal`。
5. **shipped 挂载零落点。** `PROFILE_TEMPLATES`（`packages/boot/app-boot/src/profile.ts`）只有 `web: [dsh-base, dsh-web-app]` 与 `headless: [dsh-base, dsh-headless]`；shipped agent presets 只有 `apps/cli/config/agent-presets/{minimal,standard,code,cordis}`，无 team。`packages/bundle/team/cordis.patch.yml` 存在但全库无任何 shipped 挂载点（审计 S11 欠账）。开发实例的 team preset（`C:\Users\user\.dsh-dev\.agent-presets\team\agent.cordis.yml`，team 组在 isolate realm 内）是已验证的组合参照。
6. **CLI 命令面很小。** `apps/cli/src/` 仅 `bin` / `args` / `plugin` / `profile-boot` 等少数模块；`dsh teammate` 是新命令族，需按 `plugin.ts` 的先例接线。

## 本轮范围

- **纳入**：permission seam Stage 1 接线（Phase 4 等价物）、5.1 shipped 挂载与端到端集成测试、5.2 Web 团队面板、5.3 CLI、5.4 cookbook。
- **不纳入**：permission Stage 2（MCP 融合 B）与 Stage 3（规则学习、readonly/bypass、hook bridge）、结构化消息队列、`maxContextTokens` 实现（待 compaction 层）、基座运行时事件注册面（上游未实现，独立发布触发条件未满足）。

## 决策项（2026-08-19 确认，均采纳建议方案）

| # | 决策 | 决议 |
|---|---|---|
| D6 | shipped 挂载面：team 包进哪个平面 | shipped team preset（preset 平面，team 组在 isolate realm 内，照开发实例已验证的组合）；`PROFILE_TEMPLATES` 不动；`bundle/team` 保留为 opt-in 安装入口 |
| D7 | Web 面板范围 | MVP 先行：进度面板 + teammate 状态；消息时间线随后（若 M7 验收超期，拆 M7a/M7b 两批） |
| D8 | Stage 1 审计事件复用 `permission/decision` | 设计阶段验证 payload 兼容性（tool、decision、matched rule、layer、member、mode、cause）；兼容则复用；不兼容则暂停该事件实现并上报用户——修改既有事件结构属基座变更，超出本轮授权 |

## 任务包切分

### 任务包路由与升级（用户 2026-08-19 确认）

1. 全部任务包由子代理执行，初始执行者默认 qwen3.8-27b；执行失败允许同一模型重试一次。
2. 重试仍失败，升级 gemini-3.7-flash-thinking 执行；其失败同样允许重试一次。
3. 重试仍失败，升级 qwen3.8-max 执行；qwen3.8-max 不再允许重试，其失败即暂停该任务包的工作并立即向用户汇报，父级不自动改道，等待用户指示。

升级按任务包计次（每级至多两次尝试：一次执行 + 一次重试），换包不重置；每次失败、重试与升级记入该包的验收报告。难度保留，供父级验收时参考；D8 兼容性核对与逐包验收由父级执行。

### M1 — permission Service Definition 与 Consumer 补齐（Stage 1 基础）

**范围**：`permission` 服务与 `tool-permission-guard` 的测试补齐、invariant 落实、主 agent 路径接通（guard 挂 `tools/pre-execute`，mode fallback 走配置）。
**文件域**：`packages/permission/permission/`、`packages/permission/tool-permission-guard/`。
**难度**：中。**路由**：默认链（engine 已建成，补测与接线规格明确）。
**验收**：两包测试覆盖 evaluate 三态与 guard 拒绝路径；`verify-package-invariants` 通过；typecheck + 焦点测试绿。

### M2 — 规则分层加载与冷恢复快照（Stage 1 数据面）

**范围**：managed / project / teammate frontmatter 三层规则文件的只读加载与合并（deny 跨层绝对）；teammate inline 规则快照进 `team/member-bound` durable 载荷（**可选字段，冷恢复向后兼容**）；冷恢复时重读 managed/project 层、缺失 managed 文件失败关闭。
**文件域**：`packages/permission/permission-engine/`（加载器）、`packages/team/team-local/src/parser.ts`（frontmatter `permissions` 字段）、`packages/team/team/src/types.ts`、`packages/team/team-runtime/src/member-setup.ts`。
**难度**：高（durable 边界 + 跨包）。**路由**：默认链。
**验收**：分层合并与绝对 deny 单测；旧日志（无 rules 字段）冷恢复不回归；新载荷冷恢复重建策略一致。

### M3 — team 插件接入 permission（Stage 1 决策面）

**范围**：`team-runtime` 注入 `permission`；`installApprovalHook` 从按名 gating 改为调用 `evaluate`；`ask` 结果复用现有 leader rendezvous（suspend-wake-decide over `team/control-request`）；受控 teammate 默认 `enforce` 模式（frontmatter 可声明）。
**文件域**：`packages/team/team-runtime/src/approval-setup.ts`、`packages/team/tool-team/`（拒绝消息措辞）、teammate 定义 frontmatter 文档。
**难度**：高（挂起/恢复状态机改造）。**路由**：默认链。
**验收**：REAL-composition 下 enforce teammate 的未匹配调用在执行器处被拒（可观察，而非仅 schema 缺失）；managed deny 穿透 mode；`ask` 走 leader 审批后恢复。

### M4 — permission Stage 1 验收与审计核对

**范围**：按提案 note 验收标准逐条落测试；核对 `permission/decision` payload 兼容性（D8）；note 状态由 proposed 推进（随接线完成改为 implemented 并按 supersession 规则处理主计划 Phase 4 表述）。
**文件域**：`packages/permission/*/tests/`、`packages/team/*/tests/`、note 三件套。
**难度**：中。**路由**：默认链（验收测试规格来自 note 验收标准）；D8 兼容性核对由父级。
**验收**：note 验收标准 8 条中 Stage 1 适用项全部有测试映射；doc-sync 相关 gate 绿。

### M5 — shipped 挂载：team preset 与 bundle 归位（5.1 + S11 欠账）

**范围**：按 D6 决议落地——新增 shipped team preset `apps/cli/config/agent-presets/team/agent.cordis.yml`（以开发实例 preset 为蓝本，team 组在 isolate realm 内），进入 roster 声明序与 discovery 测试；`bundle/team` 保留为 opt-in，README 说明两种挂载面差异；`verify-cordis-config` 与 preset 挂载测试覆盖。
**文件域**：`apps/cli/config/agent-presets/team/`、`packages/preset/agent-presets/`（discovery/metadata 如需）、`packages/bundle/team/README*`。
**难度**：中。**路由**：默认链。
**验收**：shipped preset 挂载测试通过；roster 顺序与 metadata gate 绿；GUI preset 选择器可见 team。

### M6 — 端到端集成测试与 keyless snapshot（S11 测试欠账）

**范围**：REAL-composition 端到端：委派 → teammate 执行 → 审批 → 冷恢复 → 工作区发现（`agent/created` 跟踪）；按测试政策为 model-visible 团队交互补 keyless snapshot（`tests/snapshot/team-*`，lib 模式）。
**文件域**：`packages/team/*/tests/`、`tests/snapshot/`（或 examples 下的 team 例子入口，视 snapshot harness 要求）。
**难度**：高。**路由**：默认链。
**验收**：snapshot replay 无 key 通过；覆盖审计列出的 S11 缺失路径。

### M7 — Web 团队面板（5.2）

**范围**：扩展 `packages/client/ui-team`：任务进度面板（消费 `team/progress`）与 teammate 状态显示（bound/running/settled）为本批 MVP（D7）；消息时间线（`team/message`）随后；参照 `ui-subagent` / `ui-workflow-run` 的事件消费与 slot 注册先例。
**文件域**：`packages/client/ui-team/`（含 locales、css module、web bundle 注册）。
**难度**：高（client 状态与 slot 接线）。**路由**：默认链。
**验收**：built web 下可见面板并随事件更新；web snapshot 或 built-web 测试覆盖渲染。

### M8 — CLI 命令族（5.3）

**范围**：`dsh teammate list / add <file> / enable <id> / disable <id>`：list 读 `$DSH_HOME/teammates` + 当前工作区 `.dsh/teammates`；enable/disable 写 settings 的 `team-enablement` 命名空间（与第二轮 N2 同一存储面）；add 校验 frontmatter 后落盘。
**文件域**：`apps/cli/src/teammate.ts`（新）、`apps/cli/src/args.ts` / `bin.ts` 接线、`apps/cli/tests/`。
**难度**：中。**路由**：默认链。
**验收**：命令测试覆盖四个子命令与错误路径；built-bin e2e 冒烟通过。

### M9 — cookbook 与文档收尾（5.4 + 5.5 余账）

**范围**：`docs/cookbook/adding-agent-team.md`（teammate 定义编写、挂载选择、委派与审批操作指引，双语 + 配对）；team 各 README 的 Known Limitations 刷新（本轮完成项移出）；主计划 §三 Phase 4/5 状态按追认流程更新。
**文件域**：`docs/cookbook/`、`packages/team/*/README*`、主计划与审计文档。
**难度**：低。**路由**：默认链（文档模板化）；主计划状态更新由父级。
**验收**：doc-sync 全绿（含站点构建）；配对记录重录。

## 依赖图与分发批次

```
批次 A（并行，文件域互斥）:  M1  M5  M7  M8  M9
批次 B:                      M2 ← M1        M6 ← M5
批次 C:                      M3 ← M2        M4 ← M3（D8 核对随 M4）
```

分发策略：批次 A 五个任务包文件域已核对互斥（permission 基础 / preset+bundle / client / cli / docs），并行分发；M6 依赖 M5 的 shipped 挂载作为组合入口，M2 依赖 M1 的服务面稳定；M3 是唯一的跨包状态机改造，单独成批，验收通过后才进 M4 收尾。每包执行按"任务包路由与升级"链进行，失败、重试与升级记入该包验收报告；父级逐包验收（焦点测试 + typecheck + lint + 配对 + 相关 doc-sync gate），每批验收后合并提交。

## 执行约束

- **不新增 session 事件类型**（词汇表耦合纪律，主计划 §4.6）；Stage 1 审计复用既有 `permission/decision`，兼容性验证（D8）先于实现。
- **durable 载荷变更必须冷恢复兼容**：`team/member-bound` 仅增可选字段；旧日志读取路径有回归测试。
- 每项非平凡改动同 PR 附 Agent Note（中英双语 + 配对记录）；permission note 的状态推进在 M4。
- 不修改 `fs-observation-policy` 的决策槽占位（勘察结论 1）；参数级 fs 约束一律经 permission 引擎在执行器边界裁决。
- Web 面板不得引入新的宿主服务面——只消费既有 session 事件与 client slot。

## 风险

| 风险 | 缓解 |
|---|---|
| M3 挂起/恢复状态机改造触碰已验收的 rendezvous 路径 | 以现有 control-coordinator 测试为回归基线，改造前先跑通全量 team 测试快照 |
| D8 验证发现 payload 不兼容 | 停止审计事件实现并上报；Stage 1 其余部分不依赖该事件，可先交付 |
| M7 client 接线受上游 web 架构演进影响（本轮合并已见 client 包重组） | 以合并后的 slot-catalog 与 ui-subagent 现状为唯一参照，不引用旧布局假设 |
| shipped team preset 与 standard preset 的工具注册冲突 | team 组在 isolate realm 内（开发实例已验证），挂载测试显式断言无宿主面泄漏 |
| 批次 A 五包并行加大验收负担 | 每包验收标准在本文档固化；父级按批合并，不跨批积压 |

## 文档状态

| 文档 | 状态 |
|---|---|
| `AGENT_TEAM_PLUGIN_PLAN.md` | §七索引已追加本文档行；Phase 4/5 状态更新随 M4/M9 |
| `AGENT_TEAM_PLUGIN_AUDIT_2026-08-18.md` | 不动（时点记录），本轮进展记入本文档与后续 Agent Note |
| `AGENT_TEAM_PLUGIN_ROUND3_PLAN.md` | 本文档，2026-08-19 确认 |
| permission seam note（proposed） | 不动；状态推进随 M4 接线完成 |
