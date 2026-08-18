# 运行实例边界（务必先读）

本机存在**两个独立的 DSH 实例**。它们的源码目录、`DSH_HOME`、端口全部不同。
在动任何文件、命令、进程之前，先确认你在哪一个实例上工作。

## 🔴 稳定版 —— 禁止改动

| 项 | 值 |
|---|---|
| 源码 | `D:\deepseek-harness` |
| `DSH_HOME` | `C:\Users\user\.dsh` |
| agent preset | `C:\Users\user\.dsh\.agent-presets\aieo-team\` |
| 端口 | **3080** |

**除非收到明确指令，不要碰这个实例的任何东西** —— 代码、配置、会话历史、日志、preset、teammate 定义、`node_modules`，一律不动。
不要在此实例上执行 `pnpm install`、`build`、`git` 写操作，或删除/改写 preset。
它是可用的参照系统；破坏它就失去了对照基准。

## 🟢 开发版 —— 可以改动

| 项 | 值 |
|---|---|
| 源码 | `D:\AgentDev\deepseek-harness` |
| `DSH_HOME` | `C:\Users\user\.dsh-dev` |
| agent preset | `C:\Users\user\.dsh-dev\.agent-presets\aieo-team\` |
| 端口 | **3180** |
| 启动脚本 | `start-dev.ps1`（位于开发版源码根目录） |

`start-dev.ps1` 启动的就是这一处实例：它把 `DSH_HOME` 设为 `C:\Users\user\.dsh-dev` 后运行 `pnpm dsh --profile web --port 3180`。
**所有开发、构建、测试、试运行验收都在此实例上进行。**

## 两处极易混淆的点

**1. `DSH_HOME` 是 preset 目录的父级，不是 preset 目录本身。**
`DSH_HOME=C:\Users\user\.dsh-dev`；preset 位于其下的 `.agent-presets\aieo-team\`。
`teammates\`、`profiles\`、`sessions\`、`settings.yaml` 同样挂在 `DSH_HOME` 下，不在 preset 目录内。

**2. 两处各有一份 `aieo-team` preset 拷贝，内容相同但周边数据不同。**
teammate 定义只存在于开发版（`C:\Users\user\.dsh-dev\teammates\`，13 个 `.md`）；
稳定版的 `teammates\` 为空。因此团队模式的试运行只有在开发版上才有意义。

## 判断当前实例的方法

```powershell
$env:DSH_HOME          # .dsh = 稳定版；.dsh-dev = 开发版
pwd                    # D:\deepseek-harness = 稳定版；D:\AgentDev\... = 开发版
```

浏览器地址栏的端口同样是判据：3080 稳定版，3180 开发版。
