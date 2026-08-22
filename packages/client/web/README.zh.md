# @deepseek-ai/dsh-client-web

[English](README.md) | 中文

Web 启动内核：`new AppWebEntry(el, seams?).run()` 通过两个阶段挂载客户端。模块阶段调用 Host 安装的 `window.__ModuleLoader__.create()`，传入 `window.__DSH_BOOT__`、外壳的静态模块和任何测试传输覆盖；facade 在采纳 parser 预加载的注册项后，返回构建出的模块系统与解析出的 manifest。随后本包预取 `immediately` 层级。插件阶段挂载仓库内置的 Cordis Loader，通过 Loader 的 `internal` 接口注入该模块系统，统一创建每个图 entry，并等待每个 fiber 变为 ACTIVE。随后它将带标记的启动 DOM 交给动态 UI 渲染器的 `ctx.uiRenderer.mount(el)` 操作；渲染器先 hydrate 该 DOM，再切换到完整 UI。Host 拥有图、parser 预加载和 facade；AppWebEntry 不知道引导包 id，也不解析 wire 格式。

启动页使用原生 DOM 和本地 CSS，因此客户端包与插件激活的失败都保持可见。其回退字体与颜色匹配加载期间到达的主题 token。fiber 更新保留一个 spinner 节点，并在条目首次激活时增长其 CSS 弧线；hydrate 保留该节点及其动画相位，直至应用提交。React 挂载、slot 渲染、应用组装和浏览器标题投影位于 [`ui-renderer`](../ui-renderer/README.zh.md)。modules 包缓存自身已物化的导出，并在其普通图 entry 激活时提供闭包捕获的系统；Cordis 服务等待使图行创建顺序独立于该激活。

`PLATFORM_MODULES`（src/platform.ts）是外壳种子的共享模块的唯一真源。它与 `PRELOADED_CLIENT_EXTERNALS` 一起为每个动态包定义隐式 external 基线；`dsh.client.external` 只添加精确的非基线请求。

可选的覆盖参数 `seams` 会为外部 `<script>` 执行无法到达页面上下文的环境转发模块系统的 `loadBundle` 传输覆盖（`BootSeams`）；普通浏览器调用方省略此参数。预注入的页面传输是优先于它的默认项：当 `globalThis.__DSH_TRANSPORT__`（connection 包的 `ClientTransportHooks`）携带 `loadBundle` 时，模块阶段采纳它作为 bundle 传输，并跳过 immediate 层级的 HTTP 预取——显式 `seams` 仍然优先。

## 模型体验

无。入口外壳负责启动浏览器插件树；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **应用等待完整名册** —— 一个失败入口会让不依赖框架的启动页保持可见，并附带逐入口报告；不支持部分 UI 可用。
