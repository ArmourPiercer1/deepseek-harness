# dsh-client-ui-team

[English](README.md) | 中文

DeepSeek Harness 团队插件的 Web 团队配置与状态呈现界面。

## 角色

浏览器端 UI 插件，向设置面板添加一个 Team 设置区块，展示 teammate 配置与使用说明。

## 插槽注册

| 目标插槽 | 类别 | 内容 |
|---|---|---|
| `settings.section` | list/root | 包含 teammate 列表和设置说明的 Team 配置区块 |

## 模型体验

无，因为该包是浏览器端 UI 插件，不注册任何面向模型的内容。

#### KV Cache 影响

无影响。

## 已知限制与暂缓事项

- MVP 阶段设置区块为只读；行内编辑 teammate 定义暂缓。
- 会话级团队状态 dock 栏与切换按钮推迟到后续工作。
- 针对团队事件（委托、消息、进度）的对话节点渲染暂缓。
