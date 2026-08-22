# 权限

[English](permission.md) | 中文

[packages/permission](../../packages/permission) 的权限能力决定某个工具调用是否可以发出。`ctx.permission`（[dsh-permission](../../packages/permission/permission/README.zh.md)）是[服务定义](../../packages/permission/permission/README.zh.md)：抽象的 `PermissionService` 契约，提供 `compile` 与 `evaluate`。提供方 [dsh-permission-engine](../../packages/permission/permission-engine/README.zh.md) 通过解析作者编写的规则字符串、用四种 matcher 匹配工具调用、裁决分层规则集并追加 `permission/decision` 审计事件来实现 `evaluate`；[dsh-tool-permission-guard](../../packages/permission/tool-permission-guard/README.zh.md) 与 team 插件是它的消费者。包 README 负责组合状态与限制；[权限 seam Agent Note](../../.agents/notes/implemented/architecture/2026-08-15-permission-seam-and-mcp-fusion.zh.md) 负责设计决策依据。

源码：[`packages/permission/permission/src/index.ts`](../../packages/permission/permission/src/index.ts)

## 服务

`ctx.permission.compile(rules)` 在加载时一次性把作者编写的 `RuleSource` 集解析成不透明的 `CompiledPolicy` 句柄，并把任何解析诊断作为字符串返回。`ctx.permission.evaluate(call, context)` 根据该作用域的编译策略、权限模式、路径基址与执行成员 id，对单个 `ToolCallView`（工具名与冻结的 JSON 参数）作出决定。两个方法都是纯函数：二者都不追加审计事件，也不运行审批流程——由消费者在提交点追加 `permission/decision`，并把 `ask` 路由到审批 seam（主代理）或 leader rendezvous（teammate）。

## 规则引擎

规则是作者编写的字符串，被解析成带 `kind`（`allow`/`ask`/`deny`）、`layer`（`managed`/`project`/`teammate`）、目标工具名和 matcher 判别的 [`RuleIR`](../../packages/permission/permission/src/types.ts)。引擎把每条规则编译成四种 matcher 之一：**command** matcher 拆分复合命令并剥离包装，用于 `Bash`/`pwsh`；**path** matcher 以 `//`/`~`/`/` 锚点对文件工具应用 gitignore 语义；**mcp** matcher 检查 `mcp__server[__tool]` 前缀；**param** matcher 检查任意工具的一个顶层标量输入字段。matcher 表见[引擎 README](../../packages/permission/permission-engine/README.zh.md)。

## 裁决

`evaluate` 按 `deny → ask → allow` 顺序逐层匹配，没有命中时回退到作用域的权限模式。首个命中者胜出，与特异性无关；`managed` 层的 `deny` 在每个模式下都是绝对的，不能被更低层的 `allow` 覆盖。`enforce` 模式拒绝未命中的调用（allowlist，受控 teammate 的默认值），`default` 允许它（denylist，主代理的默认值），保留的 `readonly`/`bypass` 模式抛出未实现异常。被拒绝的调用携带一个模型可见的 `reason`（规则拒绝为 `` denied by rule "<raw>" (<layer>) ``，模式拒绝为 `` no matching allow rule (enforce mode) ``）。

## `permission/decision` 事件

`permission/decision` 是单次求值的持久审计记录：工具名、结果 kind、决定它的规则与层（当由规则决定时）、执行成员、生效模式以及拒绝原因。模型可见的决策结果必须能从会话日志重建，因此消费者在提交点追加该事件。分层规则加载、规则学习（把已批准的 `ask` 写回）以及 `readonly`/`bypass` 模式均被推迟；该 seam 尚未接入任何组合，因此在组合一个提供方行之前，`ctx.permission` 不存在。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpermission--permissionservice"></a>

### `ctx.permission` — `PermissionService`

The permission engine. Consumers `compile` a scope's authored rules once at load into an opaque CompiledPolicy, then `evaluate` each tool call against it. Both are pure: neither appends the audit event or runs the approval flow — a consumer appends `permission/decision` at its commit point and routes an `ask` to the approval seam or the leader rendezvous.

```ts cordis-catalog
/**
 * Compile a scope's authored rules into an opaque policy.
 * @param rules - the authored rule strings with their kinds and layers.
 * @returns the compiled policy, plus any parse diagnostics as human-readable strings.
 */
compile(rules: readonly RuleSource[]): { readonly policy: CompiledPolicy; readonly diagnostics: readonly string[] }

/**
 * Decide whether a tool call may be issued.
 * @param call - the tool name and JSON arguments to decide.
 * @param context - the compiled policy, mode, path bases, and acting member.
 * @returns the allow/ask/deny decision, with the matched rule when a rule decided it.
 */
evaluate(call: ToolCallView, context: PermissionContext): PermissionDecision

/**
 * Load the managed and project rule layers from disk (read-only), merge them
 * with the optional teammate inline rules, and return the scope's full
 * layer-tagged rule source set. A missing managed file is refused (not
 * skipped) when the options record that the scope was bound with it present.
 * @param options - the layer file paths and the optional teammate snapshot.
 * @returns the merged rule sources plus each layer's presence.
 * @throws when the managed file is missing but was present at bind time, or a
 *   layer file cannot be read or is outside the supported rule-file format.
 */
loadRuleLayers(options: LoadRuleLayersOptions): Promise<LoadedRuleLayers>
```

Source: [`packages/permission/permission/src/index.ts`](../../packages/permission/permission/src/index.ts)
<!-- END GENERATED cordis-surface -->
