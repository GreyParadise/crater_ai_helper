# 装进 DeepSeek Harness（DSH）

DSH 用 `@deepseek-ai/dsh-mcp-client` 插件接外部 MCP 服务器：**每台服务器一条配置记录**，
工具以 `mcp__<serverName>__<tool>` 出现在模型工具列表里。本文记录本项目的实际安装方式。

## 1. 配置文件在哪

| 项 | 路径 |
| --- | --- |
| 启用的 profile | `C:\Users\<你>\.dsh\profiles\desktop`（桌面版启动参数里写死） |
| 要改的文件 | `profiles\desktop\cordis.patch.yml`（**用户补丁层**，在 bundle 之后应用） |
| 不要改 | `profiles\desktop\cordis.yml`（空根，加载器自己维护） |

DSH 启动命令里的 profile 路径可以确认当前用的是哪个 profile：

```
"...\DeepSeek Harness.exe" --expose-internals ...\dsh-desktop-host\lib\index.js ... C:\Users\<你>\.dsh\profiles\desktop ...
```

## 2. 加一条服务器记录

追加到 `cordis.patch.yml` 末尾（完整段落见文件里的注释）：

```yaml
- id: mcp-crater
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: crater              # 工具名前缀：mcp__crater__*
    transport: stdio
    command: 'C:\Program Files\nodejs\node.exe'
    args:
      - 'C:\Users\Administrator\Desktop\AI\k8s及插件\crater_ai_helper\dist\index.js'
    cwd: 'C:\Users\Administrator\Desktop\AI\k8s及插件\crater_ai_helper'
    toolCallTimeoutMs: 180000       # 作业创建/镜像构建慢，默认 60s 偏紧
    failOnStartupError: false       # 连不上也不要阻止 DSH 启动
    env:
      CRATER_ENV_FILE: '...\crater_ai_helper\.env'   # 凭据只在这里，写进 git 忽略的文件
      CRATER_TOOL_GROUPS: 'auth,profile,jobs,files,images,resources,stats,datasets,cli,feedback'
      CRATER_ALLOW_ADMIN: 'false'
      CRATER_READ_ONLY: 'false'
      CRATER_ENFORCE_SELF_SCOPE: 'true'
```

要点：

- **凭据不写进 DSH 配置**。`dsh-mcp-client` 会清洗环境变量，但本服务自己会从
  `CRATER_ENV_FILE` / `cwd/.env` / 仓库根 `.env` 读配置，所以 `cordis.patch.yml` 里不出现密码。
- `serverName` 必须匹配 `[A-Za-z0-9_-]{1,32}` 且在存活实例内唯一。
- `failOnStartupError: false`：连接失败时 DSH 照常启动，只是没有这批工具（并记一条错误）。

## 3. 生效方式

改完 `cordis.patch.yml` 需要**重启 DeepSeek Harness**（`cordis.patch.yml` 的 profile 配置热重载
在本机实测没有把新增行加载进来；重启最稳）。

重启后新会话里应有 100 个 `mcp__crater__*` 工具。验证一句话：

```
用 mcp__crater__crater_auth_whoami 看我现在是谁
```

预期返回 `userId / username / accountId / rolePlatform`。

## 4. 工具组与 token 预算

`CRATER_TOOL_GROUPS` 决定注入多少 schema。实测（`tools/list` 序列化后）：

| 配置 | 工具数 | schema | 估算 token |
| --- | --- | --- | --- |
| `auth,profile,jobs,files,images,resources,stats,datasets,cli,feedback`（当前默认，无 admin） | 103 | ≈124 KiB | 42k ~ 58k |
| 再加 `admin`（全开） | 180 | 193.8 KiB | 66k ~ 91k |
| 只 `cli`（官方 CLI 透传） | 2 | 3.2 KiB | ≈1k |

要开管理端：`CRATER_TOOL_GROUPS` 末尾加 `,admin`，并把 `CRATER_ALLOW_ADMIN` 改成 `'true'`。

## 5. 排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 重启后没有 `mcp__crater__*` 工具 | patch 行没被加载 / YAML 写坏 | 校验 YAML：`node -e "console.log(require('yaml').parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" <文件>`（在 `~/.dsh/profiles` 下跑，那里有 `yaml` 依赖） |
| 工具在但调用全失败 | 服务端连不上 Crater / 凭据错 | 先手动跑 `node dist/index.js --whoami`，能出 JSON 再回来看 DSH |
| 调用超时 | 作业创建、镜像构建耗时长 | 调大 `toolCallTimeoutMs` |
| `--check` 报工具定义问题 | 代码改坏了 | `node dist/index.js --check` |
| 想回退 | 备份文件 | `profiles\desktop\cordis.patch.yml.bak-<时间戳>` |

## 6. 本机实测记录（2026-11-06）

- DSH 桌面版当前 profile：`profiles\desktop`（由启动命令行参数确认）。
- 按第 2 节写入后，用**同样的命令 + 清洗后的环境**手工握手：按默认工具组约 103 个工具、`crater_auth_whoami` 可调，
  `mcp__crater__<name>` 命名符合预期。
- 运行中的 DSH 实例在改写配置文件后未自动加载新增行（仍为 199 个插件、无 `mcp-crater`），
  故结论为**需重启应用生效**。
- 备份：`cordis.patch.yml.bak-20261106-163707`。
