# @deepseek-ai/dsh-session-persistence-sqlite

[English](README.md) | 中文

可选启用的 SQLite `SessionPersistence` 提供方。它把符合条件的 `assistant/chunk` 运行段存入打包的物理行，对大 payload 选择性做 Zstandard 压缩，并对溯源序列做增量编码，同时精确恢复逻辑 `SessionEvent[]`。出厂组合不选择它；部署必须显式挂载本包并提供数据库路径。

`locate(meta)` 返回 `undefined`，因为所有会话共享一个数据库。该提供方不暴露逐会话原始产物。

## 存储模型

Schema 17 保持普通 ROWID 表和复合 `events(session_id, seq)` 主键索引。标量行存储一个逻辑事件。打包行使用 `text-chunks`、`reasoning-chunks` 或 `tool-call-chunks` 作为物理 `type`；`seq` 和 `time` 标识首个被表示的事件，`data` 保存共享的打包块 payload。打包行把 `ignorable=0` 作为物理判别位，并保持 `source_event_seqs` 与 `surface_op` 为 `NULL`；标量行仅在逻辑可忽略事件上使用 `ignorable=1`，其余为 `NULL`。因此未来的可忽略逻辑事件可以复用存储标签名而不被解码成打包行。这些标签是存储记录，不是 `SessionEventMap` 成员。

Schema 17 在本地拥有自己的编解码器，而不是导入另一个持久化格式的可变实现。只有精确、连续且同块的 text、reasoning 或 tool-call delta 形态会被打包。未知字段、surface 元数据、序列缺口、不兼容的块/调用身份以及不安全的时间戳保持标量。一个打包行最多表示 1,024 个事件和最多 1 MiB 未压缩 UTF-8 `data`；更长的运行段在不改变逻辑事件的前提下分区存储。读取在把数据交还持久化协调方之前重建每个原始序列号、时间戳、token 边界、参数片段和 payload。

序列化后小于 4 KiB 的 `data` 保持为 SQLite `TEXT`。达到或超过该阈值时，写入方使用 Zstandard level 3，且只有当压缩帧小于原文时才存储 `BLOB`；读取方在 UTF-8 验证和 JSON 解析之前先解压。`source_event_seqs` 保持完整的有序溯源数组。它的第一个序列号是无符号 varint，之后每个序列号是用 ZigZag varint 编码的有符号差值，整体存为 `BLOB`；不省略任何源，也不转换为范围。

每次 append 持有 `BEGIN IMMEDIATE`，验证有界的物理尾部，只打包新的持久化批次，插入相应记录，并只递增一次会话修订。正常 append 从不删除或替换更早的事件行。因此默认 200 ms 写延迟窗口能在压缩高频流的同时，让物理写入量保持与新持久化批次成正比，而不是反复重写不断增长的打包值。存储级逻辑尾部检查在变更前拒绝过期写入方。

完整读取按首个逻辑序列号顺序扫描物理行。反向遍历找到最后一个有效 `turn/end`，而无需保留每个物理行的解码副本；正向遍历一次解码并验证一个物理行，填入返回的逻辑事件数组。`readFrom(id, fromSeq)` 只在最大行跨度内检查打包前驱行，并把后缀锚定在最早可能包含 `fromSeq` 的行上；这包括从打包行内部开始的事件范围，能检测重叠的物理损坏，且不会解析无关的更早标量行。损坏的打包行是全有或全无：已提交的损坏被拒绝，而撕裂的最终行在变更恢复期间从其物理基础删除。修复在写锁下重读尾部，并在删除任何内容前拒绝过期标记。超出 schema 字节上限的打包 `data` 在 JSON 解析之前被拒绝。

## Schema 兼容性

全新数据库直接以 schema 17 初始化。旧 schema、外部应用标识、非 pristine 的无版本数据库以及不兼容的 schema 对象都会被拒绝；该未发布提供方不提供迁移。每条语句和固定 pragma 都位于打包的 `.sql` 资源中；值使用 SQLite 参数，运行时代码从不组装查询文本。

## 配置（schemastery）

```ts
interface Config {
  path: string
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'
  busyTimeoutMs?: number
  preparedSessionCacheSize?: number
  writeBatchMaxDelayMs?: number
}
```

`journalMode` 默认为 `wal`，`busyTimeoutMs` 默认为 `5,000`，`preparedSessionCacheSize` 默认为 `5`，`writeBatchMaxDelayMs` 默认为 `200`。该超时限制每次同步 SQLite 锁等待。由于 SQLite 在变更 journal 模式时可能立即返回 `SQLITE_BUSY`，冷启动在尝试之间让出，并在相对于打开时刻的重试截止之后不再发起尝试。进行中的同步 SQLite 调用可能在那之后完成。该提供方在每个连接上禁用受信 schema 和内存映射 I/O，然后把两个设置都读回。选定的 journal 模式也会被读回且必须匹配；内存数据库显式接受 SQLite 的 `memory` 结果。选定 journal 之后，提供方固定 `synchronous=FULL` 并验证它，使 SQLite 构建默认值无法削弱已提交追加的持久性。在 POSIX 上，数据库父目录和文件必须由当前用户拥有，父目录不得组/其他可写，文件不得有组/其他权限；符号链接和非常规文件被拒绝。Windows 同样拒绝符号链接和非常规文件，但部署仍需负责把目录和文件 ACL 限制为 harness 用户。路径和所有权失败会拒绝插件初始化。Node SQLite 在第一次持久化操作时延迟加载；该 import 只抑制 Node 22 的精确 SQLite `ExperimentalWarning`。存储标识和 schema 失败会在数据被暴露或变更前拒绝该操作。

## 模型体验

### 恢复的对话历史

#### 模型看到的内容

与 SQLite 本身无关。恢复还原与 JSONL 相同的逻辑事件和派生消息；物理打包标签不会到达提示词、工具、重放或实时 `session/event` 传递。

#### Token 影响

零实时请求 token。恢复只为保留的逻辑历史和当前请求 envelope 付费。

#### KV Cache 影响

物理打包不修改请求前缀。提供方缓存重用与任何其他持久化后端一样，只取决于重建的历史、当前 envelope 和模型路由。

## 已知限制与暂缓事项

- **临时性的 SQLite 特定设计** — 这个效率优先的实现参考了 [morlay/session-persistence-rdb](https://github.com/morlay/session-persistence-rdb)。统一的多后端关系数据库设计和可配置 schema 被暂缓；未发布开发期间不保证 schema 稳定性或迁移支持。
- **打包跟随持久化批次边界** — 被写延迟窗口或显式 flush 切分的兼容运行段保持为独立的物理记录；这避免了重写之前行的代价，但打包率取决于时序。
- **同步压缩** — Node 的 SQLite 和 Zstandard 调用会阻塞 JavaScript 线程；4 KiB 阈值限制了小记录的单帧工作量。
- **`DatabaseSync` 阻塞事件循环** — 物理行数量减少并不会让 SQLite 操作变成异步。
- **busy 等待阻塞事件循环** — SQLite 等待发生在同步 `DatabaseSync` 调用内部；只有 busy journal 模式转换会在尝试之间让出，且相对于打开时刻的截止是阻止另一次尝试，而不是中断进行中的调用。
- **外部 SQL 读取方必须理解物理标签** — 受支持的读取方通过本提供方读取，而不是把每个 `events.type` 当作逻辑事件类型。
- **无删除或后台历史压缩** — 正常 append 是仅插入的。
