# Agent Note: 工作区插件开发指南

Status: implemented

[English](2026-08-14-plugin-development-guide-reference.md) | 中文

## 问题

本工作区专门用于开发一系列 DeepSeek Harness 插件。插件作者上手时，反复从零散来源推导同一批事实：插件的运行时稳定性要求、标准插件接口，以及如何安装、卸载、激活、停用插件。此前没有一个集中的地方为插件作者收集这些内容，也没有任何持久记录指明这样一份指南所在。

## 决策

[`PLUGIN_DEV_GUIDE.md`](../../../../PLUGIN_DEV_GUIDE.md) 是工作区根目录下的插件开发常驻参考。它以当前状态陈述记录四个部分：dsh 对插件的稳定性/性能要求、标准插件接口（function plugin 的导出形态与 `cordis.yml` entry 契约）、通过 `dsh plugin --profile` 及分层 `cordis.patch.yml` 组合实施的安装/卸载/激活/停用，以及一份文档索引和简短开发流程小节。每条事实都以相对 markdown 链接指向其权威归属（`docs/architecture.md`、`docs/cordis-primer.md`、`docs/cordis-tutorial/`、`packages/boot/app-boot/README.md`、`docs/config-catalog.md`、`apps/cli/reference/README.md`、`docs/testing.md`、`packages/extensions/tool-cordis/README.md`，以及根/`packages` 的 AGENTS.md），使指南始终是一幅可导航的地图，而不是一个与之竞争的权威。

该指南是指针与定位产物，并非新的事实来源。精确契约以其中的链接为准，而非其中的文字；正文刻意保持精简，避免重复其所链接的归属内容。指向该指南的工作区记忆指针即是本 Agent Note（一条可供日后插件开发会话通过 `.agents/notes` 树找到的决策记录）。

## 曾考虑的替代方案

- **把这份总结写进现有 `docs/` 树。** 不予采纳：该指南是面向本工作区的定位性总结，而非 dsh 的正式文档；放入 `docs/` 会与 doc-tier 和 doc-budget 门禁纠缠。置于工作区根目录可明确其作者面向性质。
- **只在 `docs/` 持久化，不写 Agent Note。** 不予采纳：请求明确要求把文件链接持久化到记忆中，方便日后插件开发会话查找；`.agents/notes` 下的 Agent Note 正是仓库的持久记忆机制，且指南以相对链接指向它，可机械校验。

## 后果

- 插件开发在工作区有一个稳定入口，并有一条跨会话存续的持久记录可供日后参考。
- 若不持续维护，指南可能与上游文档脱节；由于它只链接（并简要概括）各个权威归属，漂移是有界的，且 `verify-md-links` 会强制其链接可解析。
- 工作区现在多了一份根级文档；保持精简并基于链接，尽量压低它对文档预算门禁的额外负担。
