# @deepseek-ai/dsh-client-modules

[English](README.md) | 中文

客户端模块系统：Node 内部 ESM loader 的浏览器端对等实现，以惰性 CJS 表实现。web 外壳挂载 vendored cordis Loader 来治理配置项（fiber 生命周期、inject 等待、update/refresh），并通过其 `internal` 约定注入该包的 `ClientModuleLoader`；vendored 一侧唯一的消费点是 `EntryTree.import`，因此替换 `internal` 恰好只会替换「插件代码如何到达」，不会改变其他内容。

惰性 CJS 模型（web2）：执行插件 bundle 只会注册其 factory（`window.__ModuleLoader__.load({id, factory})`）；每个模块主体的副作用（包括 CSS 注入）都位于 factory 闭包中，在物化时运行（`factory(require)` → 导出表层，并在 `loadCache` 中记忆化），不会在脚本执行时运行。如果 factory 依赖另一个已注册但尚未物化的模块，系统会递归物化它；图的组合把声明的动态请求排在其消费者之前，而 require 循环会抛出异常（factory 形式的 CJS 无法提供部分导出）。`<id>/client` 与裸 id 指向同一表层（一个插件 bundle 就是其包的客户端侧）。

Host 会在 parser 预加载运行之前安装 `window.__ModuleLoader__`。其队列模式的 `load()` 保留早期注册；`create()` 用一个拒绝外部请求的 bootstrap require 物化该包的 factory，并调用其 `createClientModuleSystem` 导出。构建把同一组导出缓存为 modules 行，把同一门面切换为实时注册，并排空剩余队列。bundle 在模块闭包中保留由此得到的系统，因此其后 Cordis `apply()` 无需另一个页面全局即可将同一实例提供为 `ctx.modules`。

解析分支顺序（`import(specifier)`）：平台种子词 → 外壳实例；记忆化记录 → 表层；模块图行（`window.__DSH_BOOT__`）→ 注册其 classic script factory；已注册 factory → 物化；其他情况一律抛出异常——这是构建时 bundle 纯度门禁的运行时镜像。交给 factory 的同步 `require` 按相同顺序遍历，但不含异步的模块图行加载，并把观察到的边记录到模块记录中。`prefetch` 是第一阶段到达钩子（只加载脚本并注册 factory；并发调用共享一个进行中的任务）；`invalidate` 会丢弃非 bootstrap factory 及其物化记录，使下一次 prefetch/import 重新加载脚本（HMR 钩子）。

Node 侧会扫描已启用的 Loader 配置项以发现 web `dsh.client` 包，解析每个 `exports["./client"]`，把构建后的 bundle 哈希写入启动图，携带各包特定的 `dsh.client.external` 请求，把动态提供者排在其消费者之前，并通过 `/plugins` 为每个 bundle 提供其 sourcemap。源码启动会把宿主侧导入映射到 TypeScript 源码，但仍消费这一构建后的客户端导出；缺失文件共享一条构建说明，随后以包／路径列表列出各项，而无关的文件系统错误仍是独立故障。

`dsh.client.external` 是在隐式基线之外可选的精确 specifier 请求列表：外壳播种的 React、Cordis、静态 UI 库，加上 parser 预加载的 runtime。请求由其所命名的动态包行或精确的静态表键应答；只有结尾的 `/client` 会别名到包行，不存在提供者别名声明。仅类型的导入会被擦除且不产生请求。组合会拒绝格式错误的请求、缺失的供应者、自请求和同步请求环；import 与 prefetch 会在消费者物化之前递归注册动态供应者。参见[共享模块与模块图](../AGENTS.md#shared-modules-and-the-module-graph)。

## 模型体验

无。模块 loader 属于浏览器侧内核机制；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **有意采用扁平模块图**：每个 bundle 是一个模块节点，其边只指向表中的叶节点；接口（`loadCache`/`edges`/`invalidate`）已经支持通用模块图，因此可以改变 externalization 粒度而不更改接口。
- **自身不维护卸载记录**：样式移除与 fiber 拆卸顺序属于 HMR 驱动器（`@deepseek-ai/dsh-client-hmr`）；loader 只在每条记录中登记其拥有的样式标签 id。
