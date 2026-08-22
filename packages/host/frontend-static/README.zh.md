# `@deepseek-ai/dsh-host-frontend-static`

[English](README.md) | 中文

Web 壳的 SPA dist 服务器：一个函数插件（配置为 `{distIndex}`），占据 [webserver](../webserver/README.zh.md) 的唯一回退席位，并以显式的 index 入口点服务已构建的前端目录。在 `distIndex` 可读期间，dist 根目录与已配置的 index 路径都以 HTTP 200 渲染 `index.html`；其他已存在的文件直接提供。dist 根目录内不存在或非文件的对象（包括缺失的已配置 index）返回空 404；越出 dist 根目录的遍历返回 403，未知扩展名按 `application/octet-stream` 提供，GET／HEAD 之外的方法在没有匹配的具名路由时返回 405。每个成功的 index 响应都经过 webserver 的 `renderIndex` 渲染——先是结构化注入行，再是原始 index taps——启动 manifest 就是经此送达页面的。`distIndex` 是组合应用的组装事实：[`dsh-web-app`](../../bundle/web-app/README.zh.md) 通过前端包的 exports 解析它并挂载本插件；部署绝不硬编码它。

回退席位只有单一所有者（第二次占据会抛错），并受 effect 作用域约束：dispose（资源释放）插件的 fiber 会释放席位，此后无人占据的 webserver 回答 404。

## 模型体验

无。该包只服务浏览器资产；其中没有任何内容会进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

- **初始 MIME 表很精简**：它覆盖 Vite 输出的资产集合及实际交付的 PWA manifest；其他扩展名在相应资产类别实际发布前都会回退到 `application/octet-stream`。
- **路径名路由是显式的**：当前客户端通过根或已配置的 index 路径进入，没有 History API 路径名路由；新增一条需要显式的服务器规则与真实组合覆盖，而不是对所有未命中做宽泛回退。
