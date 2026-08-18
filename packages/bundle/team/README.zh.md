# dsh-bundle-team

[English](README.md) | 中文

dsh agent 团队组合包：在可继续的 subagent 之上进行 leader-teammate 协调。

## 安装

把团队组合包添加到你 profile 的 `cordis.patch.yml` 中：

```yaml
- insert:
    - id: team-bundle
      name: '@deepseek-ai/dsh-bundle-team'
```

或通过 CLI 安装：

```bash
pnpm add @deepseek-ai/dsh-bundle-team
```

## 包含的包

| 包 | 角色 |
|---|---|
| `dsh-team` | Service Definition（类型、事件、抽象注册表） |
| `dsh-team-local` | Service Provider（Markdown 定义加载器） |
| `dsh-team-runtime` | Consumer（编排、MCP guard、技能过滤） |
| `dsh-team-channels` | Consumer（消息传递、进度、审批） |
| `dsh-tool-team` | Consumer（5 个面向模型的工具） |

## 配置

组合包提供默认配置。在你的 `cordis.patch.yml` 中覆盖：

```yaml
- id: team-local
  config:
    homePath: /custom/path
    workspacePath: /workspace/path
- id: team-channels
  config:
    controlRequestTimeoutMs: 60000
```

## 模型体验

无，因为该组合包是纯组合清单，没有提示词、schema 或结果。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- 无 Web 客户端集成（团队进度面板、teammate 状态展示）。
- 无 CLI 命令（`dsh teammate list/add/enable/disable`）。
