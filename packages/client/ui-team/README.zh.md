# dsh-client-ui-team

[English](README.md) | 中文

DeepSeek Harness 团队插件的 Web 团队配置与状态呈现界面。

## 角色

团队插件的浏览器端 UI 插件。在设置面板中添加 Team 设置区块，展示 teammate 配置与使用说明；并在领导者会话中注册一个持久的团队面板 Chat 节点：由 `team/progress` 事件折叠出的任务进度看板，加上来自 subagent 目录的 teammate 状态行。

## 插槽注册

| 目标插槽 | 类别 | 内容 |
|---|---|---|
| `settings.section` | list/root | 包含 teammate 列表和设置说明的 Team 配置区块 |
| `conversation.chat.node` | keyed/session，key `team-panel` | 团队面板：任务进度看板与 teammate 状态行；当会话日志中出现 `team/progress` 事件或 `delegate_to_teammate` 工具调用后渲染 |

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
