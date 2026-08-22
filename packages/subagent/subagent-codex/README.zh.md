# @deepseek-ai/dsh-subagent-codex

[English](README.md) | 中文

本包注册一个以 Profile 命名的 Codex subagent 提供方，其默认名称为 `codex`。每次接受运行请求后，它都会在发起委托的会话工作区中，以 `app-server --stdio` 启动官方包内 Codex wrapper，创建一个临时 Codex 线程，提交一个自包含的文本任务，并通过共享的 [`dsh-subagent`](../subagent/README.zh.md) 结果约定返回选定的最终答案或一个独立的安全失败诊断。

## 启动与所有权

`start(request)` 只接受非空的文本块序列，并根据父会话确定子级 cwd。随后，它通过 [`dsh-subprocess`](../../subprocess/subprocess/README.zh.md) spawn 固定命令，依次执行 `initialize` → `initialized`，把 Profile 所选模式映射到官方 `thread/start` 的审批/审查者/沙箱字段并与 `{ cwd, ephemeral: true }` 并列，且仅在 Codex 返回有效的临时线程后才发布此次运行。若在发布前发生失败或取消，它会关闭通信链路、终止受管进程树并等待其退出，然后拒绝 `start()` 调用。非取消的拒绝只暴露固定的 `initialize` 或 `thread-start` 阶段以及已观察到的进程结果；原始产品与 Host 错误仍保留在内部因果链上。

已发布的 `run.result` 恰好启动一个轮次。它只接受与此次运行的线程和轮次匹配的通知，随后等待权威的终止通知 `turn/completed`。以最后一条 `phase: "final_answer"` 的 `agentMessage` 为准；若 Codex 没有发出明确的最终阶段，则以最后一条 `phase: null` 的消息作为兼容性回退。过程说明绝不会取代上述任一答案；成功完成的轮次若没有非空白答案，结果也会判为错误。

对于命令与文件审批，无人值守的提供方会从请求给出的决策选项中选择一项不予批准的决策，并优先选择 `cancel`；稳定的 0.147.0 请求形态没有决策选项列表，因此回退到 `decline`。它对权限请求返回作用域限于当前轮次的空权限集，不向用户输入请求提供任何答案，并拒绝 MCP elicitation。若请求在无人值守模式下没有合法响应，或是未知服务器请求，此次运行就会失败。通信链路只记录生效的模式、请求类别、决策与固定的安全原因。它还识别被拒绝的命令/文件项与 `sandboxError` 终态。Codex 0.147.0 会把一些早期的 `never` 拒绝与沙箱违规仅写入结构化 stderr，因此 Provider 会接管 stderr、原样转发给宿主，并在每轮运行有界的尾部中匹配两个固定签名；原始 stderr 绝不会进入诊断。

本地取消会在结果竞态中胜出并映射为 `aborted`。对于失败轮次，诊断会保留 Codex 0.147.0 `codexErrorInfo` 联合体中的全部十一种字符串变体与五种对象变体；当提供了数值时，四种连接/流变体会保留数值型 `httpStatusCode`，而 `activeTurnNotSteerable` 不暴露 `turnKind`。诊断还会指明 `turn-start`、`turn` 或 `process`，独立地包含可用的退出码与信号，并对无法识别或格式错误的值使用 `unknown`，而不复制原始字段。`contextWindowExceeded` 仍为 `max-tokens`；其他任何远端中断或失败仍为 `error`，且该提供方不会产生 `refusal`。造成影响的权限决策跟随结构化失败行之后。成功运行与本地取消运行省略这两个事实。

`dispose()` 是幂等的：如果当前的两个标识符均已知，它会尽力请求 `turn/interrupt`，关闭 JSON-RPC 通信链路，结束标准输入，调用共享的进程树终止升级机制，等待整棵进程树退出，并分离 stderr 观察者。独立的清理拒绝使用固定的 `teardown` 阶段与任何可用的进程结果。当启动与回滚都失败时，顶层聚合消息会保留两条安全阶段行，而原始失败仍保留在内部。

## 能力与上下文

本提供方不声明任何可选的启动时能力，并报告 `inheritsParentContext: false`。Codex 会接收独立文本任务和父会话 cwd，但不会接收父会话的对话、角色设定、工具筛选器、深度策略或结构化输出约定。临时 Codex 线程 ID 与轮次 ID 仅在此次运行内部可见，绝不会持久化到父会话。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `codex` | `ctx.subagents` 上非空的注册名；每个挂载的实例需要唯一的值。 |
| `env` | `{}` | 显式指定的子进程环境，叠加在由子进程 seam 清除凭证后的父环境之上。 |
| `permissionMode` | `never` | 由本 Provider 实例为每个线程固定的原生非交互审批与沙箱模式。 |
| `disposeGraceMs` | `3000` | 共享进程树责任方各终止层级之间的宽限期，单位为毫秒且须为正有限值，并不得大于仓库共享的 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.zh.md)；随后资源释放会等待整棵进程树退出。 |

| `permissionMode` 值 | `thread/start` 字段 | 原生行为 |
|---|---|---|
| `never` | `approvalPolicy: never`，sandbox 省略 | 从不请求审批；执行失败在原生沙箱下返回给模型。 |
| `approve-for-me` | `approvalPolicy: on-request`、`approvalsReviewer: auto_review`、`sandbox: workspace-write` | 通过 Codex 自动审查路由权限请求，无需人工介入。 |
| `dangerously-bypass-approvals-and-sandbox` | `approvalPolicy: never`、`sandbox: danger-full-access` | 跳过审批与沙箱强制；该值必须显式选择。 |

生产环境会解析其锁定的 `@openai/codex@0.147.0` 依赖所声明的 `codex` bin，并使用当前的 Node 可执行文件启动该 JavaScript wrapper。wrapper 会选择匹配的原生平台载荷；提供方既不检查也不回退到 `PATH` 上的宿主机 `codex`。原生 Codex 配置与身份验证通过父 cwd、`HOME` 和 `CODEX_HOME` 保持权威地位，而 Provider 只覆盖所选线程的审批/审查者/沙箱字段。其余所有项目、模型、提供方、MCP、hook、skill 与账户设置均保持原生。该插件不选择模型、不创建 `CODEX_HOME`、不执行登录，也不探测账户。具有凭证特征的环境变量会在应用显式 `env` 叠加之前被子进程 seam 移除。

本包是一个可选的 Profile Bundle。将其安装到目标 Profile，然后重启该 Profile；安装会把官方 wrapper 和一个兼容的原生平台载荷带入该 Profile，而声明的 `cordis.patch.yml` 层只注册处于休眠状态的 `codex` Host 提供方，不启动任何 Codex 进程。移除该包会在下次 Profile 启动时收回该提供方及其私有运行时闭包。

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-codex
dsh --profile <name>
```

安装控制的是 Host 可用性，而非模型权限。Bundle 提供处于休眠状态的默认 `codex` 行；Profile 可以替换该行的完整配置，也可以挂载使用不同 `providerName`、`permissionMode` 和 `env` 值的额外行。加载实例不会在绑定的工具调用之前启动 Codex 进程。每个 `dsh-tool-subagent` 行命名一个提供方并需要自己的 `toolName`，因此模型看到的是静态工具而不是动态提供方选择器。完整 Agent Preset 携带一条对应的默认产品工具行并设置 `disabled: true`；复制一个 preset 并删除该字段，即可只向由该副本组装的 agent 暴露 `subagent_codex`。其 `one-shot` 策略会让省略 `run_in_background` 或传入 `false` 的调用继续在前台等待，而显式传入 `true` 会返回由父级拥有的 Job id，供 `job_output` 或 `job_kill` 使用。base host 与完整 preset 已提供通用作业注册表和控制工具。

下列独立组装展示完整的显式能力。基于 `@deepseek-ai/dsh-base` 的 Profile 保留已有 Job 行，只新增产品提供方行并启用 preset 工具行，禁止重复挂载 Job 服务。

```yaml
- id: subagent-codex-safe
  name: '@deepseek-ai/dsh-subagent-codex'
  config:
    providerName: codex-safe
    permissionMode: never
    env:
      OPENAI_API_KEY: !!js process.env.OPENAI_API_KEY

- id: subagent-codex-bypass
  name: '@deepseek-ai/dsh-subagent-codex'
  config:
    providerName: codex-bypass
    permissionMode: dangerously-bypass-approvals-and-sandbox
    env:
      OPENAI_API_KEY: !!js process.env.OPENAI_API_KEY
```

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: tool-subagent-codex-safe
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: codex-safe
    toolName: subagent_codex_safe
    backgroundMode: one-shot
    maxDepth: provider-managed

- id: tool-subagent-codex-bypass
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: codex-bypass
    toolName: subagent_codex_bypass
    backgroundMode: one-shot
    maxDepth: provider-managed
```

## 产品兼容性与证据

生产环境的协议层有意只实现这一单次执行约定所需的 app-server 方法。运行时依赖与全部六个可选依赖别名都锁定在 `@openai/codex@0.147.0` / `codex-cli 0.147.0`。常规安装会为当前 OS 与 CPU 选择一个载荷。就当前 darwin-arm64 载荷而言，`npm pack --dry-run --json @openai/codex@0.147.0-darwin-arm64` 报告打包字节数 111,199,052、解包字节数 274,777,843。该包包含原生 `codex`、`codex-code-mode-host`、`rg` 和 `zsh` 资源；其他平台可能不同，这些数值属于信息披露而非安装门槛。

生成的 schema 证据与包测试锁定全部十六种 error-info 变体、HTTP 状态位置、六个生命周期阶段、进程结果、stop-reason 映射、`unknown` 回退、净化、权限排序、取消、并发与清理聚合。无密钥的真实产品测试以 loopback Responses 桩驱动包内 wrapper，并观察包内 argv、精确的 Bearer 密钥、原始任务、字节级精确的最终答案、线程级 `never` 覆盖环境中的 `on-request`、自动审查启动、无文件副作用的无人值守拒绝、一次真实的 `internalServerError`、在套件自有的临时存储中进行显式 dangerous-bypass 写入、带安全退出事实的进程/协议失败，以及 wrapper/原生的静默状态。同一层级的测试还证明两个命名实例保留了相互分离的环境与原生模式。

在安装时省略可选依赖、使用不支持的平台或丢失所选载荷时，首次委托会在 `initialize` 处以安全的 `unknown` 类别和任何已观察到的进程结果而失败。原始 wrapper 文本仍保留在 Host stderr 上；提供方既不会探测宿主机 CLI，也不会用 CLI 重试。独立的 wrapper 桩单独证明了原生载荷失败以及没有宿主机回退。

## 模型体验

### 子级请求

#### 模型看到的内容

Codex 子级会在一个全新的临时线程中，以单个轮次接收这些独立文本块。它的工作区是父会话 cwd；其模型、系统指令、工具与身份验证来自原生 Codex 配置，所选 Provider 实例的 Profile 配置则固定该线程的环境、非交互审批策略与沙箱模式，可执行版本则来自 Bundle 锁定的平台载荷。

#### 对 token 的影响

子级需为独立的 Codex 上下文和轮次承担 token 开销。子级 token 不会进入父级上下文。

#### 对 KV Cache 的影响

这与父请求缓存相互独立。能否复用只取决于 Codex 自身的提供方、模型、指令、工具和临时线程请求。

### 父级调度与结果（间接）

#### 模型看到的内容

通过 `dsh-tool-subagent`，前台调用会让父级模型看到选定的 Codex 最终答案，或者在结果未完成时看到一个包含 stop reason 与可选安全诊断的错误。该诊断可以在不复制产品文案的情况下区分固定的 error-info 类别、协议阶段、数值型 HTTP 状态与观察到的进程结果。后台调用会先返回 Job id；随后通用作业控制面会送达完成通知，通过 `job_output` 公开同样的最终答案或失败状态详情，并允许 `job_kill` 请求取消。Codex 的过程说明、推理（reasoning）、工具活动、原始 stderr、工作区差异、用量信息、产品标识符、命令、路径与协议载荷均不会复制到父会话。

#### 对 token 的影响

前台输入会增加工具结果中保留的最终答案或错误内容。后台输入还会包含启动确认、完成通知，以及 `job_output`、`job_kill` 或后续状态结果；子任务 token 仍不会进入父级上下文。本提供方自身不添加父级工具 schema。

#### 对 KV Cache 的影响

仅追加：前台会在可复用的父请求前缀后增加一个结果，后台则会继续追加 Job 启动确认、通知以及后续控制或收集结果。后台调度可能增加一个由通知唤醒的轮次，但这些消息都不会改写更早的前缀。

## 已知限制与后续工作

- **每次运行均新建一个进程、一个线程和一个轮次**：不支持续接、恢复、池化、进度流或产品会话持久化。
- **静态实例选择**：Profile 行固定提供方名称与工具绑定；调用无法动态选择提供方，且每个暴露的工具都需要唯一的 `toolName`。
- **身份验证与账户状态保持原生**：Bundle 提供 CLI，但不创建账户、不登录、不信任项目、不改写 Codex 配置；配置与身份验证失败会带着其生命周期阶段和安全的 `unknown` 回退呈现，而不是单独公开的分类法。
- **委托时必须有原生平台载荷**：省略可选依赖的安装、不支持的平台以及缺失或损坏的载荷都会在首次运行时失败；没有宿主机 CLI 回退。
- **兼容性由开发证据锁定**：若要从已验证的 0.147.0 协议基线升级，必须重新生成上游 schema 证据，并重新运行握手、答案选择、审批、取消、无密钥真实产品以及带密钥的 DeepSeek 随机数测试。
- **没有人工审批路径**：已知的无人值守审批请求会被拒绝，未知服务器请求会以默认拒绝方式使运行失败；三种 Profile 模式绝不会创建 DSH 交互通道或按调用的允许策略。
- **助手载荷仅包含最终文本**：失败运行还可额外暴露独立的安全诊断；推理、过程说明、中间消息、工具通信、用量信息、原始 stderr 和工作区差异仍保留在父会话之外，而通用 Job id、通知与状态来自共享作业运行时。
- **没有可选的共享能力**：对于本提供方，共享服务会拒绝输出 schema、子任务角色设定、工具筛选和 harness 深度强制约束。
- **没有按实际经过时间触发的超时或副作用回滚**：长时间运行的工作由调用方取消，且取消前已更改的文件或外部系统不会恢复原状。
