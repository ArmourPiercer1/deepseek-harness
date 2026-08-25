# dsh-client-ui-team

[English](README.md) | 中文

DeepSeek Harness 团队插件的 Web 团队配置与状态呈现界面。

## 角色

团队插件的浏览器端 UI 插件。在设置面板中添加 Team 设置区块，展示 teammate 配置与使用说明；在领导者会话中注册一个持久的团队面板 Chat 节点：由 `team/progress` 事件折叠出的任务进度看板，加上来自 subagent 目录的 teammate 状态行；并注册全局可见的「团队」会话视图标签页，数据来自只读的按 leader 键控团队镜像（`ctx.sessions.teams`；冻结团队性判定位于 runtime 的 `resolveTeamView`）。

## 插槽注册

| 目标插槽 | 类别 | 内容 |
|---|---|---|
| `settings.section` | list/root | 包含 teammate 列表和设置说明的 Team 配置区块 |
| `conversation.chat.node` | keyed/session，key `team-panel` | 团队面板：任务进度看板与 teammate 状态行；当会话日志中出现 `team/progress` 事件或 `delegate_to_teammate` 工具调用后渲染 |
| `conversation.view` | list/session，id `team`，order 20 | 团队标签页：非团队会话显示一行零态文案，团队会话在四段视图落地前显示占位内容 |

## 团队视图数据

标签页经其注册的 inject hooks 槽位读取 sessions 服务的团队镜像（`useTeamMirror`，按 leader 键控 `TeamView` 记录的只读选择钩子），并在标签页挂载且镜像缺席该会话时经 `ensureTeam`（单飞的 `team.projection` 一元调用）冷拉补齐。一个会话恰在它领导某个镜像视图、或任一镜像视图把它绑为成员（`members.sessionIds`）时才是团队会话；其余会话只渲染零态，不渲染任何其他结构。

## 队员状态语义

队员行是父会话中 `team:` 前缀标记的 continuable subagent 子会话。状态按行派生：子会话的 store 快照 activity 为 running 时显示运行中；已交接对应 inactive 且其名称出现在窗口内 `delegate_to_teammate` 目标中的队员；其余显示已绑定（已绑定基线，加载窗口内尚无委托）。目录 label 携带队员 name，而委托调用携带队员 id —— 二者是相互独立的 frontmatter 字段 —— 因此按 name 的关联是尽力而为的。

## 模型体验

无，因为该包是浏览器端 UI 插件，不注册任何面向模型的内容。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- MVP 阶段设置区块为只读；行内编辑 teammate 定义暂缓。
- 会话级团队状态 dock 栏与切换按钮推迟到后续工作。
- team/message 时间线（会话中按队员展开的消息行）暂缓；面板仅渲染进度看板与队员状态。
