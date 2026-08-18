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

## 模型体验

无，因为文件系统加载器只填充注册表，没有提示词、schema 或结果。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- YAML 解析器是最小实现；复杂的 YAML 结构（锚点、多行字符串）可能无法正确解析。
