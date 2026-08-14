# DeepSeek Harness 插件开发指南

本工作区用于开发 DeepSeek Harness（后文简称 dsh）的一系列插件。dsh 是构建在 vendored [Cordis](docs/cordis-primer.md) 之上的插件式 agent harness：**一切皆插件**，包括模型适配器、工具注册表、会话日志、agent loop 本身，因此每个部件都能从配置替换。此文件是开发插件的常驻参考；新需求先读 [architecture.md](docs/architecture.md) 与本文，再动 `packages/`。

---

## 1. dsh 对插件的稳定性 / 性能要求

文档中**没有硬性的时延或吞吐基准**，重点几乎全在**正确性取向的运行时稳定性**。核心约束如下。

### 一切可逆（effects）

- 每个插件对 context 的贡献都是**可逆 effect**：通过 `ctx.effect()` / `ctx.on()` 注册；registry 的 `register()` 返回 disposer，卸载时代理自动 unwind。见 [cordis-primer.md](docs/cordis-primer.md) 与根 [AGENTS.md](AGENTS.md)。
- 超出 Cordis 管理的资源（定时器、连接、watcher）必须包裹在 `ctx.effect()` 内并返回 disposer，否则卸载 / HMR 时会泄漏，或回调作用到已死的进程（[tutorial ch.2](docs/cordis-tutorial/02-lifecycle-and-effects.md)）。
- 卸载顺序：disposer 按注册逆序启动；**多个 async disposer 并发执行**，若 teardown 步骤有先后，放在同一个 effect 里按序 `await`。

### 热插拔 / HMR 稳定性

- HMR 的本质是"卸载 + 重新加载"：卸载释放 effects、加载遵循 `inject` 依赖，因此能热替换运行中的插件（[tutorial ch.6](docs/cordis-tutorial/06-composition-and-hmr.md)）。
- 配置编辑（`cordis.patch.yml`）被**事务性**重组；任何一次失败的解析 / 加载**保留上一个可用的 tree 继续运行**，并广播 `hmr/config-update-failed`（[app-boot](packages/boot/app-boot/README.md)）。
- 加载与配置校验失败必须**响亮失败（fail loud）**，绝不静默跳过；"misconfiguration fails loud"是 repo-wide 约定。
- fiber 状态机：`PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED`（另有 `FAILED`）。**`PENDING` 是合法状态**：声明了 `inject` 但服务暂缺时不报错（provider 可能稍后挂载）；诊断靠观察 fiber 状态而非报错。

### 启动与退出纪律

- boot 后审计 `assertEntriesLoaded` / `assertEntriesActivated`：每个 enabled entry 必须有 fiber、且必须真正激活，否则启动失败并带原始 stack（[app-boot](packages/boot/app-boot/README.md)）。
- 一个 wedged（卡死）disposer 只会**延迟致命退出**，绝不取消它（受 `FAIL_LOUD_RELEASE_TIMEOUT_MS` 限界）。
- 进程关闭给插件树最多 **5 秒**优雅 dispose（SIGINT/SIGTERM）。

### 测试强制要求（与稳定性直接相关）

- 每个 registry 必须有 **HMR-safety 测试**：dispose 贡献的 fiber，然后断言其注册被移除（[testing.md](docs/testing.md)、[packages/AGENTS.md](packages/AGENTS.md)）。
- 产品可见插件必须有 REAL-composition 测试（真 Loader 装载真 `cordis.yml`），不能只用手工 `ctx.plugin(...)`；条件与快照粒度见 [testing.md](docs/testing.md)。

### 关键反模式（避免不稳定）

- **function plugin 千万别设 `default` export**——会让 Loader 丢弃其命名导出 namespace（见 [postmortem](docs/postmortem/0001-acp-default-export-drops-inject.md)）。
- 可选项依赖不要用 `ctx.<name>`（拓扑敏感），用 `ctx.get(name)`。
- 服务、状态只在**提交点（commit point）**发布；通知 / 派生状态滞后于操作成功后。

---

## 2. 插件的标准接口

插件本质是实现 Service 的对象，两种标准形态，见 [packages/AGENTS.md](packages/AGENTS.md) 与 [tutorial ch.1](docs/cordis-tutorial/01-first-plugin.md)。

### Function plugin（最常见的元插件形态）

命名导出：`name`（可选诊断名）、`inject`（可选服务依赖）、`Config`（配置校验类型）、`apply(ctx)`。**没有 `default` export**。Cordis 直接调用函数；函数名仅用于诊断。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'
export const inject = ['tools']                 // 可选：声明服务依赖
export interface Config { /* 配置校验字段，见 config-catalog */ }

export function apply(ctx: Context) {
  // 通过 ctx.effect() / ctx.on() 注册可逆贡献
}
```

对象形式也合法：`ctx.plugin({ name?, inject?, apply(ctx) })`。服务类插件则 `export default` 一个承自 `Service` 基类的类，Cordis 把其生命周期挂到 context。

### 通过配置装载的契约（`cordis.yml` entry）

```
- id: <稳定身份>          # HMR 靠它对 diff；缺省则每次读文件都重生成 id 导致重挂载
  name: <模块 specifier>   # 相对路径或 npm 包名
  config: { ... }          # 见 config-catalog
  disabled: true           # 保留 entry、跳过挂载；翻回 false 重新加载
  # group: true + isolate: { key: true }   # 分组 + 服务隔离 realm（每会话私有服务）
```

- `inject: ['timer']` 声明依赖 → 插件等待这些服务存在后才激活；加载顺序由依赖表达，而非条目在文件中的位置（条目并发启动）。
- 服务访问：`ctx.<key>`（如 `ctx.tools`、`ctx.llm`、`ctx.sessions`、`ctx.agents`、`ctx.agentPresets`、`ctx.shell`、`ctx.fs`、`ctx.jobs`）；可选服务用 `ctx.get(name)`。
- 事件是类型化声明合并 + `emit / waterfall / parallel / serial` 分发模式；waterfall 监听器必须调用 `next()` 委派，否则短路整条链。
- 命名：npm 包统一 `@deepseek-ai/dsh-<name>`；ESM + `"type": "module"`；相对本地 import 用 `.ts` 后缀。

### 配置字段的合法性来源

`config:` 块能设哪些字段、默认值是什么，以生成的 [config-catalog.md](docs/config-catalog.md) 为准（逐个逐字列出，含 JSDoc）。新行为放文档化扩展点而非改 agent-loop（见 [architecture.md](docs/architecture.md)）。

### Capability seam（新增能力时）

一个可替换能力 = **Service Definition + Service Provider + Consumer 三件套**（Consumer 常是模型可见工具）。新增能力应三者齐备；单一角色 ≠ seam。一个 provider 替换即可带动整个产品层面的行为迁移。

---

## 3. 安装 / 卸载 / 激活 / 停用

正确操作单位是 **profile**（`$DSH_HOME/profiles/<name>`，`$DSH_HOME` 默认 `~/.dsh`）。管理入口是 CLI 转发器，详见 [CLI 参考](apps/cli/reference/README.md) 与 [app-boot Profiles](packages/boot/app-boot/README.md#profiles)。

### 命令总览

```sh
# 安装（首次自动初始化 profile；自动把声明 dsh.bundle 的包加入图层栈）
dsh plugin --profile <name> add <package-or-git-spec>
# 卸载（自动从图层栈移除）
dsh plugin --profile <name> remove <package>
# 更新（新版若获得 dsh.bundle 声明则自动激活为图层）
dsh plugin --profile <name> update
# 启动
dsh --profile <name>
```

- `dsh plugin` 转发给 pnpm（cwd = profile 目录）：`add` / `remove` / `why` / `update` 等 pnpm 动词原样可用，pnpm 在 PATH 上。
- 相对路径 spec（`.`、`../plugin`、`file:` / `link:` 形式）会先锚定到**调用目录**，所以 `add .` 可把当前 checkout 装进去。
- 每次成功后自动 reconcile `dsh.profile.bundles`：依赖解析到声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的包即加入图层栈（激活其 patch 层）；依赖被移除则离开。`update` 会激活新版新增的 bundle 声明。
- git 托管插件：pnpm ≥10 对 `prepare`（构建）脚本默认拦截，首次 `add` 会失败并给 `allowBuilds` 提示；把 pnpm 打印的关键字加入 profile 的 `pnpm-workspace.yaml` 再重跑即可。

### 激活（activate）

**没有独立的 activate 命令**——激活是自动的：entry 只要 `disabled` 不为真、且其 `inject` 声明的服务都可用，Loader 就装载并把 fiber 推进到 ACTIVE。对 bundle 而言，激活 = 被列为 profile 的 `dsh.profile.bundles` 图层栈（由 `add` / `update` 自动维护）。浏览器侧另有 GUI：`packages/client/ui-settings-plugins` 与 `ui-settings-plugin-inventory`。

### 停用 / 再启用（disable / enable）

- **entry 级**：把该 entry 设 `disabled: true`——保留 entry、跳过挂载；翻回 `false` 则（连同所有 PENDING 在它服务上的插件）重新加载（[tutorial ch.6](docs/cordis-tutorial/06-composition-and-hmr.md)）。
- **Loader 在每次挂载决策时插值 `disabled` 字段**，故可写 `!!js` 表达式做按环境启用 / 禁用（例：`disabled: !!js process.platform === 'win32'`）。
- **图层 / 整栈**：从 `dsh.profile.bundles` 移除（=卸载）；或在某 patch 层把该 row `disabled: true` 保留数据但不挂载。

### Layered composition（patch 机制）

树在一个空根上按层应用，**后来者按 row 覆盖**；id-定向 patch **整体替换**该 row 的 `config`（不做深合并）或 `insert` 新 row。

```
各 bundle 图层（dsh.profile.bundles 顺序）
  → profile 的 cordis.patch.yml
  → home 的 $DSH_HOME/cordis.patch.yml（机器级，高于 per-profile）
  → --patch <file> overlay
```

- 用 `dsh --profile <name> --dump-config` / `--dump-default-config` 查看最终树，不必启动（见 [CLI 参考](apps/cli/reference/README.md)）。

---

## 4. 相关文档索引

| 主题 | 入口 |
|---|---|
| 架构总览与扩展点 | [docs/architecture.md](docs/architecture.md) |
| Cordis 五概念 / dispatch / waterfall | [docs/cordis-primer.md](docs/cordis-primer.md) |
| 教程（插件→效松量→事件→服务→HMR） | [docs/cordis-tutorial/](docs/cordis-tutorial/index.md) |
| profile 组成与分层 | [packages/boot/app-boot/README.md](packages/boot/app-boot/README.md) |
| 配置字段（逐字合法值） | [docs/config-catalog.md](docs/config-catalog.md) |
| CLI 行为参考（安装/卸载/图层） | [apps/cli/reference/README.md](apps/cli/reference/README.md) |
| 扩展 cookbook（加插件/工具/LLM适配器/聊天节点） | [docs/cookbook/](docs/cookbook/extension-cookbook.md) |
| 新增包规范与模型体验 | [docs/cookbook/adding-a-package.md](docs/cookbook/adding-a-package.md) |
| 测试政策（含 HMR-safety） | [docs/testing.md](docs/testing.md) |
| 运行时自省工具（cordis_inspect 等） | [packages/extensions/tool-cordis/README.md](packages/extensions/tool-cordis/README.md) |

## 5. 开发流程提示

- 改任何 `packages/` 前读 [architecture.md](docs/architecture.md)；非平凡改动须在同一个 PR 内附 Agent Note（见 [.agents/notes](.agents/notes/README.md)）。
- 贡献务必走注册表 API（拿 disposer），并带 HMR-safety 测试；可选项设置要能在 `cordis.yml` 改（不要写死 tunable）。
- 运行中可用 `cordis_inspect` 自省服务、fiber、已注册工具；`tool-cordis` 的动态包仅存于进程内存，不视为正式安装，保留实验需走常规插件开发流程。
