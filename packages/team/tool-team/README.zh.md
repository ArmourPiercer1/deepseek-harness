# dsh-tool-team

[English](README.md) | 中文

DeepSeek Harness 团队插件的面向模型的团队工具。

## 角色

**Consumer** —— 注册 5 个用于团队协调的工具：委托、发现、消息传递、进度跟踪与审批控制。

## 工具

| 工具 | 说明 |
|---|---|
| `delegate_to_teammate` | 向 teammate 委托任务（仅限 leader） |
| `list_teammates` | 列出可用的 teammates 及其状态 |
| `send_team_message` | 向 teammate 或 leader 发送消息 |
| `team_progress` | 读取/更新团队任务进度看板 |
| `team_control` | 评审/决定待处理的 teammate 权限请求（仅限 leader） |

## 模型体验

间接的，经由拥有 5 个已注册团队工具之面向模型工具目录渲染的 dsh-tools。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- teammate 到 teammate 的直接投递尚不可用：teammate 向 peer 发送的 `send_team_message` 会报告给 leader，由被唤醒的 leader 转发该消息。结构化的跨成员消息队列暂缓。
- 工具结果内容块使用纯文本；富结构化渲染暂缓。
