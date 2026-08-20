# Agent Note: Shipped `team` Preset and the Two Team Mount Surfaces

Status: implemented

[English](2026-08-19-shipped-team-preset.md) | 中文

## 问题

agent team 各包此前只以 opt-in 的 `dsh-bundle-team` 宿主补丁形式发布，没有任何 shipped 挂载点：web 与 headless 的 profile 模板都不含 team 行，shipped agent preset 名册（`apps/cli/config/agent-presets/`）没有 team 条目，2026-08-18 审计将其记为欠账（S11）。标准部署的用户只能通过在 `$DSH_HOME/.agent-presets/` 下手写 preset 才能使用 team 模式。

## 决策

第三轮决策 D6 定下平面：team 模式以 **preset** 形式 shipped，而不是进 profile 模板；bundle 保留为 opt-in 的宿主平面入口。

- 新增 shipped preset `apps/cli/config/agent-presets/team/`：近完整复制 `standard`，persona 将根 agent 称为 team leader，末尾追加 `agent team` 组。该组携带 `isolate` realm（`team`、`teamControl`），provider 行与全部消费者都在其内，因此 standing mount 拥有唯一的注册表与协调器，preset 上的所有会话通过 scope 父级共享。teammate 所运行的 `subagents` 注册表仍在宿主平面，经 `ctx.get` 解析——与 preset 的 delegation 组完全一致。
- 名册顺序：`team` 在 shipped 集合中声明 `order: 2`（standard、team、code、minimal、cordis），完整 agent 排在前面，其后的槽位顺延一位。
- Web 选择器的内置文案表（`dsh-client-ui-agent-preset` locales）新增 `presetTeamName`/`presetTeamDescription`；中文文案与 preset 的 `preset.yml` 保持一致。
- `dsh-bundle-team` 行为不变；其 README 现在写明两个挂载面以及部署为何二选一。

开发实例下用户自制的 preset（`C:\Users\user\.dsh-dev\.agent-presets\team\`）是本文件所依据的已验证组合。

## 考虑过的替代方案

- **把 team 行放进 `PROFILE_TEMPLATES`（宿主平面 profile 模板）**：拒绝。模板面发布到 root realm：preset 挂载若不带 realm，会在同一 realm 中二次注册同名服务而抛错；带 realm 则两套注册表分叉——宿主读者解析 profile 的一份，preset 的 agent 解析自己的那份。team 服务在 agent 平面之外没有消费者，preset realm 才是正确归属，`PROFILE_TEMPLATES` 保持不动。
- **把 `team` 排在 `cordis` 之后**：拒绝，让 shipped 集合按能力阅读；`team` 与 `standard` 同为完整 agent，应排在一起。

## 后果

- 每个标准部署中，team 模式只差一次 preset 选择。名册、平面隔离与挂载测试将其固化：`web-agent-presets.e2e.ts` 断言精确的 team 工具目录，并确认 `team`/`teamControl` 对宿主不可见；`verify-cordis-config` 检查 preset 行与宿主组合的隔离。
- web 与 headless 的 profile 组合不变；bundle 仍是无 preset 名册的自定义 profile 的宿主平面入口。
- 同时安装两个面的部署会运行两套独立注册表（宿主 root realm 与 preset realm）；preset 的 agent 解析自己的那份，宿主侧的行保持惰性。
