# 与官方 crater CLI 的分工（CLI 桥接）

本 MCP 有两层能力：**180 个强类型工具** 与 **官方 CLI 透传**（`crater_cli_read` / `crater_cli_write`）。
本文说明为什么这样分工、白名单怎么定、以及什么场景该走哪条路。

## 1. 为什么要接官方 CLI

| | 强类型工具（每接口一条 ToolSpec） | CLI 透传（1 条工具吃 100+ 子命令） |
| --- | --- | --- |
| schema 开销 | 每条 200~600 token | 2 条工具，合计约 600 token |
| 参数校验 | zod schema，agent 看得懂 | 只有 `args: string[]` |
| 错误提示 | 中文 + 分域 hint | CLI 的结构化错误码 + 本层 hint |
| 覆盖面 | 只有我们写过的那 180 个接口 | 官方 CLI 全部命令（含我们没封装的） |
| 版本漂移 | 后端接口变了要改 `ToolSpec` | CLI 升级即自动获得新命令 |

结论：**高频主路径用强类型工具，长尾用 CLI 透传**。这也是把官方 "CLI + Skills" 与我们 "MCP 强约束"两种主张拼起来的做法——
MCP 负责"限制在账号权限内、不碰底层"，CLI 负责"覆盖面与官方跟进速度"。

## 2. 配置

```bash
# 官方 CLI 可执行文件；不填则用 PATH 上的 crater / crater.exe
CRATER_CLI_PATH=C:\Users\Administrator\AppData\Roaming\npm\crater.exe

# 是否放行 CLI 的写命令（默认 false，只放行只读）
CRATER_ALLOW_CLI_WRITE=true
```

安装：

```bash
npm install --global @raids-lab/crater-cli     # Windows 官方标注 experimental
crater auth login -p http://172.16.16.140 -u <你的账号>   # 只需一次，凭据存在本机
crater compatibility -p http://172.16.16.140   # 检查 CLI 与后端 API 版本是否匹配
```

**注意**：CLI 用的是它自己的登录态（`auth login`），与本 MCP 的 `CRATER_USERNAME/PASSWORD` 是两套。
MCP 永远不会代你执行 `auth login`，也不会读取 CLI 保存的凭据。

## 3. 只读白名单（`crater_cli_read` 默认放行）

按 argv 的"命令路径前缀"匹配（flag 不参与匹配）。`--help` 一律放行。

| 模块 | 允许的命令 |
| --- | --- |
| account | `ls` `current` `get` `members` `users-out` `billing` |
| auth | `ls` |
| billing | `status` `summary` `jobs` `job` `prices` |
| compatibility | （无子命令） |
| context | `quota` `resources` `billing` |
| dataset | `ls` `get` `users` `users-out` `queues` `queues-out` |
| download | `ls` `get` `logs` |
| file | `ls` |
| image | `ls` `cuda ls` `build ls\|get\|template\|pod` `quota get` `share ls\|users\|accounts` `harbor info` `valid` |
| job | `ls` `get` `pods` `events` `yaml` `template` `logs` |
| model-download | `ls` `get` `logs` |
| node | `ls` `get` `gpu` `pods` |
| order | `ls` `get` `by-name` |
| pod | `containers` `events` `ingresses` `logs` `nodeports` |
| resource | `ls` `networks` `prices` `vgpu` |
| template | `ls` `get` |
| user | `get` |
| admin（只读子集） | `user ls\|billing`、`account ls\|get\|members\|quota\|users-out\|billing`、`job ls`、`image ls\|build-ls`、`dataset ls`、`resource vgpu\|networks`、`queue-quotas`、`cronjobs`、`gpu-analyses`、`system-config llm\|gpu-analysis`、`whitelist`、`billing jobs\|status`、`order ls\|get` |

额外兜底：只读前缀之后若出现变更动词（`add` `delete` `remove` `set` `update` `create` `rm` `mv` `upload`
`approve` `reject` `cancel` `clean` `lock` `unlock` `keep` `snapshot` `alert` `edit` `submit` `pause`
`resume` `retry` `build` `install` `uninstall` `switch` `login` `logout` `public`），一律按写操作处理。

## 4. 写白名单（还需 `CRATER_ALLOW_CLI_WRITE=true`）

`download create|model|dataset|pause|resume|retry|rm`、`order submit|edit|cancel`、
`job create|delete|alert|snapshot`、`image build pip-apt|dockerfile|envd|remove`、
`image share add|remove`、`image delete|upload|tags|type|arch|quota`、`file mkdir|mv|rm`、
`admin job delete|lock|unlock|keep|clean`、`admin image delete-many|description|public|tags|type|arch|cuda add|delete`、
`admin order approve|reject|check`。

## 5. 硬拒绝（写模式也不放行）

| 命令 | 原因 |
| --- | --- |
| `auth login` / `logout` / `switch` / `rm` | 改动本地 CLI 凭据状态；登录应在终端完成 |
| `job token` / `job secret` / `job ssh` | 凭据或交互式会话，会污染上下文 |
| `image harbor credential` | 返回 Harbor 明文账号密码 |
| `file upload` / `file download` | 绕过 `CRATER_WORK_DIR` 沙箱，请用 `crater_files_*` |
| `completion install` / `uninstall` | 修改本机 shell 配置 |
| `config language` | 修改本地 CLI 配置 |
| 参数含 `--password` / `--token` / `--token-stdin` | 敏感值会留在对话历史；改用 `--token-env` |

## 6. 实现要点

`src/cli.ts`：

- **不经 shell**：`spawn(binary, argv, { shell: false })`，参数逐个传递，杜绝命令注入（`"job ls; rm -rf /"` 会因为第二段不等于 `ls` 而被拒）。
- 自动补 `--json --no-interactive`，避免 agent 卡在交互提示或拿到彩色表格。
- 输出优先解析 JSON；非 JSON 时回传截断后的 stdout/stderr。
- 超时默认 60s（`timeoutMs` 可调，上限 600s），输出上限 1 MB。
- 退出码 / `cliCode` / `hint` 一起返回，`ERR_API_VERSION_MISMATCH` 会额外提示"后端版本偏旧、可降 CLI 版本"。

## 7. 本平台实测（2026-11-06）

CLI `1.4.1 (build 8232a99)`，平台 `http://172.16.16.140`：

- 可用：`job ls|get|pods|logs`、`image ls|build ls|quota get|cuda ls`、`order ls`、`admin queue-quotas`、
  `admin image ls`、`admin account ls`、`dataset ls`、`template ls`、`node get|gpu`、`resource prices`、`billing summary`、`compatibility`。
- **版本偏旧**：`crater compatibility` 报 `ERR_API_VERSION_MISMATCH` —— 后端 API `v1` < CLI 最低要求 `v3`，
  `status: backend_maybe_too_old`。基础读写正常，但新命令可能因契约差异失败。
- `crater job get <中文显示名>` 会 `HTTP 500 record not found`，必须传 `jobName`（本 MCP 的 `crater_jobs_*` 会自动回退解析）。
