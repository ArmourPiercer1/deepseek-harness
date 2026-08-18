# dsh-team-runtime

[English](README.md) | 中文

DeepSeek Harness 团队插件的团队运行时编排、委托与每个成员的能力过滤。

## 角色

**Consumer** —— 编排 teammate 生命周期，并在可继续的子作用域上安装每个成员的组合（MCP guard + 审批钩子）。

## 关键导出

| 导出 | 说明 |
|---|---|
| `TeamOrchestrator` | 会话作用域的激活管理器 |
| `createMcpGuard` | 动态 MCP 工具 guard 工厂 |
| `installMemberComposition` | 从绑定数据进行的复合成员设置 |
| `installApprovalHook` | 针对 `requiresApproval` 工具的作用域 `tools/pre-execute` 挂起 |
| `teamMemberSetupContribution` | 读取 `team/member-bound` 的 `registerContinuableSetup` 贡献 |

## 模型体验

间接的，经由编排器为 teammate 执行而委托的 subagent seam。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- 条件工具约束（`pathWithin`、`executableEquals`）推迟到 Phase 4。
- `maxTokens` 只在全新委托时应用；冷恢复的 teammate 会回退到其路由默认值，因为可继续描述符按设计省略了每次激活的预算。
