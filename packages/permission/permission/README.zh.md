# dsh-permission

[English](README.md) | 中文

DeepSeek Harness 的权限 Service Definition。

提供 `ctx.permission`——决定某个工具调用是否可被发出的抽象契约。引擎提供方（`dsh-permission-engine`）提供实现；消费者（`dsh-tool-permission-guard` 与团队插件）读取该服务。

## 角色

**Service Definition**——规则与决策类型、`PermissionService.evaluate` 契约，以及 `permission/decision` 审计事件。无运行时行为；提供方与消费者依赖本包。发布 `ctx.permission`，此行属于宿主组合。

## 关键导出

| 导出 | 说明 |
|---|---|
| `PermissionService` | 注册为 `ctx.permission` 的 `evaluate(call, context)` 契约 |
| `PermissionMode` | 每个 scope 未匹配调用的回退：`enforce` / `default`（`readonly` / `bypass` 保留） |
| `RuleIR` | 解析后的规则：kind、layer、tool、matcher 判别项与作者写的 `raw` 字符串 |
| `ToolCallView` | `evaluate` 据以决策的工具名与 JSON 参数 |
| `PermissionContext` | 模式、执行成员与合并后的层标记规则集 |
| `PermissionDecision` | `allow` / `deny{reason,cause}` / `ask`，附用于审计的匹配规则 |
| 会话事件 | `permission/decision`——一次决策的持久审计记录 |

## 决策契约

`evaluate` 按 `deny > ask > allow` 的顺序将调用与上下文的规则匹配，未匹配时回退到权限模式。`managed` 层的 `deny` 在任何模式下都是绝对的。`evaluate` 是其输入的纯函数：引擎在其提交点追加 `permission/decision`，消费者将 `ask` 路由到审批 seam 或 leader 会合点。

## 模型体验

### Service Definition 表面

#### 模型看到的内容

本包不贡献任何提示词、工具 schema 或模型请求。它声明 `ctx.permission` 服务契约与 `permission/decision` 会话事件类型；提供方（`dsh-permission-engine`）与消费者（`dsh-tool-permission-guard` 和团队插件）拥有该决策产生的每个模型可见效果。

#### Token 影响

零。来自本 Definition 的任何请求、结果或失败都不会进入模型请求。

#### KV 缓存影响

独立。本 Definition 不增加请求前缀 token，也无法使原本可复用的提供方缓存条目失效。

## 已知局限与延迟工作

- **未挂载到任何组合**——该行未出现在任何 bundle 或 profile 的 `cordis.yml` 中，因此在组合进提供方行之前 `ctx.permission` 都不存在。
- **`readonly` 与 `bypass` 是保留但未实现的枚举值**——类型声明了它们，而第一阶段的引擎会以错误拒绝二者，而非对其采取行动。
- **分层规则加载不属于 Definition**——合并后的层标记规则集是 `evaluate` 的输入；组装 managed/project/teammate 层的加载器被延迟。
- **规则学习被延迟**——将已批准的 `ask` 写回目标地由权限 seam Agent Note 定型，但尚不属于本 Definition。
- **尚无会话日志组合测试**——deny 到 `permission/decision` 的关系由一个尚不存在的组合测试断言。
