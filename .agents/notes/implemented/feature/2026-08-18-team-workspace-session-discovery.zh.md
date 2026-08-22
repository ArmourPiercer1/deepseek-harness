# Agent Note: 团队工作区发现跟踪运行中的会话

Status: implemented

[English](2026-08-18-team-workspace-session-discovery.md) | 中文

相关：[Agent Team Plugin](2026-08-14-agent-team-plugin.zh.md)、[Team Plugin Round 2](2026-08-18-team-plugin-round-2.zh.md)。

## 问题

`dsh-team-local` 曾在挂载时一次性解析 teammate 工作区：先取配置的 `workspacePath`，再取 `$DSH_CWD`，最后取进程当前工作目录。一个 preset 只在其 standing scope 下挂载一次，并被加入其下的所有会话共享，因此在多会话表面（`dsh web`）上挂载时根本不存在会话工作区，回退解析到的是服务器进程的工作目录。项目工作区 `<workspace>/.dsh/teammates/` 下的 teammate 从未被发现：无论会话属于哪个工作区，都只能看到全局 `$DSH_HOME/teammates/` 的定义。挂载时合并语义放大了该问题：home 与工作区定义合并为同一集合，使无关的全局团队泄漏进每个项目工作区；且 `list_teammates` 过滤掉了 leader，工作区的 leader 定义对模型不可见。

## 决策

- **会话工作区跟踪**：team-local 监听 `agent/created`——该事件从每个 agent 作用域向上传播到 standing mount。当被创建 agent 的会话头携带非空且与当前跟踪工作区不同的 `cwd` 时，team-local 立即把工作区重新指向该目录并重载，同时为新工作区的 `.dsh/teammates/` 目录追加 watcher。挂载时解析（配置、`$DSH_CWD`、进程 cwd）仍作为 CLI 等单进程表面的初始种子。
- **工作区团队自包含**：工作区在 `.dsh/teammates/` 下定义了自己的成员时，这些定义即构成该工作区的完整团队；home 定义仅作为回退，作用于自身没有任何定义的工作区。加载路径不再有跨来源合并，也不再有“工作区 leader 覆盖 home leader”的折叠。
- **leader 可见性**：`list_teammates` 将 leader 与 teammates 一并列出。`delegate_to_teammate` 拒绝 leader id，因为 leader 是调用会话自身组合出的根 agent，从来不是委派目标。

## 考虑过的替代方案

- **通过 preset 配置传入会话工作区**：否决——standing 组合被不同工作区的会话共享，而 preset 配置在挂载时是静态的。
- **保留 home+工作区合并、工作区优先**：否决——全局团队会泄漏进无关的项目工作区，项目团队无法按定义原样列出。
- **注册表按工作区分键、工具按调用方会话过滤**：暂缓——当前 orchestrator 与进度存储同样是进程级的；按工作区划分的注册表视图应与那次会话化改造一并进行。注册表目前保存一份扁平集合，由最近创建 agent 的会话工作区决定（已在包 README 中记录）。

## 结果

- 在 `D:\test\team-e2e-demo` 下使用 `team` preset 的会话恰好列出 `leader`、`backend-dev`、`code-reviewer`；`$DSH_HOME/teammates/` 中的全局 AIEO 定义不再出现。
- `dsh-team-local` 为 `agent/created` 载荷新增 `dsh-agent`/`dsh-session` 类型依赖。
- 团队测试扩充至 25 个套件共 189 项，其中 `session-workspace.spec.ts` 覆盖工作区切换、home 回退、watcher 生命周期与 dispose。
