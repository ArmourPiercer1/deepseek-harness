# dsh-tool-permission-guard

[English](README.md) | 中文

DeepSeek Harness 的权限守卫 Consumer。

一个 `tools/pre-execute` 监听器，为主 agent 和单个委派的子 agent 应用 `ctx.permission.evaluate`。`allow` 继续；`deny` 以引擎的 reason 阻止调用；`ask` 路由到审批 seam。

## 角色

**Consumer**——读取 `ctx.permission`（来自 `@deepseek-ai/dsh-permission`），不提供服务。它松散地置于组合中：服务按每次工具调用解析，而非在 apply 时解析——Loader 并行激活各行，apply 时的读取可能永久禁用守卫；服务缺失时调用不受守卫地继续。引擎在编译时丢弃或忽略的规则会在首次被评估的调用时记录到守卫的日志器，被丢弃的 deny 不会静默消失。团队插件是另一个消费者，改为将 `ask` 路由到 leader 会合点。

## 配置

| 字段 | 说明 |
|---|---|
| `mode` | 该 scope 的权限模式（`enforce` / `default`）。 |
| `rules` | 该 scope 的作者编写的规则字符串，按 kind 组织。 |
| `pathBases` | 路径规则锚点的解析基（`settingsDir` / `homeDir` / `cwd`）。 |

规则来源分层与冷恢复快照属于加载器；本消费者接收解析后的模式与规则。

## 模型体验

### 受守卫的工具调用结果

#### 模型看到的内容

守卫不注册任何工具。其模型可见效果是被守卫调用的结果：被允许的调用继续，被拒绝的调用返回携带引擎 `reason` 的错误结果，`ask` 路由到审批 seam 并呈现引擎的 reason。每次决策都会作为 `permission/decision` 审计事件追加到执行会话的日志。

#### Token 影响

有条件的。只有被拒或被询问的调用会将其 `reason` 与审批提示词贡献给模型请求；被允许的调用除工具调用本身外不贡献任何内容。

#### KV 缓存影响

独立。守卫不增加请求前缀 token，也无法使原本可复用的提供方缓存条目失效。

## 已知局限与延迟工作

- **未挂载到任何组合**——监听器行未出现在任何 bundle 或 profile 的 `cordis.yml` 中，因此在组合进行并且 `ctx.permission` 存在之前守卫处于非活动状态。
- **规则来源分层与冷恢复快照未实现**——守卫接收解析后的模式与规则；组装 managed/project/teammate 层的加载器与冷恢复快照被延迟。
- **`ask` 路径依赖审批 seam**——守卫将 `ask` 路由到审批 seam，由针对真实 `ApprovalService` 的组合测试证明；无该服务时 seam 拒绝该调用。团队插件的 leader 会合点路由是另一个消费者的职责。
