# Agent Note: 权限规则匹配与 harness 工具调用对齐

Status: implemented

[English](2026-08-21-permission-rule-matching-aligns-with-harness-tool-calls.md) | 中文

## 问题

文档中的规则语言以 Claude Code 风格的大写拼写命名工具——`dsh-team-local` README 与 adding-agent-team 手册都写作 `Bash(...)` 与 `Read(...)`——而 harness 的工具以小写注册（`bash`、`read`、`write`），文件工具收到的是工作区相对路径（`notes/hello.txt`），而路径规则却对照会话 cwd 解析。两处比较对上述两个事实都视而不见：path 与 param 匹配器精确比较工具名（command 匹配器早已大小写不敏感），而 `matchPath` 把解析后的绝对模式与原始输入路径直接比较，不把相对输入解析到 cwd。一条作者编写的 `Write` ask 规则能编译，却永远匹配不到相对路径上的 `write` 调用，受门禁的调用直接落入模式兜底——teammate 的 `ask: [Write]` 从不发起 ask，且在 `default` 模式下每道门禁都静默放行。

## 决定

规则到调用的匹配与 harness 的命名和路径对齐；`mcp__` 前缀保持精确，因为 server 名是身份而非拼写：

- parse 以小写化的工具名检测 command/path 家族与主内容字段表；编译出的匹配器保留作者拼写，path 与 param 匹配器两侧小写后比较——即 command 匹配器早已遵守的契约。
- `matchPath` 在比较前解析输入路径：绝对输入保持其 POSIX 形式，相对输入连接到该 scope 的会话 cwd——与模式的相对形式所用的同一组 bases。

## 考虑过的替代方案

**在 parse 时把作者规则规范化为小写。** 存储规范化的小写名也能修复工具比较，但它会改写审计经由 `RuleIR.tool` 呈现的作者名，且被调用侧仍需在匹配器里小写化；两侧同时小写化让作者文本在所有地方保持原样。

**要求工具调用或规则使用绝对路径。** 文件工具例行地从模型收到工作区相对路径；在任何一侧强要绝对输入，都是把 cwd 记账推给每个调用方，而不是放在唯一拥有 bases 的模块里。

**把 harness 工具改名为大写拼写。** 工具名对模型可见、被记入日志、并持久于会话事件与载荷；为规则拼写一致性而改名，要付出两次比较就能吸收的持久化迁移成本。

## 后果

- 文档示例（`Bash(...)`、`Read(...)`、裸 `Write`）按原样匹配小写的 harness 工具及其相对路径。
- 回归用例在 `parse.spec.ts`、`match-path.spec.ts`、`match-param.spec.ts` 中钉住大小写不敏感的家族检测与工具比较，以及相对输入对 cwd 的解析。
- [team-agent keyless snapshot](../testing/2026-08-20-team-agent-keyless-e2e-snapshot.md) 是装配级证明：fixture 成员的内联 `ask: [Write]` 规则让它们相对路径的 `write` 调用经由已发布的强制钩子挂起。

## 相关

- [base 组合接线 note](2026-08-21-base-composition-carries-the-permission-engine.md) 提供让本匹配在已发布组合中可达的 engine 行。
- [权限 seam note](../architecture/2026-08-15-permission-seam-and-mcp-fusion.md) 拥有本 note 保留的 matcher 词汇。
- `dsh-permission-engine` README 记载 matcher 表与规则文件格式。
