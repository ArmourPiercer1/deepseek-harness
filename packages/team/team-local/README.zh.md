# dsh-team-local

[English](README.md) | 中文

DeepSeek Harness 团队插件的本地文件系统团队成员定义加载器。

## 角色

**Service Provider** —— 从 `$DSH_HOME/teammates/` 和 `.dsh/teammates/` 读取 Markdown 团队成员定义，解析它们，并填充 `ctx.team` 注册表。

## 定义格式

团队成员定义为带 YAML frontmatter 的 Markdown 文件：

```yaml
---
schemaVersion: 1
id: backend-dev
role: teammate
name: Backend Developer
description: Handles server-side logic and API design.
provider: Qiyuan-Inter
model: deepseek-v4-flash-0731
maxTokens: 16384
tools:
  allow: [read, edit, write, grep, glob, pwsh]
mcpServers:
  servers: [postgres-mcp]
contextPolicy: persistent
---

You are a senior backend developer...
```

## 配置

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `homePath` | `string` | `$DSH_HOME` | 全局定义的路径 |
| `workspacePath` | `string` | — | 项目级定义的路径 |

## Teammate 启用

按工作区划分的 teammate 启用状态持久化在 `team-enablement` 设置命名空间中，为工作区路径到 teammate id、再到启用标志的记录：

```yaml
team-enablement:
  C:/projects/demo:
    backend-dev: false
```

- 缺失的设置小节、工作区或 teammate 一律视为启用；只有显式的 `false` 会禁用。
- 只有 `role: teammate` 的定义会被过滤。leader 永不会被禁用：有效的团队要求恰好一个 leader，且 leader 仅为元数据，由自己的 preset 组合，而非注册表。
- 已提交的设置变更会重新加载定义，因此启用与禁用无需重启即可生效。
- 工作区键为插件配置中 `workspacePath` 的原始字符串；不做任何路径归一化。

## 启动诊断

每次成功加载后，team-local 会通过 `ctx.logger('team-local')` 记录警告：当已注册的 leader 期望的 `DEFAULT_LEADER_TOOLS` 未被 `ctx.tools` 注册时，并逐一列出缺失的工具。该警告仅作诊断：加载不会失败，也不会依据 leader 定义执行任何工具策略。

## 模型体验

无，因为文件系统加载器只填充注册表，没有提示词、schema 或结果。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- YAML 解析器是最小实现；复杂的 YAML 结构（锚点、多行字符串）可能无法正确解析。
