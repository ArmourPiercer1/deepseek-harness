# Agent Note: Layered rule loading and the cold-recovery rule snapshot

[English](2026-08-15-layered-rule-loading-and-cold-recovery-snapshot.md) | 中文

Status: implemented

## 问题

权限引擎评估的是一套已经合并、带层标记的规则集，但没有任何东西组装这套规则集：managed 与 project 规则文件没有加载器，成员定义中的内联规则（frontmatter 的 `permissions`）也没有进入任何持久载荷。成员会话的有效策略因此只活在父级的活注册表里——而这正是冷恢复所没有的状态，因为恢复必须仅凭其持久的 `team/member-bound` 事件重建子会话的组合。另一方面，基于文件的策略是移动目标：组织在会话开始之后收紧某条 managed `deny`，若恢复不从磁盘重读文件层，在途的恢复会话就不会受其约束。而一个默默跳过缺失 managed 文件的加载器，会让在该策略下绑定的会话恢复到不受守卫的状态——这正是权限 seam note 点名的不可接受失败模式。

## 决定

分层加载是引擎（`dsh-permission-engine` 的 `load.ts`）中一个纯的、不感知路径的模块，通过 `dsh-permission` Service Definition 上的 `PermissionService.loadRuleLayers` 契约发布：

- **来源。** managed 层为 `$DSH_HOME/permissions.yml`，project 层为 `<workspace>/.dsh/permissions.yml`（该 scope 的会话 cwd），teammate 层为调用方传入的内联规则快照。引擎由调用方提供路径，自身不拥有路径解析。
- **文件格式。** 规则文件是单一顶层 `permissions:` 键，其 `deny` / `ask` / `allow` 值为规则字符串列表，行内或块状皆可。解析是严格子集：注释与空行跳过，格式之外的一切以 `RuleFileError` 拒绝，指明来源与每一条诊断，因此拼写错误会大声失败而不是丢弃一条 deny。
- **合并。** 各层连接，相同的 `(kind, raw)` 规则去重到最高层（managed > project > teammate）。共享同一 raw 字符串的 `deny` 与 `allow` 是两条不同的规则，两者都保留；deny 的绝对性在裁决时强制，而不是靠丢弃 `allow` 实现。
- **失败关闭。** 当调用方在 managed 策略下绑定（`managedPresent: true`）而 managed 文件缺失或无法解析时，加载以 `ManagedRulesMissingError` 拒绝，而不是跳过该层。绑定之后才部署的 managed 文件会被重读拾取，立即约束该会话。

团队侧提供这三个来源：

- `dsh-team-local` 从成员 frontmatter 解析可选的 `permissions`（按姿态分组的规则字符串数组）与 `permissionMode`（`enforce` / `default`；`readonly` / `bypass` 被拒绝）；这需要扩展 `parseSimpleYaml` 支持嵌套块数组与正确的空行内数组。
- 委托工具把成员的 `permissions`、`permissionMode`、以及对 managed 文件的纯存在性探测，作为 `rules`、`permissionMode`、`managedPresent` 快照进持久的 `team/member-bound` 载荷——仅新增可选字段，因此字段出现之前写出的载荷依然可解析、依然可恢复。
- 团队运行时的成员设置贡献在全新创建与冷恢复两种情况下都调用 `loadRuleLayers`——`permission` 是该插件的硬注入，这一注入与消费存储加载的强制点由[teammate 权限强制 note](2026-08-20-teammate-permission-enforcement-at-the-executor.zh.md)拥有——并把结果 promise 以子会话 id 为键存储。文件层总是从磁盘重读；teammate 规则来自持久快照。

## 加载拒绝的归属

存储的 promise 可能在任何消费者等待它之前就拒绝（managed 文件失效、某层文件格式错误）——那发生在设置时刻，而强制点只在工具调用时才读取存储。一个无人等待的拒绝会浮现为未处理的拒绝，因此注册时附加一个有命名的吞并处理，在存储的 promise 被读取之前消费该拒绝；存储的 promise 本身仍会把它交付给任何等待它的人。

## 已考虑的替代方案

**团队运行时静态导入加载器**——在 `dsh-team-runtime` 的 package.json 中声明 `dsh-permission` 依赖。本轮约束是不新增依赖、不改 lockfile，且 `permission` 服务本就是 seam 所在：运行时用 `ctx.get` 读取它，并以结构方式镜像那一小段契约（`TeamPermissionService`），待正式依赖有依据时可用真实导入替换。

**持久存储完整合并规则集，而非快照加重读**——把完整合并规则集存进 `team/member-bound` 在恢复时更简单，但它把 managed 与 project 层冻结了：组织收紧的 `deny` 在下一次委派之前都不会约束在途的恢复会话。只有 teammate 层是持久的（其定义文件可能被删除）；文件层是关于部署的事实，应当重读。

**绑定期做完整的 `loadRuleLayers` 探测**——在委派时调用加载器既能记录 `managedPresent` 又能校验 managed 文件，但一份格式错误的 project 文件届时会让该工作区的每次委派都被拒绝。绑定期探测是纯存在性检查：只记录一个布尔值，解析问题在策略真正被读取时浮现。

**恢复时对任何缺失的 managed 文件都失败关闭**——无条件拒绝会让所有没有 managed 策略的部署回归：从未在其下运行的会话一旦接线了恢复就永远无法冷恢复。绑定期的 `managedPresent` 标志区分"在其下绑定且它已失效"（拒绝）与"从未在其下"（缺席是常态）。

**团队运行时用硬 `inject: ['permission']`**——本阶段被拒：注入使团队行在没有引擎行时无法组合，而团队插件独立组合、独立运行，因此松散的 `ctx.get` 读取保留了有文档的无引擎状态：不安装任何规则状态，子会话不带策略层运行。[teammate 权限强制 note](2026-08-20-teammate-permission-enforcement-at-the-executor.zh.md) 在强制点反转了这个决定：硬注入交付了，激活条件显影在组合本身，而不是静默未强制的策略。

## 后果

- 收紧的 managed `deny` 在恢复会话的下一次规则评估时约束它，失效的 managed 文件使恢复加载拒绝——两者由引擎与成员设置的单元测试钉住。
- 向后兼容是结构性的：无规则字段的旧 `team/member-bound` 载荷（无 `rules`、无 `managedPresent`）与从前完全相同地冷恢复，成员设置测试断言了这一无快照的加载调用。
- 引擎保持纯与不感知路径；`dsh-team-runtime` 的 `resolveRuleLayerPaths` 是文件路径约定的唯一所有者，引擎的测试使用自己的临时目录树。
- 绑定期探测读取环境中的 `$DSH_HOME`；测试把它 stub 到临时目录。
- 从恢复策略编译并对调用执行 deny（把存储的拒绝结算为 deny）的强制点由[teammate 权限强制 note](2026-08-20-teammate-permission-enforcement-at-the-executor.zh.md)记载；它所需的 engine 行按 [base 组合接线 note](../bug-fix/2026-08-21-base-composition-carries-the-permission-engine.zh.md) 随 base bundle 发布，因此每个已发布预设的团队行都能解析该硬注入。

## 相关

- [权限 seam 与 MCP 融合](2026-08-15-permission-seam-and-mcp-fusion.zh.md)提案拥有更宽的 seam；其第一阶段列出了本 note 交付的分层文件加载、冷恢复规则快照与绝对 managed 层。
- [teammate 权限强制 note](2026-08-20-teammate-permission-enforcement-at-the-executor.zh.md) 在强制点消费本阶段的加载，并反转上文记录的松 `ctx.get` 决定。
- [工具权限守卫 note](2026-08-20-tool-permission-guard-resolves-permission-per-call.zh.md)拥有守卫的按调用服务解析，是同一 `permission` 服务、同一激活顺序约束下的另一个消费者。
- `dsh-permission-engine` 的 README 记录规则文件格式与失败关闭契约；`dsh-team-local` 的 README 记录 frontmatter 字段；`dsh-team-runtime` 的 README 记录恢复加载与其存储。
