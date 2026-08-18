# dsh-team-channels

[English](README.md) | 中文

DeepSeek Harness 团队插件的团队消息、进度跟踪与审批协调。

## 角色

**Consumer** —— 提供宿主层 `ctx.teamControl` 注册表（teammate → leader 审批流程，按 leader 会话键控）和 `TeamProgressStore`（结构化任务进度，按 leader 会话键控）。

## 关键导出

| 导出 | 说明 |
|---|---|
| `TeamControlRegistry` | 宿主层待处理审批注册表，按 leader 会话键控，带超时清理 |
| `TeamProgressStore` | 内存进度存储，按 leader 会话键控，带会话事件恢复 |

## 配置

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `controlRequestTimeoutMs` | `number` | `120000` | 待处理请求的自动拒绝超时 |

## 模型体验

无，因为该包只提供 `team_control` 和 `team_progress` 工具消费的内存协调状态；它自身不注册提示词、schema 或结果。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- 跨进程重启的审批请求持久化尚未实现；冷恢复会自动拒绝待处理请求。
- 进度存储仅在内存中；会话事件提供持久性，并在 `list` 时回放。
