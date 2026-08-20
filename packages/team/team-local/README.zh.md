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
permissions:
  deny:
    - Bash(rm -rf *)
    - "Read(//**/.env)"
  ask:
    - "Bash(git push:*)"
permissionMode: enforce
contextPolicy: persistent
---

You are a senior backend developer...
```

权限字段：

- `permissions`——成员面向权限引擎的内联规则：`deny` / `ask` / `allow` 为引擎规则格式的规则字符串数组（行内 `[a, b]` 或块状 `- a` 列表）。规则语法为 `Tool` 或 `Tool(specifier)`：裸名（或 `Tool(*)`）对引擎已知家族匹配整个工具——`Bash` / `pwsh` 按命令模式、`Read` / `Edit` / `Write` / `Grep` / `Glob` / `NotebookEdit` 按路径模式、`mcp__server` 按 server——而任何其他工具都取一个 `param:value` 说明符（带 `*` 通配符），作用于它的某个参数。解析不出匹配器的规则会被带诊断地丢弃，因此一条命名了不支持形式的规则不会静默地放行任何东西。这些列表在委派时被快照进成员持久的 `team/member-bound` 载荷，因此之后被删除的定义文件不会破坏冷恢复；引擎将它们与 managed/project 规则文件合并，其中 `deny` 跨层保持绝对。
- `permissionMode`——成员的权限模式：`enforce` 或 `default`，省略该字段时为 `enforce`（受控 teammate 的未匹配调用在执行器处被拒绝，而非放行）。保留值 `readonly` 与 `bypass` 在解析期被拒绝。
- `requiresApproval`——遗留字段，仍被解析并快照进 `team/member-bound` 载荷以兼容既有定义，但不再把关任何东西：强制钩子通过权限引擎评估每个 teammate 调用，因此该字段被同一工具的 `ask` 规则所取代。

## 配置

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `homePath` | `string` | `$DSH_HOME` | 全局定义的路径 |
| `workspacePath` | `string` | `$DSH_CWD`，再否则进程当前工作目录 | 项目级定义的初始路径；运行中的会话会覆盖它（见下） |

## 会话工作区跟踪

一个 preset 的 standing mount 由加入其下的所有会话共享，挂载时刻的进程状态无法知道该扫描哪个工作区的 `.dsh/teammates/`。因此 team-local 在运行时跟踪工作区：

- 初始工作区为配置的 `workspacePath`，然后 `$DSH_CWD`，再然后进程当前工作目录。
- 每个 `agent/created` 事件，只要其会话头携带不同且非空的 `cwd`，就会把工作区重新指向该会话目录并立即重载。
- 工作区在 `.dsh/teammates/` 下定义了自己的成员时即为自包含：这些定义构成该工作区的完整团队，全局 home 定义不会混入项目团队。home 定义只作用于自身没有任何定义的工作区。
- 每个被观察到的工作区的 `.dsh/teammates/` 目录都会获得一个 watcher，其后的文件修改走正常的防抖重载。

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
- 工作区键为当前跟踪的工作区路径：在被不同 cwd 的会话重新指向之前，取初始解析结果（配置的 `workspacePath`，然后 `DSH_CWD` 环境变量，再然后进程当前工作目录）；不做任何路径归一化。

## 启动诊断

每次成功加载后，team-local 会通过 `ctx.logger('team-local')` 记录警告：当已注册的 leader 期望的 `DEFAULT_LEADER_TOOLS` 未被 `ctx.tools` 注册时，并逐一列出缺失的工具。该警告仅作诊断：加载不会失败，也不会依据 leader 定义执行任何工具策略。

## 模型体验

无，因为文件系统加载器只填充注册表，没有提示词、schema 或结果。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- YAML 解析器是最小实现；复杂的 YAML 结构（锚点、多行字符串）可能无法正确解析。
- 团队注册表在每个 standing mount 下只保存一份扁平定义集合。因此不同工作区的并发会话共享该集合，注册集合由最近创建 agent 的会话工作区决定；按工作区划分的注册表视图暂缓到 orchestrator 与进度存储会话化之后。
