# dsh-permission-engine

[English](README.md) | 中文

DeepSeek Harness 的权限引擎提供方。

实现 `ctx.permission`（`@deepseek-ai/dsh-permission` Service Definition）：将作者编写的规则字符串解析为编译形式，用四个 matcher 匹配工具调用，在 managed/project/teammate 层间按 `deny > ask > allow` 裁决（managed 层为绝对），回退到权限模式，并追加 `permission/decision` 审计事件。

## 角色

**Service Provider**——具体的 `evaluate` 实现及注册它的插件。发布 `ctx.permission`，此行属于宿主组合。

## Matchers

| Matcher | 目标 | 语义 |
|---|---|---|
| command | `Bash` / `pwsh` | 复合命令拆分、包装器剥离、pwsh 别名规范化、`*` 与 `:*` 模式 |
| path | `Read` / `Edit` / `Write` / … | gitignore 语义，带 `//` / `~` / `/` 锚点、POSIX 规范化 |
| mcp | `mcp__server[__tool]` | 整个服务器、精确工具与 `mcp__*` 前缀 |
| param | 任意工具 | `Tool(param:value)`，作用于顶层标量字段，绝不作用于主内容字段 |

## 裁决

`evaluate` 按 `deny → ask → allow → mode fallback` 顺序匹配；无论特异性如何，第一个匹配者胜出。`managed` 层的 `deny` 不能被较低层的 `allow` 覆盖。未匹配的调用由模式决定：`enforce` 拒绝，`default` 允许；`readonly` 与 `bypass` 被拒绝为未实现。

## 模型体验

### 被拒调用的 reason 字符串

#### 模型看到的内容

被拒的工具调用以 `reason` 字符串的形式到达模型。由规则决定的拒绝使用稳定字面量 `` denied by rule "<raw>" (<layer>) ``，而 `enforce` 模式下未匹配的调用使用 `` no matching allow rule (enforce mode) ``。每次决策都会作为 `permission/decision` 审计事件追加到执行会话的日志。

#### Token 影响

有条件的。只有该次被拒调用的 `reason` 字符串会进入随后的模型请求；被允许或 `ask` 的调用本身不贡献 reason。

#### KV 缓存影响

独立。引擎不注册任何提示词或工具 schema，因此不增加请求前缀 token，也无法使原本可复用的提供方缓存条目失效。

## 已知局限与延迟工作

- **未挂载到任何组合**——引擎行未出现在任何 bundle 或 profile 的 `cordis.yml` 中，因此在组合进提供方行之前 `ctx.permission` 都不存在。
- **`readonly` 与 `bypass` 模式是未实现的桩**——`resolveDecision` 会对这两个保留模式抛错，而非对其采取行动。
- **分层规则加载与冷恢复快照未实现**——引擎评估已经合并的规则集；组装 managed/project/teammate 层的加载器与冷恢复快照被延迟。
- **尚无会话日志组合测试**——deny 到 `permission/decision` 的关系由一个尚不存在的组合测试断言。
- **规则学习与 MCP 生命周期被延迟**——权限 seam Agent Note 的后续阶段负责写回目标与 MCP 生命周期，此处未实现。
