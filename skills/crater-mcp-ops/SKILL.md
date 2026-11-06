---
name: crater-mcp-ops
version: 1.1.0
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

> 在 DeepSeek Harness 里工具名带服务器前缀：`mcp__crater__crater_jobs_list`。
> 下文统一写裸名 `crater_jobs_list`，实际调用时按宿主的命名规则加前缀。

## 0. 开场三件事

1. 先确认身份与所在账号队列：`crater_auth_whoami`（返回 userId / accountId / rolePlatform / 空间名）。
2. 提交任何作业前先看配额与占用：`crater_profile_quota`、`crater_resources_list`。
3. 需要判断平台支持什么：`crater_auth_mode`、`crater_context_attributes`；CLI 与后端是否同版本用
   `crater_cli_read {args:["compatibility","-p","<平台地址>"]}`。

**永远不要把密码、token、`crater_jobs_get_token` / `crater_jobs_get_secret` 的输出贴进对话。**
需要入口凭据时只说"已获取"，不要把值复述出来。

## 1. 路由表

| 用户意图 | 首选工具 | 备注 |
| --- | --- | --- |
| 我是谁 / 我在哪个账号队列 | `crater_auth_whoami` | 也返回 rolePlatform，判断能否用 admin 工具 |
| 我的账号列表 / 切换项目队列 | `crater_profile_accounts`、`crater_auth_switch_account` | |
| 我的配额、能开多少卡 | `crater_profile_quota` | 提交前必看 |
| 平台有哪些 GPU/CPU 型号、单价 | `crater_resources_list`、`crater_resources_prices` | |
| 列作业 / 看详情 / 看日志 | `crater_jobs_list`、`crater_jobs_get`、`crater_jobs_logs` | `:name` 传 **jobName**（`vsc-...-abcde`），不是中文显示名 |
| 作业 YAML / 事件 / Pod | `crater_jobs_yaml`、`crater_jobs_events`、`crater_jobs_pods` | Pod 容器级细节再走 `crater_cli_read {args:["pod","containers",...]}` |
| 停止作业 | `crater_jobs_stop` | 运行中作业会被终止；重要产物先 `crater_jobs_snapshot` |
| 提交作业 | `crater_jobs_create_webide` / `crater_jobs_create_jupyter` / `crater_jobs_create_training` / `crater_jobs_create_pytorch` / `crater_jobs_create_tensorflow` | 需要模板先 `crater_jobs_templates`、`crater_jobs_template_get` |
| 提交前资源预检 | `crater_jobs_resource_limit_check` | 避免"创建即失败" |
| 作业计费 | `crater_jobs_billing`、`crater_jobs_billing_detail` | |
| 传文件 / 建目录 / 移动 / 删除 | `crater_files_upload`、`crater_files_mkdir`、`crater_files_move`、`crater_files_delete` | 受 `CRATER_WORK_DIR` 沙箱限制；路径用逻辑路径 `user/...` |
| 列远端目录 | `crater_files_list`、`crater_files_my_space`、`crater_files_account_space` | |
| 存储用量 | `crater_files_usage` | CLI 没有对应命令 |
| 写权限预检 | `crater_files_permission` | |
| 列镜像 / 看构建记录 | `crater_images_list`、`crater_images_available`、`crater_images_kaniko_list`、`crater_images_kaniko_detail` | |
| 构建镜像 | `crater_images_build_kaniko` / `crater_images_build_dockerfile` / `crater_images_build_envd` | 取消用 `crater_images_kaniko_cancel` |
| 镜像分享 / 删除 / 改标签 | `crater_images_share`、`crater_images_unshare`、`crater_images_delete`、`crater_images_update_tags` | |
| 数据集增删改查与分享 | `crater_datasets_*` | CLI 的 `dataset` 只读，写操作只有 MCP 有 |
| 节点 / GPU 状态 | `crater_nodes_list`、`crater_nodes_get`、`crater_nodes_gpu`、`crater_nodes_pods` | 这是平台侧视图，不是 kubectl |
| 统计概览 | `crater_stats_overview`、`crater_stats_mine` | |
| **下载 HuggingFace / ModelScope 模型** | `crater_cli_write {args:["download","model","<名字>","--source","hf","--wait"]}` | CLI 独有能力；token 用 `--token-env`，别用 `--token` |
| 看下载任务 | `crater_cli_read {args:["download","ls"]}` / `["download","logs","<id>"]` | |
| **审批工单**（提交/改/撤销） | `crater_cli_write {args:["order","submit",...]}` / `["order","cancel",...]` | 管理员审批：`crater_admin_approvals_*` 或 `["admin","order","approve",...]` |
| 镜像授权、CUDA 基础镜像、Harbor 配额 | `crater_cli_read {args:["image","share","ls",...]}` / `["image","cuda","ls"]` / `["image","quota","get"]` | MCP 侧有部分对应：`crater_images_cuda_base`、`crater_images_quota`、`crater_images_harbor` |
| 管理员：用户/账号/配额/系统配置 | `crater_admin_users_*`、`crater_admin_accounts_*`、`crater_admin_queue_quotas_*`、`crater_admin_system_*` | 需 `rolePlatform=3` 且 `CRATER_ALLOW_ADMIN=true` |
| 管理员：节点标签/污点/排水 | `crater_admin_nodes_*` | 破坏性操作，先复述目标节点 |
| 管理员：运维清理与锁时 | `crater_admin_ops_*` | 也可 `crater_cli_write {args:["admin","job","clean",...]}` |
| 管理员：全量作业与统计 | `crater_admin_jobs_all`、`crater_admin_statistics` | 非管理员会被守卫拒绝 |

## 2. 作业的四条最容易踩的坑

1. **name vs jobName**：`crater_jobs_list` 返回里 `name` 是中文显示名、`jobName` 才是 k8s 名。所有 `:name` 参数都要传 `jobName`；传中文名会得到 `HTTP 500 record not found`。
2. **提交前查配额**：GPU/CPU/内存不够会被调度器拒绝，先 `crater_profile_quota`（或 `crater_jobs_resource_limit_check`）再创建。
3. **停止 ≠ 删除干净**：`crater_jobs_stop` 终止运行；需要保留环境就先 `crater_jobs_snapshot` 存成镜像。
4. **镜像必须带架构**：提交作业时 `--arch`/架构参数要与构建产物一致，否则 Pod 起不来。

## 3. 什么时候该走 CLI 透传

- 命令只在 CLI 里：`download`（模型/数据集下载任务）、`order`（审批）、`pod`（容器与 ingress 诊断）、`compatibility`。
- 不确定命令怎么拼：先 `crater_cli_read {args:["job","--help"]}` 探路，`--help` 一律放行。
- 想用 CLI 的成熟实现（例如下载任务的 `--wait` 轮询、`--token-env` 凭据通道）。

不要用来做：登录（`auth login` 被拦）、拿凭据（`job token|secret|ssh`、`image harbor credential` 被拦）、
传文件（`file upload|download` 被拦，请用 `crater_files_*`）。

## 4. 失败时怎么读错误

| 现象 | 含义 | 下一步 |
| --- | --- | --- |
| `不是管理员（rolePlatform=…）` | 当前账号没有管理端权限 | 换管理员账号；或改走用户侧工具 |
| `当前 MCP 处于只读模式` | 服务端 `CRATER_READ_ONLY=true` | 让用户改 MCP 配置后重启 |
| `属于写操作，但 CRATER_ALLOW_CLI_WRITE 未开启` | 该 CLI 命令是写操作 | 开 `CRATER_ALLOW_CLI_WRITE=true`，或改用 MCP 强类型工具 |
| `不在本 MCP 的命令白名单里` | 命令拼错 / 未收录 | `args:["<命令>","--help"]` 探路 |
| `ERR_API_VERSION_MISMATCH` | 平台后端比 CLI 老（本平台实测后端 API v1 < CLI 要求 v3） | 基础命令仍可用；新命令失败时降 CLI 版本或改用 MCP 工具 |
| `ERR_MISSING_REQUIRED_FLAG` | CLI 参数不全 | 看 stderr 用法提示，补齐 `--namespace` 等 |
| `HTTP 500 record not found` | 名字传错（常见是传了中文显示名） | 换成 `jobName` |
| `HTTP 401 / token 过期` | MCP 会用配置里的账号重新登录；CLI 需用户在自己终端 `crater auth login` | 不要让用户把密码贴给你 |

## 5. 安全边界（不要绕过）

- 所有操作都以**用户自己的 Crater 身份**执行；权限与网页端一致。
- 非管理员会被拦在 `/api/v1/admin/**`、以及后端未做归属校验的"宽接口"（全平台作业列表、任意用户作业、任意 Pod 日志/终端）之外。
- 文件读写只在 `CRATER_WORK_DIR` 沙箱内；CLI 的 `file upload/download` 已被禁用，避免绕过。
- 破坏性操作（停止作业、删镜像、删数据集、删文件、节点排水、封禁用户）执行前先向用户复述目标对象。
