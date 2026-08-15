# 理解与开发 DeepSeek Harness：面向物理/数值方法背景的学习路线

本文件的读者定位：电子加速器方向博士生，熟悉物理与数值方法，但对软件开发、Agent 工程没有系统背景。
目标是：(1) 理解 dsh 的设计理念与建构模式；(2) 获得一条能真正上手"进一步开发"的可执行路线。

---

## 一、设计理念 —— 用你的学科语言先建立直觉

下面先给一条"物理学家视角"的总纲，再用后面的文档要点逐条对证。建议你带着这些直觉去读 [architecture.md](docs/architecture.md)。

### 0. 一句话：dsh 是一个"一切皆插件" 的 agent 运行时

在代码库里反复出现的第一原则是 **everything is a plugin**（[README.md](README.md)、[architecture.md](docs/architecture.md)）：

> 没有需要打补丁的"特权核心"。模型适配器、工具注册表、会话日志、甚至 agent 主循环本身都是插件。
> 你通过"在旁边挂一个插件"来扩展 dsh，而不是去改主循环。

**用你的学科类比**：把 agent 运行时想成一条束流线（beamline）。Cordis 是那条真空气路/支持结构——它本身不"做物理"，只负责把各个元件（偾磁铁、加速腔、诊断元件、靶……）稳定地串起来，并允许你随时"插入一个元件"或"换掉一个元件"，而不必把整条线拆了重焊。dsh 里的"元件"就是**插件**。

### 1. 核心隐喻：Context（上下文）＝ 一个按名字寻址的"控制室"

- 每个插件都能拿到一个 `ctx`（context）。`ctx` 是一个**服务仓库（repository of services）**。
- 一个服务占住一个稳定的 `ctx.<key>`，例如 `ctx.tools`（工具）、`ctx.llm`（模型）、`ctx.sessions`（会话）。
- 别的插件**不 import 具体实现**，而是通过 `ctx.<key>` 找到服务。→ 这就是"依赖倒置"：谁提供不重要，用什么接口才重要。

**类比**：`ctx` 像加速器控制室墙上的一排仪表/接口（"工具面板"、"电源接口"……）。你要用某个设备，就去找那个接口，而不是去拆开特定的设备型号。这样把某一个设备换成另一个牌子，控制室其余部分完全不用改。

### 2. 依赖声明 `inject` ＝ 声明"前置条件"

一个插件想用 `ctx.tools`，就在 `inject: ['tools']` 里声明。框架会**等这个服务存在了才加载该插件**。

**类比**：像你在写一个数值算法时声明输入参数——"这个例程需要先有 mesh 和 initial condition"。加载顺序由依赖关系自动决定，而不是靠手工排先后顺序（避免"哪个先启动"的脆性）。

### 3. 事件（Events）＝ 可监听、可拦截的"触发信号"

服务之间通过**类型化事件**通信，而不是直接函数耦合。事件有几种派发模式：

| 模式 | 特性 |
|---|---|
| `emit` | 广播，监听者只观察，无返回值 |
| `waterfall` | 按注册顺序，可"截断"或改写后传给下一个（这是策略层的关键） |
| `parallel` | 并行监听 |
| `serial` | 按顺序监听，有返回值 |

**类比**：像加速器里的触发/采集信号。你可以"旁路监听"（observe）某个信号而不干扰它（`emit`），也可以"拦下来改写再放行"（`waterfall`，用于权限/策略），还可以"并行订阅"多路信号。事件就是 dsh 的**扩展点（extension points）**。

### 4. 注册就是可逆效应（reversible effects）："用完即拆"

插件通过 `ctx.effect()` / `ctx.on()` 注册的一切（提示段、工具 schema、适配器、监听器）都可以在卸载时自动撤销。这带来了**热重载（HMR）**：改插件 → 卸载旧的 → 挂新的，不需要重启。

**类比**：像你在每步数值计算里保证"分配的数组/句柄在结束时一定释放"。清理是可预测的、成对出现的。

### 5. 会话日志 = 唯一事实来源："模型可见的 ⟺ 被记录的"

- dsh 会保持一个**只追加（append-only）的会话事件日志**，是模型所见上下文的来源。
- 铁律：**凡是进入模型请求的东西，必须能从日志重建**（model-visible ⟺ logged）。
- Fork、恢复、回放、遥测、持久化，全部从这个流派生。

**类比**：像你的实验**数据流/事件记录（data stream）才是 ground truth**。界面、模型提示词、标题、统计都是从这条记录"投影"出来的，而不是各自记一套。保证可复现、可回放。

### 6. 循环层级：turn / step / round

- **step**：一次模型请求 + 它调用的工具。
- **turn**：一次输入被吞掉到"不再欠任何东西"之间，包含 0..N 个 step。
- **round**：外层策略的一次迭代（例如一次目标续跑、一次 fresh-agent 尝试），属于某个策略，不数每一次 turn。

**类比**：像"一次粒子推进循环（PIC 的一次迭代 = a turn）"包含若干子步（a step），外层还有一个"宏迭代"（round）用来做自适应/收敛策略。层级清晰、边界明确。

### 7. 能力接缝（capability seam）＝ 服务定义/提供者/使用者 三角

一个可替换的能力叫**seam**，固定由三个角色组成：

- **Service Definition**：声明接口（Cordis 的一个 `Service`，占有 `ctx.<key>`）。
- **Service Provider**：实现该接口。
- **Consumer**：使用它（常是面对模型的工具）。

**类比**：像"一个标准化的实验接口（如通用的束流监控协议）"。定义接口是一回事（Definition），提供厂家实现是另一回事（Provider），用它的诊断是第三回事（Consumer）。三者解耦，所以**换一个 Provider 就能让整个产品跟着变**（例如把本地文件/子进程换成远端沙箱，bash、PTY、LSP 一起跟着走）。

---

## 二、文档要点（代码库里的"权威答案"在哪）

你不需要一次读完，先记住"每个概念有一个家（one home per fact）"，按需去查：

| 想了解 | 读哪份文档 |
|---|---|
| 总架构、主循环、扩展点地图 | [docs/architecture.md](docs/architecture.md)（改 `packages/` 前必读） |
| Cordis 五句概念速览 | [docs/cordis-primer.md](docs/cordis-primer.md) |
| 术语表（seam、scope、goal、turn/step/round…） | [docs/glossary.md](docs/glossary.md) |
| 能力接缝完整图（每个服务由谁定义/实现/消费） | [docs/capability-seams.md](docs/capability-seams.md) |
| 每个子系统的类型定义与 API | [docs/subsystems/README.md](docs/subsystems/README.md) |
| 上手工程化（依赖、命令、CI、项目布局） | [docs/development.md](docs/development.md) |
| 防御性模式（生命周期/并发/子进程/清理） | [docs/defensive-patterns.md](docs/defensive-patterns.md) |
| 给 agent/开发者看的"制度性约定" | [AGENTS.md](AGENTS.md)（根）及其子树版本 |
| 如何加一个工具/包/LLM 适配器/对话节点 | [docs/cookbook/adding-a-tool.md](docs/cookbook/adding-a-tool.md) 等 |

注意：大部分核心文档有[中文对照版](docs/architecture.zh.md)（同目录下 `.zh.md` 文件），对你降低阅读门槛很有帮助，尤其是 [cordis-primer.zh.md](docs/cordis-primer.zh.md)。

---

## 三、学习路线（分阶段，附"为什么这么排"）

考虑到你**没有系统软件工程背景，但数值方法功底扎实**，路线的关键是把"编程基础"当作工具快速补齐，然后立即转入"动手写一个工具插件"——用做仿真/写数值代码的思维方式去理解 agent 工程。

### 阶段 0：概念定向（半天，纯读，不需要环境）
目标：建立上面的"物理直觉"，知道大图长什么样，不陷入细节。
- 读 [cordis-primer.md](docs/cordis-primer.md)（或中文版）——先建立五概念。
- 扫读 [glossary.md](docs/glossary.md)——遇到术语就来查。
- 通读 [architecture.md](docs/architecture.md)——主循环和扩展点地图。
- 结果检验：你能向别人讲清楚"为什么一切都是插件""turn/step/round 是什么""seam 三角色是什么"。

### 阶段 1：补齐最小编程地基（约 3–5 天，按需取用）
目标：你不需要成为 TypeScript 专家，但要能"读懂和改一个小插件"。以下按优先级：
- **JavaScript/TypeScript 最小集**：函数、对象、`async/await`（异步——你写代码/迭代时会反复遇到）、类型标注（`ctx: Context`）、`import`/`export` 模块化。教程 [docs/cordis-tutorial/index.md](docs/cordis-tutorial/index.md) 的 [TypeScript notes](docs/cordis-tutorial/index.md#typescript-notes) 把"做教程够用的语法"讲清了。
- **Node.js 是什么**：一个能在命令行跑 JS 的运行时；包管理器 `pnpm` 用来装依赖。知道 `pnpm install` / `pnpm dsh ...` 大概做什么即可。
- **建议**：先不要深入研究工程化细节（构建、测试门禁），那留到阶段性之后。你的目的是"亲手跑通一个能改的插件"。

### 阶段 2：跑 Cordis 教程（约 2–3 天，动手，无 API key）
目标：亲手写 7 章插件，理解"插件/上下文/服务/事件/配置/组合"。
- 按 [docs/cordis-tutorial/index.md](docs/cordis-tutorial/index.md) 从第 1 章走到第 7 章，每一章都是可运行示例（在 `tmp/cordis-tutorial/` 里，不需要 API key）。
- 这是衔接"概念"与"dsh 真实服务"的桥：第 7 章把插件接到真实 harness 服务。
- 结果检验：你能写出一个带 `inject`、注册一个事件监听、用一个 `ctx.<key>` 服务的小插件。

### 阶段 3：挂进 Web UI 的第一个插件（约 1–2 天）
目标：让"我写的插件"真的在 dsh 产品里跑起来。
- 走 [docs/user/develop/basic/index.md](docs/user/develop/basic/index.md)（你的第一个插件）与 [tool.md](docs/user/develop/basic/tool.md)（构建一个工具）。
- 这一步能看到插件如何用一行 `cordis.yml` 加进去、在 Web UI 里热加载。
- 结果检验：一个自定义工具出现在 `ctx.tools` 里，模型能调用它。

### 阶段 4：写第一个真正的"工具插件"（核心里程碑，约 3–5 天）
目标：掌握 dsh 扩展的主要形态之一——给模型加一个能力。
- 精读 [docs/cookbook/adding-a-tool.md](docs/cookbook/adding-a-tool.md)：工具定义 DSL、`execute` 契约、`defineTool`、UI 呈现意图、后台任务。
- 参考生产级范例 `packages/shell/tool-bash`（三包：seam 定义/实现/消费）和 `packages/fs/tool-fs`。
- **建议选题（贴合你背景）**：写一个"数值/物理计算工具"——例如一个暴算某个解析公式、做简单单位换算、或封装一个你熟悉的小例程的工具。这能把你的数值思维直接映射进来：`parameters` = 输入参数、`execute` = 核心函数、`output.render` = 结果呈现。
- 结果检验：工具通过全部契约（参数校验、规范返回值、`exec.signal`、UI 呈现）。这是"进一步开发"的基本功。

### 阶段 5：理解并做一个"能力接缝"（进阶，约 1 周）
目标：从"加一个工具"上升到"设计一类可替换能力"。
- 精读 [docs/capability-seams.md](docs/capability-seams.md) 与 [docs/glossary.md](docs/glossary.md#capability-seam)。
- 用 [docs/cookbook/adding-a-package.md](docs/cookbook/adding-a-package.md) 学会组织机构：一个包 = 一个 `@deepseek-ai/dsh-<name>` workspace。
- 拆解 `packages/shell`（`dsh-shell`=定义、`dsh-bash-local`=实现、`dsh-tool-bash`=消费）作为模板。
- 可选：做一个 LLM 适配器（[adding-an-llm-adapter.md](docs/cookbook/adding-an-llm-adapter.md)）感受"换 Provider 整个产品跟着变"。

### 阶段 6：真正参与这个仓库的开发（建议在你想贡献/深入时再做）
目标：理解 dsh 的"工程制度"，让你能提交合规的改动。
- 通读 [AGENTS.md](AGENTS.md)：约定了事件语义、品牌 id、错误处理、注释规范、测试/快照策略、文档分层（one home per fact）。
- 读 [docs/development.md](docs/development.md)：项目布局、日常命令、CI、TypeScript 双聚合布局。
- 读 [docs/defensive-patterns.md](docs/defensive-patterns.md)：在做生命周期/并发/子进程/清理类工作前必读。
- 先跑一条最小链路：改一个工具 → 更新其 README/JSDoc → 跑对应测试 → `pnpm run typecheck`。跟随 [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md) 选最小检查集。

---

## 四、给非软件背景者的几条心法

1. **别被工程化吓到。** 构建/门禁/CI 是"参与开源仓库"才需要的；前几个阶段你只需要 `pnpm install` + 一个示例目录 + 一个 `cordis.yml`。先用最小路径跑起来。
2. **把"写插件"当"写数值例程"。** 输入(schema/parameters)、核心计算(execute)、输出(canonical value + render)、资源清理(disposer/`exec.signal`)——这些你都熟。
3. **用"事件/信号"的直觉。** 需要"加一个功能"时，先问：这是新能力（→ 注册到 `ctx.tools`/某个 seam）还是"在某个环节上加策略"（→ 监听对应 `agent/*` 或 `tools/*` 事件）？[architecture.md](docs/architecture.md) 的[扩展点样例表](docs/architecture.md#where-new-behavior-goes)就是关键对照表。
4. **按需查文档，不要从头读到尾。** 每个概念有唯一"家"；看到不懂的术语就先翻 [glossary.md](docs/glossary.md)。
5. **中文文档是你的加速器。** 核心 docs 都有 `.zh.md` 对照；对照着读英文，既降低门槛又能积累术语的英文表达（以后读源码/PR 会用到）。

---

## 五、建议的最小动手路径速查

```text
阅读:  primer(.zh) → glossary → architecture
─────────────────────────────────────────────
动手:  …/cordis-tutorial/ 第1→7章           (无 key, tmp/ 目录)
─────────────────────────────────────────────
动手:  user/develop/basic: index.md → tool.md (挂进 Web UI)
─────────────────────────────────────────────
动手:  照 adding-a-tool.md 写一个"计算型工具"
─────────────────────────────────────────────
进阶:  capability-seams.md + adding-a-package.md
─────────────────────────────────────────────
贡献:  AGENTS.md + development.md + defensive-patterns.md
```

每完成一个阶段，检验该阶段末尾的"结果检验"条目；能自答即通过，不必追求一次读完所有文档。
