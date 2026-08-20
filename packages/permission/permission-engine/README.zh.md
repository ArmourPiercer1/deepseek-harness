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

## 规则分层加载

`loadRuleLayers` 组装 `evaluate` 消费的规则集，来源有三层：

- **managed**——`$DSH_HOME/permissions.yml`（组织策略文件）
- **project**——`<workspace>/.dsh/permissions.yml`，其中 workspace 为该 scope 的会话 cwd
- **teammate**——调用方快照传入的内联规则（成员 frontmatter 规则，在绑定时冻结进持久的 `team/member-bound` 载荷）

无法解析的层路径、或不存在的文件，都读作"该层缺席"；存在但无法读取、或超出规则文件格式的文件，会以 `RuleFileError` 拒绝，并指明来源与每一条诊断。文件格式是单一顶层 `permissions:` 键，其 `deny` / `ask` / `allow` 值为规则字符串列表，行内（`deny: [a, b]`）或块状（`- a`）均可；其余写法一律拒绝，因此拼写错误会大声失败而不是跳过一条 deny。

合并时按层连接，并对相同的 `(kind, raw)` 规则去重，保留最高层（managed > project > teammate）。共享同一 raw 字符串的 `deny` 与 `allow` 是两条不同的规则，两者都保留；deny 的绝对性在裁决时强制，而不是靠丢弃 `allow` 实现。

当调用方在 managed 策略下绑定（`managedPresent: true`）而 managed 文件现在缺失时，加载以 `ManagedRulesMissingError` 拒绝，而不是跳过该层：恢复的会话要么受组织当前策略约束，要么被拒绝，绝不受陈旧策略约束。绑定之后才部署的 managed 文件会被重读拾取，立即约束该会话。

## 模型体验

### 被拒调用的 reason 字符串

#### 模型看到的内容

被拒的工具调用以 `reason` 字符串的形式到达模型。由规则决定的拒绝使用稳定字面量 `` denied by rule "<raw>" (<layer>) ``，而 `enforce` 模式下未匹配的调用使用 `` no matching allow rule (enforce mode) ``。每次决策都会作为 `permission/decision` 审计事件追加到执行会话的日志。

#### Token 影响

有条件的。只有该次被拒调用的 `reason` 字符串会进入随后的模型请求；被允许或 `ask` 的调用本身不贡献 reason。

#### KV 缓存影响

独立。引擎不注册任何提示词或工具 schema，因此不增加请求前缀 token，也无法使原本可复用的提供方缓存条目失效。

### 规则文件加载失败

#### 模型看到的内容

加载失败（`RuleFileError`、`ManagedRulesMissingError`）会使 `loadRuleLayers` 拒绝；引擎本身不将加载失败文本放入模型请求。调用方决定呈现面：团队委托工具的绑定期探测是纯存在性检查，永不拒绝；团队运行时的强制点把被拒绝的策略加载结算为 fail-closed 的 deny（记入日志，且由于没有评估发生，不追加 `permission/decision` 审计）。

#### Token 影响

取决于调用方的呈现面；加载路径本身不向模型请求贡献任何内容。

#### KV 缓存影响

独立。

## 已知局限与延迟工作

- **未挂载到任何已发布的组合**——引擎行未出现在任何 bundle 或 profile 的 `cordis.yml` 中，因此已发布预设里 `ctx.permission` 缺席：团队运行时的硬 `permission` 注入使 team 预设的 team-runtime 行保持惰性（pending），直到某个部署把 engine 行与其组合到一起。
- **`readonly` 与 `bypass` 模式是未实现的桩**——`resolveDecision` 会对这两个保留模式抛错，而非对其采取行动。
- **规则学习与 MCP 生命周期被延迟**——权限 seam Agent Note 的后续阶段负责写回目标与 MCP 生命周期，此处未实现。
