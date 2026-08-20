# Cookbook: 新增 agent 团队

[English](adding-agent-team.md) | 中文

如何为一个运行中的 DeepSeek Harness 增加 leader 与其 teammates，并日常操作该团队。一个团队由一个 leader agent 和若干具名 teammate 组成，每个 teammate 都是一个持久的可继续 subagent，通过五个 leader 工具协调；[Team 子系统页](../subsystems/team.md) 拥有机制描述，本手册拥有操作步骤。

**前置条件。** 一个模型路由可用的运行中 harness，经 [Web UI](../user/guide/index.md) 操作。无需安装：team 能力随部署提供（步骤 2）。

## 1. 编写团队定义

团队成员是 Markdown 文件——YAML frontmatter 加 persona 提示词正文——由 [dsh-team-local](../../packages/team/team-local/README.md) 加载器从两个目录发现：

- `$DSH_HOME/teammates/` —— 全局定义，所有工作区共享。
- `<workspace>/.dsh/teammates/` —— 项目级定义；定义了自家团队的工作区是自包含的，home 定义永不并入其中。

加载集中恰好一个文件声明 `role: leader`，其余声明 `role: teammate`。leader 文件只是元数据：会话的根 agent 由其自身 preset 组合，因此运行时不应用任何 leader 策略。

```yaml
---
schemaVersion: 1
id: backend-dev
role: teammate
name: Backend Developer
description: Implements server-side APIs and verifies them with tests.
model: deepseek-v4-flash
maxTokens: 16384
tools:
  allow: [read, edit, write, grep, glob, pwsh, send_team_message]
requiresApproval: [pwsh]
mcpServers:
  servers: [postgres-mcp]
contextPolicy: persistent
---

You are a senior backend developer...
```

| 字段 | 必填 | 含义 |
|---|---|---|
| `schemaVersion`、`id`、`role`、`name`、`description` | 是 | 标识；`id` 在加载集中唯一，是委派的寻址 |
| 提示词正文（frontmatter 之后） | 是 | 成员的 persona 提示词；空正文以 warning 解析 |
| `provider`、`model`、`maxTokens` | 否 | 成员的模型路由与输出预算 |
| `tools` | 否 | `allow`/`deny` 名称列表；teammate 的 `deny` 恒含团队协调工具 |
| `requiresApproval` | 否 | 执行挂起、待 leader 裁决的工具名列表；只能命名该成员可运行的工具 |
| `skills` | 否 | 该成员可加载的 skill 名称；缺省表示不限制 |
| `mcpServers` | 否 | MCP server 名称的 `servers` 允许列表 |
| `contextPolicy` | 否 | `persistent`（默认）跨委派复用同一子会话；`fresh_per_delegation` 每次 `run` 新建会话 |
| `permissions`、`permissionMode` | 否 | 参数级规则与该成员的 permission mode（步骤 4） |

验证：team preset 上的会话用 `list_teammates` 能看到新 `id`；`dsh teammate list`（步骤 6）读取同样的两个目录。

## 2. 选择挂载面

存在两个挂载面，随部署的默认是 preset。

**Shipped team preset（默认）。** 部署在 agent preset roster 中随发一个 `team` preset——[第三轮计划](../../AGENT_TEAM_PLUGIN_ROUND3_PLAN.md) 的决策 D6。该 preset 在 preset 平面挂载全部五个 team 包，team 组位于 `isolate` realm 内，其服务不进入宿主平面。在 Web UI 的 preset 选择器中为新会话选择它，或在 **Agent preset** 设置行中把它设为后续会话的默认。

**Bundle（opt-in）。** [`@deepseek-ai/dsh-bundle-team`](../../packages/bundle/team/README.md) 是自行组合 profile 而非选择 preset 的部署的安装入口；它把五个包插入 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: team-bundle
      name: '@deepseek-ai/dsh-bundle-team'
```

验证：preset roster 中出现 `team` 行，在该 preset 上启动的会话向模型提供五个 team 工具。

## 3. 委派工作

leader 通过五个工具协调（[dsh-tool-team](../../packages/team/tool-team/README.md)）：

| 工具 | 用途 |
|---|---|
| `list_teammates` | 列出带实时状态的 teammates |
| `delegate_to_teammate` | 启动、继续或停止一个 teammate |
| `send_team_message` | leader ↔ teammate 双向消息 |
| `team_control` | 评审并裁决待审批请求 |
| `team_progress` | 读/写团队任务看板 |

`delegate_to_teammate` 接收 `teammate_id`、`prompt` 和 `action`——`run`（默认）、`follow_up` 或 `shutdown`。委派是异步的：调用立即返回 `dispatched`，teammate 在后台的自有子会话中工作，其完成报告唤醒 leader 并带来结果。每个 teammate 同一时间只有一个在途轮次：向运行中的 teammate 委派会得到 `already_running`，并指向 `follow_up` 或 `shutdown`。`persistent`（默认）成员跨委派复用其已 settled 的子会话；`fresh_per_delegation` 成员每次 `run` 新建会话。

`send_team_message` 是双向的。teammate 指向同级的消息会上报给 leader，leader 被唤醒后转发该消息；teammate 之间的直接投递是[文档化的限制](../../packages/team/tool-team/README.md)。

验证：委派结果读作 `dispatched`，完成报告唤醒 leader，Web 团队面板从 `team/progress` 事件跟踪任务看板，并显示每个 teammate 的 bound、running 或 settled 状态。

## 4. 约束 teammate 可做的事

工具名 allow/deny、`skills`、`mcpServers` 与 `requiresApproval`（步骤 1）约束成员能调用什么；参数级规则约束每个调用能做什么。规则以字符串编写于三层——managed 策略文件、项目级文件、teammate frontmatter——按 `deny > ask > allow` 解析，managed 层的 `deny` 在每种 mode 下绝对优先：

```yaml
permissions:
  deny: ["Bash(rm -rf *)", "Read(//**/.env)"]
  ask: ["Bash(git push:*)"]
  allow: ["Bash(git status:*)"]
permissionMode: enforce
```

四个 matcher 族覆盖命令、路径、MCP 工具前缀与通用 `Tool(param:value)` 参数；未匹配的调用回退到成员的 `permissionMode`，其中 `enforce`（受控 teammate 的默认）拒绝、`default` 放行。完整规则语言及其失败模式见 [permission seam 提案](../../.agents/notes/proposed/architecture/2026-08-15-permission-seam-and-mcp-fusion.md)。

teammate 的内联规则在首次委派时快照进其 `team/member-bound` 事件，因此被删除的定义文件不会破坏冷恢复；恢复时重读 managed 与 project 层，缺失的 managed 文件拒绝恢复，而不是在过期策略下运行。

验证：被拒绝的调用在执行器处可观察——工具调用带着拒绝失败，而不仅仅是缺席于工具列表——且每次裁决都会追加一个 `permission/decision` 事件，可重建命中的规则、层、成员、mode 与原因。

## 5. 审批 teammate 请求

`ask` 结果——来自 `requiresApproval` 或 `ask` 规则——挂起 teammate 的调用并打开一个控制请求：

1. 运行时在 teammate 会话上持久化 `team/control-request` 并唤醒 leader。
2. leader 通过 `team_control` 列出（`action: "list"`）并裁决（`action: "decide"` 加请求 id），取 `allow_once`、`deny`、`escalate_to_user`、`approve_plan` 或 `request_revision` 之一。
3. 裁决持久化为 `team/control-decision`，挂起的调用随之结算：允许则执行，拒绝或退回则带原因失败该调用，`escalate_to_user` 把请求交给人工审批流。

每个待决请求都有时限：[dsh-team-channels](../../packages/team/team-channels/README.md) 的清扫在 `controlRequestTimeoutMs`（默认 120 秒）后自动拒绝，leader 会话 dispose 自动拒绝其待决请求，冷恢复自动拒绝恢复子会话中仍 pending 的持久化请求。

验证：两个事件按请求在先、裁决在后的顺序出现在会话日志中，teammate 的工具结果陈述了结果。

## 6. 管理团队

```bash
dsh teammate list
dsh teammate add ./backend-dev.md
dsh teammate disable backend-dev
dsh teammate enable backend-dev
```

- `list` 读取 `$DSH_HOME/teammates` 与当前工作区的 `.dsh/teammates`。
- `add` 在落盘为定义之前校验文件的 frontmatter。
- `enable`/`disable` 把选择按工作区记入 `team-enablement` 设置命名空间（[dsh-team-local](../../packages/team/team-local/README.md#teammate-enablement)），无需重启即生效；leader 永不被禁用。

定义文件的编辑经加载器的 debounce 重载，因此修好的文件无需重启即可到达下一次委派。会话运行期间，Web 团队面板显示任务看板与每个 teammate 的状态。

## 参考

- [Team 子系统页](../subsystems/team.md) —— leader/teammate 模型、控制请求流、`team/*` 事件。
- [packages/team](../../packages/team/README.md) —— 组 README：包表、组合包、快速开始。
- [dsh-team](../../packages/team/team/README.md) —— Service Definition：类型、事件、常量。
- [dsh-team-local](../../packages/team/team-local/README.md) —— 定义格式、发现、启用、启动诊断。
- [dsh-team-runtime](../../packages/team/team-runtime/README.md) —— 编排、guard、审批钩子。
- [dsh-team-channels](../../packages/team/team-channels/README.md) —— 控制 registry、进度存储。
- [dsh-bundle-team](../../packages/bundle/team/README.md) —— opt-in 组合包。
- [agent 团队第三轮计划](../../AGENT_TEAM_PLUGIN_ROUND3_PLAN.md) —— 本手册描述的产品化决策。
