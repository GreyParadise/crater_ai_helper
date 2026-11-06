---
name: crater-mcp-ops
version: 1.0.0
description: 在 Crater 平台上用 crater-mcp（MCP 工具）与官方 crater CLI 协作完成作业、镜像、文件、数据集、审批与管理员操作。当用户要在 Crater 上提交/查看/停止作业、构建镜像、传文件、下载模型、查配额或做管理员操作时使用。先读本文件，再按路由表选择工具。
metadata:
  requires:
    bins: ["crater-mcp"]
  optional_bins: ["crater"]
---

# Crater 操作指引（MCP + 官方 CLI）

两套东西一起用，分工明确：

| 层 | 提供者 | 特点 | 什么时候用 |
| --- | --- | --- | --- |
| **MCP 强类型工具** | 本项目 `crater-mcp` | 参数有 schema、错误有中文提示、危险操作有注解、文件读写受沙箱约束 | 高频主路径：作业、镜像、文件、数据集、账号、管理员 |
| **官方 CLI 透传** | `crater_cli_read` / `crater_cli_write` | 一条字符串数组透传，覆盖 CLI 全部 100+ 子命令 | CLI 独有或 CLI 更好用的长尾：模型下载任务、审批工单、Pod 诊断、兼容性检查 |

铁律：**能走 MCP 强类型工具就不要走 CLI 透传**（参数校验和错误信息好得多）；CLI 只用来补缺口。

## 0. 开场三件事

1. 任一业务工具报「未登录 / 401」时：让用户检查 MCP 配置里的 `CRATER_USERNAME`/`CRATER_PASSWORD`，**不要**询问用户密码或 token 让你代填。
2. 需要确认身份与配额：`crater_context_whoami`、`crater_context_quota`、`crater_context_resources`。
3. 需要知道平台支持什么：`crater_context_*` 与 `crater_cli_read {args:["compatibility","-p","<平台地址>"]}`（CLI 与后端 API 版本是否匹配）。

**永远不要把密码、token、`crater job token` 的输出贴进对话。** `crater_cli_read` 已硬拒绝这些命令。

## 1. 路由表

| 用户意图 | 首选 | 备注 |
| --- | --- | --- |
| 我是谁 / 我在哪个账号队列 | `crater_context_whoami`、`crater_account_list` | |
| 我的配额、能开多少卡 | `crater_context_quota`、`crater_context_resources` | 提交前先看，避免创建即失败 |
| 列作业 / 看详情 / 看日志 / 停作业 | `crater_jobs_list`、`crater_jobs_get`、`crater_jobs_logs`、`crater_jobs_delete` | `:name` 传 **jobName**（`vsc-...-abcde`），不是中文显示名 |
| 提交作业（Jupyter / WebIDE / 自定义） | `crater_jobs_create_jupyter` / `create_webide` / `create_custom` | 需要模板时先 `crater_jobs_templates` |
| 作业诊断（pod、事件、YAML） | `crater_jobs_pods` / `crater_jobs_events` / `crater_jobs_yaml` | 想看容器级细节再上 `crater_cli_read {args:["pod","containers",...]}` |
| 传文件 / 建目录 / 移动 / 删除 | `crater_files_upload`、`crater_files_mkdir`、`crater_files_move`、`crater_files_delete` | 受 `CRATER_WORK_DIR` 沙箱限制 |
| 看存储用量 | `crater_files_usage` | CLI 没有对应命令 |
| 列镜像 / 构建镜像 / 分享 | `crater_images_*` | 构建用 `crater_images_build_kaniko` / `build_dockerfile` / `build_envd` |
| 镜像授权、CUDA 基础镜像、Harbor 配额 | `crater_cli_read {args:["image","share","ls",...]}` / `["image","cuda","ls"]` / `["image","quota","get"]` | MCP 侧没有强类型封装 |
| **下载 HuggingFace / ModelScope 模型** | `crater_cli_read`/`crater_cli_write` 的 `download model` | CLI 独有能力：`--source hf\|ms`、`--revision`、`--token-env`、`--wait` |
| **审批工单**（提交/改/撤销/审批） | `crater_cli_write {args:["order","submit",...]}` / `["order","cancel",...]` / 管理员 `["admin","order","approve",...]` | 长尾，MCP 未封装 |
| 数据集创建 / 分享 | `crater_datasets_*` | CLI 的 `dataset` 只读，写操作只有 MCP 有 |
| 节点 / GPU 资源 / 价格 | `crater_nodes_*`、`crater_resources_*` | `node pods` 需要 `--namespace` |
| 管理员：用户、账号、系统配置、配额 | `crater_admin_*`（77 个） | CLI 的管理端多为只读，改配置只有 MCP 有 |
| 管理员：作业清理锁、镜像批量删除 | `crater_admin_jobs_*` / `crater_admin_images_*` | 也可 `crater_cli_write {args:["admin","job","clean",...]}` |

## 2. 作业的三条最容易踩的坑

1. **name vs jobName**：`crater job ls` / `crater_jobs_list` 返回里 `name` 是中文显示名、`jobName` 才是 k8s 名。所有 `:name` 参数都要传 `jobName`；传中文名会得到 `HTTP 500 record not found`。
2. **提交前查配额**：GPU/CPU/内存不够会被调度器拒绝，先 `crater_context_quota` 再创建。
3. **删除是停止+清理**：`crater_jobs_delete` 对运行中作业是终止；重要产物先 `crater_jobs_snapshot`（快照成镜像）或确认文件已落 `user/` 卷。

## 3. 什么时候该走 CLI 透传

- 命令只在 CLI 里：`download`（模型/数据集下载任务）、`order`（审批）、`pod`（容器与 ingress 诊断）、`compatibility`、`image share/cuda/quota/harbor`。
- 不确定命令怎么拼：先 `crater_cli_read {args:["job","--help"]}` 探路，`--help` 一律放行。
- 想拿 CLI 的成熟实现（例如下载任务的 `--wait` 轮询、`--token-env` 凭据通道）。

不要用来做：登录（`auth login` 被拦）、拿凭据（`job token|secret|ssh`、`image harbor credential` 被拦）、传文件（`file upload|download` 被拦，请用 `crater_files_*`）。

## 4. 失败时怎么读错误

| 现象 | 含义 | 下一步 |
| --- | --- | --- |
| `不属于写操作…CRATER_ALLOW_CLI_WRITE 未开启` | 该 CLI 命令是写操作 | 让用户在 MCP 配置里开 `CRATER_ALLOW_CLI_WRITE=true`，或改用 MCP 强类型工具 |
| `不在本 MCP 的命令白名单里` | 命令拼错 / 未收录 | 用 `args:["<命令>","--help"]` 探路 |
| `ERR_API_VERSION_MISMATCH` | 平台后端比 CLI 老（本平台实测后端 API v1 < CLI 要求 v3） | 基础命令仍可用；新命令失败时建议降 CLI 版本，或改用 MCP 工具（MCP 是按本平台接口逐条验证的） |
| `ERR_MISSING_REQUIRED_FLAG` | CLI 参数不全 | 看 stderr 里的用法提示，补齐 `--namespace` 等必填项 |
| `HTTP 500 record not found` | 名字传错（常见是传了中文显示名） | 换成 `jobName` |
| `HTTP 401 / token 过期` | MCP 用 `CRATER_USERNAME` 重新登录；CLI 需用户在自己终端 `crater auth login` | 不要让用户把密码贴给你 |

## 5. 安全边界（不要绕过）

- 所有操作都以**用户自己的 Crater 身份**执行；权限与网页端一致。
- 非管理员会被拦在 `/api/v1/admin/**`、以及后端未做归属校验的"宽接口"（全平台作业列表、任意用户作业、任意 Pod 日志/终端）之外。
- 文件读写只在 `CRATER_WORK_DIR` 沙箱内；CLI 的 `file upload/download` 已被禁用，避免绕过。
- 破坏性操作（删除作业、删镜像、删数据集、删文件）执行前先向用户复述目标对象。
