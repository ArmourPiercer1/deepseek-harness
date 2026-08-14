---
Status: implemented
---

## Problem

为 DeepSeek Harness 开发 agent-team 插件，需要理解 PilotDeck agent team mode 提供的能力（teammate 定义、精细化 per-agent 权限、team 编排、leader 审批通道），并将这些功能映射到 DSH 现有架构（subagent seam、tool restriction、scoped registration、continuable subagents）上。

## Decision

分析了 `references/PilotDeck-acc-preview/src/agent/team/` 的 PilotDeck 源码、`references/oh-my-opencode/src/agents/` + `src/tools/delegate-task/` + `src/features/background-agent/` 的 oh-my-opencode 源码，以及 DSH 的 subagent、tool、scope、preset 子系统。在 [`AGENT_TEAM_PLUGIN_PLAN.md`](../../../../AGENT_TEAM_PLUGIN_PLAN.md) 中产出了分阶段开发计划和详细编码蓝图（§六）：Phase 0（PoC）、Phase 1（定义/加载）、Phase 2（运行时/委派）、Phase 3（消息/控制通道）、Phase 4（精细化约束）、Phase 5（集成），以及包内架构、文件清单、TypeScript 接口契约、测试要求和 subagent 编码任务分配。

关键架构决策：

- **包组织**：`packages/team/` 组，5 个包（`dsh-team` Service Definition、`dsh-team-local` provider、`dsh-team-runtime` consumer、`dsh-team-channels` consumer、`dsh-tool-team` consumer）加 `dsh-bundle-team`。
- **Teammate 生命周期**：DSH continuable subagent 配合 persona、tool restriction 和 per-agent model 配置（`AgentOptions`）。
- **MCP 过滤**：动态 `tools.guard()` 在每次执行时检查 `mcp__<server>__` 前缀（非启动时枚举），覆盖 MCP 晚连接/重连后新增工具。PilotDeck 的 MCP 过滤存在已知 bug，不予参考。
- **Cold resume**：team 专属 `team/member-bound` session event 持久化完整 member 策略（含 `maxTokens`、MCP allowlist、skill allowlist），独立于 continuable descriptor。
- **Leader 设计**：统一 `TeamMemberDefinition` 类型，10 个不可移除默认 tools，插件加载时校验。
- **Subagent 模型分配**：`Qiyuan-Inter/deepseek-v4-flash-0731` 作为主力模型承担复杂任务（接口设计、状态机、cold resume、集成测试），`Qiyuan-Inter/gpt-5.6-luna` 作为辅助模型承担简单任务（解析器、guard、tool 定义、文档）。编码工作在 DSH 下执行（而非 Codex），通过 `SubagentStartRequest.agentOptions` 为每个子代理指定模型。Provider route 通过 `dsh-llm-pi-ai` 配置，不硬编码。

识别了 DSH 相对于 PilotDeck 功能的 11 个架构缺失项（G1–G11）；除可选扩展 `AgentOptions` 增加 `maxContextTokens` 外，全部可在插件层解决。

## Alternatives considered

- **修改 DSH 核心**（在 `dsh-agent` / `dsh-agent-loop` 中添加 team 原语）：拒绝，因为 AGENTS.md 要求新行为通过扩展点实现而非修改 loop；现有 subagent seam、tool restriction 和 scoped registration 已提供所需原语。
- **用 Workflow engine 做 team 编排**：拒绝，因为 workflow 是无状态 fan-out 脚本，无持久化 agent session；team mode 需要有状态的持久 teammate 和 follow-up turns。
- **仅使用 one-shot subagent**（不用 continuable）：拒绝，因为跨委派保留 teammate 上下文是 PilotDeck 的主要功能；one-shot 作为 `contextPolicy: "fresh_per_delegation"` 选项提供。
- **采用 PilotDeck Leader 工具锁定**（Leader 限制为纯协调 tools）：拒绝，因为用户可能希望 Leader 在协调之外承担领域工作；统一 `TeamMemberDefinition` + 10 个不可移除的默认 leader tools 在不牺牲灵活性的前提下保证了协调安全。
- **参考 PilotDeck MCP 过滤代码**：拒绝，因为 PilotDeck 的 `TeammateExtensionResolver.listMcpInstructions()` 存在已知 bug（teammate 经常检测不到 MCP 挂载）；per-agent MCP 过滤基于 DSH 原生 `ToolGuard` + `ToolRestriction` 机制独立实现。
- **启动时枚举 MCP deny list**：拒绝，因为 MCP server 可能晚连接或重连后新增工具，启动时枚举会漏检；改用动态 `tools.guard()` 在每次执行时检查前缀。

## Consequences

- 开发遵循 6 阶段计划（Phase 0–5），附详细 §六 编码蓝图（包内文件清单、TypeScript 接口、模块分解、测试策略、并行化 subagent 任务分配）。
- 所有 team 功能位于 `packages/team/` 下，遵循 capability seam 模式（Service Definition + Provider + Consumer），通过 `dsh-bundle-team` 安装。
- 工作区根目录的计划文件是 agent-team 插件系列的权威开发路线图。
