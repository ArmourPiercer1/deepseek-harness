# dsh-team

[English](README.md) | 中文

DeepSeek Harness 的 agent 团队 Service Definition。

提供 `ctx.team` —— 加载、查询和校验团队成员定义的抽象契约。具体提供方（例如 `dsh-team-local`）提供实现。

## 角色

**Service Definition** —— 类型、带品牌 id、会话事件和抽象 `TeamRegistry` 类。没有运行时行为；提供方与消费方依赖此包。

## 关键导出

| 导出 | 说明 |
|---|---|
| `TeamRegistry`（默认） | 注册为 `ctx.team` 的抽象 `Service` 子类 |
| `TeamMemberId` | 团队成员带品牌 id 类型 + 工厂 |
| `TeamMemberDefinition` | leader 和 teammate 的统一定义类型，含可选内联 `permissions` 规则与 `permissionMode` |
| `TeamPermissionRules` | 成员的内联规则列表：可选的 `deny` / `ask` / `allow` 规则字符串 |
| `TeamPermissionMode` | 成员的权限模式：`enforce` / `default`（`readonly` / `bypass` 保留并被拒绝） |
| `DEFAULT_LEADER_TOOLS` | 10 个不可移除的 leader 工具 |
| `TEAMMATE_DENIED_TOOLS` | teammate 永远不能调用的工具 |
| 会话事件 | `team/member-bound`（可携带成员规则快照与绑定期 managed 存在性）、`team/progress`、`team/control-request`、`team/control-decision`、`team/message` |

## 模型体验

无，因为 Service Definition 只提供类型、事件和常量，没有提示词、schema 或结果。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- `maxContextTokens` 未在 `TeamMemberDefinition` 中建模；上下文窗口限制推迟到压缩层集成。
