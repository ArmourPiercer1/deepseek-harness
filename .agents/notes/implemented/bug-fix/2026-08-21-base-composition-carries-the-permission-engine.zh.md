# Agent Note: base 组合携带 permission engine

Status: implemented

[English](2026-08-21-base-composition-carries-the-permission-engine.md) | 中文

## 问题

`dsh-team-runtime` 硬注入 `permission`，因为团队在策略下运行的任何地方都必须在场 teammate 强制（[teammate 权限强制](../architecture/2026-08-20-teammate-permission-enforcement-at-the-executor.zh.md)）。但没有任何组合提供 engine 行：bundle、profile 与 preset 都不组合 `@deepseek-ai/dsh-permission-engine`，因此该注入永不解析，已发布的 `team` 预设以 `team-runtime ... waiting for permission` 挂载失败。所有 team 会话的创建与恢复都被拒绝，引擎的规则加载与强制虽已发布却不可达。

## 决定

base bundle 组合携带 engine 行：`packages/bundle/base/cordis.patch.yml` 在 sandbox 的 `permission` presets 行旁挂载 `- id: permission-engine` / `@deepseek-ai/dsh-permission-engine`，`@deepseek-ai/dsh-base` 声明工作区依赖。引擎在宿主平面发布 `ctx.permission`，其 README 也把这行归于宿主组合：managed 规则层是 `$DSH_HOME/permissions.yml`——一个比任何会话都长寿的部署事实——而 preset 平面的行经由 scope 父系解析该服务，与解析宿主 `tools` 与 `subagents` 注册表完全相同。引擎在消费者编译某个 scope 的作者规则之前是纯的——无 config、空 inject、不自带工具——因此挂载它本身不改变任何行为，直到有消费者读取它。

## 考虑过的替代方案

**把 engine 行组合进 team preset 内部。** preset 作用域的 engine 也能为 team 会话解析同一注入，但权限策略是宿主平面的关切：managed 层读取部署文件，team 预设的每个用户副本都会组合自己的 engine 实例，而宿主平面的消费者永远无法解析 preset 作用域的服务。这行属于策略所在之处。

**把注入软回松 `ctx.get`。** 没有 engine 挂载也能成功，但团队会带着静默未强制的策略运行——正是强制 note 选择硬注入要使其显影的看不见的缺口。修复补上缺席的行，而不是削弱消费者。

**把接线留给每个部署。** 已发布预设要在已发布部署中挂载；把同样两行推给每个部署只是把缺陷复述成样板。

## 后果

- 每个在 base bundle 之上组合的会话都携带 `ctx.permission`；已发布 team 预设挂载其完整行集，team 会话可创建可恢复，[team-agent keyless snapshot](../testing/2026-08-20-team-agent-keyless-e2e-snapshot.zh.md) 在已发布 profile 上演练活的强制路径。
- `dsh-team-runtime` 与 `dsh-permission-engine` README 记载自定义组合的激活条件——插件只在组合携带 engine 行处激活，而每个已发布组合都携带——不再有已发布缺口的限制条目。
- 丢弃 base 行的自定义组合仍会把 team-runtime 行显示为 pending：正是选择硬注入要得到的显影故障。

## 相关

- [teammate 权限强制 note](../architecture/2026-08-20-teammate-permission-enforcement-at-the-executor.zh.md) 拥有本行所满足的硬注入。
- [分层规则加载 note](../architecture/2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.zh.md) 拥有强制所消费的加载。
- [权限 seam note](../architecture/2026-08-15-permission-seam-and-mcp-fusion.zh.md) 拥有更宽的 seam。
