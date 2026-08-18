# Team

[English](README.md) | 中文

DeepSeek Harness 的 agent 团队能力：在可继续的 subagent 之上进行 leader-teammate 协调。

## 包

| 包 | npm 名称 | 插件形态 | `ctx.*` 键 | 角色 |
|---|---|---|---|---|
| `team/` | `dsh-team` | Service 子类（默认导出） | `ctx.team` | **Service Definition**：类型、事件、常量、`TeamRegistry` |
| `team-local/` | `dsh-team-local` | function plugin | — | **Service Provider**：本地文件系统 Markdown 定义加载器 |
| `team-runtime/` | `dsh-team-runtime` | function plugin | — | **Consumer**：编排、MCP guard、审批钩子 |
| `team-channels/` | `dsh-team-channels` | function plugin | `ctx.teamControl` | **Consumer**：审批注册表、进度存储 |
| `tool-team/` | `dsh-tool-team` | function plugin | — | **Consumer**：5 个面向模型的团队工具 |

## 组合包

`packages/bundle/team/` 下的 `@deepseek-ai/dsh-bundle-team` 包把全部 5 个包聚合成一个可安装的组合包。

## 快速开始

把组合包的行加入某个组合，并配一个可继续的 subagent 后端：

```yaml
- id: team
  name: '@deepseek-ai/dsh-team'
- id: team-local
  name: '@deepseek-ai/dsh-team-local'
  config:
    homePath: !!js process.env.DSH_HOME ?? ''
- id: team-runtime
  name: '@deepseek-ai/dsh-team-runtime'
- id: team-channels
  name: '@deepseek-ai/dsh-team-channels'
- id: tool-team
  name: '@deepseek-ai/dsh-tool-team'
```

团队成员是 `$DSH_HOME/teammates/` 或 `.dsh/teammates/` 中的 Markdown 文件（YAML frontmatter + persona 正文）。必须有且只有一个文件声明 `role: leader`。参见 [`team-local/examples/teammates/`](team-local/examples/teammates/) 中一套完整的 roster —— `backend-dev.md` 展示了每个成员的 tool allow/deny、`requiresApproval`（leader 门控的工具）以及 MCP server 作用域。

leader 用五个工具协调：

| 工具 | 用途 |
|---|---|
| `delegate_to_teammate` | 启动（`run`）、继续（`follow_up`）或停止（`shutdown`）一个 teammate |
| `list_teammates` | 列出带实时状态的 teammates |
| `send_team_message` | leader ↔ teammate 双向消息 |
| `team_control` | 评审并决定待处理的 teammate 审批请求 |
| `team_progress` | 读/写团队任务看板 |

teammate 是一个持久的可继续 subagent，其 persona、工具过滤、MCP 作用域和审批门禁在委托时固定，并在冷恢复时重建。teammate 永远不会收到 `delegate_to_teammate`、`team_control` 或 `list_teammates`。
