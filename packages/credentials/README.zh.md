# credentials/：凭据引用与授权

[English](README.md) | 中文

凭据能力家族将引用解析与提供方分离，并将两者与通过询问获取凭据的行为分开：

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`credentials/`](credentials/README.zh.md) | 凭据引用与凭据记录 seam | `ctx.credentials` |
| [`credentials-local/`](credentials-local/README.zh.md) | 环境与本地文件提供方 | 注册 `ctx.credentials` |
| [`authorization/`](authorization/README.zh.md) | 插件拥有的通过询问人类获取凭据的流程 | `ctx.authorization` |

配置携带引用而非机密值。消费方在其操作边界解析这些引用；变更、优先级与存储语义由子级 README 负责。授权流程写入一条凭据记录并以该记录作为键，因此两个 seam 仅在记录处交汇，别无他处。

子系统参考——`CredentialRef`、按操作解析、对 UI 安全的 `CredentialInfo`、提供方层——见 [docs/subsystems/credentials.md](../../docs/subsystems/credentials.zh.md)。
