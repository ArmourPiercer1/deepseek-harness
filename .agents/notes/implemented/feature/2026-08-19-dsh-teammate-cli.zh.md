# Agent Note: The `dsh teammate` Command Family

Status: implemented

[English](2026-08-19-dsh-teammate-cli.md) | 中文

## 问题

Teammate 定义是位于工作区 `.dsh/teammates/` 或 `$DSH_HOME/teammates/` 下的 Markdown 文件，按工作区的启用状态存放在 `$DSH_HOME/settings.yaml` 的 `team-enablement` 段中（即[第二轮](2026-08-18-team-plugin-round-2.md) N2 的存储面）。在此改动之前，两个面都没有第一方 CLI：列出、添加或切换 teammate 需要知道磁盘布局，而启用状态的修改则需要手工编辑一个由 settings-file provider 拥有的 YAML 文档。

## 决策

`apps/cli` 发布带四个子命令的 `dsh teammate`，实现在 `apps/cli/src/teammate.ts`，按 `plugin.ts` 的先例经 `args.ts`/`bin.ts` 接线：

- `list` 按加载器的自包含可见性规则（工作区有自己的 `.dsh/teammates/` 定义时隐藏 home 定义）打印当前工作区可见的 teammate，含角色、启用状态、能力摘要（provider、model、tools、skills、mcpServers、requiresApproval、contextPolicy）以及定义来源（home 或 workspace）；无法解析的文件以 stderr 警告呈现，命令仍以 0 退出。
- `add <file>` 按 team-local 解析器的精确规则校验文件 frontmatter，默认安装到 `$DSH_HOME/teammates/<basename>`，加 `-w, --workspace` 时安装到 `<workspace>/.dsh/teammates/<basename>`；文件缺失、frontmatter 非法或目标已存在都以 1 退出且不写入任何内容，`add` 拒绝覆盖。
- `enable <id>` / `disable <id>` 读写 `$DSH_HOME/settings.yaml` 的 `team-enablement` 段，以工作区路径和 teammate id 为键：`disable` 存入加载器过滤所依赖的显式 `false`，`enable` 清除显式 `false`（缺省是加载器的规范启用状态，从不存储显式 `true`），leader 永不可禁用，未知 id 或幂等空操作均有报告且空操作以 0 退出不写入。

CLI 的解析器是 `dsh-team-local` 的 `parseTeamMemberMarkdown` 与 `parseSimpleYaml` 的逐字自包含镜像，因为本次改动中已发布的 CLI 不能新增对团队包的依赖。`apps/cli/tests/teammate.spec.ts` 中的 parity 测试电池从工作区源码树导入加载器的真实解析器（仅限测试的相对导入；发布的产物不保留 team-local 依赖），并在 24 个夹具上断言判定、提取字段与诊断完全一致——包括加载器自身的解析怪癖（嵌套键下的缩进块列表变成数组、带引号的数字保持字符串），镜像复现而非修复这些怪癖。

settings 写入用 js-yaml 整体往返文档：其他命名空间的数据被保留，`settings.yaml` 中的注释不被保留（settings-file provider 用 YAML Document API 修补其文档并保留注释；CLI 整体写入文档）。写入是临时文件加重命名替换；该文档没有跨进程锁，双向皆无。

## 备选方案

- **把 `@deepseek-ai/dsh-team-local` 加为 CLI 依赖**：被否决——本次改动冻结了 CLI 的依赖面（不新增依赖），且在 pnpm 严格布局下，导入一个不在导入方包 lockfile 条目中的包会破坏源码启动。逐字镜像在不新增依赖的前提下让"`add` 接受什么"与"加载器解析什么"保持一致。
- **给 `add` 用严格 YAML frontmatter 解析器**：被否决——它会接受加载器的基于行的 `parseSimpleYaml` 会误解析的文件，于是 `add` 可能安装运行时读成别的东西的文件。镜像精确复现加载器的怪癖，parity 测试电池检测漂移。
- **按 teammate id 而非按工作区为启用状态设键**：被否决——第二轮 N2 的存储面是 `workspacePath -> teammateId -> boolean`，CLI 说同一种方言，加载器与任何其他写入方因此达成一致。
- **`enable` 时存储显式 `true`**：被否决——缺省是规范启用状态，存储 `true` 会引入加载器忽略的状态。
- **`dsh teammate rm` 子命令**：不属于本决策；删除定义仍是对该 Markdown 文件的普通文件系统操作。

## 后果

- Teammate 可在不知磁盘布局的情况下被列出、添加和切换；四个子命令及其错误路径（文件缺失、frontmatter 非法变体、未知 id、重复 add、禁用 leader）由 `apps/cli/tests/teammate.spec.ts`（含 parity 测试电池共 57 个测试）钉住，`apps/cli/tests/teammate-source-launch.spec.ts`（4 个测试）对临时 `DSH_HOME` 启动真实源码 bin。
- frontmatter 解析器现在存在两份副本；经过变异检查的 parity 测试电池（镜像中一字之差的消息改动即使其失败）是漂移守卫。
- 整体文档的 settings 往返：其他命名空间的数据被保留，`settings.yaml` 注释不被保留，文档的并发写入方双向都不被锁出。
- 本改动的 built-bin smoke 按"不构建仓库"的任务约束替换为源码启动 smoke（`node --import tsx/esm apps/cli/src/bin.ts`，即[源码启动契约](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md)向量）；父级回合在验收时复核。
