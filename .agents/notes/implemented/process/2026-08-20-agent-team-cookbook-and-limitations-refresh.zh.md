# Agent Note: The agent team operations cookbook and the round-3 limitations refresh

Status: implemented

[English](2026-08-20-agent-team-cookbook-and-limitations-refresh.md) | 中文

## 问题

agent 团队插件在产品化轮次（第三轮计划）获得了其产品化面——shipped team preset、`dsh teammate` 命令族、Web 团队面板与 permission 引擎审批——但没有任何文档告诉操作者如何定义团队、选择挂载、委派工作与裁决审批请求。各包 README 拥有逐包契约，[Team 子系统页](../../../../docs/subsystems/team.md) 拥有机制描述，二者都不是操作手册。与此同时，`packages/team/team/README.md` 与 `packages/team/team-runtime/README.md` 仍带着“条件工具约束推迟到 Phase 4”的限制条目，而[已确认的第三轮计划](../../../../AGENT_TEAM_PLUGIN_ROUND3_PLAN.md)已用 permission seam Stage 1 取代了 Phase 4。

## 决策

- [`docs/cookbook/adding-agent-team.md`](../../../../docs/cookbook/adding-agent-team.md)（双语对）是团队操作的手册式归宿：teammate 定义编写、挂载选择（按决策 D6 默认 shipped preset，否则 bundle opt-in）、经由五个 leader 工具的委派、permission 规则层（`deny > ask > allow`、`enforce`/`default` mode、managed 层绝对 deny）以及 `team/control-request` / `team/control-decision` 上的审批流。
- 手册按已确认计划陈述第三轮目标态；机制细节保持链接而非重述——子系统页、各包 README 与 [permission seam 提案](../../proposed/architecture/2026-08-15-permission-seam-and-mcp-fusion.md) 各自拥有其事实。
- 两条“推迟到 Phase 4”的限制条目移出 [dsh-team](../../../../packages/team/team/README.md) 与 [dsh-team-runtime](../../../../packages/team/team-runtime/README.md)；两者仍各保留一条剩余限制（`maxContextTokens`、`maxTokens` 冷恢复回退），故 `scripts/verify-package-readme-limitations.ts` 的 `NO_LIMITATIONS` allowlist 不动。M2/M3 的代码改动落地时在其包 README 中自行记录行为。

## 被否方案

**放进 `packages/team/README.md` 组 README 的一个小节。** 组 README 拥有包表、组合包指针与组合快速开始；六步操作手册会把它推过其层级并重复 cookbook。被否。

**放进 `docs/user/` 产品指南。** user 层由文档网站发布，面向产品整体的终端用户；团队操作是开发者/操作者的 how-to，且 cookbook 层已承载并列的“adding a X”指南。被否。

**保留限制条目直到 M2/M3 代码落地。** 第三轮计划已于 2026-08-19 确认并采纳全部决策；一旦计划以 permission seam Stage 1 取代 Phase 4，声称约束仍推迟于 Phase 4 的条目即为不实。被否。

## 后果

手册在批次 B/C 代码落地前即陈述第三轮目标态；若 permission 接线偏离计划，受影响的章节在偏离的同一改动中修正。permission seam note 在 M4 验收推进前保持 `proposed`，手册链接它作为规则语言归宿。手册有意不加进 `website/docs.ts`：它加入那些保持为仓库文档而非站点页面的 cookbook 同层。
