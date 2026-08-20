# dsh-bundle-team

[English](README.md) | 中文

dsh agent 团队组合包：在可继续的 subagent 之上进行 leader-teammate 协调。

## 挂载 team 模式

相同的五个包有两个挂载面，一个部署只选其一：

- **shipped 的 `team` 预设**（`apps/cli/config/agent-presets/team/`）是标准 dsh 部署的选择。它是 agent 平面组装：team 组位于 `isolate` realm（`team`、`teamControl`）之内，每个运行该预设的会话通过 scope 父级共享同一份注册表与协调器；teammate 所运行的 `subagents` 注册表仍在宿主平面。
- **本组合包**是不组装 preset 名册的自定义 profile（headless 或自动化部署）的 opt-in 宿主平面入口。它的行把 `team` 与 `teamControl` 注册进 root realm，因此是进程全局的。

同时使用两者会让各自保留一份注册表：预设的 agent 解析 realm 内实例，宿主侧的行保持惰性。

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
