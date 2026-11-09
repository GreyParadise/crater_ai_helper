# Crater MCP 工具目录

> 自动生成（`scripts/gen-catalog.mjs`），共 **180** 个工具：只读 92 个，写 88 个（其中 destructive 29 个）。
> 每个工具都以调用者的 Crater JWT 身份请求后端，权限与网页端一致。

## 总览

| 域 | 工具数 | 写操作 | 说明 |
| --- | --- | --- | --- |
| `auth` | 6 | 4 | 登录、注册、身份确认、切换账号（项目）、token 续期 |
| `profile` | 7 | 3 | 资料完善、邮箱验证、账单摘要、配额占用 |
| `jobs` | 24 | 9 | 课程作业：创建（WebIDE/Jupyter/PyTorch/TF/自定义）、查询、日志、启停、入口凭据 |
| `images` | 25 | 14 | 镜像构建（kaniko/Dockerfile/envd）、查询、共享、删除 |
| `files` | 12 | 4 | 文件管理：列目录、上传、下载、删除、移动、建目录、用量 |
| `resources` | 12 | 0 | 资源型号、节点、单价、上下文与资源预检（只读） |
| `datasets` | 13 | 7 | 数据集创建、更新、删除、分享、成员 |
| `admin` | 77 | 45 | 管理端：用户、账号、资源、节点、系统配置、队列配额、运维、审批、GPU 分析 |
| `cli` | 2 | 1 | 官方 crater CLI 透传（只读 / 写两档，含模型下载、审批工单、Pod 诊断、兼容性检查） |
| `feedback` | 2 | 1 |  |

## destructive 工具（客户端应要求人类确认）

| 工具 | 接口 | 说明 |
| --- | --- | --- |
| `crater_jobs_stop` | `DELETE /api/v1/vcjobs/:name` | 停止 / 删除作业 |
| `crater_images_delete` | `POST /api/v1/images/deleteimage` | 批量删除我的镜像 |
| `crater_images_delete_one` | `DELETE /api/v1/images/image/:id` | 按 ID 删除单个镜像 |
| `crater_images_kaniko_cancel` | `POST /api/v1/images/remove` | 删除/取消构建任务记录 |
| `crater_files_delete` | `DELETE /api/ss/delete/*path` | 删除文件或目录（不可恢复） |
| `crater_files_move` | `POST /api/ss/move/*path` | 移动/重命名 |
| `crater_datasets_delete` | `DELETE /api/v1/dataset/delete/:id` | 删除数据集 |
| `crater_datasets_unshare_user` | `POST /api/v1/dataset/cancelshare/user` | 取消对某个用户的分享 |
| `crater_datasets_unshare_queue` | `POST /api/v1/dataset/cancelshare/queue` | 取消对某个账号的分享 |
| `crater_admin_users_ban` | `PUT /api/v1/admin/users/:name/ban` | 封禁 / 解封用户（能力项） |
| `crater_admin_accounts_member_remove` | `DELETE /api/v1/admin/accounts/:aid/:uid` | 把用户移出账号 |
| `crater_admin_accounts_billing_reset` | `POST /api/v1/admin/accounts/:aid/billing/reset` | 重置账号计费余额 |
| `crater_admin_resources_vgpu_unlink` | `DELETE /api/v1/admin/resources/:id/vgpu/:vgpuId` | 解除 GPU↔vGPU 关联 |
| `crater_admin_resources_networks_unlink` | `DELETE /api/v1/admin/resources/:id/networks/:networkId` | 解除 GPU↔RDMA 网络关联 |
| `crater_admin_resources_sync` | `POST /api/v1/admin/resources/sync` | 从集群同步资源清单 |
| `crater_admin_nodes_label_delete` | `DELETE /api/v1/admin/nodes/:name/label` | 删除节点标签 |
| `crater_admin_nodes_annotation_delete` | `DELETE /api/v1/admin/nodes/:name/annotation` | 删除节点注解 |
| `crater_admin_nodes_taint_delete` | `DELETE /api/v1/admin/nodes/:name/taint` | 删除节点污点 |
| `crater_admin_nodes_drain` | `POST /api/v1/admin/nodes/:name/drain` | 排水节点（驱逐其上作业） |
| `crater_admin_system_billing_grant_all` | `POST /api/v1/admin/system-config/billing/extra-balance-all` | 给全平台所有用户发点数 |
| `crater_admin_system_billing_reset_all` | `POST /api/v1/admin/system-config/billing/reset-all` | 重置全平台计费余额 |
| `crater_admin_queue_quotas_delete` | `DELETE /api/v1/admin/queue-quotas/:id` | 删除队列配额 |
| `crater_admin_ops_cronjob_update` | `PUT /api/v1/admin/operations/cronjob` | 改巡检 cronjob 配置 |
| `crater_admin_ops_clean_low_gpu` | `POST /api/v1/admin/operations/clean/clean-low-gpu-usage-job` | 立即回收低 GPU 利用率作业 |
| `crater_admin_ops_clean_long_running` | `POST /api/v1/admin/operations/clean/clean-long-running-job` | 立即处理超长运行作业 |
| `crater_admin_ops_clean_waiting_jupyter` | `POST /api/v1/admin/operations/clean/clean-waiting-jupyter-job` | 清理长期排队的 Jupyter 作业 |
| `crater_admin_ops_clean_waiting_custom` | `POST /api/v1/admin/operations/clean/clean-waiting-custom-job` | 清理长期排队的自定义作业 |
| `crater_admin_gpu_analysis_confirm_stop` | `POST /api/v1/admin/gpu-analysis/:id/confirm-stop` | 确认并停止问题作业 |
| `crater_cli_write` | `CLI crater <write subcommand>` | 执行官方 crater CLI 的写命令（需显式开启） |

## auth

| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `crater_auth_whoami` | GET | `/api/auth/check` | 公开（免登录） | 只读 | 返回当前 MCP 使用的 Crater 身份：用户 ID、用户名、平台角色、当前账号（项目）名、账号内角色与访问模式、用户空间路径，以及后端版本。做任何写操作前建议先调用它确认身份与访问模式（只读模式会阻止写入）。 |
| `crater_auth_login` | POST | `/api/auth/login` | 公开（免登录） | 写 | 用给定的用户名密码登录 Crater，并让后续所有工具调用都使用该身份。通常你不需要它——MCP 启动时已用配置里的凭证自动登录；它主要用于『刚注册完的账号立刻登录』或临时切换身份。注意：切换后这个 MCP 进程就不再代表原来的用户了。 |
| `crater_auth_signup` | POST | `/api/auth/signup` | 公开（免登录） | 写 | 调用 Crater 的开放注册接口创建账号。注意：是否允许注册由平台配置决定（关闭时返回 403），用户名重复返回 409。注册成功**不会**自动登录，需要再调用 crater_auth_login。 |
| `crater_auth_mode` | GET | `/api/auth/mode` | 公开（免登录） | 只读 | 返回平台允许的认证方式与注册开关，用于判断能否自助注册、以及该用 normal 还是 ldap 登录。 |
| `crater_auth_switch_account` | POST | `/api/v1/auth/switch` | 仅本人 | 写 | 把当前会话切到你所属的另一个账号（Crater 里叫 queue/项目，例如 default、q-3）。切换后后端会签发新 token，MCP 会自动换用新 token——这一步很重要，旧 token 里的账号权限是过期的。只能切到自己有 user_account 记录的账号。 |
| `crater_auth_refresh_token` | POST | `/api/auth/refresh` | 仅本人 | 写 | 用 refreshToken 换一对新 token（一般不需要手动调用：客户端在收到 401 时会自动 refresh，refresh 失败再整轮重新登录）。当你在调试『写操作报 401』时可以用它手动续期。 |

<details><summary>参数与完整描述</summary>

### `crater_auth_whoami` — 我是谁 / 当前身份与上下文

- 接口：`GET /api/auth/check`
- 作用域：公开（免登录）；只读

```text
返回当前 MCP 使用的 Crater 身份：用户 ID、用户名、平台角色、当前账号（项目）名、账号内角色与访问模式、用户空间路径，以及后端版本。做任何写操作前建议先调用它确认身份与访问模式（只读模式会阻止写入）。
```

_无参数_

### `crater_auth_login` — 登录（可指定账号，会切换本进程身份）

- 接口：`POST /api/auth/login`
- 作用域：公开（免登录）；写操作

```text
用给定的用户名密码登录 Crater，并让后续所有工具调用都使用该身份。通常你不需要它——MCP 启动时已用配置里的凭证自动登录；它主要用于『刚注册完的账号立刻登录』或临时切换身份。注意：切换后这个 MCP 进程就不再代表原来的用户了。
```

| 参数 | 说明 |
| --- | --- |
| `username` | Crater 登录名 |
| `password` | Crater 密码（只在本地进程内使用，不会回显） |
| `account`（可选） | 登录后要切换到的账号（项目）名，如 q-3；不填用默认账号 |

### `crater_auth_signup` — 注册新用户

- 接口：`POST /api/auth/signup`
- 作用域：公开（免登录）；写操作

```text
调用 Crater 的开放注册接口创建账号。注意：是否允许注册由平台配置决定（关闭时返回 403），用户名重复返回 409。注册成功**不会**自动登录，需要再调用 crater_auth_login。
```

| 参数 | 说明 |
| --- | --- |
| `username` | 想要的登录名 |
| `password` | 密码 |

### `crater_auth_mode` — 查询认证模式（是否开放注册 / 是否启用 LDAP）

- 接口：`GET /api/auth/mode`
- 作用域：公开（免登录）；只读

```text
返回平台允许的认证方式与注册开关，用于判断能否自助注册、以及该用 normal 还是 ldap 登录。
```

_无参数_

### `crater_auth_switch_account` — 切换账号（项目）

- 接口：`POST /api/v1/auth/switch`
- 作用域：仅本人；写操作

```text
把当前会话切到你所属的另一个账号（Crater 里叫 queue/项目，例如 default、q-3）。切换后后端会签发新 token，MCP 会自动换用新 token——这一步很重要，旧 token 里的账号权限是过期的。只能切到自己有 user_account 记录的账号。
```

| 参数 | 说明 |
| --- | --- |
| `account` | 目标账号名（项目名） |

### `crater_auth_refresh_token` — 刷新当前 token

- 接口：`POST /api/auth/refresh`
- 作用域：仅本人；写操作

```text
用 refreshToken 换一对新 token（一般不需要手动调用：客户端在收到 401 时会自动 refresh，refresh 失败再整轮重新登录）。当你在调试『写操作报 401』时可以用它手动续期。
```

_无参数_

</details>


## profile

| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `crater_profile_get` | GET | `/api/auth/check` | 仅本人 | 只读 | 返回当前登录用户的资料（昵称、邮箱、电话、导师、课题组等）以及邮箱是否已验证、是否被封禁。 |
| `crater_profile_update` | PUT | `/api/v1/context/attributes` | 仅本人 | 写 | 整体覆盖写用户资料（Crater 的 PUT /api/v1/context/attributes）。**只传你想改的字段**，未传的字段会被后端置空（这是整体覆盖语义），所以建议先 crater_profile_get 拿到现有值，把要保留的字段一起回传。ID/UID/GID 由后端强制保持原值，改不了。 |
| `crater_profile_send_email_code` | POST | `/api/v1/context/email/code` | 仅本人 | 写 | 给指定邮箱发 6 位验证码，用于证明邮箱归属。注意：验证码存在后端进程内存里（多副本不共享），如果平台有多个后端副本而请求落到别的副本，验证可能失败——此时重试一次通常即可。 |
| `crater_profile_verify_email` | POST | `/api/v1/context/email/update` | 仅本人 | 写 | 提交邮箱 + 验证码完成验证。成功后只写入「已验证时间戳」，**不会**把邮箱写进资料表，所以还需要调用 crater_profile_update 把 email 字段更新过去。 |
| `crater_profile_accounts` | GET | `/api/v1/accounts` | 仅本人 | 只读 | 列出当前用户加入的账号（项目），可用于挑选 crater_auth_switch_account 的目标。 |
| `crater_profile_billing_summary` | GET | `/api/v1/context/billing/summary` | 仅本人 | 只读 | 返回当前账号下的账单/用量摘要（当前上下文维度）。 |
| `crater_profile_quota` | GET | `/api/v1/context/job-resource-summary` | 仅本人 | 只读 | 返回当前账号/队列的配额、以及我当前占用的 GPU/CPU/内存汇总，便于在提交作业前判断能不能排上。 |

<details><summary>参数与完整描述</summary>

### `crater_profile_get` — 查看我的资料

- 接口：`GET /api/auth/check`
- 作用域：仅本人；只读

```text
返回当前登录用户的资料（昵称、邮箱、电话、导师、课题组等）以及邮箱是否已验证、是否被封禁。
```

_无参数_

### `crater_profile_update` — 完善/修改我的资料

- 接口：`PUT /api/v1/context/attributes`
- 作用域：仅本人；写操作

```text
整体覆盖写用户资料（Crater 的 PUT /api/v1/context/attributes）。**只传你想改的字段**，未传的字段会被后端置空（这是整体覆盖语义），所以建议先 crater_profile_get 拿到现有值，把要保留的字段一起回传。ID/UID/GID 由后端强制保持原值，改不了。
```

| 参数 | 说明 |
| --- | --- |
| `nickname`（可选） | 昵称（不填则与登录名相同） |
| `email`（可选） | 邮箱 |
| `phone`（可选） | 电话 |
| `teacher`（可选） | 导师/老师 |
| `group`（可选） | 课题组 |
| `avatar`（可选） | 头像地址 |

### `crater_profile_send_email_code` — 发送邮箱验证码

- 接口：`POST /api/v1/context/email/code`
- 作用域：仅本人；写操作

```text
给指定邮箱发 6 位验证码，用于证明邮箱归属。注意：验证码存在后端进程内存里（多副本不共享），如果平台有多个后端副本而请求落到别的副本，验证可能失败——此时重试一次通常即可。
```

| 参数 | 说明 |
| --- | --- |
| `email` | 要验证的邮箱地址 |

### `crater_profile_verify_email` — 提交邮箱验证码

- 接口：`POST /api/v1/context/email/update`
- 作用域：仅本人；写操作

```text
提交邮箱 + 验证码完成验证。成功后只写入「已验证时间戳」，**不会**把邮箱写进资料表，所以还需要调用 crater_profile_update 把 email 字段更新过去。
```

| 参数 | 说明 |
| --- | --- |
| `email` | 邮箱地址 |
| `code` | 收到的验证码 |

### `crater_profile_accounts` — 我所属的账号（项目）列表

- 接口：`GET /api/v1/accounts`
- 作用域：仅本人；只读

```text
列出当前用户加入的账号（项目），可用于挑选 crater_auth_switch_account 的目标。
```

_无参数_

### `crater_profile_billing_summary` — 我的账单摘要

- 接口：`GET /api/v1/context/billing/summary`
- 作用域：仅本人；只读

```text
返回当前账号下的账单/用量摘要（当前上下文维度）。
```

_无参数_

### `crater_profile_quota` — 我的配额与已用资源

- 接口：`GET /api/v1/context/job-resource-summary`
- 作用域：仅本人；只读

```text
返回当前账号/队列的配额、以及我当前占用的 GPU/CPU/内存汇总，便于在提交作业前判断能不能排上。
```

_无参数_

</details>


## jobs

| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `crater_jobs_create_webide` | POST | `/api/v1/vcjobs/webide` | 仅本人 | 写 | 提交一个基于 code-server 的交互式 WebIDE 作业（容器名 webide、端口 8888），启动后用 crater_jobs_get_secret 取访问地址与随机密码。提交前建议先确认：① 镜像名（crater_images_list）② 可用 GPU 型号与资源键名（crater_resources |
| `crater_jobs_create_jupyter` | POST | `/api/v1/vcjobs/jupyter` | 仅本人 | 写 | 提交一个 JupyterLab 交互式作业（容器名 jupyter、端口 8888），启动后用 crater_jobs_get_token 取带 token 的访问地址。提交前建议先确认：① 镜像名（crater_images_list）② 可用 GPU 型号与资源键名（crater_resources_list）③  |
| `crater_jobs_create_training` | POST | `/api/v1/vcjobs/training` | 仅本人 | 写 | 提交一个单机 custom 作业（jobType=custom、k8s 名前缀 sg-）：自己指定镜像、shell/command、workingDir，跑完即结束，适合训练脚本与批处理。`workingDir` **必填**（后端 binding:required）；只给镜像不给 command 时用镜像 ENTRY |
| `crater_jobs_create_pytorch` | POST | `/api/v1/vcjobs/pytorch` | 仅本人 | 写 | 提交多角色 PyTorch 训练作业（k8s 名前缀 pt-）：请求体与 tensorflow 完全一致，按 tasks 声明 master/worker 等角色，各自 replicas、资源、镜像、命令与端口。注意：至少要有一个角色的 name 是 worker —— 只有 worker 完成才会把整个作业标记成功； |
| `crater_jobs_create_tensorflow` | POST | `/api/v1/vcjobs/tensorflow` | 仅本人 | 写 | 提交多角色 TensorFlow 训练作业（k8s 名前缀 tf-）：结构同 pytorch，tasks 里声明 ps/worker/chief 等角色，后端按角色建 volcano 多任务并启用 svc/env 插件。注意：MinAvailable 取所有角色 replicas 之和，必须全部排上才启动，单角色资源写 |
| `crater_jobs_list` | GET | `/api/v1/vcjobs` | 仅本人 | 只读 | 分页列出**我自己的**作业（后端按 UserID + AccountID 双过滤，看不到别人的）。返回含 jobName（后续所有作业级工具的入参）、显示名、类型、状态、账号、资源。注意：每页条数默认 10、最大 200，翻页请显式传 pageSize；`days` 不传等于全部历史，传 7 只看 7 天内创建的。 |
| `crater_jobs_facets` | GET | `/api/v1/vcjobs/facets` | 仅本人 | 只读 | 返回我自己作业的 facet 聚合（job_type / status 各自的分组计数），用于先摸清「我有哪些类型、哪些状态的作业」再发精确的列表查询。 |
| `crater_jobs_billing` | GET | `/api/v1/vcjobs/billing` | 仅本人 | 只读 | 返回我的作业计费汇总（逐作业的计费点数合计）。用于核对「我的作业花了多少」；账号余额请用 crater_profile_billing_summary。 |
| `crater_jobs_get` | GET | `/api/v1/vcjobs/:name/detail` | 仅本人 | 只读 | 按 jobName 取作业详情：状态、队列、资源、用户名/昵称、namespace、profileData（资源使用画像）、scheduleData（拉镜像耗时）、events 与容器终止状态。排查「为什么一直 Pending / 为什么失败」的第一站。返回 record not found 通常说明传的是显示名、或作 |
| `crater_jobs_pods` | GET | `/api/v1/vcjobs/:name/pods` | 仅本人 | 只读 | 列出该作业当前的所有 Pod（name / namespace / nodename / ip / port / phase / 资源）。crater_jobs_logs 内部就是靠它定位 Pod。注意 Pod 只在作业存活期间存在，作业结束（TTL 回收）后再查会是空列表。 |
| `crater_jobs_yaml` | GET | `/api/v1/vcjobs/:name/yaml` | 仅本人 | 只读 | 返回该作业在集群里的完整 Volcano Job YAML（含 task / affinity / volumes 等）。排查调度失败、亲和写错、挂载缺失时比详情更直观。注意输出可能很长，不要整段贴回给用户。 |
| `crater_jobs_events` | GET | `/api/v1/vcjobs/:name/event` | 仅本人 | 只读 | 返回该作业相关的事件列表（调度失败、镜像拉取失败、OOMKilled、被驱逐等都在这里）。作业起不来但详情里没有原因时优先看它。注意事件有时效性，过期会被集群清理。 |
| `crater_jobs_billing_detail` | GET | `/api/v1/vcjobs/:name/billing` | 仅本人 | 只读 | 返回该作业的计费点数合计（jobName / name / billedPointsTotal）。平台未开启计费或对普通用户不开放时，返回的是全 0 的空结构。 |
| `crater_jobs_template_from_job` | GET | `/api/v1/vcjobs/:name/template` | 仅本人 | 只读 | 读取该作业的提交参数快照（后端由作业自身的记录还原成 Create*Req 的公共部分），用于「照着这个作业再提一个」。返回内容可喂给 crater_jobs_create_*；注意它不含新作业的 name（显示名），需要你自己重新起。 |
| `crater_jobs_get_token` | GET | `/api/v1/vcjobs/:name/token` | 仅本人 | 只读 | 返回 Jupyter 作业的入口：baseURL / fullURL / token / podName / namespace，直接用 fullURL 打开即可。**仅 Jupyter 类型**且作业必须 Running（否则报 Job not running / Job type is not Jupyter）。返 |
| `crater_jobs_get_secret` | GET | `/api/v1/vcjobs/:name/secret` | 仅本人 | 只读 | 返回 WebIDE 作业的入口（baseURL / fullURL / token / podName / namespace），其中 token 就是 code-server 的随机密码。**仅 WebIDE 类型**且作业必须 Running；后端会进容器读 ~/.config/code-server/config |
| `crater_jobs_logs` | GET | `/api/v1/namespaces/:namespace/pods/:name/containers/:container/log` | 仅本人 | 只读 | 拉取作业某个 Pod 的容器日志尾部。vcjobs 下**没有** /logs 路由，这里按真实链路自己走三步：作业 Pod 列表 → 容器列表 → 容器日志接口，并把后端返回的 base64 解码成文本；调用前先用你自己的作业列表校验该作业确实属于你，不会读别人的 Pod。注意：只能读**正在运行或尚未回收**的作业 |
| `crater_jobs_stop` | DELETE | `/api/v1/vcjobs/:name` | 仅本人 | **写（destructive）** | 删除作业（DELETE /api/v1/vcjobs/:name）：运行中的作业会被终止、Pod 被回收，**不可恢复**——这也是「停止作业」的唯一入口（后端没有单独的 stop 接口）。删除前后端会先结算计费；非管理员只能删自己的作业。执行前建议先用 crater_jobs_get 确认 jobName，避免删错。 |
| `crater_jobs_set_alert` | PUT | `/api/v1/vcjobs/:name/alert` | 仅本人 | 写 | 切换该作业的「结束邮件提醒」开关（PUT /api/v1/vcjobs/:name/alert）。注意它**没有目标值参数、是取反**：连续调两次等于没改。发信要求你的邮箱已验证（GET /api/v1/users/email/verified），可用 crater_profile_verify_email 完成验证。 |
| `crater_jobs_ssh` | POST | `/api/v1/vcjobs/:name/ssh` | 仅本人 | 写 | 为该作业的 Pod 启动 sshd 并建 NodePort Service，返回节点 IP 与端口（可 `ssh -p <port> <你的用户名>@<ip>`）。要求作业 **Running**，且镜像里带 sshd 服务（否则报 ServiceSshdNotFound）；首次调用会在容器内创建 sshd 用户并重启 |
| `crater_jobs_snapshot` | POST | `/api/v1/vcjobs/:name/snapshot` | 仅本人 | 写 | 对运行中的单 Pod 作业做快照（nerdctl commit），把当前容器状态打包成一张新镜像并返回镜像地址，后续可用它提交新作业。硬性要求：作业只有 1 个节点、1 个 Pod、1 个容器且 Pod 处于 Running；还需要镜像构建权限（被 ban ImageBuild 会 403）。这是**耗时较久**的异步 |
| `crater_jobs_resource_limit_check` | POST | `/api/v1/context/resource-limit-check` | 仅本人 | 只读 | 把「我打算申请的资源配置」发给后端做一次限额预检（POST /api/v1/context/resource-limit-check），返回会不会超出当前账号/队列限额。只检查、不会真的提交作业，是 crater_jobs_create_* 之前最省事的防坑动作。注意：它只校验限额与配额，**不校验镜像是否存在、存储配 |
| `crater_jobs_templates` | GET | `/api/v1/jobtemplate/list` | 仅本人 | 只读 | 列出平台上的作业模板（id / 名称 / 描述 / 文档 / 模板体 / 创建者），用于创建作业时填 `template` 字段，或参考别人的参数。注意：该接口后端**不按归属过滤**（SQL 只有 `WHERE ID IS NOT NULL`），会返回他人私有模板——只读参考、不要外传。线上返回 null 表示当前没 |
| `crater_jobs_template_get` | GET | `/api/v1/jobtemplate/:id` | 仅本人 | 只读 | 按数字 id 取单个作业模板详情（含模板体 template，通常是 YAML/JSON，可直接参考或改写成 crater_jobs_create_* 的入参）。id 来自 crater_jobs_templates；id 不存在时后端返回「Failed to get job template」。 |

<details><summary>参数与完整描述</summary>

### `crater_jobs_create_webide` — 创建 WebIDE 作业（code-server）

- 接口：`POST /api/v1/vcjobs/webide`
- 作用域：仅本人；写操作

```text
提交一个基于 code-server 的交互式 WebIDE 作业（容器名 webide、端口 8888），启动后用 crater_jobs_get_secret 取访问地址与随机密码。提交前建议先确认：① 镜像名（crater_images_list）② 可用 GPU 型号与资源键名（crater_resources_list）③ 当前用量与余额（crater_jobs_billing / crater_profile_quota）④ 用 crater_jobs_resource_limit_check 干跑一次限额。注意：交互作业有**并发数上限**（后端 CheckInteractiveLimitBeforeCreate），超了会直接拒绝；这类作业默认 3 天后随 TTL 回收。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 作业显示名（作业列表里的「名称」，中文可以）。它不是 k8s 名：k8s 名由后端按类型前缀生成（jpt/sg/tf/pt/vsc） |
| `volumeMounts`（可选） | 存储/数据集挂载。数据集用 type=2 + datasetID；普通目录用 type=1 + subPath |
| `envs`（可选） | 容器环境变量（后端还会自动追加 NB_USER / NB_UID / NB_GID） |
| `selectors`（可选） | 节点选择约束（传了就变成 **required** 亲和，标签写错会一直 Pending；不传则后端按是否申请 GPU 自动给软亲和） |
| `template`（可选） | 作业模板名（来自 crater_jobs_templates），只记录来源，不影响调度 |
| `alertEnabled`（可选） | 作业结束时是否发邮件通知；为 true 时要求邮箱已验证，否则后端直接报 UserEmailNotVerified |
| `cpuPinningEnabled`（可选） | 是否 CPU 绑核（requests=limits，独占物理核，适合性能测试）；不填为 false（limits 比 requests 多 1m CPU / 1Mi 内存，便于在线调资源） |
| `forwards`（可选） | 把容器端口暴露出去（TensorBoard、自定义 API 等）；不填则只有交互作业自带入口 |
| `resource` | k8s 资源量（map<string,string>）。标准键：cpu（如 "4"）、memory（如 "16Gi"）、GPU 键随型号：nvidia.com/gpu 或 nvidia.com/a100 等（先用 crater_resources_list 确认可用键名）。requests 与 limits 由后端按 cpuPinningEnabled 自动派生，这里只传一份。 |
| `image` | 镜像**必填**：必须自带 code-server（WebIDE 镜像），普通训练镜像启动会立刻失败 |

### `crater_jobs_create_jupyter` — 创建 Jupyter 作业

- 接口：`POST /api/v1/vcjobs/jupyter`
- 作用域：仅本人；写操作

```text
提交一个 JupyterLab 交互式作业（容器名 jupyter、端口 8888），启动后用 crater_jobs_get_token 取带 token 的访问地址。提交前建议先确认：① 镜像名（crater_images_list）② 可用 GPU 型号与资源键名（crater_resources_list）③ 当前用量与余额（crater_jobs_billing / crater_profile_quota）④ 用 crater_jobs_resource_limit_check 干跑一次限额。注意：交互作业有并发上限；`/token` 只在作业 Running 时可用，对其他类型作业调它会报 Job type is not Jupyter。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 作业显示名（作业列表里的「名称」，中文可以）。它不是 k8s 名：k8s 名由后端按类型前缀生成（jpt/sg/tf/pt/vsc） |
| `volumeMounts`（可选） | 存储/数据集挂载。数据集用 type=2 + datasetID；普通目录用 type=1 + subPath |
| `envs`（可选） | 容器环境变量（后端还会自动追加 NB_USER / NB_UID / NB_GID） |
| `selectors`（可选） | 节点选择约束（传了就变成 **required** 亲和，标签写错会一直 Pending；不传则后端按是否申请 GPU 自动给软亲和） |
| `template`（可选） | 作业模板名（来自 crater_jobs_templates），只记录来源，不影响调度 |
| `alertEnabled`（可选） | 作业结束时是否发邮件通知；为 true 时要求邮箱已验证，否则后端直接报 UserEmailNotVerified |
| `cpuPinningEnabled`（可选） | 是否 CPU 绑核（requests=limits，独占物理核，适合性能测试）；不填为 false（limits 比 requests 多 1m CPU / 1Mi 内存，便于在线调资源） |
| `forwards`（可选） | 把容器端口暴露出去（TensorBoard、自定义 API 等）；不填则只有交互作业自带入口 |
| `resource` | k8s 资源量（map<string,string>）。标准键：cpu（如 "4"）、memory（如 "16Gi"）、GPU 键随型号：nvidia.com/gpu 或 nvidia.com/a100 等（先用 crater_resources_list 确认可用键名）。requests 与 limits 由后端按 cpuPinningEnabled 自动派生，这里只传一份。 |
| `image` | 镜像**必填**：需要自带 jupyter lab 与 /usr/local/bin/unified-start.sh 的镜像 |

### `crater_jobs_create_training` — 创建自定义（custom）训练作业

- 接口：`POST /api/v1/vcjobs/training`
- 作用域：仅本人；写操作

```text
提交一个单机 custom 作业（jobType=custom、k8s 名前缀 sg-）：自己指定镜像、shell/command、workingDir，跑完即结束，适合训练脚本与批处理。`workingDir` **必填**（后端 binding:required）；只给镜像不给 command 时用镜像 ENTRYPOINT。注意：`forwards` 里配的端口只在容器存活期间有效，作业结束入口即消失。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 作业显示名（作业列表里的「名称」，中文可以）。它不是 k8s 名：k8s 名由后端按类型前缀生成（jpt/sg/tf/pt/vsc） |
| `volumeMounts`（可选） | 存储/数据集挂载。数据集用 type=2 + datasetID；普通目录用 type=1 + subPath |
| `envs`（可选） | 容器环境变量（后端还会自动追加 NB_USER / NB_UID / NB_GID） |
| `selectors`（可选） | 节点选择约束（传了就变成 **required** 亲和，标签写错会一直 Pending；不传则后端按是否申请 GPU 自动给软亲和） |
| `template`（可选） | 作业模板名（来自 crater_jobs_templates），只记录来源，不影响调度 |
| `alertEnabled`（可选） | 作业结束时是否发邮件通知；为 true 时要求邮箱已验证，否则后端直接报 UserEmailNotVerified |
| `cpuPinningEnabled`（可选） | 是否 CPU 绑核（requests=limits，独占物理核，适合性能测试）；不填为 false（limits 比 requests 多 1m CPU / 1Mi 内存，便于在线调资源） |
| `forwards`（可选） | 把容器端口暴露出去（TensorBoard、自定义 API 等）；不填则只有交互作业自带入口 |
| `resource` | k8s 资源量（map<string,string>）。标准键：cpu（如 "4"）、memory（如 "16Gi"）、GPU 键随型号：nvidia.com/gpu 或 nvidia.com/a100 等（先用 crater_resources_list 确认可用键名）。requests 与 limits 由后端按 cpuPinningEnabled 自动派生，这里只传一份。 |
| `image` | — |
| `shell`（可选） | 启动 shell，例如 bash 或 sh；不填时后端默认 sh（仅当给了 command 才生效） |
| `command`（可选） | 启动命令，例如 `python train.py --epochs 10`（后端拼成 `<shell> -c <command>`） |
| `workingDir` | 容器工作目录，**必填**，例如 /home/alice/exp1（通常指向你已挂载的目录） |

### `crater_jobs_create_pytorch` — 创建 PyTorch 分布式作业

- 接口：`POST /api/v1/vcjobs/pytorch`
- 作用域：仅本人；写操作

```text
提交多角色 PyTorch 训练作业（k8s 名前缀 pt-）：请求体与 tensorflow 完全一致，按 tasks 声明 master/worker 等角色，各自 replicas、资源、镜像、命令与端口。注意：至少要有一个角色的 name 是 worker —— 只有 worker 完成才会把整个作业标记成功；分布式端口靠 `ports` 的 name 与镜像内框架配置（MASTER_ADDR / MASTER_PORT）对齐，写错会一直卡在通信。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 作业显示名（作业列表里的「名称」，中文可以）。它不是 k8s 名：k8s 名由后端按类型前缀生成（jpt/sg/tf/pt/vsc） |
| `volumeMounts`（可选） | 存储/数据集挂载。数据集用 type=2 + datasetID；普通目录用 type=1 + subPath |
| `envs`（可选） | 容器环境变量（后端还会自动追加 NB_USER / NB_UID / NB_GID） |
| `selectors`（可选） | 节点选择约束（传了就变成 **required** 亲和，标签写错会一直 Pending；不传则后端按是否申请 GPU 自动给软亲和） |
| `template`（可选） | 作业模板名（来自 crater_jobs_templates），只记录来源，不影响调度 |
| `alertEnabled`（可选） | 作业结束时是否发邮件通知；为 true 时要求邮箱已验证，否则后端直接报 UserEmailNotVerified |
| `cpuPinningEnabled`（可选） | 是否 CPU 绑核（requests=limits，独占物理核，适合性能测试）；不填为 false（limits 比 requests 多 1m CPU / 1Mi 内存，便于在线调资源） |
| `forwards`（可选） | 把容器端口暴露出去（TensorBoard、自定义 API 等）；不填则只有交互作业自带入口 |
| `tasks` | 角色列表（必填，至少 1 个）；常见写法：master(replicas=1) + worker(replicas=N) |

### `crater_jobs_create_tensorflow` — 创建 TensorFlow 分布式作业

- 接口：`POST /api/v1/vcjobs/tensorflow`
- 作用域：仅本人；写操作

```text
提交多角色 TensorFlow 训练作业（k8s 名前缀 tf-）：结构同 pytorch，tasks 里声明 ps/worker/chief 等角色，后端按角色建 volcano 多任务并启用 svc/env 插件。注意：MinAvailable 取所有角色 replicas 之和，必须全部排上才启动，单角色资源写大了会整体 Pending；`selectors` 一旦填就是强制亲和，标签写错会永远调度不上。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 作业显示名（作业列表里的「名称」，中文可以）。它不是 k8s 名：k8s 名由后端按类型前缀生成（jpt/sg/tf/pt/vsc） |
| `volumeMounts`（可选） | 存储/数据集挂载。数据集用 type=2 + datasetID；普通目录用 type=1 + subPath |
| `envs`（可选） | 容器环境变量（后端还会自动追加 NB_USER / NB_UID / NB_GID） |
| `selectors`（可选） | 节点选择约束（传了就变成 **required** 亲和，标签写错会一直 Pending；不传则后端按是否申请 GPU 自动给软亲和） |
| `template`（可选） | 作业模板名（来自 crater_jobs_templates），只记录来源，不影响调度 |
| `alertEnabled`（可选） | 作业结束时是否发邮件通知；为 true 时要求邮箱已验证，否则后端直接报 UserEmailNotVerified |
| `cpuPinningEnabled`（可选） | 是否 CPU 绑核（requests=limits，独占物理核，适合性能测试）；不填为 false（limits 比 requests 多 1m CPU / 1Mi 内存，便于在线调资源） |
| `forwards`（可选） | 把容器端口暴露出去（TensorBoard、自定义 API 等）；不填则只有交互作业自带入口 |
| `tasks` | 角色列表（必填）；TF 常见写法：ps(replicas=1) + worker(replicas=N) |

### `crater_jobs_list` — 我的作业列表

- 接口：`GET /api/v1/vcjobs`
- 作用域：仅本人；只读

```text
分页列出**我自己的**作业（后端按 UserID + AccountID 双过滤，看不到别人的）。返回含 jobName（后续所有作业级工具的入参）、显示名、类型、状态、账号、资源。注意：每页条数默认 10、最大 200，翻页请显式传 pageSize；`days` 不传等于全部历史，传 7 只看 7 天内创建的。
```

| 参数 | 说明 |
| --- | --- |
| `page`（可选） | 页码，从 1 开始，默认 1 |
| `pageSize`（可选） | 每页条数，默认 10，最大 200 |
| `days`（可选） | 只看最近 N 天创建的作业（-1 = 全部，默认 -1） |
| `search`（可选） | 关键字（对显示名、jobName、账号、用户名等模糊匹配，最长 128 字符） |
| `sort`（可选） | 排序字段，逗号分隔最多 3 个，字段前加 - 表示倒序；可用：createdAt / jobName / name / status / jobType / owner / queue / billedPointsTotal / startedAt / completedAt，默认 createdAt 倒序 |
| `jobTypes`（可选） | 按作业类型过滤（多选） |
| `statuses`（可选） | 按状态过滤（多选），如 ["Running"] |
| `node`（可选） | 只看跑在某个节点上的作业（节点名） |

### `crater_jobs_facets` — 我的作业筛选项聚合

- 接口：`GET /api/v1/vcjobs/facets`
- 作用域：仅本人；只读

```text
返回我自己作业的 facet 聚合（job_type / status 各自的分组计数），用于先摸清「我有哪些类型、哪些状态的作业」再发精确的列表查询。
```

| 参数 | 说明 |
| --- | --- |
| `days`（可选） | 只看最近 N 天（-1 = 全部，默认 -1） |
| `search`（可选） | 关键字过滤 |
| `jobTypes`（可选） | 按类型过滤 |
| `statuses`（可选） | 按状态过滤 |
| `node`（可选） | 节点名过滤 |

### `crater_jobs_billing` — 我的作业计费汇总

- 接口：`GET /api/v1/vcjobs/billing`
- 作用域：仅本人；只读

```text
返回我的作业计费汇总（逐作业的计费点数合计）。用于核对「我的作业花了多少」；账号余额请用 crater_profile_billing_summary。
```

_无参数_

### `crater_jobs_get` — 作业详情（含 Pod、事件、终止原因）

- 接口：`GET /api/v1/vcjobs/:name/detail`
- 作用域：仅本人；只读

```text
按 jobName 取作业详情：状态、队列、资源、用户名/昵称、namespace、profileData（资源使用画像）、scheduleData（拉镜像耗时）、events 与容器终止状态。排查「为什么一直 Pending / 为什么失败」的第一站。返回 record not found 通常说明传的是显示名、或作业属于别人。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_pods` — 作业的 Pod 列表

- 接口：`GET /api/v1/vcjobs/:name/pods`
- 作用域：仅本人；只读

```text
列出该作业当前的所有 Pod（name / namespace / nodename / ip / port / phase / 资源）。crater_jobs_logs 内部就是靠它定位 Pod。注意 Pod 只在作业存活期间存在，作业结束（TTL 回收）后再查会是空列表。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_yaml` — 作业 YAML

- 接口：`GET /api/v1/vcjobs/:name/yaml`
- 作用域：仅本人；只读

```text
返回该作业在集群里的完整 Volcano Job YAML（含 task / affinity / volumes 等）。排查调度失败、亲和写错、挂载缺失时比详情更直观。注意输出可能很长，不要整段贴回给用户。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_events` — 作业与 Pod 事件

- 接口：`GET /api/v1/vcjobs/:name/event`
- 作用域：仅本人；只读

```text
返回该作业相关的事件列表（调度失败、镜像拉取失败、OOMKilled、被驱逐等都在这里）。作业起不来但详情里没有原因时优先看它。注意事件有时效性，过期会被集群清理。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_billing_detail` — 单作业计费明细

- 接口：`GET /api/v1/vcjobs/:name/billing`
- 作用域：仅本人；只读

```text
返回该作业的计费点数合计（jobName / name / billedPointsTotal）。平台未开启计费或对普通用户不开放时，返回的是全 0 的空结构。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_template_from_job` — 由作业反推提交参数

- 接口：`GET /api/v1/vcjobs/:name/template`
- 作用域：仅本人；只读

```text
读取该作业的提交参数快照（后端由作业自身的记录还原成 Create*Req 的公共部分），用于「照着这个作业再提一个」。返回内容可喂给 crater_jobs_create_*；注意它不含新作业的 name（显示名），需要你自己重新起。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_get_token` — 取 Jupyter 入口地址与 token

- 接口：`GET /api/v1/vcjobs/:name/token`
- 作用域：仅本人；只读

```text
返回 Jupyter 作业的入口：baseURL / fullURL / token / podName / namespace，直接用 fullURL 打开即可。**仅 Jupyter 类型**且作业必须 Running（否则报 Job not running / Job type is not Jupyter）。返回内容含**访问凭据**（token 等于登录密码），不要回显给第三方或写进文档。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_get_secret` — 取 WebIDE 入口凭据

- 接口：`GET /api/v1/vcjobs/:name/secret`
- 作用域：仅本人；只读

```text
返回 WebIDE 作业的入口（baseURL / fullURL / token / podName / namespace），其中 token 就是 code-server 的随机密码。**仅 WebIDE 类型**且作业必须 Running；后端会进容器读 ~/.config/code-server/config.yaml 并缓存到作业注解。返回内容含**敏感凭据**，不要写入日志、不要提交到仓库。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_logs` — 作业容器日志（尾部 N 行）

- 接口：`GET /api/v1/namespaces/:namespace/pods/:name/containers/:container/log`
- 作用域：仅本人；只读

```text
拉取作业某个 Pod 的容器日志尾部。vcjobs 下**没有** /logs 路由，这里按真实链路自己走三步：作业 Pod 列表 → 容器列表 → 容器日志接口，并把后端返回的 base64 解码成文本；调用前先用你自己的作业列表校验该作业确实属于你，不会读别人的 Pod。注意：只能读**正在运行或尚未回收**的作业，作业结束且 Pod 被删时拿不到日志，应改用 crater_jobs_events 或详情里的 terminatedStates。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |
| `container`（可选） | 容器名；不填时按作业类型自动取（WebIDE=webide、Jupyter=jupyter、custom=custom），分布式作业会自动查 Pod 的容器列表取第一个，也可以用本参数显式指定角色名（如 worker） |
| `tailLines`（可选） | 返回最后多少行，默认 200，最大 2000 |
| `podIndex`（可选） | 多 Pod 作业取第几个 Pod（从 0 开始，顺序同 crater_jobs_pods），默认 0 |

### `crater_jobs_stop` — 停止 / 删除作业

- 接口：`DELETE /api/v1/vcjobs/:name`
- 作用域：仅本人；写操作（destructive）

```text
删除作业（DELETE /api/v1/vcjobs/:name）：运行中的作业会被终止、Pod 被回收，**不可恢复**——这也是「停止作业」的唯一入口（后端没有单独的 stop 接口）。删除前后端会先结算计费；非管理员只能删自己的作业。执行前建议先用 crater_jobs_get 确认 jobName，避免删错。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_set_alert` — 开关作业邮件提醒

- 接口：`PUT /api/v1/vcjobs/:name/alert`
- 作用域：仅本人；写操作

```text
切换该作业的「结束邮件提醒」开关（PUT /api/v1/vcjobs/:name/alert）。注意它**没有目标值参数、是取反**：连续调两次等于没改。发信要求你的邮箱已验证（GET /api/v1/users/email/verified），可用 crater_profile_verify_email 完成验证。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_ssh` — 为作业开启 SSH 并取连接信息

- 接口：`POST /api/v1/vcjobs/:name/ssh`
- 作用域：仅本人；写操作

```text
为该作业的 Pod 启动 sshd 并建 NodePort Service，返回节点 IP 与端口（可 `ssh -p <port> <你的用户名>@<ip>`）。要求作业 **Running**，且镜像里带 sshd 服务（否则报 ServiceSshdNotFound）；首次调用会在容器内创建 sshd 用户并重启服务，属写操作。注意端口是**节点级暴露**的，用完请及时删除作业或在平台回收。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_snapshot` — 把作业容器打包成镜像

- 接口：`POST /api/v1/vcjobs/:name/snapshot`
- 作用域：仅本人；写操作

```text
对运行中的单 Pod 作业做快照（nerdctl commit），把当前容器状态打包成一张新镜像并返回镜像地址，后续可用它提交新作业。硬性要求：作业只有 1 个节点、1 个 Pod、1 个容器且 Pod 处于 Running；还需要镜像构建权限（被 ban ImageBuild 会 403）。这是**耗时较久**的异步操作（要推送 Harbor），期间不要重复调用。
```

| 参数 | 说明 |
| --- | --- |
| `jobName` | 作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。 |

### `crater_jobs_resource_limit_check` — 提交前资源限额干跑检查

- 接口：`POST /api/v1/context/resource-limit-check`
- 作用域：仅本人；只读

```text
把「我打算申请的资源配置」发给后端做一次限额预检（POST /api/v1/context/resource-limit-check），返回会不会超出当前账号/队列限额。只检查、不会真的提交作业，是 crater_jobs_create_* 之前最省事的防坑动作。注意：它只校验限额与配额，**不校验镜像是否存在、存储配额、余额**，那几项仍是创建时的独立校验。
```

| 参数 | 说明 |
| --- | --- |
| `requestedResources` | 本次想申请的资源（map<string,string>），键与创建作业的 resource 完全一致：cpu / memory / nvidia.com/gpu 等 |

### `crater_jobs_templates` — 作业模板列表

- 接口：`GET /api/v1/jobtemplate/list`
- 作用域：仅本人；只读

```text
列出平台上的作业模板（id / 名称 / 描述 / 文档 / 模板体 / 创建者），用于创建作业时填 `template` 字段，或参考别人的参数。注意：该接口后端**不按归属过滤**（SQL 只有 `WHERE ID IS NOT NULL`），会返回他人私有模板——只读参考、不要外传。线上返回 null 表示当前没有任何模板。
```

_无参数_

### `crater_jobs_template_get` — 作业模板详情

- 接口：`GET /api/v1/jobtemplate/:id`
- 作用域：仅本人；只读

```text
按数字 id 取单个作业模板详情（含模板体 template，通常是 YAML/JSON，可直接参考或改写成 crater_jobs_create_* 的入参）。id 来自 crater_jobs_templates；id 不存在时后端返回「Failed to get job template」。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 作业模板 ID（crater_jobs_templates 返回的 id） |

</details>


## images

| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `crater_images_list` | GET | `/api/v1/images/image` | 账号内 | 只读 | 列出「我可用的镜像」：公共镜像 + 本账号镜像 + 我上传的私有镜像 + 别人分享给我的镜像（响应为 {imageList:[...]}）。每个元素含 ID（注意字段名是大写 ID）、imageLink（完整镜像地址）、imagepackName（构建时提交的镜像名）、taskType、archs、imageShare |
| `crater_images_available` | GET | `/api/v1/images/available` | 账号内 | 只读 | 按作业类型（jupyter / webide / training / pytorch / tensorflow / custom）列出平台允许该类型使用的镜像，用于创建作业时挑镜像。type 为空时后端可能返回全部类型，若报 validate failed 再补上 type。注意：这个是「该任务类型可用」集合，和「我 |
| `crater_images_cuda_base` | GET | `/api/v1/images/cudabaseimage` | 仅本人 | 只读 | 返回平台登记的 CUDA 基础镜像条目（label / value，例如『CUDA 12.4 + Ubuntu 22.04』）。构建镜像（envd 的 base、kaniko 的 image）或挑基础环境时先用它，别自己编 base 镜像名。注意：这是平台管理员维护的参考清单，不一定等于 Harbor 里真实存在可拉取 |
| `crater_images_kaniko_list` | GET | `/api/v1/images/kaniko` | 仅本人 | 只读 | 列出我提交过的镜像构建任务（kaniko records）：镜像链接、目标镜像名、状态、创建时间等。构建是异步的，提交后用它轮询进度；想取消或清理记录用 crater_images_kaniko_cancel。注意：这里只有「任务记录」，构建失败的具体原因要看 kaniko 构建日志，接口里通常只有状态。 |
| `crater_images_kaniko_detail` | GET | `/api/v1/images/getbyname` | 仅本人 | 只读 | 按镜像包名（imagePackName，即构建时提交的 name、也是列表响应里的 imagepackName 字段）取某个构建/镜像的详情：状态、dockerfile、构建 Pod 名、架构、标签等。排查「镜像到底构建成功没有」时优先用它，比列表更详细。注意：query 参数名是 name（§3.4 `GET /im |
| `crater_images_kaniko_pod` | GET | `/api/v1/images/podname` | 仅本人 | 只读 | 按构建任务 ID 返回该次构建对应的 Pod 名、命名空间、所在节点，便于定位构建卡住/被驱逐是哪个节点的问题。注意：只有构建任务仍有 Pod（构建中或刚结束）时才有信息；拿到 Pod 名后如需看日志请去平台界面或集群侧，本 MCP 不封装 k8s 级日志接口。 |
| `crater_images_quota` | GET | `/api/v1/images/quota` | 账号内 | 只读 | 返回我的镜像仓库（Harbor 项目）的已用空间 used、配额 quota、项目名 project、总量 total（对象，不是分页列表），构建镜像前先看还有没有余量。注意：每次构建都会往项目里推镜像并占用空间，配额满了构建会直接失败；删镜像（crater_images_delete）后空间需要等 Harbor 回收 |
| `crater_images_harbor` | GET | `/api/v1/images/harbor` | 仅本人 | 只读 | 返回平台 Harbor 仓库地址（ip 字段，形如 https://x.x.x.x:port）。拼完整镜像地址（Harbor地址/项目名/镜像名:tag）、或者让别人 docker pull 时用得到。注意：这里只给地址，不含账号密码；仓库账号密码属敏感凭据，本组不提供接口。 |
| `crater_images_share_granted` | GET | `/api/v1/images/share` | 仅本人 | 只读 | 按镜像 ID 返回该镜像当前已授权的用户列表与账号列表（userList / accountList）。分享（crater_images_share）前后用它确认授权对象，取消分享（crater_images_unshare）前也用它拿到要撤销的 ID。注意：只能查自己有权限的镜像；imageID 必填，不传会报 va |
| `crater_images_share_ungranted_users` | GET | `/api/v1/images/user` | 仅本人 | 只读 | 按镜像 ID + 用户名关键字，搜索「还没被授权」的用户，用于决定 crater_images_share 里 idList 该填哪些用户 ID。注意：返回的是用户 ID，不是用户名；分享给账号请改用 crater_images_share_ungranted_accounts。 |
| `crater_images_share_ungranted_accounts` | GET | `/api/v1/images/account` | 仅本人 | 只读 | 按镜像 ID 列出「还没被授权」的账号（项目）列表，用于 crater_images_share(type=account) 挑选 idList。注意：账号级分享会让该账号内所有成员都能用这个镜像，慎用；先确认账号名与 ID 的对应关系。 |
| `crater_images_build_kaniko` | POST | `/api/v1/images/kaniko` | 仅本人 | 写 | 基于一个已有源镜像，叠加 pip requirements 与 apt 包，构建出新镜像（平台没有独立的 pip-apt 路由，pip/apt 安装就走这个接口）。必填 image（源镜像）、name（目标镜像名）、tag；requirements 传 pip requirements 文本（一行一个包），packag |
| `crater_images_build_dockerfile` | POST | `/api/v1/images/dockerfile` | 仅本人 | 写 | 提交完整 Dockerfile 文本构建新镜像，适合 pip/apt 之外的自定义步骤（COPY 文件、环境变量、多阶段构建）。必填 dockerfile、name、tag；建议 base 用 crater_images_cuda_base 里的条目，别写死拉不到的镜像。注意：Dockerfile 里 FROM 的镜像 |
| `crater_images_build_envd` | POST | `/api/v1/images/envd` | 仅本人 | 写 | 提交 envd 构建脚本（envd 字段）+ python 版本 + base 基础镜像来构建镜像；把「在 WebIDE/Jupyter 里装好的环境」打成镜像时最常用这一步，但 envd 只负责构建：要打包运行中环境里装过的包，请先把这些包写进 envd 脚本（或改用 crater_images_build_kani |
| `crater_images_register` | POST | `/api/v1/images/image` | 仅本人 | 写 | 把已经存在（在别处构建好、已推进仓库）的镜像地址登记进平台，供创建作业时选择，不做任何构建。必填 imageLink（完整镜像地址）与 taskType（jupyter/webide/training…）。注意：平台通常不会真的去拉取校验，链接写错要到启动作业时才暴露；登记前可用 crater_images_harbo |
| `crater_images_update_description` | POST | `/api/v1/images/description` | 仅本人 | 写 | 修改某个镜像的描述。只能改自己作为 owner 的镜像，改别人的会被后端拒绝（requireImageOwner）。必填 id 与 description；想把描述清空就传空字符串。注意：这是整体覆盖该字段，不是追加；不确定当前 description 时先 crater_images_list 看一眼。 |
| `crater_images_update_tags` | POST | `/api/v1/images/tags` | 仅本人 | 写 | 整体覆盖某个镜像的检索标签（tags 数组）。只能改自己拥有的镜像。注意：tags 是覆盖语义不是追加——要保留旧标签就把旧标签一起传进来（先 crater_images_list 查当前值）；它和镜像的目标 tag（:tag）不是一回事。 |
| `crater_images_update_arch` | POST | `/api/v1/images/arch` | 仅本人 | 写 | 整体覆盖某个镜像记录的架构列表（archs，如 ["amd64"]）。只能改自己拥有的镜像，id 与 archs 都必填。注意：这里只改平台里的元数据记录，**不会**真的重新构建多架构镜像；乱填会导致作业调度时选错架构而拉取失败。 |
| `crater_images_update_task_type` | POST | `/api/v1/images/type` | 仅本人 | 写 | 修改镜像适用的任务类型（jupyter / webide / training / pytorch / tensorflow / custom），决定它出现在哪类作业的镜像下拉里。只能改自己拥有的镜像。注意：改错类型后该镜像可能在作业创建页「消失」，用 crater_images_available 验证改动是否符合预 |
| `crater_images_quota_update` | POST | `/api/v1/images/quota` | 账号内 | 写 | 把「我」的 Harbor 镜像项目存储配额改成 size（整数，单位与 crater_images_quota 返回的 quota 一致，实测为 GB 量级，最大不超过平台上限）。配额满了就构建不出镜像，所以扩容后才好继续构建。注意：这是账号资源上限，改小会让现有镜像超出配额、后续构建直接失败；先 crater_ima |
| `crater_images_share` | POST | `/api/v1/images/share` | 仅本人 | 写 | 把自己的镜像分享给别人：imageID 指定镜像，idList 指定被分享对象 ID 列表，type 决定对象是用户（user）还是账号（account）。前置：先用 crater_images_share_ungranted_users（用户）或 crater_images_share_ungranted_accou |
| `crater_images_unshare` | DELETE | `/api/v1/images/share` | 仅本人 | 写 | 撤销某个镜像对某个用户或账号的授权。id 是被撤销的授权对象 ID（用户 ID 或账号 ID），imageID 是镜像 ID，type 与分享时一致。前置：用 crater_images_share_granted 查到当前已授权的 userList / accountList 再填。注意：撤销后对方立刻无法再用该镜像 |
| `crater_images_delete` | POST | `/api/v1/images/deleteimage` | 仅本人 | **写（destructive）** | 按 ID 列表批量删除自己拥有的镜像（后端逐个校验 owner）。用它可以一次清理多个镜像、腾出 Harbor 配额。注意：删除**不可恢复**，且可能连带影响引用该镜像的历史作业/他人共享（先用 crater_images_share_granted 确认共享情况）；空间回收有延迟，删完 crater_images_ |
| `crater_images_delete_one` | DELETE | `/api/v1/images/image/:id` | 仅本人 | **写（destructive）** | 按路径中的镜像 ID 删除单个镜像（仅 owner 可用），是 crater_images_delete 的单条版本，调用语义更直观。注意：删除**不可恢复**；若只是想取消一次构建任务记录，别用这个，用 crater_images_kaniko_cancel。 |
| `crater_images_kaniko_cancel` | POST | `/api/v1/images/remove` | 仅本人 | **写（destructive）** | 按构建任务 ID 删除（取消）我的一条 kaniko 构建记录，用于清理构建失败留下的垃圾记录。注意：它删除的是**构建任务记录**，不等于删除已构建出来的镜像（后者用 crater_images_delete）；操作不可恢复；若构建仍在进行中，进度查询会随之消失。 |

<details><summary>参数与完整描述</summary>

### `crater_images_list` — 我可用的镜像列表

- 接口：`GET /api/v1/images/image`
- 作用域：账号内；只读

```text
列出「我可用的镜像」：公共镜像 + 本账号镜像 + 我上传的私有镜像 + 别人分享给我的镜像（响应为 {imageList:[...]}）。每个元素含 ID（注意字段名是大写 ID）、imageLink（完整镜像地址）、imagepackName（构建时提交的镜像名）、taskType、archs、imageShareStatus、isPublic 与 userInfo.username（owner），创建作业前先用它拿准确的镜像标识，不要凭记忆拼镜像名。注意：返回混合了多种来源，改描述/改标签/删除这类操作只对 userInfo.username 是自己的镜像生效。
```

_无参数_

### `crater_images_available` — 按任务类型列可选镜像

- 接口：`GET /api/v1/images/available`
- 作用域：账号内；只读

```text
按作业类型（jupyter / webide / training / pytorch / tensorflow / custom）列出平台允许该类型使用的镜像，用于创建作业时挑镜像。type 为空时后端可能返回全部类型，若报 validate failed 再补上 type。注意：这个是「该任务类型可用」集合，和「我有权限使用」的交集才是你真正能选的镜像。
```

| 参数 | 说明 |
| --- | --- |
| `type`（可选） | 作业类型（JobType），如 jupyter、webide、training、pytorch、tensorflow、custom；不传通常返回全部 |

### `crater_images_cuda_base` — CUDA 基础镜像列表

- 接口：`GET /api/v1/images/cudabaseimage`
- 作用域：仅本人；只读

```text
返回平台登记的 CUDA 基础镜像条目（label / value，例如『CUDA 12.4 + Ubuntu 22.04』）。构建镜像（envd 的 base、kaniko 的 image）或挑基础环境时先用它，别自己编 base 镜像名。注意：这是平台管理员维护的参考清单，不一定等于 Harbor 里真实存在可拉取的镜像。
```

_无参数_

### `crater_images_kaniko_list` — 我的镜像构建任务列表

- 接口：`GET /api/v1/images/kaniko`
- 作用域：仅本人；只读

```text
列出我提交过的镜像构建任务（kaniko records）：镜像链接、目标镜像名、状态、创建时间等。构建是异步的，提交后用它轮询进度；想取消或清理记录用 crater_images_kaniko_cancel。注意：这里只有「任务记录」，构建失败的具体原因要看 kaniko 构建日志，接口里通常只有状态。
```

_无参数_

### `crater_images_kaniko_detail` — 按镜像包名查构建详情

- 接口：`GET /api/v1/images/getbyname`
- 作用域：仅本人；只读

```text
按镜像包名（imagePackName，即构建时提交的 name、也是列表响应里的 imagepackName 字段）取某个构建/镜像的详情：状态、dockerfile、构建 Pod 名、架构、标签等。排查「镜像到底构建成功没有」时优先用它，比列表更详细。注意：query 参数名是 name（§3.4 `GET /images/getbyname | query name (required)`），必须是镜像名而不是完整 imageLink，也不是 tag。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 镜像包名（构建时提交的 name，不是 tag、不是完整镜像地址） |

### `crater_images_kaniko_pod` — 查构建 Pod 名/命名空间/节点

- 接口：`GET /api/v1/images/podname`
- 作用域：仅本人；只读

```text
按构建任务 ID 返回该次构建对应的 Pod 名、命名空间、所在节点，便于定位构建卡住/被驱逐是哪个节点的问题。注意：只有构建任务仍有 Pod（构建中或刚结束）时才有信息；拿到 Pod 名后如需看日志请去平台界面或集群侧，本 MCP 不封装 k8s 级日志接口。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 构建任务 ID（kaniko 记录的 ID，可从 crater_images_kaniko_list 拿） |

### `crater_images_quota` — 我的 Harbor 项目用量与配额

- 接口：`GET /api/v1/images/quota`
- 作用域：账号内；只读

```text
返回我的镜像仓库（Harbor 项目）的已用空间 used、配额 quota、项目名 project、总量 total（对象，不是分页列表），构建镜像前先看还有没有余量。注意：每次构建都会往项目里推镜像并占用空间，配额满了构建会直接失败；删镜像（crater_images_delete）后空间需要等 Harbor 回收。
```

_无参数_

### `crater_images_harbor` — 查 Harbor 地址

- 接口：`GET /api/v1/images/harbor`
- 作用域：仅本人；只读

```text
返回平台 Harbor 仓库地址（ip 字段，形如 https://x.x.x.x:port）。拼完整镜像地址（Harbor地址/项目名/镜像名:tag）、或者让别人 docker pull 时用得到。注意：这里只给地址，不含账号密码；仓库账号密码属敏感凭据，本组不提供接口。
```

_无参数_

### `crater_images_share_granted` — 查镜像已共享给谁

- 接口：`GET /api/v1/images/share`
- 作用域：仅本人；只读

```text
按镜像 ID 返回该镜像当前已授权的用户列表与账号列表（userList / accountList）。分享（crater_images_share）前后用它确认授权对象，取消分享（crater_images_unshare）前也用它拿到要撤销的 ID。注意：只能查自己有权限的镜像；imageID 必填，不传会报 validate failed。
```

| 参数 | 说明 |
| --- | --- |
| `imageID` | 镜像 ID（从 crater_images_list 的 ID 字段取） |

### `crater_images_share_ungranted_users` — 搜可共享的用户（尚未授权）

- 接口：`GET /api/v1/images/user`
- 作用域：仅本人；只读

```text
按镜像 ID + 用户名关键字，搜索「还没被授权」的用户，用于决定 crater_images_share 里 idList 该填哪些用户 ID。注意：返回的是用户 ID，不是用户名；分享给账号请改用 crater_images_share_ungranted_accounts。
```

| 参数 | 说明 |
| --- | --- |
| `imageID` | 要分享的镜像 ID |
| `name`（可选） | 用户名关键字（模糊匹配）；不传一般返回全部未授权用户 |

### `crater_images_share_ungranted_accounts` — 列可共享的账号（尚未授权）

- 接口：`GET /api/v1/images/account`
- 作用域：仅本人；只读

```text
按镜像 ID 列出「还没被授权」的账号（项目）列表，用于 crater_images_share(type=account) 挑选 idList。注意：账号级分享会让该账号内所有成员都能用这个镜像，慎用；先确认账号名与 ID 的对应关系。
```

| 参数 | 说明 |
| --- | --- |
| `imageID` | 要分享的镜像 ID |

### `crater_images_build_kaniko` — 用 pip/apt 增量构建镜像

- 接口：`POST /api/v1/images/kaniko`
- 作用域：仅本人；写操作

```text
基于一个已有源镜像，叠加 pip requirements 与 apt 包，构建出新镜像（平台没有独立的 pip-apt 路由，pip/apt 安装就走这个接口）。必填 image（源镜像）、name（目标镜像名）、tag；requirements 传 pip requirements 文本（一行一个包），packages 传空格分隔的 apt 包名。注意：构建异步且耗时长，会占用 crater_images_quota 的仓库配额；源镜像必须是我能拉到的（公共/本账号/已共享），构建失败只能看 kaniko 构建日志，常见原因是包名写错、网络拉不到源镜像、配额满。
```

| 参数 | 说明 |
| --- | --- |
| `image` | 源镜像（JSON 字段 image），可用完整地址或 crater_images_list 里的 imageLink |
| `requirements`（可选） | pip requirements 文本，一行一个（如 torch==2.4.0\nnumpy>=1.26）；不装 pip 包就留空 |
| `packages`（可选） | apt 包名，空格分隔（如 vim git curl）；不装系统包就留空 |
| `name` | 目标镜像名（JSON 字段 name），只写镜像名本身、不带 Harbor 地址与 tag，例如 my-torch |
| `tag` | 目标标签（JSON 字段 tag），例如 v1、py310-cu124；同名镜像重构建请换 tag，否则会互相覆盖 |
| `description`（可选） | 镜像描述，会显示在镜像列表里 |
| `tags`（可选） | 镜像检索标签（≠ tag，与目标 tag 是两回事） |
| `template`（可选） | 构建模板标识；不确定就留空（可从 crater_images_kaniko_detail 看已有镜像用的模板） |
| `archs`（可选） | 目标架构列表，如 ["amd64"]；写多个（多架构构建）会显著变慢 |

### `crater_images_build_dockerfile` — 用 Dockerfile 构建镜像

- 接口：`POST /api/v1/images/dockerfile`
- 作用域：仅本人；写操作

```text
提交完整 Dockerfile 文本构建新镜像，适合 pip/apt 之外的自定义步骤（COPY 文件、环境变量、多阶段构建）。必填 dockerfile、name、tag；建议 base 用 crater_images_cuda_base 里的条目，别写死拉不到的镜像。注意：Dockerfile 里 FROM 的镜像必须平台可达；构建同样异步、耗时、占配额，失败只能看 kaniko 构建日志。
```

| 参数 | 说明 |
| --- | --- |
| `dockerfile` | 完整 Dockerfile 文本（JSON 字段 dockerfile），必须含 FROM |
| `name` | 目标镜像名（JSON 字段 name），只写镜像名本身、不带 Harbor 地址与 tag，例如 my-torch |
| `tag` | 目标标签（JSON 字段 tag），例如 v1、py310-cu124；同名镜像重构建请换 tag，否则会互相覆盖 |
| `description`（可选） | 镜像描述，会显示在镜像列表里 |
| `tags`（可选） | 镜像检索标签（≠ tag，与目标 tag 是两回事） |
| `template`（可选） | 构建模板标识；不确定就留空（可从 crater_images_kaniko_detail 看已有镜像用的模板） |
| `archs`（可选） | 目标架构列表，如 ["amd64"]；写多个（多架构构建）会显著变慢 |

### `crater_images_build_envd` — 用 envd 脚本构建镜像

- 接口：`POST /api/v1/images/envd`
- 作用域：仅本人；写操作

```text
提交 envd 构建脚本（envd 字段）+ python 版本 + base 基础镜像来构建镜像；把「在 WebIDE/Jupyter 里装好的环境」打成镜像时最常用这一步，但 envd 只负责构建：要打包运行中环境里装过的包，请先把这些包写进 envd 脚本（或改用 crater_images_build_kaniko 的 requirements）。前置：envd 脚本必须以 `# syntax=v1` 开头（格式不对后端直接失败）、base 先用 crater_images_cuda_base 选、name/tag 必填且要唯一。注意：构建异步、耗时长（几十分钟）、占配额；失败细节只在 kaniko 构建日志里。
```

| 参数 | 说明 |
| --- | --- |
| `envd` | envd 构建脚本全文（JSON 字段 envd），须含 `# syntax=v1` 首行 |
| `python`（可选） | python 版本，例如 3.10；不传则由 base/脚本决定 |
| `base`（可选） | 基础镜像（JSON 字段 base），建议从 crater_images_cuda_base 选，如 CUDA 12.4 + Ubuntu 22.04 对应的 value |
| `name` | 目标镜像名（JSON 字段 name），只写镜像名本身、不带 Harbor 地址与 tag，例如 my-torch |
| `tag` | 目标标签（JSON 字段 tag），例如 v1、py310-cu124；同名镜像重构建请换 tag，否则会互相覆盖 |
| `description`（可选） | 镜像描述，会显示在镜像列表里 |
| `tags`（可选） | 镜像检索标签（≠ tag，与目标 tag 是两回事） |
| `template`（可选） | 构建模板标识；不确定就留空（可从 crater_images_kaniko_detail 看已有镜像用的模板） |
| `archs`（可选） | 目标架构列表，如 ["amd64"]；写多个（多架构构建）会显著变慢 |

### `crater_images_register` — 登记一个已有镜像链接

- 接口：`POST /api/v1/images/image`
- 作用域：仅本人；写操作

```text
把已经存在（在别处构建好、已推进仓库）的镜像地址登记进平台，供创建作业时选择，不做任何构建。必填 imageLink（完整镜像地址）与 taskType（jupyter/webide/training…）。注意：平台通常不会真的去拉取校验，链接写错要到启动作业时才暴露；登记前可用 crater_images_harbor 拼地址。
```

| 参数 | 说明 |
| --- | --- |
| `imageLink` | 完整镜像地址，例如 <harbor地址>/<项目>/<镜像名>:<tag> |
| `taskType` | 任务类型（JobType），如 jupyter、webide、training、pytorch、tensorflow、custom |
| `description`（可选） | 镜像描述 |
| `tags`（可选） | 镜像检索标签 |
| `archs`（可选） | 镜像架构列表，如 ["amd64"] |

### `crater_images_update_description` — 改镜像描述

- 接口：`POST /api/v1/images/description`
- 作用域：仅本人；写操作

```text
修改某个镜像的描述。只能改自己作为 owner 的镜像，改别人的会被后端拒绝（requireImageOwner）。必填 id 与 description；想把描述清空就传空字符串。注意：这是整体覆盖该字段，不是追加；不确定当前 description 时先 crater_images_list 看一眼。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 镜像 ID（crater_images_list 返回的元素里字段名是大写 ID，如 10） |
| `description` | 新的镜像描述（整体覆盖；传空串即清空） |

### `crater_images_update_tags` — 改镜像标签

- 接口：`POST /api/v1/images/tags`
- 作用域：仅本人；写操作

```text
整体覆盖某个镜像的检索标签（tags 数组）。只能改自己拥有的镜像。注意：tags 是覆盖语义不是追加——要保留旧标签就把旧标签一起传进来（先 crater_images_list 查当前值）；它和镜像的目标 tag（:tag）不是一回事。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 镜像 ID |
| `tags` | 新的标签数组（整体覆盖旧值） |

### `crater_images_update_arch` — 改镜像架构列表

- 接口：`POST /api/v1/images/arch`
- 作用域：仅本人；写操作

```text
整体覆盖某个镜像记录的架构列表（archs，如 ["amd64"]）。只能改自己拥有的镜像，id 与 archs 都必填。注意：这里只改平台里的元数据记录，**不会**真的重新构建多架构镜像；乱填会导致作业调度时选错架构而拉取失败。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 镜像 ID |
| `archs` | 架构列表，如 ["amd64"] 或 ["amd64","arm64"]（整体覆盖） |

### `crater_images_update_task_type` — 改镜像任务类型

- 接口：`POST /api/v1/images/type`
- 作用域：仅本人；写操作

```text
修改镜像适用的任务类型（jupyter / webide / training / pytorch / tensorflow / custom），决定它出现在哪类作业的镜像下拉里。只能改自己拥有的镜像。注意：改错类型后该镜像可能在作业创建页「消失」，用 crater_images_available 验证改动是否符合预期。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 镜像 ID |
| `taskType` | 新的任务类型（JobType），如 jupyter、webide、training、pytorch、tensorflow、custom |

### `crater_images_quota_update` — 改 Harbor 项目存储配额

- 接口：`POST /api/v1/images/quota`
- 作用域：账号内；写操作

```text
把「我」的 Harbor 镜像项目存储配额改成 size（整数，单位与 crater_images_quota 返回的 quota 一致，实测为 GB 量级，最大不超过平台上限）。配额满了就构建不出镜像，所以扩容后才好继续构建。注意：这是账号资源上限，改小会让现有镜像超出配额、后续构建直接失败；先 crater_images_quota 看 used 再决定。
```

| 参数 | 说明 |
| --- | --- |
| `size` | 新的配额大小（整数），请对照 crater_images_quota 返回的 quota 单位填写 |

### `crater_images_share` — 共享镜像给用户或账号

- 接口：`POST /api/v1/images/share`
- 作用域：仅本人；写操作

```text
把自己的镜像分享给别人：imageID 指定镜像，idList 指定被分享对象 ID 列表，type 决定对象是用户（user）还是账号（account）。前置：先用 crater_images_share_ungranted_users（用户）或 crater_images_share_ungranted_accounts（账号）拿到尚未授权的 ID。注意：分享给账号 = 该账号全体成员都能用，权限面很大；分享不改变归属，对方不能删你的镜像，但你可以随时取消（crater_images_unshare）。
```

| 参数 | 说明 |
| --- | --- |
| `imageID` | 要分享的镜像 ID（必须是自己拥有的镜像） |
| `idList` | 被分享对象的 ID 列表（type=user 时是用户 ID，type=account 时是账号 ID） |
| `type` | 分享对象类型：user=指定用户，account=整个账号（项目） |

### `crater_images_unshare` — 取消镜像共享

- 接口：`DELETE /api/v1/images/share`
- 作用域：仅本人；写操作

```text
撤销某个镜像对某个用户或账号的授权。id 是被撤销的授权对象 ID（用户 ID 或账号 ID），imageID 是镜像 ID，type 与分享时一致。前置：用 crater_images_share_granted 查到当前已授权的 userList / accountList 再填。注意：撤销后对方立刻无法再用该镜像启动作业，已在运行的作业不受影响。
```

| 参数 | 说明 |
| --- | --- |
| `imageID` | 镜像 ID |
| `id` | 要撤销的授权对象 ID（用户 ID 或账号 ID） |
| `type` | 授权对象类型：user 或 account（与分享时保持一致） |

### `crater_images_delete` — 批量删除我的镜像

- 接口：`POST /api/v1/images/deleteimage`
- 作用域：仅本人；写操作（destructive）

```text
按 ID 列表批量删除自己拥有的镜像（后端逐个校验 owner）。用它可以一次清理多个镜像、腾出 Harbor 配额。注意：删除**不可恢复**，且可能连带影响引用该镜像的历史作业/他人共享（先用 crater_images_share_granted 确认共享情况）；空间回收有延迟，删完 crater_images_quota 的 used 不会立刻下降。
```

| 参数 | 说明 |
| --- | --- |
| `idList` | 要删除的镜像 ID 列表（必须是自己的镜像；ID 取自列表元素的大写 ID 字段，idList 为必填） |

### `crater_images_delete_one` — 按 ID 删除单个镜像

- 接口：`DELETE /api/v1/images/image/:id`
- 作用域：仅本人；写操作（destructive）

```text
按路径中的镜像 ID 删除单个镜像（仅 owner 可用），是 crater_images_delete 的单条版本，调用语义更直观。注意：删除**不可恢复**；若只是想取消一次构建任务记录，别用这个，用 crater_images_kaniko_cancel。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 镜像 ID（crater_images_list 返回元素里的大写 ID 字段） |

### `crater_images_kaniko_cancel` — 删除/取消构建任务记录

- 接口：`POST /api/v1/images/remove`
- 作用域：仅本人；写操作（destructive）

```text
按构建任务 ID 删除（取消）我的一条 kaniko 构建记录，用于清理构建失败留下的垃圾记录。注意：它删除的是**构建任务记录**，不等于删除已构建出来的镜像（后者用 crater_images_delete）；操作不可恢复；若构建仍在进行中，进度查询会随之消失。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 构建任务 ID（crater_images_kaniko_list 里的 ID 字段） |

</details>


## files

| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `crater_files_my_space` | GET | `/api/ss/userspace` | 仅本人 | 只读 | 查我自己的个人空间入口，并给出可直接使用的逻辑路径示例。注意：后端 GET /api/ss/userspace 只对平台管理员开放（storage/file.go GetUserSpace 里 RolePlatform!=admin 直接报错），非管理员会拿到 available=false + 提示——此时直接用 c |
| `crater_files_account_space` | GET | `/api/ss/queuespace` | 账号内 | 只读 | 查当前账号（Crater 里叫 queue/项目，如 q-3）的共享空间入口。注意：GET /api/ss/queuespace 同样只对平台管理员开放，非管理员会拿到 available=false；普通用户直接用逻辑路径 account（如 account/shared/data.csv），写权限取决于你在账号内的 |
| `crater_files_list` | GET | `/api/ss/files/*path` | 仅本人 | 只读 | 列某个空间目录的内容，条目含 name/path/isDir/size/modifyTime，并附带按空间根推导的读写权限。默认只列一层，可用 depth 递归展开、page/pageSize 分页；rw=true 走 /api/ss/rwfiles（只列你有写权限的空间）。注意：路径要写逻辑路径（user/… 或 a |
| `crater_files_admin_list` | GET | `/api/ss/admin/files/*path` | 管理员 | 只读 | 管理员视角列目录（GET /api/ss/admin/files），根上能同时看到 user / account / public，并可用 admin-user/<space>、admin-account/<space>、admin-public 进入别人的空间。需要平台管理员（RolePlatform==3），非管理 |
| `crater_files_download` | GET | `/api/ss/download/*path` | 仅本人 | 只读 | 把远端逻辑路径的文件下载到 MCP 所在机器的 CRATER_WORK_DIR 之内，返回落地绝对路径与字节数（不回传二进制内容）。本地路径必须是相对 CRATER_WORK_DIR 的相对路径或该目录内的绝对路径，越界（..、符号链接指向外部）会被直接拒绝；文件会整体读进内存，默认上限 512MiB，超过请显式调大  |
| `crater_files_upload` | PUT | `/api/ss/*path` | 仅本人 | 写 | 把 CRATER_WORK_DIR 之内的本地文件按裸字节写入远端逻辑路径（线上走 WebDAV PUT /api/ss/<路径>，因为 POST /api/ss/upload 在该镜像上 404）。overwrite=false（默认）时若远端已存在会报 409 而不是静默覆盖；父目录必须已存在，需要先 crater |
| `crater_files_mkdir` | MKCOL | `/api/ss/*path` | 仅本人 | 写 | 用 WebDAV MKCOL 在空间里建一个目录；只能建一级——父目录必须已存在，否则后端返回 409（directory parent is unavailable），需要多级就按层级依次调用或先把父级建好。目标已存在时直接返回 alreadyExists，不改动现有内容。 |
| `crater_files_delete` | DELETE | `/api/ss/delete/*path` | 仅本人 | **写（destructive）** | 调用 DELETE /api/ss/delete/<逻辑路径>，后端是 RemoveAll 语义：目录会连整棵子树一起删除，且对不存在的路径也返回成功（幂等）。因为危险，删目录时必须显式传 recursive=true；无法确认目标类型时也要求 recursive=true。删除没有回收站，不可恢复。 |
| `crater_files_move` | POST | `/api/ss/move/*path` | 仅本人 | **写（destructive）** | POST /api/ss/move/<源逻辑路径>，body {dst}，用于重命名或在空间间移动。源与目标都必须有写权限（ReadWrite），目标已存在时后端会直接报错（移动不覆盖），目标父目录不存在时后端会自动创建。标记 destructive 是保守做法：源路径上的原内容会被移走/消失，操作不可撤销。 |
| `crater_files_dataset_browse` | GET | `/api/ss/dataset/:id/*path` | 仅本人 | 只读 | 按数据集 ID 浏览其存储目录（GET /api/ss/dataset/:id[/<相对路径>]），需要该数据集已共享给你或你是管理员，否则后端返回「This dataset does not exist or you do not have permission」。数据集 ID 从 dataset 组工具拿，单个文件 |
| `crater_files_usage` | GET | `/api/ss/usage` | 仅本人 | 只读 | 读 storage-server 的 GET /api/ss/usage，返回每个空间（public / account / user…）的已用字节、文件数与容量。注意主后端的 /api/v1/storage/my-quota 与 dirsize 在当前部署上都是 404，所以配额/用量只能看这个接口。 |
| `crater_files_permission` | GET | `/api/v1/storage/verify` | 仅本人 | 只读 | 读主后端 GET /api/v1/storage/verify，返回 storage-server token 对应的 {userId, rootPath, permission}，permission 1=NotAllowed 2=ReadOnly 3=ReadWrite，rootPath 是当前账号空间的实体名（不 |

<details><summary>参数与完整描述</summary>

### `crater_files_my_space` — 我的用户空间路径

- 接口：`GET /api/ss/userspace`（storage-server）
- 作用域：仅本人；只读

```text
查我自己的个人空间入口，并给出可直接使用的逻辑路径示例。注意：后端 GET /api/ss/userspace 只对平台管理员开放（storage/file.go GetUserSpace 里 RolePlatform!=admin 直接报错），非管理员会拿到 available=false + 提示——此时直接用 crater_files_list 传 path="user" 浏览自己的空间即可。
```

_无参数_

### `crater_files_account_space` — 当前账号空间路径

- 接口：`GET /api/ss/queuespace`（storage-server）
- 作用域：账号内；只读

```text
查当前账号（Crater 里叫 queue/项目，如 q-3）的共享空间入口。注意：GET /api/ss/queuespace 同样只对平台管理员开放，非管理员会拿到 available=false；普通用户直接用逻辑路径 account（如 account/shared/data.csv），写权限取决于你在账号内的访问模式。
```

_无参数_

### `crater_files_list` — 列目录（含空间权限提示）

- 接口：`GET /api/ss/files/*path`（storage-server）
- 作用域：仅本人；只读

```text
列某个空间目录的内容，条目含 name/path/isDir/size/modifyTime，并附带按空间根推导的读写权限。默认只列一层，可用 depth 递归展开、page/pageSize 分页；rw=true 走 /api/ss/rwfiles（只列你有写权限的空间）。注意：路径要写逻辑路径（user/… 或 account/… 或 public/…），指向单个文件时后端只返回空数组。
```

| 参数 | 说明 |
| --- | --- |
| `rw`（可选） | true=改用 /api/ss/rwfiles（只返回你可写的空间；带路径时若无写权限后端直接 401）。默认 false |
| `path`（可选） | 逻辑路径；留空=根（只列出 user / account / public 等空间根）。例：user、user/exp1、public/datasets、admin-user/xxx（仅管理员客户端可用）。 |
| `depth`（可选） | 递归展开层数：0=只列这一层（默认），1=再展开直接子目录，最大 5。目录很多时慎用 |
| `nameContains`（可选） | 按文件名子串过滤（MCP 本地过滤，区分大小写不敏感） |
| `dirsOnly`（可选） | true=只返回目录 |
| `page`（可选） | 分页页码，从 1 开始 |
| `pageSize`（可选） | 每页条数，最大 200 |

### `crater_files_admin_list` — 管理员：列任意空间目录

- 接口：`GET /api/ss/admin/files/*path`（storage-server）
- 作用域：管理员；只读

```text
管理员视角列目录（GET /api/ss/admin/files），根上能同时看到 user / account / public，并可用 admin-user/<space>、admin-account/<space>、admin-public 进入别人的空间。需要平台管理员（RolePlatform==3），非管理员会被后端 401 拒绝。
```

| 参数 | 说明 |
| --- | --- |
| `path`（可选） | 逻辑路径；留空=根（只列出 user / account / public 等空间根）。例：user、user/exp1、public/datasets、admin-user/xxx（仅管理员客户端可用）。 |
| `depth`（可选） | 递归展开层数：0=只列这一层（默认），1=再展开直接子目录，最大 5。目录很多时慎用 |
| `nameContains`（可选） | 按文件名子串过滤（MCP 本地过滤，区分大小写不敏感） |
| `dirsOnly`（可选） | true=只返回目录 |
| `page`（可选） | 分页页码，从 1 开始 |
| `pageSize`（可选） | 每页条数，最大 200 |

### `crater_files_download` — 下载文件到本机工作目录

- 接口：`GET /api/ss/download/*path`（storage-server）
- 作用域：仅本人；只读

```text
把远端逻辑路径的文件下载到 MCP 所在机器的 CRATER_WORK_DIR 之内，返回落地绝对路径与字节数（不回传二进制内容）。本地路径必须是相对 CRATER_WORK_DIR 的相对路径或该目录内的绝对路径，越界（..、符号链接指向外部）会被直接拒绝；文件会整体读进内存，默认上限 512MiB，超过请显式调大 maxBytes 或改用作业/rsync。
```

| 参数 | 说明 |
| --- | --- |
| `path` | 远端逻辑路径，如 user/exp1/result.csv |
| `localPath`（可选） | 落地路径（相对 CRATER_WORK_DIR）；不填则用远端文件名放在 CRATER_WORK_DIR 根下。禁止绝对路径逃逸或 .. |
| `overwrite`（可选） | 本地已存在同名文件时是否覆盖，默认 false（存在则报错，不静默覆盖） |
| `maxBytes`（可选） | 允许的最大字节数，默认 536870912（512MiB）；超出会在下载前报错 |

### `crater_files_upload` — 上传本机文件到空间

- 接口：`PUT /api/ss/*path`（storage-server）
- 作用域：仅本人；写操作

```text
把 CRATER_WORK_DIR 之内的本地文件按裸字节写入远端逻辑路径（线上走 WebDAV PUT /api/ss/<路径>，因为 POST /api/ss/upload 在该镜像上 404）。overwrite=false（默认）时若远端已存在会报 409 而不是静默覆盖；父目录必须已存在，需要先 crater_files_mkdir。只读账号（accessMode=ReadOnly）写 account/public 会被后端 401 拒绝，user 空间恒可写。
```

| 参数 | 说明 |
| --- | --- |
| `localPath` | 本地文件路径（相对 CRATER_WORK_DIR，或该目录内的绝对路径）；越界会被拒绝 |
| `path` | 远端逻辑路径，如 user/exp1/data.csv；不能只给空间根（父目录不存在时会自动逐级创建） |
| `overwrite`（可选） | 远端已存在时是否覆盖，默认 false（存在则报 409） |
| `maxBytes`（可选） | 允许上传的最大字节数，默认 536870912（512MiB） |

### `crater_files_mkdir` — 新建目录（单级）

- 接口：`MKCOL /api/ss/*path`（storage-server）
- 作用域：仅本人；写操作

```text
用 WebDAV MKCOL 在空间里建一个目录；只能建一级——父目录必须已存在，否则后端返回 409（directory parent is unavailable），需要多级就按层级依次调用或先把父级建好。目标已存在时直接返回 alreadyExists，不改动现有内容。
```

| 参数 | 说明 |
| --- | --- |
| `path` | 要创建的逻辑目录路径，如 user/exp1/checkpoints（父目录 user/exp1 必须已存在） |

### `crater_files_delete` — 删除文件或目录（不可恢复）

- 接口：`DELETE /api/ss/delete/*path`（storage-server）
- 作用域：仅本人；写操作（destructive）

```text
调用 DELETE /api/ss/delete/<逻辑路径>，后端是 RemoveAll 语义：目录会连整棵子树一起删除，且对不存在的路径也返回成功（幂等）。因为危险，删目录时必须显式传 recursive=true；无法确认目标类型时也要求 recursive=true。删除没有回收站，不可恢复。
```

| 参数 | 说明 |
| --- | --- |
| `path` | 要删除的逻辑路径，如 user/exp1/old.log |
| `recursive`（可选） | 删除目录（或无法确认类型）时必须显式传 true；只删单个文件可以不传 |

### `crater_files_move` — 移动/重命名

- 接口：`POST /api/ss/move/*path`（storage-server）
- 作用域：仅本人；写操作（destructive）

```text
POST /api/ss/move/<源逻辑路径>，body {dst}，用于重命名或在空间间移动。源与目标都必须有写权限（ReadWrite），目标已存在时后端会直接报错（移动不覆盖），目标父目录不存在时后端会自动创建。标记 destructive 是保守做法：源路径上的原内容会被移走/消失，操作不可撤销。
```

| 参数 | 说明 |
| --- | --- |
| `path` | 源逻辑路径，如 user/exp1/old-name.txt |
| `dst` | 目标逻辑路径（含新名字），如 user/exp1/new-name.txt |

### `crater_files_dataset_browse` — 浏览数据集目录

- 接口：`GET /api/ss/dataset/:id/*path`（storage-server）
- 作用域：仅本人；只读

```text
按数据集 ID 浏览其存储目录（GET /api/ss/dataset/:id[/<相对路径>]），需要该数据集已共享给你或你是管理员，否则后端返回「This dataset does not exist or you do not have permission」。数据集 ID 从 dataset 组工具拿，单个文件型数据集会直接返回该文件本身。
```

| 参数 | 说明 |
| --- | --- |
| `datasetId` | 数据集 ID |
| `path`（可选） | 数据集内的相对路径，留空=数据集根 |
| `page`（可选） | 分页页码，从 1 开始 |
| `pageSize`（可选） | 每页条数，最大 200 |

### `crater_files_usage` — 各空间存储用量

- 接口：`GET /api/ss/usage`（storage-server）
- 作用域：仅本人；只读

```text
读 storage-server 的 GET /api/ss/usage，返回每个空间（public / account / user…）的已用字节、文件数与容量。注意主后端的 /api/v1/storage/my-quota 与 dirsize 在当前部署上都是 404，所以配额/用量只能看这个接口。
```

_无参数_

### `crater_files_permission` — 后端给我的存储权限

- 接口：`GET /api/v1/storage/verify`
- 作用域：仅本人；只读

```text
读主后端 GET /api/v1/storage/verify，返回 storage-server token 对应的 {userId, rootPath, permission}，permission 1=NotAllowed 2=ReadOnly 3=ReadWrite，rootPath 是当前账号空间的实体名（不是逻辑路径）。写操作被 401/403 拒绝时用它先排查自己是 RO 还是 NA。
```

_无参数_

</details>


## resources

| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `crater_resources_list` | GET | `/api/v1/resources` | 账号内 | 只读 | 列出集群在册的资源型号：GPU（如 nvidia.com/v100）、vGPU、RDMA 网络、CPU、内存、hugepages 等，含总量 amount、单卡上限 amountSingleMax、标签 label 与数字 ID。提交作业前先调它确认可申请的 accelerator 名字与规格；withVendorDo |
| `crater_resources_networks` | GET | `/api/v1/resources/:id/networks` | 账号内 | 只读 | 查某个 GPU 资源型号关联的 RDMA/RoCE 网络资源（多机分布式训练需要选对网络时用）。id 必须是 crater_resources_list 里的数字 ID；资源不是 GPU 类型或未配置关联时后端返回空数组，不会报错。关联关系是数据库里的配置快照（只有管理员改过才会变），用于提交多机作业前判断网络够不够、 |
| `crater_resources_vgpu` | GET | `/api/v1/resources/:id/vgpu` | 账号内 | 只读 | 查某个 GPU 资源型号能切分出的 vGPU 资源及其约束（vGPU 资源、最小/最大切分粒度），用于判断能否申请 1/4 卡之类的切分规格。id 必须是 crater_resources_list 里的数字 ID；未配置 vGPU 时返回空数组。切分配置是数据库快照（仅管理员可改），用于提交小规格作业前判断能申请多大 |
| `crater_resources_prices` | GET | `/api/v1/resources/billing/prices` | 账号内 | 只读 | 返回各资源的计费单价（每单位时间的点数）。只有平台开启计费且对用户可见时单价才非 0，否则全是 0（说明本部署不计费）。用它估算一次作业的花费；自己还剩多少额度请看 crater_stats_mine 或 crater_profile_billing_summary。单价是快照，管理员改价后新作业立即按新价计。 |
| `crater_nodes_list` | GET | `/api/v1/nodes` | 账号内 | 只读 | 列出所有节点的角色（control-plane/worker）、状态、capacity/allocatable/used、在跑作业数（workloads）、GPU 驱动与地址。用于提交前判断集群整体还有没有空闲卡、节点是否 Ready 或不可调度（Unschedulable）；单节点细节用 crater_nodes_g |
| `crater_nodes_get` | GET | `/api/v1/nodes/:name` | 账号内 | 只读 | 返回单个节点的详细信息：capacity/allocatable/used、GPU 型号与数量、显存、GPU 架构与驱动、容器运行时、内核版本等。节点名必须精确匹配，建议先用 crater_nodes_list 拿名字；名字写错后端返回 500『Node "xxx" not found』而不是空结果。这些数字来自数据库 |
| `crater_nodes_gpu` | GET | `/api/v1/nodes/:name/gpu` | 账号内 | 只读 | 列出某节点的 GPU 明细：每种 GPU 的资源名/型号/数量/显存/架构/驱动/CUDA，每张卡的利用率（gpuUtil）与关联作业（relateJobs）。用于判断该节点是否还有整卡空闲；haveGPU=false 表示该节点没有 GPU（此时 gpuDevices 为空）。这些数字来自数据库 / Promethe |
| `crater_nodes_pods` | GET | `/api/v1/nodes/:name/pods` | 账号内 | 只读 | 列出某节点上正在运行的 Pod（命名空间、状态、requests/limits、占用者用户名与账号、是否被锁定），用于看节点被谁占满、哪些 Pod 占着卡。这是集群级只读视图，含他人 Pod 的基本信息，只用于容量判断；它不返回日志/终端（Pod 日志与 exec 属于本 MCP 明确不封装的 /api/v1/name |
| `crater_stats_overview` | GET | `/api/v1/nodes` | 账号内 | 只读 | 提交作业前的一次性概览：把资源型号清单、节点状态汇总（按状态计数 + 各类 GPU 的 allocatable 总量）与「我的用量」拼成一份快照，用来判断「还有没有卡、我还能不能用」。它由 3 个只读接口拼成（/api/v1/resources、/api/v1/nodes、/api/v1/context/job-res |
| `crater_stats_mine` | GET | `/api/v1/context/job-resource-summary` | 仅本人 | 只读 | 只看「我自己 + 当前账号」维度的用量统计：Volcano 配额与已用（context/quota）、运行/排队作业数与 CPU/内存/各加速器的 used/running/pending/limit（context/job-resource-summary）、计费余额（context/billing/summary） |
| `crater_context_attributes` | GET | `/api/auth/check` | 仅本人 | 只读 | 返回当前上下文的属性：所属账号（队列）、平台角色、账号内角色、访问模式（RO/RW/AO）、存储空间前缀，以及我的资料字段（昵称、邮箱、电话、导师、课题组、头像、UID/GID）。后端**没有** GET /api/v1/context/attributes（实测 404，属性只有 PUT），所以这里读的是 /api/ |
| `crater_context_prequeue` | GET | `/api/v1/context/prequeue` | 仅本人 | 只读 | 返回排队预检（scheduler extender 的回填 / prequeue）开关状态，例如 backfillEnabled：用来判断当前集群是否接受排队作业、排队回填是否生效。它只有开关信息，不含「我提这个规格会不会超限」的判定；后端没有 /admin/system-config/prequeue 之类的路由，某 |

<details><summary>参数与完整描述</summary>

### `crater_resources_list` — 资源型号与总量清单

- 接口：`GET /api/v1/resources`
- 作用域：账号内；只读

```text
列出集群在册的资源型号：GPU（如 nvidia.com/v100）、vGPU、RDMA 网络、CPU、内存、hugepages 等，含总量 amount、单卡上限 amountSingleMax、标签 label 与数字 ID。提交作业前先调它确认可申请的 accelerator 名字与规格；withVendorDomain=true 只看 GPU 类资源。这些数字来自数据库 / Prometheus / kubelet 快照（秒级到分钟级延迟），只用于「提交作业前判断资源够不够」，实时余量与最终排队结果以调度器为准。注意这里的 amount 是集群总量，不是当前空闲量——空闲情况请看 crater_stats_overview 或 crater_nodes_list。
```

| 参数 | 说明 |
| --- | --- |
| `withVendorDomain`（可选） | 是否只返回 GPU 类型资源（后端按 type=gpu 过滤，默认 false 返回全部资源） |

### `crater_resources_networks` — GPU 关联的 RDMA 网络

- 接口：`GET /api/v1/resources/:id/networks`
- 作用域：账号内；只读

```text
查某个 GPU 资源型号关联的 RDMA/RoCE 网络资源（多机分布式训练需要选对网络时用）。id 必须是 crater_resources_list 里的数字 ID；资源不是 GPU 类型或未配置关联时后端返回空数组，不会报错。关联关系是数据库里的配置快照（只有管理员改过才会变），用于提交多机作业前判断网络够不够、该选哪种互联。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 资源 ID（数字主键，从 crater_resources_list 返回的 ID 字段取，不是资源名如 nvidia.com/v100） |

### `crater_resources_vgpu` — GPU 切分 vGPU 配置

- 接口：`GET /api/v1/resources/:id/vgpu`
- 作用域：账号内；只读

```text
查某个 GPU 资源型号能切分出的 vGPU 资源及其约束（vGPU 资源、最小/最大切分粒度），用于判断能否申请 1/4 卡之类的切分规格。id 必须是 crater_resources_list 里的数字 ID；未配置 vGPU 时返回空数组。切分配置是数据库快照（仅管理员可改），用于提交小规格作业前判断能申请多大切分的卡。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 资源 ID（数字主键，从 crater_resources_list 返回的 ID 字段取，不是资源名如 nvidia.com/v100） |

### `crater_resources_prices` — 资源计费单价

- 接口：`GET /api/v1/resources/billing/prices`
- 作用域：账号内；只读

```text
返回各资源的计费单价（每单位时间的点数）。只有平台开启计费且对用户可见时单价才非 0，否则全是 0（说明本部署不计费）。用它估算一次作业的花费；自己还剩多少额度请看 crater_stats_mine 或 crater_profile_billing_summary。单价是快照，管理员改价后新作业立即按新价计。
```

_无参数_

### `crater_nodes_list` — 集群节点列表

- 接口：`GET /api/v1/nodes`
- 作用域：账号内；只读

```text
列出所有节点的角色（control-plane/worker）、状态、capacity/allocatable/used、在跑作业数（workloads）、GPU 驱动与地址。用于提交前判断集群整体还有没有空闲卡、节点是否 Ready 或不可调度（Unschedulable）；单节点细节用 crater_nodes_get。这些数字来自数据库 / Prometheus / kubelet 快照（秒级到分钟级延迟），只用于「提交作业前判断资源够不够」，实时余量与最终排队结果以调度器为准。
```

_无参数_

### `crater_nodes_get` — 节点详情

- 接口：`GET /api/v1/nodes/:name`
- 作用域：账号内；只读

```text
返回单个节点的详细信息：capacity/allocatable/used、GPU 型号与数量、显存、GPU 架构与驱动、容器运行时、内核版本等。节点名必须精确匹配，建议先用 crater_nodes_list 拿名字；名字写错后端返回 500『Node "xxx" not found』而不是空结果。这些数字来自数据库 / Prometheus / kubelet 快照（秒级到分钟级延迟），只用于「提交作业前判断资源够不够」，实时余量与最终排队结果以调度器为准。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 节点名，例如 gpu004（需与 crater_nodes_list 的 name 完全一致） |

### `crater_nodes_gpu` — 节点 GPU 明细

- 接口：`GET /api/v1/nodes/:name/gpu`
- 作用域：账号内；只读

```text
列出某节点的 GPU 明细：每种 GPU 的资源名/型号/数量/显存/架构/驱动/CUDA，每张卡的利用率（gpuUtil）与关联作业（relateJobs）。用于判断该节点是否还有整卡空闲；haveGPU=false 表示该节点没有 GPU（此时 gpuDevices 为空）。这些数字来自数据库 / Prometheus / kubelet 快照（秒级到分钟级延迟），只用于「提交作业前判断资源够不够」，实时余量与最终排队结果以调度器为准。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 节点名，需与 crater_nodes_list 的 name 完全一致 |

### `crater_nodes_pods` — 节点上的 Pod 列表

- 接口：`GET /api/v1/nodes/:name/pods`
- 作用域：账号内；只读

```text
列出某节点上正在运行的 Pod（命名空间、状态、requests/limits、占用者用户名与账号、是否被锁定），用于看节点被谁占满、哪些 Pod 占着卡。这是集群级只读视图，含他人 Pod 的基本信息，只用于容量判断；它不返回日志/终端（Pod 日志与 exec 属于本 MCP 明确不封装的 /api/v1/namespaces/**）。这些数字来自数据库 / Prometheus / kubelet 快照（秒级到分钟级延迟），只用于「提交作业前判断资源够不够」，实时余量与最终排队结果以调度器为准。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 节点名，需与 crater_nodes_list 的 name 完全一致 |

### `crater_stats_overview` — 资源概览（够不够用）

- 接口：`GET /api/v1/nodes`
- 作用域：账号内；只读

```text
提交作业前的一次性概览：把资源型号清单、节点状态汇总（按状态计数 + 各类 GPU 的 allocatable 总量）与「我的用量」拼成一份快照，用来判断「还有没有卡、我还能不能用」。它由 3 个只读接口拼成（/api/v1/resources、/api/v1/nodes、/api/v1/context/job-resource-summary），**不是** GET /api/v1/statistics——后者支持跨用户维度，非管理员会被 MCP 拦下。这些数字来自数据库 / Prometheus / kubelet 快照（秒级到分钟级延迟），只用于「提交作业前判断资源够不够」，实时余量与最终排队结果以调度器为准。某一个子接口失败时会在 errors 里说明，其余部分照常返回。
```

_无参数_

### `crater_stats_mine` — 我的用量统计

- 接口：`GET /api/v1/context/job-resource-summary`
- 作用域：仅本人；只读

```text
只看「我自己 + 当前账号」维度的用量统计：Volcano 配额与已用（context/quota）、运行/排队作业数与 CPU/内存/各加速器的 used/running/pending/limit（context/job-resource-summary）、计费余额（context/billing/summary）。三个接口后端都按 UserID+AccountID 过滤，所以看不到任何他人数据——本组刻意不封装 GET /api/v1/statistics（它支持 scope=user 查任意用户 / scope=cluster 查全平台，非管理员会被 MCP 拦截）。这些数字来自数据库 / Prometheus / kubelet 快照（秒级到分钟级延迟），只用于「提交作业前判断资源够不够」，实时余量与最终排队结果以调度器为准。
```

_无参数_

### `crater_context_attributes` — 当前上下文属性

- 接口：`GET /api/auth/check`
- 作用域：仅本人；只读

```text
返回当前上下文的属性：所属账号（队列）、平台角色、账号内角色、访问模式（RO/RW/AO）、存储空间前缀，以及我的资料字段（昵称、邮箱、电话、导师、课题组、头像、UID/GID）。后端**没有** GET /api/v1/context/attributes（实测 404，属性只有 PUT），所以这里读的是 /api/auth/check 的 context/user；要修改资料请用 crater_profile_update（PUT 整体覆盖语义）。
```

_无参数_

### `crater_context_prequeue` — 排队预检开关状态

- 接口：`GET /api/v1/context/prequeue`
- 作用域：仅本人；只读

```text
返回排队预检（scheduler extender 的回填 / prequeue）开关状态，例如 backfillEnabled：用来判断当前集群是否接受排队作业、排队回填是否生效。它只有开关信息，不含「我提这个规格会不会超限」的判定；后端没有 /admin/system-config/prequeue 之类的路由，某些旧部署上该端点会返回 404。这些数字来自数据库 / Prometheus / kubelet 快照（秒级到分钟级延迟），只用于「提交作业前判断资源够不够」，实时余量与最终排队结果以调度器为准。
```

_无参数_

</details>


## datasets

| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `crater_datasets_mine` | GET | `/api/v1/dataset/mydataset` | 账号内 | 只读 | 列出当前身份**可见**的数据集：我创建的 + 直接共享给我的 + 共享给我所在账号（含默认账号）的。本组其它工具要的 id 都从这里取。返回已裁剪成关键字段，可用 keyword/type/ownedOnly 在本地过滤。注意：同名数据集是允许的（靠 id 区分），改/删前请确认 owned=true。 |
| `crater_datasets_get` | GET | `/api/v1/dataset/mydataset` | 账号内 | 只读 | 按 id 或 name 取数据集详情：存储路径、描述、标签、类型、容量、挂载数、创建者、是否可编辑。它**不**调用 GET /api/v1/dataset/detail/:id（那个接口只按 ID 查、不校验归属，本 MCP 不暴露它），而是在「我的可见集合」里精确命中，命中不了就报错，所以不可能读到没共享给你的数据 |
| `crater_datasets_shared_users` | GET | `/api/v1/dataset/:datasetId/usersIn` | 账号内 | 只读 | 列出该数据集已共享的用户（GET /:datasetId/usersIn，isowner=true 的那条就是创建者）。先会校验数据集在你可见范围内，避免拿任意 ID 探别人的共享关系。用于回答「谁能看这个数据集」，也可用来挑出要取消分享的 userID（配合 crater_datasets_unshare_user） |
| `crater_datasets_unshared_users` | GET | `/api/v1/dataset/:datasetId/usersNotIn` | 账号内 | 只读 | 列出**还没有**被共享该数据集的活跃用户（GET /:datasetId/usersNotIn），即 crater_datasets_share_user 的候选名单；先会校验数据集在你可见范围内。返回项里的 id 就是分享时要传的 userID。提醒：接口返回的是用户属性对象（id 来自属性表），若某条缺 id，请 |
| `crater_datasets_shared_queues` | GET | `/api/v1/dataset/:datasetId/queuesIn` | 账号内 | 只读 | 列出该数据集已共享的账号/队列（GET /:datasetId/queuesIn；这里的 id 是**账号 ID**，不是账号名）。先会校验数据集在你可见范围内。分享给账号 = 该账号全体成员都能看到，所以这份名单等于「整账号可见」的范围。 |
| `crater_datasets_unshared_queues` | GET | `/api/v1/dataset/:datasetId/queuesNotIn` | 账号内 | 只读 | 列出**还没有**被共享该数据集的账号/队列（GET /:datasetId/queuesNotIn），即 crater_datasets_share_queue 的候选名单；先会校验数据集在你可见范围内。返回的 id 就是要传给 queueIDs 的账号 ID。 |
| `crater_datasets_create` | POST | `/api/v1/dataset/create` | 仅本人 | 写 | 登记一个新的数据集/模型条目（只是元数据，指向存储里已存在的一个目录）。必填 name/describe/url；url 必须以 user/（我的空间）、account/（当前账号空间）或 public/（公共只读）开头，建议先用 files 组的工具把目录建好、数据传完再登记。坑：成功时后端只回一句字符串、不回新 i |
| `crater_datasets_update` | POST | `/api/v1/dataset/update` | 仅本人 | 写 | 改数据集的 name / 描述 / url / 标签（只有创建者或平台管理员能改）。接口本身要求 name/describe/url 全量必填，本工具会先用 crater_datasets_mine 的现值补齐你没传的字段，tags 是全量替换（不传则沿用原标签）；type（dataset/model）和 ispubl |
| `crater_datasets_delete` | DELETE | `/api/v1/dataset/delete/:id` | 仅本人 | **写（destructive）** | 删除数据集条目，并连带清掉它的 user_dataset / account_dataset 共享关系（只有创建者或平台管理员能删）。**不会**删存储里的实际文件——目录还在，要清数据请再用 files 组删目录。这是不可逆操作，删前建议先 crater_datasets_get 确认 id 和名字。 |
| `crater_datasets_share_user` | POST | `/api/v1/dataset/share/user` | 仅本人 | 写 | 把数据集共享给一批用户（userIDs 是用户 ID，可从 crater_datasets_unshared_users 取）；只有创建者能分享。分享后对方在 mydataset 里就能看到并可挂载/下载（下载还要求对方没被封禁 DatasetDownload 能力）。坑：后端是逐个插入，遇到「该用户已共享过」会整体报 |
| `crater_datasets_share_queue` | POST | `/api/v1/dataset/share/queue` | 仅本人 | 写 | 把数据集共享给整个账号/队列（queueIDs 是**账号 ID**，不是账号名，可从 crater_datasets_unshared_queues 取）；只有创建者能分享。分享给账号 = 该账号**全体成员**都能看到并能挂载/下载这个数据集。坑：同样逐个插入，遇到「该账号已共享」会整体报错且前面已生效，批量前先用 |
| `crater_datasets_unshare_user` | POST | `/api/v1/dataset/cancelshare/user` | 仅本人 | **写（destructive）** | 取消该数据集对某个用户的共享（一次一个 userID，只有创建者能取消；可用 crater_datasets_shared_users 查当前名单）。取消后对方的 mydataset 里就看不到它了；如果对方是通过账号共享看到它的，取消用户级分享并不会让他看不到。注意：不能取消创建者自己（后端报 can't cance |
| `crater_datasets_unshare_queue` | POST | `/api/v1/dataset/cancelshare/queue` | 仅本人 | **写（destructive）** | 取消该数据集对某个账号/队列的共享（一次一个 queueID=账号 ID，只有创建者能取消；当前名单用 crater_datasets_shared_queues 查）。取消后该账号的普通成员就不再通过账号维度看到它（若他们同时被单独共享过，仍然可见）。未共享过的账号会报 the dataset was not sha |

<details><summary>参数与完整描述</summary>

### `crater_datasets_mine` — 我的数据集列表

- 接口：`GET /api/v1/dataset/mydataset`
- 作用域：账号内；只读

```text
列出当前身份**可见**的数据集：我创建的 + 直接共享给我的 + 共享给我所在账号（含默认账号）的。本组其它工具要的 id 都从这里取。返回已裁剪成关键字段，可用 keyword/type/ownedOnly 在本地过滤。注意：同名数据集是允许的（靠 id 区分），改/删前请确认 owned=true。
```

| 参数 | 说明 |
| --- | --- |
| `keyword`（可选） | 按名字/描述做不区分大小写的子串过滤 |
| `type`（可选） | 条目类型：dataset=数据集 model=模型 sharefile=共享文件（后端默认 dataset） |
| `ownedOnly`（可选） | true=只返回我创建的（即我拥有改/删/分享权的那部分） |

### `crater_datasets_get` — 数据集详情（仅限你可见的）

- 接口：`GET /api/v1/dataset/mydataset`
- 作用域：账号内；只读

```text
按 id 或 name 取数据集详情：存储路径、描述、标签、类型、容量、挂载数、创建者、是否可编辑。它**不**调用 GET /api/v1/dataset/detail/:id（那个接口只按 ID 查、不校验归属，本 MCP 不暴露它），而是在「我的可见集合」里精确命中，命中不了就报错，所以不可能读到没共享给你的数据集。浏览/下载里面的文件请用 files 组的 crater_files_dataset_browse（数据集下载要求账号未被封禁 DatasetDownload 能力，否则 storage-server 返回 403）。
```

| 参数 | 说明 |
| --- | --- |
| `id`（可选） | 数据集 ID（来自 crater_datasets_mine；与 name 至少给一个） |
| `name`（可选） | 数据集名（与 id 至少给一个；同名多条时请改用 id） |

### `crater_datasets_shared_users` — 数据集已共享给哪些用户

- 接口：`GET /api/v1/dataset/:datasetId/usersIn`
- 作用域：账号内；只读

```text
列出该数据集已共享的用户（GET /:datasetId/usersIn，isowner=true 的那条就是创建者）。先会校验数据集在你可见范围内，避免拿任意 ID 探别人的共享关系。用于回答「谁能看这个数据集」，也可用来挑出要取消分享的 userID（配合 crater_datasets_unshare_user）。
```

| 参数 | 说明 |
| --- | --- |
| `datasetId` | 数据集 ID（就是 crater_datasets_mine 里的 id），查已共享用户 |

### `crater_datasets_unshared_users` — 数据集可分享给哪些用户

- 接口：`GET /api/v1/dataset/:datasetId/usersNotIn`
- 作用域：账号内；只读

```text
列出**还没有**被共享该数据集的活跃用户（GET /:datasetId/usersNotIn），即 crater_datasets_share_user 的候选名单；先会校验数据集在你可见范围内。返回项里的 id 就是分享时要传的 userID。提醒：接口返回的是用户属性对象（id 来自属性表），若某条缺 id，请让用户在网页端确认后再分享。
```

| 参数 | 说明 |
| --- | --- |
| `datasetId` | 数据集 ID（就是 crater_datasets_mine 里的 id），查未共享用户 |

### `crater_datasets_shared_queues` — 数据集已共享给哪些账号

- 接口：`GET /api/v1/dataset/:datasetId/queuesIn`
- 作用域：账号内；只读

```text
列出该数据集已共享的账号/队列（GET /:datasetId/queuesIn；这里的 id 是**账号 ID**，不是账号名）。先会校验数据集在你可见范围内。分享给账号 = 该账号全体成员都能看到，所以这份名单等于「整账号可见」的范围。
```

| 参数 | 说明 |
| --- | --- |
| `datasetId` | 数据集 ID（就是 crater_datasets_mine 里的 id），查已共享账号 |

### `crater_datasets_unshared_queues` — 数据集可分享给哪些账号

- 接口：`GET /api/v1/dataset/:datasetId/queuesNotIn`
- 作用域：账号内；只读

```text
列出**还没有**被共享该数据集的账号/队列（GET /:datasetId/queuesNotIn），即 crater_datasets_share_queue 的候选名单；先会校验数据集在你可见范围内。返回的 id 就是要传给 queueIDs 的账号 ID。
```

| 参数 | 说明 |
| --- | --- |
| `datasetId` | 数据集 ID（就是 crater_datasets_mine 里的 id），查未共享账号 |

### `crater_datasets_create` — 创建数据集

- 接口：`POST /api/v1/dataset/create`
- 作用域：仅本人；写操作

```text
登记一个新的数据集/模型条目（只是元数据，指向存储里已存在的一个目录）。必填 name/describe/url；url 必须以 user/（我的空间）、account/（当前账号空间）或 public/（公共只读）开头，建议先用 files 组的工具把目录建好、数据传完再登记。坑：成功时后端只回一句字符串、不回新 id，需要再调 crater_datasets_mine 拿 id；ispublic=true 会把数据集塞进默认账号（等于全平台可见），别随便置 true。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 数据集名（展示用，允许同名，靠 id 区分） |
| `url` | 存储逻辑路径，必须 user/ 或 account/ 或 public/ 开头，例如 user/datasets/coco2017 |
| `describe` | 描述（必填，别传空） |
| `type`（可选） | 条目类型：dataset=数据集 model=模型 sharefile=共享文件（后端默认 dataset） |
| `tags`（可选） | 标签列表 |
| `weburl`（可选） | 外部主页/来源链接（可选） |
| `editable`（可选） | 标记为「可编辑」（仅前端语义） |
| `ispublic`（可选） | true=同时共享给默认账号（全平台可见），默认 false |

### `crater_datasets_update` — 更新数据集

- 接口：`POST /api/v1/dataset/update`
- 作用域：仅本人；写操作

```text
改数据集的 name / 描述 / url / 标签（只有创建者或平台管理员能改）。接口本身要求 name/describe/url 全量必填，本工具会先用 crater_datasets_mine 的现值补齐你没传的字段，tags 是全量替换（不传则沿用原标签）；type（dataset/model）和 ispublic 创建后改不了（后端 UpdateDatasetreq 没有这两个字段）。url 前缀仍是 user/ account/ public/ 语义：传 user/... 这类逻辑路径会被重写成物理路径，传其它字符串则原样写入。
```

| 参数 | 说明 |
| --- | --- |
| `datasetID` | 要改的数据集 ID（来自 crater_datasets_mine） |
| `name`（可选） | 新名字；不传沿用原名 |
| `describe`（可选） | 新描述；不传沿用原描述 |
| `url`（可选） | 新存储路径；不传沿用原路径 |
| `tags`（可选） | 新的完整标签列表（全量替换）；不传沿用原标签 |
| `weburl`（可选） | 外部链接；传空串表示不改 |

### `crater_datasets_delete` — 删除数据集

- 接口：`DELETE /api/v1/dataset/delete/:id`
- 作用域：仅本人；写操作（destructive）

```text
删除数据集条目，并连带清掉它的 user_dataset / account_dataset 共享关系（只有创建者或平台管理员能删）。**不会**删存储里的实际文件——目录还在，要清数据请再用 files 组删目录。这是不可逆操作，删前建议先 crater_datasets_get 确认 id 和名字。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 要删除的数据集 ID（来自 crater_datasets_mine） |

### `crater_datasets_share_user` — 把数据集分享给用户

- 接口：`POST /api/v1/dataset/share/user`
- 作用域：仅本人；写操作

```text
把数据集共享给一批用户（userIDs 是用户 ID，可从 crater_datasets_unshared_users 取）；只有创建者能分享。分享后对方在 mydataset 里就能看到并可挂载/下载（下载还要求对方没被封禁 DatasetDownload 能力）。坑：后端是逐个插入，遇到「该用户已共享过」会整体报错，但前面的已经生效——建议先用 crater_datasets_unshared_users 过滤出真正的候选再批量分享。
```

| 参数 | 说明 |
| --- | --- |
| `datasetID` | 数据集 ID（来自 crater_datasets_mine） |
| `userIDs` | 要分享给的用户 ID 列表（来自 crater_datasets_unshared_users） |

### `crater_datasets_share_queue` — 把数据集分享给账号

- 接口：`POST /api/v1/dataset/share/queue`
- 作用域：仅本人；写操作

```text
把数据集共享给整个账号/队列（queueIDs 是**账号 ID**，不是账号名，可从 crater_datasets_unshared_queues 取）；只有创建者能分享。分享给账号 = 该账号**全体成员**都能看到并能挂载/下载这个数据集。坑：同样逐个插入，遇到「该账号已共享」会整体报错且前面已生效，批量前先用 crater_datasets_unshared_queues 过滤。
```

| 参数 | 说明 |
| --- | --- |
| `datasetID` | 数据集 ID（来自 crater_datasets_mine） |
| `queueIDs` | 要分享给的账号/队列 ID 列表（来自 crater_datasets_unshared_queues） |

### `crater_datasets_unshare_user` — 取消对某个用户的分享

- 接口：`POST /api/v1/dataset/cancelshare/user`
- 作用域：仅本人；写操作（destructive）

```text
取消该数据集对某个用户的共享（一次一个 userID，只有创建者能取消；可用 crater_datasets_shared_users 查当前名单）。取消后对方的 mydataset 里就看不到它了；如果对方是通过账号共享看到它的，取消用户级分享并不会让他看不到。注意：不能取消创建者自己（后端报 can't cancel share with creator），也不能取消本来就没共享的用户（报 user doesn't shared dataset）。
```

| 参数 | 说明 |
| --- | --- |
| `datasetID` | 数据集 ID（来自 crater_datasets_mine） |
| `userID` | 要取消共享的用户 ID（来自 crater_datasets_shared_users） |

### `crater_datasets_unshare_queue` — 取消对某个账号的分享

- 接口：`POST /api/v1/dataset/cancelshare/queue`
- 作用域：仅本人；写操作（destructive）

```text
取消该数据集对某个账号/队列的共享（一次一个 queueID=账号 ID，只有创建者能取消；当前名单用 crater_datasets_shared_queues 查）。取消后该账号的普通成员就不再通过账号维度看到它（若他们同时被单独共享过，仍然可见）。未共享过的账号会报 the dataset was not shared with the queue。
```

| 参数 | 说明 |
| --- | --- |
| `datasetID` | 数据集 ID（来自 crater_datasets_mine） |
| `queueID` | 要取消共享的账号/队列 ID（来自 crater_datasets_shared_queues） |

</details>


## admin

| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `crater_admin_users_list` | GET | `/api/v1/admin/users` | 管理员 | 只读 | 【影响面：全平台只读】列出平台所有用户（id/登录名/角色/状态/额外点数/是否被封禁/封禁能力项/资料）。⚠️ 后端这个接口**不认分页和筛选参数**，永远返回全量；keyword/role/bannedOnly/page/pageSize 由 MCP 在本地过滤后再切片，所以拿到的 total 是过滤后的条数。列出 |
| `crater_admin_users_detail` | GET | `/api/v1/users/:name` | 管理员 | 只读 | 【影响面：单个用户只读】按登录名取某个用户的资料（昵称/角色/导师/课题组/头像/余额等）。Crater 管理端没有独立的 `GET /admin/users/:name`，这里用的是全平台通用的用户详情接口，在本 MCP 中被限制为管理员才能调用。名字必须是**登录名**，昵称/显示名查不到。 |
| `crater_admin_users_baseinfo` | GET | `/api/v1/admin/users/baseinfo` | 管理员 | 只读 | 【影响面：全平台只读】一次性返回所有用户的精简信息：登录名、昵称、用户空间目录名。适合在给账号加成员、按用户名查作业等场景里快速做「登录名 ↔ 昵称」的对照；它不含 id，需要 id（如账号成员接口的 uid）时请用 crater_admin_users_list。 |
| `crater_admin_users_ban` | PUT | `/api/v1/admin/users/:name/ban` | 管理员 | **写（destructive）** | 【影响面：单个用户，写；不可逆点在于「踢下线」】封禁或解封某个用户，banned=true 封、false 解。⚠️ **不传 banRestrictions 等于只记一个封禁状态、任何能力都不限制**（后端按零值处理，五张能力旗标全 false 就什么都不拦）；要真正把人挡在平台外必须显式传 banRestricti |
| `crater_admin_users_set_role` | PUT | `/api/v1/admin/users/:name/role` | 管理员 | 写 | 【影响面：单个用户，写，可逆】把某用户设为 guest(1)/user(2)/admin(3)。⚠️ 改成 admin 等于交出整台平台的运维权限（可删用户/改配置/清作业）；改成 guest 后该用户失去提交作业等基础能力。改完提示用户重新登录：旧 token 里的角色快照会让其**写**请求立刻 401（读请求仍暂 |
| `crater_admin_users_update_attributes` | PUT | `/api/v1/admin/users/:name/attributes` | 管理员 | 写 | 【影响面：单个用户，写，可逆】修改别的用户的资料（昵称/邮箱/电话/导师/课题组/头像/过期时间）。后端是**整体覆盖写**：没传的字段会被清空，所以本工具会先读出该用户现有 attributes，再把你要改的字段覆盖上去，其余字段原样回传（ID/UID/GID 也一并保留）。昵称会同步为该用户的展示名。 |
| `crater_admin_users_adjust_balance` | POST | `/api/v1/admin/users/:name/billing/extra-balance` | 管理员 | 写 | 【影响面：单个用户余额，写，可逆（反向 delta 即可复原）】按增量调整用户的额外点数 extraBalance，delta 为正=增加、为负=扣减，后端带行锁不会并发串账。仅在计费（billing）功能开启时有意义；⚠️ 点数就是钱：操作前建议先用 crater_admin_users_list 确认当前余额，并在 |
| `crater_admin_accounts_list` | GET | `/api/v1/admin/accounts` | 管理员 | 只读 | 【影响面：全平台只读】列出平台所有账号（项目），含 id/登录名/昵称/空间/配额等信息。账号是 Crater 里的资源与权限边界（原 queue），几乎所有账号级操作都要先拿到这里的 id（aid）。 |
| `crater_admin_accounts_get` | GET | `/api/v1/admin/accounts/:aid` | 管理员 | 只读 | 【影响面：单个账号只读】按数字 id 取账号详情（昵称/空间/配额/管理员/过期时间等）。 |
| `crater_admin_accounts_quota` | GET | `/api/v1/admin/accounts/:aid/quota` | 管理员 | 只读 | 【影响面：单个账号只读】返回该账号的 Volcano 配额（guaranteed/deserved/capability）与已分配用量，用于判断资源是否紧张。注意这里读的是账号级配额，用户级资源限制在 queue-quotas 里。 |
| `crater_admin_accounts_members` | GET | `/api/v1/admin/accounts/userIn/:aid` | 管理员 | 只读 | 【影响面：单个账号只读】列出该账号内的成员及其账号内角色(role)与访问模式(accessmode)、个人配额。注意返回里的 role/accessmode 是**数字字符串**（如 "3"），与 crater_admin_accounts_member_update 的入参一致。 |
| `crater_admin_accounts_member_add` | POST | `/api/v1/admin/accounts/add/:aid/:uid` | 管理员 | 写 | 【影响面：单账号成员关系，写，可逆（可再移除）】把某个用户（uid，数字 id）加入账号（aid），并指定账号内角色与访问模式。role/accessmode 必须是**数字字符串**（role: "1"\|"2"\|"3"；accessmode: "2" 只读 / "3" 读写 / "4" 仅管理员）。前置：用 cr |
| `crater_admin_accounts_member_update` | POST | `/api/v1/admin/accounts/update/:aid/:uid` | 管理员 | 写 | 【影响面：单账号单成员，写，可逆】全量更新某成员在账号内的角色、访问模式与个人配额（三个字段都必须给）。⚠️ 改成 "2"（只读）会让该用户在该账号下立刻丧失一切写能力；改成 "4" 等于把账号管理权交给对方。 |
| `crater_admin_accounts_member_remove` | DELETE | `/api/v1/admin/accounts/:aid/:uid` | 管理员 | **写（destructive）** | 【影响面：单账号单成员，写，难逆】删除用户与账号的成员关系。该用户在该账号下的作业/文件随之不可见（资源与数据仍留在账号空间里），重新加入需要管理员再次操作。⚠️ 若对方正在该账号下运行作业，作业不会被自动停止；被移除后其旧 token 的写请求会立刻 401。 |
| `crater_admin_accounts_billing_config` | GET | `/api/v1/admin/accounts/:aid/billing/config` | 管理员 | 只读 | 【影响面：单账号只读】读取账号的计费发放配置：每期发放点数 issueAmount、发放周期 issuePeriodMinutes，以及生效值/下一次发放时间。计费功能关闭时该接口会报 409（billing feature is disabled）。 |
| `crater_admin_accounts_billing_config_update` | PUT | `/api/v1/admin/accounts/:aid/billing/config` | 管理员 | 写 | 【影响面：单账号全体成员的发放额度，写，可逆】改该账号的每期发放点数与发放周期。issueAmount 是点数（支持小数）、issuePeriodMinutes 是周期分钟数（≥0，0 通常表示不自动发放）。⚠️ 影响该账号下每个人的可用点数，改错会让大批用户余额异常；不传的字段保持原值（后端是增量语义）。 |
| `crater_admin_accounts_billing_members` | GET | `/api/v1/admin/accounts/:aid/billing/members` | 管理员 | 只读 | 【影响面：单账号只读】列出该账号每个成员的计费明细（本期免费余额、额外点数、发放额度覆盖值等）。适合排查「某人为什么余额异常」。计费关闭时返回 409。 |
| `crater_admin_accounts_billing_reset` | POST | `/api/v1/admin/accounts/:aid/billing/reset` | 管理员 | **写（destructive）** | 【影响面：单账号全体成员，写，数据不可恢复】把该账号的计费余额按后端逻辑重新结算/重置（本期免费点数），会直接改写该账号下所有成员的余额数字。计费功能关闭时报错。⚠️ 这是「重置」不是「补发」：重置前的余额数字无从回滚，操作前请先 crater_admin_accounts_billing_members 留底。 |
| `crater_admin_resources_vgpu_list` | GET | `/api/v1/admin/resources/:id/vgpu` | 管理员 | 只读 | 【影响面：单资源只读】列出某个 GPU 资源已关联的 vGPU 资源及其切分参数（关联记录 id、min/max、描述）。要改/删关联时先用它拿 vgpuId（那是**关联记录 id**，不是资源 id）。资源 id 可用 crater_resources_list 查。 |
| `crater_admin_resources_vgpu_link` | POST | `/api/v1/admin/resources/:id/vgpu` | 管理员 | 写 | 【影响面：单资源模型，写，可逆（可解除）】给 GPU 资源挂一个 vGPU 资源，让 GPU 支持切分。vgpuResourceId 是 vGPU 那个资源条目的 id（先 crater_resources_list 找）；min/max 是切分档位约束，min>max 会被后端拒绝。⚠️ 影响调度与计费口径：配错会让 |
| `crater_admin_resources_vgpu_update` | PUT | `/api/v1/admin/resources/:id/vgpu/:vgpuId` | 管理员 | 写 | 【影响面：单资源模型，写，可逆】调整已存在的 GPU↔vGPU 关联的 min/max/描述。vgpuId 是**关联记录 id**（从 crater_admin_resources_vgpu_list 取），不是资源 id。只传要改的字段。 |
| `crater_admin_resources_vgpu_unlink` | DELETE | `/api/v1/admin/resources/:id/vgpu/:vgpuId` | 管理员 | **写（destructive）** | 【影响面：单资源模型，写，删除类】删除 GPU 与 vGPU 的关联。⚠️ 解除后该型号 GPU 不再支持对应切分：已在跑的 vGPU 作业不受影响，但新的 vGPU 申请会被调度拒绝或按整卡计费。 |
| `crater_admin_resources_networks_list` | GET | `/api/v1/admin/resources/:id/networks` | 管理员 | 只读 | 【影响面：单资源只读】列出某个 GPU 资源已关联的 RDMA/网络资源，用于确认多机训练的高速网络通路。 |
| `crater_admin_resources_networks_link` | POST | `/api/v1/admin/resources/:id/networks` | 管理员 | 写 | 【影响面：单资源模型，写，可逆（可解除）】把 RDMA 网络资源挂到某个 GPU 资源上（rdmaId 是 RDMA 资源条目的 id）。⚠️ 影响分布式作业的网络可用性判断：关联错误会让多机作业拿不到 RDMA 或调度失败。 |
| `crater_admin_resources_networks_unlink` | DELETE | `/api/v1/admin/resources/:id/networks/:networkId` | 管理员 | **写（destructive）** | 【影响面：单资源模型，写，删除类】删除 GPU 与 RDMA 网络的关联。⚠️ 解绑后依赖该通路的分布式训练可能无法再被调度到高速网络，已在跑的作业不受影响。 |
| `crater_admin_resources_unit_price` | PUT | `/api/v1/admin/resources/:id/billing/unit-price` | 管理员 | 写 | 【影响面：全平台计费口径，写，可逆】设置某个资源的计费单价（点数/单位时间）。⚠️ 这是全平台价格：改动会影响之后所有作业的扣费，历史账单不重算；unitPrice 传 0 等于免费，建议先用 crater_resources_prices 看现有单价再改。计费功能未开启时后端可能拒绝。 |
| `crater_admin_resources_sync` | POST | `/api/v1/admin/resources/sync` | 管理员 | **写（destructive）** | 【影响面：全平台资源清单，写，部分不可逆】按集群当前节点实际情况重建资源表：新出现的资源会被创建、数量变化的会更新、**集群上已不存在的资源记录会被删除**。⚠️ 删除会连带影响资源列表展示、标签/单价等人工维护的属性，以及依赖该资源的作业配置可见性；在集群侧网络抖动/节点暂时 NotReady 时调用，可能把仍需要的 |
| `crater_admin_nodes_list` | GET | `/api/v1/admin/nodes` | 管理员 | 只读 | 【影响面：全平台节点只读】列出所有节点的角色/架构/状态/资源与使用率，是节点类操作的第一步（拿节点名）。节点名就是 k8s 节点名（如 gpu004），后续 label/taint/drain 都用它。 |
| `crater_admin_nodes_detail` | GET | `/api/v1/nodes/:name` | 管理员 | 只读 | 【影响面：单节点只读】按节点名取节点详情（含该节点上的 Pod 概况），用于排查调度失败/资源占用。管理端没有独立的 `/admin/nodes/:name` 详情路由，这里用通用节点详情接口，并在本 MCP 中限制为管理员调用。 |
| `crater_admin_nodes_marks` | GET | `/api/v1/admin/nodes/:name/mark` | 管理员 | 只读 | 【影响面：单节点只读】一次性返回该节点当前的 labels、annotations、taints。改/删标签或污点前建议先看这里，避免误删关键调度标记。 |
| `crater_admin_nodes_label_add` | POST | `/api/v1/admin/nodes/:name/label` | 管理员 | 写 | 【影响面：单节点调度属性，写，可逆】新增或覆盖一个节点 label（key/value）。⚠️ label 常被作业的节点选择器（selectors）引用：改掉关键标签会让匹配它的作业无法调度到该节点。 |
| `crater_admin_nodes_label_delete` | DELETE | `/api/v1/admin/nodes/:name/label` | 管理员 | **写（destructive）** | 【影响面：单节点调度属性，写，删除类】按 key/value 删除节点 label。⚠️ 删掉调度依赖的标签会让相关作业长期 Pending；value 需与现存值一致，删前先 crater_admin_nodes_marks 确认。 |
| `crater_admin_nodes_annotation_add` | POST | `/api/v1/admin/nodes/:name/annotation` | 管理员 | 写 | 【影响面：单节点元数据，写，可逆】新增或覆盖一个节点 annotation（key/value）。注解通常不影响调度，但可能被某些控制器/告警规则读取，建议 key 加团队前缀。 |
| `crater_admin_nodes_annotation_delete` | DELETE | `/api/v1/admin/nodes/:name/annotation` | 管理员 | **写（destructive）** | 【影响面：单节点元数据，写，删除类】按 key/value 删除节点 annotation；删前先 crater_admin_nodes_marks 确认。 |
| `crater_admin_nodes_taint_add` | POST | `/api/v1/admin/nodes/:name/taint` | 管理员 | 写 | 【影响面：单节点调度，写，可逆】给节点加一个 taint（key/value/effect）。effect 取值：NoSchedule=不再调度新 Pod、PreferNoSchedule=尽量不调度、NoExecute=**连已运行的 Pod 也会被驱逐**。⚠️ 用 NoExecute 等同于小范围排水；没有对应  |
| `crater_admin_nodes_taint_delete` | DELETE | `/api/v1/admin/nodes/:name/taint` | 管理员 | **写（destructive）** | 【影响面：单节点调度，写，删除类】按 key/value 删除节点 taint，等于放宽该节点的调度限制。⚠️ 删掉隔离类污点后，原本被挡住的高占用作业可能涌入该节点；删前先 crater_admin_nodes_marks 确认。 |
| `crater_admin_nodes_drain` | POST | `/api/v1/admin/nodes/:name/drain` | 管理员 | **写（destructive）** | 【影响面：单节点上所有作业，写，不可逆（被驱逐的作业不会自动恢复）】把节点标记为不可调度并驱逐其上的 Pod。⚠️ **会驱逐该节点上正在运行的作业**：这些作业会被终止（用户需重新提交），正在跑的交互式会话/训练进度会丢失。⚠️ 该接口**没有对应的 uncordon/取消排水** 路由：排水后要让节点恢复可调度，需 |
| `crater_admin_nodes_pods` | GET | `/api/v1/admin/nodes/:name/pods` | 管理员 | 只读 | 【影响面：单节点只读】列出该节点上的 Pod（管理员视角，字段比用户版更多），含所属作业、命名空间、资源、状态。排水/打污点前用它评估影响面；返回里的 Pod 名与 namespace 可用于 crater_admin_nodes_pod_resources 在线调资源。 |
| `crater_admin_nodes_pod_resources` | PUT | `/api/v1/admin/namespaces/:namespace/pods/:name/resources` | 管理员 | 写 | 【影响面：单个运行中的作业 Pod，写，可逆（改回原值即可）】直接修改运行中 Pod 的 resources（cpu/memory 等）。⚠️ 这是绕过作业模板的在线变更：改小可能导致容器 OOM/被限流，改大可能让节点超卖；后端只允许对「作业 Pod」操作，且会校验调用者对该作业的权限。namespace 一般是作业 |
| `crater_admin_system_billing_get` | GET | `/api/v1/admin/system-config/billing` | 管理员 | 只读 | 【影响面：全平台只读】读取计费总开关与参数：功能开关 featureEnabled、是否生效 active、运行中结算开关与周期、作业免费分钟、默认发放点数/周期、按账号覆盖开关，以及 cron 状态。改配置前先读它拿现状。 |
| `crater_admin_system_billing_update` | PUT | `/api/v1/admin/system-config/billing` | 管理员 | 写 | 【影响面：全平台所有用户的扣费/发放，写，可逆（改回原值）】修改计费开关与参数，只传要改的字段（后端按指针增量更新）。⚠️ 关掉 featureEnabled/runningSettlementEnabled 会立即停止扣费；改 defaultIssueAmount/Period 会影响所有人之后的发放；开启计费前请确 |
| `crater_admin_system_llm_get` | GET | `/api/v1/admin/system-config/llm` | 管理员 | 只读 | 【影响面：全平台只读】读取平台 LLM 配置（baseUrl/modelName/apiKey 已脱敏为 ********）。改之前先读它，回写时把 apiKey 原样传回 ******** 即可保留旧密钥。 |
| `crater_admin_system_llm_update` | PUT | `/api/v1/admin/system-config/llm` | 管理员 | 写 | 【影响面：全平台 AI 功能（GPU 分析等），写，可逆（改回原值）】更新 LLM 的 baseUrl/modelName/apiKey。apiKey 传 `********` 表示**保留旧密钥**（后端特判）；baseUrl 与 modelName 每次都必须给。validate=true 会让后端立即试连一次，失 |
| `crater_admin_system_pod_bandwidth_get` | GET | `/api/v1/admin/system-config/pod-bandwidth` | 管理员 | 只读 | 【影响面：全平台只读】读取 Pod 带宽限制开关与三类带宽值（模型下载/作业入口/作业出口）。 |
| `crater_admin_system_pod_bandwidth_update` | PUT | `/api/v1/admin/system-config/pod-bandwidth` | 管理员 | 写 | 【影响面：全平台所有新 Pod 的网络限速，写，可逆】设置 Pod 带宽限制。四个字段后端都**必填**，带宽值是 k8s 数量字符串（如 "1G"、"500M"）。⚠️ 限得太低会让模型下载/推理服务超时；只对之后创建的 Pod 生效，已运行的 Pod 不变。改前先 crater_admin_system_pod_b |
| `crater_admin_system_model_download_limit_get` | GET | `/api/v1/admin/system-config/model-download-limit` | 管理员 | 只读 | 【影响面：全平台只读】读取模型下载限额配置：开关、最大并发、统计窗口小时数、窗口内最多成功下载次数，以及白名单用户 id 列表。 |
| `crater_admin_system_model_download_limit_update` | PUT | `/api/v1/admin/system-config/model-download-limit` | 管理员 | 写 | 【影响面：全平台用户的模型下载能力，写，可逆】设置模型下载限额。四个数值字段后端都**必填且必须 > 0**，whitelistUserIds 是豁免该限制的用户 id 列表（整表覆盖，不传等于清空白名单）。⚠️ 把 maxSuccessfulDownloads 设小会大面积卡住用户下载；改前先 get 拿现值，避免把 |
| `crater_admin_system_gpu_analysis_get` | GET | `/api/v1/admin/system-config/gpu-analysis` | 管理员 | 只读 | 【影响面：全平台只读】读取 GPU 利用率分析（占卡检测）功能的总开关状态。 |
| `crater_admin_system_gpu_analysis_update` | PUT | `/api/v1/admin/system-config/gpu-analysis` | 管理员 | 写 | 【影响面：全平台，写，可逆】开启/关闭 GPU 分析功能。⚠️ 关闭后相关巡检 cronjob 无法被启用（后端会拒绝开启对应 cron），已产生的分析记录保留；开启后需要 LLM 配置可用，否则分析任务会持续失败。 |
| `crater_admin_system_billing_grant_all` | POST | `/api/v1/admin/system-config/billing/extra-balance-all` | 管理员 | **写（destructive）** | 【影响面：**全平台每一个用户**，写，难逆】给所有未被删除的用户统一增加额外点数 delta（后端要求 > 0，不能扣减）。⚠️ 这是一次性群发：人数多、总额大，且没有「撤销」接口（只能逐个用户用 crater_admin_users_adjust_balance 反向扣回）。调用前务必确认 delta 含义（点数， |
| `crater_admin_system_billing_reset_all` | POST | `/api/v1/admin/system-config/billing/reset-all` | 管理员 | **写（destructive）** | 【影响面：**全平台所有账号与用户**，写，数据不可恢复】触发一次全平台余额重置：按后端逻辑重新结算每个账号/成员的本期免费余额，并返回受影响的账号数/成员数与时间戳。⚠️ 会一次性改写所有人的余额数字，无法回滚；误调用等于全平台账单被重置。计费功能关闭时会直接报错。执行前请先 crater_admin_account |
| `crater_admin_queue_quotas_list` | GET | `/api/v1/admin/queue-quotas` | 管理员 | 只读 | 【影响面：全平台只读】列出队列配额配置项（id/名称/资源限制 map）。这些配额在调度器侧限制单用户可用资源上限，与账号自身的 Volcano 配额（crater_admin_accounts_quota）是两层不同的东西。 |
| `crater_admin_queue_quotas_create` | POST | `/api/v1/admin/queue-quotas` | 管理员 | 写 | 【影响面：命中该配额的账号/用户，写，可逆（可删）】新建一条队列配额配置：name 为配置名，quota 为资源名→数量字符串。⚠️ 配额调小会让正在排队的作业无法被调度；名称冲突会返回 409，建前先 list 一下。 |
| `crater_admin_queue_quotas_update` | PUT | `/api/v1/admin/queue-quotas/:id` | 管理员 | 写 | 【影响面：命中该配额的账号/用户，写，可逆】按 id 更新一条队列配额（name + 整份 quota 覆盖写）。⚠️ quota 是整体覆盖：漏掉的资源键会变成不限制/默认，改前请先 crater_admin_queue_quotas_list 拿全量再改。 |
| `crater_admin_queue_quotas_delete` | DELETE | `/api/v1/admin/queue-quotas/:id` | 管理员 | **写（destructive）** | 【影响面：命中该配额的账号/用户，写，删除类】删除一条队列配额配置。⚠️ 删除后相关用户不再受该配额限制（可能瞬间申请到大量资源），也可能回落到默认策略；删前确认它没有在被使用。 |
| `crater_admin_ops_cronjob_configs` | GET | `/api/v1/admin/operations/cronjob` | 管理员 | 只读 | 【影响面：全平台只读】列出所有巡检/清理定时任务（清理类、计费循环、GPU 分析巡检等）的配置：name/type/spec/status/config。看「现在有哪些自动任务、是否 suspended」就调它；改配置用 crater_admin_ops_cronjob_update。 |
| `crater_admin_ops_cronjob_update` | PUT | `/api/v1/admin/operations/cronjob` | 管理员 | **写（destructive）** | 【影响面：全平台自动化，写，可逆（改回原值）】按 name 更新一个 cronjob 的 type/spec/status/config（只传要改的字段）。status 取值：running/idle/suspended/unknown；spec 是 cron 表达式。⚠️ 把清理类任务设成 suspended 等于停 |
| `crater_admin_ops_cronjob_status` | POST | `/api/v1/admin/operations/cronjob/config/status` | 管理员 | 只读 | 【影响面：全平台只读】按名字批量查 cronjob 的当前状态与调度 entry id。不传 name 等于查全部。排查「自动清理为什么没跑」时先用它看 status 是否为 suspended。 |
| `crater_admin_ops_cronjob_records` | POST | `/api/v1/admin/operations/cronjob/record/list` | 管理员 | 只读 | 【影响面：全平台只读】分页查巡检/清理任务的执行记录，可按任务名、时间范围、状态过滤。时间用 RFC3339 字符串（如 2026-11-01T00:00:00+08:00）。属于「谁在什么时候清理了什么」的追溯依据。 |
| `crater_admin_ops_clean_low_gpu` | POST | `/api/v1/admin/operations/clean/clean-low-gpu-usage-job` | 管理员 | **写（destructive）** | 【影响面：全平台所有作业，写，不可逆】立刻执行一次「低 GPU 利用率作业回收」：把 GPU 利用率持续低于阈值的作业停止/回收。⚠️ 该操作**不会**给用户确认机会，被判定为低利用率的作业会被直接处理；timeRange 是观察窗口（分钟），util 是利用率阈值（百分比），waitTime 是告警等待时间。误用会 |
| `crater_admin_ops_clean_long_running` | POST | `/api/v1/admin/operations/clean/clean-long-running-job` | 管理员 | **写（destructive）** | 【影响面：全平台所有作业，写，不可逆】立刻执行一次「超长运行作业处理」：把运行时长超过阈值的作业清理/停止。⚠️ batchDays 是批处理类作业的天数阈值、interactiveDays 是交互式作业（Jupyter/WebIDE）的天数阈值，不传则用后端默认。误用会批量打断长期训练；执行前请确认没有正在收敛的关键 |
| `crater_admin_ops_clean_waiting_jupyter` | POST | `/api/v1/admin/operations/clean/clean-waiting-jupyter-job` | 管理员 | **写（destructive）** | 【影响面：全平台排队中的交互式作业，写，不可逆】立刻执行一次「长期排队 Jupyter 作业清理」：把排队超过 waitMinitues 分钟的 Jupyter 作业取消掉（释放排队名额）。⚠️ 单位是**分钟**（后端字段名拼写就是 waitMinitues）；取消后用户需重新提交，交互式环境里的临时内容会丢失。 |
| `crater_admin_ops_clean_waiting_custom` | POST | `/api/v1/admin/operations/clean/clean-waiting-custom-job` | 管理员 | **写（destructive）** | 【影响面：全平台排队中的自定义/训练作业，写，不可逆】立刻执行一次「长期排队自定义作业清理」：把排队超过 waitMinitues 分钟的作业取消掉。⚠️ 单位是分钟；会打断用户排队中的训练任务，取消不可恢复。 |
| `crater_admin_ops_add_locktime` | PUT | `/api/v1/admin/operations/add/locktime` | 管理员 | 写 | 【影响面：单个作业，写，可逆（可清除）】给某个作业设置/延长锁定时间：锁定期内该作业不会被低利用率/超时清理任务回收。isPermanent=true 表示永久锁定（请谨慎，等于永久豁免清理）；否则 days/hours/minutes 至少有一个 > 0。name 必须是 **jobName**（k8s 名，如 vs |
| `crater_admin_ops_clear_locktime` | PUT | `/api/v1/admin/operations/clear/locktime` | 管理员 | 写 | 【影响面：单个作业，写，可逆（可再加锁）】清除某作业的锁定时间，使其重新受低利用率/超时清理策略约束。name 必须是 jobName（k8s 名）。清除后若该作业利用率确实很低，下一轮清理可能把它回收。 |
| `crater_admin_ops_whitelist` | GET | `/api/v1/admin/operations/whitelist` | 管理员 | 只读 | 【影响面：全平台只读】读取运维白名单：哪些作业/用户不会被自动清理。手工执行清理类操作前先看它，避免误杀白名单对象。 |
| `crater_admin_operation_logs` | GET | `/api/v1/admin/operation-logs` | 管理员 | 只读 | 【影响面：全平台只读】分页查管理端操作审计日志（操作人、类型、目标、结果、时间），可按人/目标/关键字/时间过滤。用于追溯「谁改了什么」。注意分页参数名是 page 与 **limit**（不是 pageSize），时间是 RFC3339/标准时间字符串。 |
| `crater_admin_approvals_list` | GET | `/api/v1/admin/approvalorder` | 管理员 | 只读 | 【影响面：全平台只读】列出所有审批工单（延长作业时长、数据集申请等），按创建时间倒序，含创建人/审批人/状态/内容。后端无分页参数，一次性返回全量；单条详情用 crater_admin_approvals_get。 |
| `crater_admin_approvals_get` | GET | `/api/v1/admin/approvalorder/:id` | 管理员 | 只读 | 【影响面：单工单只读】按工单 id 取详情（类型/状态/申请内容/理由/审批备注/创建人与审批人）。 |
| `crater_admin_approvals_review` | PUT | `/api/v1/admin/approvalorder/:id/review` | 管理员 | 写 | 【影响面：单个工单（可能牵动作业时长/数据集访问），写，可逆性取决于类型】通过/拒绝/取消一个工单。status 只能是 Approved / Rejected / Canceled；**Rejected 必须带 reviewNotes**（后端强制）。⚠️ 批准延长作业时长的工单会实际延长用户作业，拒绝则相当于驳回诉 |
| `crater_admin_gpu_analysis_list` | GET | `/api/v1/admin/gpu-analysis` | 管理员 | 只读 | 【影响面：全平台只读】列出 GPU 利用率分析记录（关联作业名、评分、审核状态、涉及资源/节点等），按评分倒序。用来找「疑似占卡不干活」的作业；审核/停机分别用 crater_admin_gpu_analysis_review 与 crater_admin_gpu_analysis_confirm_stop。 |
| `crater_admin_gpu_analysis_review` | PUT | `/api/v1/admin/gpu-analysis/:id/review` | 管理员 | 写 | 【影响面：单条分析记录，写，可逆（可再改）】把分析记录标记为「已确认占卡」(2) 或「已忽略」(3)。⚠️ 只是标记结论，**不会**停止作业；要真正停作业用 crater_admin_gpu_analysis_confirm_stop。id 是分析记录 id，不是作业名。 |
| `crater_admin_gpu_analysis_confirm_stop` | POST | `/api/v1/admin/gpu-analysis/:id/confirm-stop` | 管理员 | **写（destructive）** | 【影响面：单个用户作业，写，不可逆】确认某条分析结论并**立即删除对应作业**（作业被强制停止，用户需重新提交）。id 是分析记录 id（不是作业名），后端会按记录里的 jobName 停作业，并把记录标记为已确认。⚠️ 高风险：这是「替用户杀作业」，执行前请确认记录确实指向占卡/异常作业，并尽量先通知用户。 |
| `crater_admin_gpu_analysis_trigger_all` | POST | `/api/v1/admin/gpu-analysis/trigger/all-jobs` | 管理员 | 写 | 【影响面：全平台运行中的作业，写，可逆（只产生分析记录）】把符合条件的运行中作业批量加入后台 GPU 分析队列，接口立即返回排队数量，分析异步进行。⚠️ 会消耗 LLM 配额与集群指标查询资源，短时间内重复调用意义不大；需要先在系统配置里开启 GPU 分析功能（crater_admin_system_gpu_analy |
| `crater_admin_jobs_all` | GET | `/api/v1/vcjobs/all` | 管理员 | 只读 | 【影响面：全平台只读，含他人作业】列出所有用户的作业（这是后端不按调用者过滤的宽接口，只允许管理员用）。默认只回最近若干天，用 days=-1 表示不按天数截断；page_size 上限 200（注意参数名是 page_size）。返回项里同时有 `name`（用户填的显示名，可能中文/重名）与 `jobName`（k |
| `crater_admin_jobs_by_user` | GET | `/api/v1/vcjobs/user/:username` | 管理员 | 只读 | 【影响面：任意用户只读】列出某个用户的作业（后端不校验归属，只允许管理员用），参数与分页同 crater_admin_jobs_all。username 必须是**登录名**（不是昵称）。注意返回项里的 `jobName` 才是后续所有作业接口要用的名字。 |
| `crater_admin_statistics` | GET | `/api/v1/statistics` | 管理员 | 只读 | 【影响面：全平台统计只读】按时间范围返回资源使用统计（核时/卡时/GiB·时）：totalUsage + 时间序列。scope=cluster 是集群总量（仅管理员可查），account 需账号管理员，user 可查任意用户（targetID 填 user_id 或 account_id）。⚠️ startTime/e |

<details><summary>参数与完整描述</summary>

### `crater_admin_users_list` — 全平台用户列表（可本地筛选分页）

- 接口：`GET /api/v1/admin/users`
- 作用域：管理员；只读

```text
【影响面：全平台只读】列出平台所有用户（id/登录名/角色/状态/额外点数/是否被封禁/封禁能力项/资料）。⚠️ 后端这个接口**不认分页和筛选参数**，永远返回全量；keyword/role/bannedOnly/page/pageSize 由 MCP 在本地过滤后再切片，所以拿到的 total 是过滤后的条数。列出的是全平台用户，属于个人信息，不要无目的批量导出。
```

| 参数 | 说明 |
| --- | --- |
| `keyword`（可选） | 按登录名/昵称/邮箱模糊匹配（本地过滤，不区分大小写） |
| `role`（可选） | 只看某平台角色：1=guest 2=user 3=admin |
| `bannedOnly`（可选） | true 时只返回当前处于封禁状态的用户 |
| `page`（可选） | 本地分页页码，从 1 开始（默认 1） |
| `pageSize`（可选） | 本地每页条数，默认 20，最大 200 |

### `crater_admin_users_detail` — 单个用户详情（管理员视角）

- 接口：`GET /api/v1/users/:name`
- 作用域：管理员；只读

```text
【影响面：单个用户只读】按登录名取某个用户的资料（昵称/角色/导师/课题组/头像/余额等）。Crater 管理端没有独立的 `GET /admin/users/:name`，这里用的是全平台通用的用户详情接口，在本 MCP 中被限制为管理员才能调用。名字必须是**登录名**，昵称/显示名查不到。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 目标用户的登录名（不是昵称，也不是中文显示名） |

### `crater_admin_users_baseinfo` — 用户基础信息精简列表（name/昵称/空间）

- 接口：`GET /api/v1/admin/users/baseinfo`
- 作用域：管理员；只读

```text
【影响面：全平台只读】一次性返回所有用户的精简信息：登录名、昵称、用户空间目录名。适合在给账号加成员、按用户名查作业等场景里快速做「登录名 ↔ 昵称」的对照；它不含 id，需要 id（如账号成员接口的 uid）时请用 crater_admin_users_list。
```

_无参数_

### `crater_admin_users_ban` — 封禁 / 解封用户（能力项）

- 接口：`PUT /api/v1/admin/users/:name/ban`
- 作用域：管理员；写操作（destructive）

```text
【影响面：单个用户，写；不可逆点在于「踢下线」】封禁或解封某个用户，banned=true 封、false 解。⚠️ **不传 banRestrictions 等于只记一个封禁状态、任何能力都不限制**（后端按零值处理，五张能力旗标全 false 就什么都不拦）；要真正把人挡在平台外必须显式传 banRestrictions.platformAccess=true——该旗标由 JWT 中间件检查，会让该用户**立刻**无法访问任何 /api/v1 接口（页面与 CLI 一起被踢）。时长由 isPermanent / days+hours+minutes 决定（都为 0 且非永久会被后端拒绝）；reason 最长 500 字。解封：banned=false，其余不用传。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 目标用户的登录名 |
| `banned` | 必填：true=封禁，false=解封 |
| `isPermanent`（可选） | 永久封禁（true 时忽略 days/hours/minutes） |
| `days`（可选） | 封禁天数（非负） |
| `hours`（可选） | 封禁小时数（非负） |
| `minutes`（可选） | 封禁分钟数（非负） |
| `banRestrictions`（可选） | 逐项能力限制；⚠️ 整个字段不传 = 五项全不限制（封了个寂寞），要拦人请显式传 true |
| `reason`（可选） | 封禁原因（留档，后端最长 500 字符） |

### `crater_admin_users_set_role` — 改用户平台角色

- 接口：`PUT /api/v1/admin/users/:name/role`
- 作用域：管理员；写操作

```text
【影响面：单个用户，写，可逆】把某用户设为 guest(1)/user(2)/admin(3)。⚠️ 改成 admin 等于交出整台平台的运维权限（可删用户/改配置/清作业）；改成 guest 后该用户失去提交作业等基础能力。改完提示用户重新登录：旧 token 里的角色快照会让其**写**请求立刻 401（读请求仍暂时可用）。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 目标用户的登录名 |
| `role` | 新角色：1=guest 2=user 3=admin |

### `crater_admin_users_update_attributes` — 改他人资料（先读后写，避免清空）

- 接口：`PUT /api/v1/admin/users/:name/attributes`
- 作用域：管理员；写操作

```text
【影响面：单个用户，写，可逆】修改别的用户的资料（昵称/邮箱/电话/导师/课题组/头像/过期时间）。后端是**整体覆盖写**：没传的字段会被清空，所以本工具会先读出该用户现有 attributes，再把你要改的字段覆盖上去，其余字段原样回传（ID/UID/GID 也一并保留）。昵称会同步为该用户的展示名。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 目标用户的登录名 |
| `nickname`（可选） | 昵称（会同步成展示名） |
| `email`（可选） | 邮箱 |
| `phone`（可选） | 电话 |
| `teacher`（可选） | 导师/老师 |
| `group`（可选） | 课题组 |
| `avatar`（可选） | 头像地址 |
| `expiredAt`（可选） | 过期时间（ISO 时间字符串，如 2027-01-01T00:00:00+08:00） |

### `crater_admin_users_adjust_balance` — 调整用户额外点数（可正可负）

- 接口：`POST /api/v1/admin/users/:name/billing/extra-balance`
- 作用域：管理员；写操作

```text
【影响面：单个用户余额，写，可逆（反向 delta 即可复原）】按增量调整用户的额外点数 extraBalance，delta 为正=增加、为负=扣减，后端带行锁不会并发串账。仅在计费（billing）功能开启时有意义；⚠️ 点数就是钱：操作前建议先用 crater_admin_users_list 确认当前余额，并在 reason 里写清楚依据（会留档）。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 目标用户的登录名 |
| `delta` | 点数增量：正数增加、负数扣减，支持小数（如 100、-12.5） |
| `reason`（可选） | 调整原因（留档，建议必填） |

### `crater_admin_accounts_list` — 账号（项目）列表

- 接口：`GET /api/v1/admin/accounts`
- 作用域：管理员；只读

```text
【影响面：全平台只读】列出平台所有账号（项目），含 id/登录名/昵称/空间/配额等信息。账号是 Crater 里的资源与权限边界（原 queue），几乎所有账号级操作都要先拿到这里的 id（aid）。
```

_无参数_

### `crater_admin_accounts_get` — 账号（项目）详情

- 接口：`GET /api/v1/admin/accounts/:aid`
- 作用域：管理员；只读

```text
【影响面：单个账号只读】按数字 id 取账号详情（昵称/空间/配额/管理员/过期时间等）。
```

| 参数 | 说明 |
| --- | --- |
| `aid` | 账号 id（不是账号名；账号名/id 对照见 crater_admin_accounts_list） |

### `crater_admin_accounts_quota` — 账号 Volcano 配额与已分配

- 接口：`GET /api/v1/admin/accounts/:aid/quota`
- 作用域：管理员；只读

```text
【影响面：单个账号只读】返回该账号的 Volcano 配额（guaranteed/deserved/capability）与已分配用量，用于判断资源是否紧张。注意这里读的是账号级配额，用户级资源限制在 queue-quotas 里。
```

| 参数 | 说明 |
| --- | --- |
| `aid` | 账号 id |

### `crater_admin_accounts_members` — 账号成员列表

- 接口：`GET /api/v1/admin/accounts/userIn/:aid`
- 作用域：管理员；只读

```text
【影响面：单个账号只读】列出该账号内的成员及其账号内角色(role)与访问模式(accessmode)、个人配额。注意返回里的 role/accessmode 是**数字字符串**（如 "3"），与 crater_admin_accounts_member_update 的入参一致。
```

| 参数 | 说明 |
| --- | --- |
| `aid` | 账号 id |

### `crater_admin_accounts_member_add` — 把用户加入账号

- 接口：`POST /api/v1/admin/accounts/add/:aid/:uid`
- 作用域：管理员；写操作

```text
【影响面：单账号成员关系，写，可逆（可再移除）】把某个用户（uid，数字 id）加入账号（aid），并指定账号内角色与访问模式。role/accessmode 必须是**数字字符串**（role: "1"|"2"|"3"；accessmode: "2" 只读 / "3" 读写 / "4" 仅管理员）。前置：用 crater_admin_users_list 查 uid、crater_admin_accounts_list 查 aid；重复加入会报错。给了 "3"/"4" 等于放权，请核对。
```

| 参数 | 说明 |
| --- | --- |
| `aid` | 账号 id |
| `uid` | 用户 id（数字 id，不是登录名） |
| `role` | 账号内角色（注意是"数字字符串"）：1=guest 2=user 3=admin，如 "3" |
| `accessmode` | 账号内访问模式（"数字字符串"）：2=只读 3=读写 4=仅管理员，如 "3" |
| `quota`（可选） | 资源配额，资源名→k8s 数量字符串，如 {"cpu":"8","memory":"32Gi","nvidia.com/gpu":"1"}；不传则沿用/不设 |

### `crater_admin_accounts_member_update` — 改账号成员的角色/访问模式/配额

- 接口：`POST /api/v1/admin/accounts/update/:aid/:uid`
- 作用域：管理员；写操作

```text
【影响面：单账号单成员，写，可逆】全量更新某成员在账号内的角色、访问模式与个人配额（三个字段都必须给）。⚠️ 改成 "2"（只读）会让该用户在该账号下立刻丧失一切写能力；改成 "4" 等于把账号管理权交给对方。
```

| 参数 | 说明 |
| --- | --- |
| `aid` | 账号 id |
| `uid` | 用户 id |
| `role` | 账号内角色（注意是"数字字符串"）：1=guest 2=user 3=admin，如 "3" |
| `accessmode` | 账号内访问模式（"数字字符串"）：2=只读 3=读写 4=仅管理员，如 "3" |
| `quota`（可选） | 资源配额，资源名→k8s 数量字符串，如 {"cpu":"8","memory":"32Gi","nvidia.com/gpu":"1"}；不传则沿用/不设 |

### `crater_admin_accounts_member_remove` — 把用户移出账号

- 接口：`DELETE /api/v1/admin/accounts/:aid/:uid`
- 作用域：管理员；写操作（destructive）

```text
【影响面：单账号单成员，写，难逆】删除用户与账号的成员关系。该用户在该账号下的作业/文件随之不可见（资源与数据仍留在账号空间里），重新加入需要管理员再次操作。⚠️ 若对方正在该账号下运行作业，作业不会被自动停止；被移除后其旧 token 的写请求会立刻 401。
```

| 参数 | 说明 |
| --- | --- |
| `aid` | 账号 id |
| `uid` | 用户 id |

### `crater_admin_accounts_billing_config` — 账号计费发放配置（读）

- 接口：`GET /api/v1/admin/accounts/:aid/billing/config`
- 作用域：管理员；只读

```text
【影响面：单账号只读】读取账号的计费发放配置：每期发放点数 issueAmount、发放周期 issuePeriodMinutes，以及生效值/下一次发放时间。计费功能关闭时该接口会报 409（billing feature is disabled）。
```

| 参数 | 说明 |
| --- | --- |
| `aid` | 账号 id |

### `crater_admin_accounts_billing_config_update` — 账号计费发放配置（写）

- 接口：`PUT /api/v1/admin/accounts/:aid/billing/config`
- 作用域：管理员；写操作

```text
【影响面：单账号全体成员的发放额度，写，可逆】改该账号的每期发放点数与发放周期。issueAmount 是点数（支持小数）、issuePeriodMinutes 是周期分钟数（≥0，0 通常表示不自动发放）。⚠️ 影响该账号下每个人的可用点数，改错会让大批用户余额异常；不传的字段保持原值（后端是增量语义）。
```

| 参数 | 说明 |
| --- | --- |
| `aid` | 账号 id |
| `issueAmount`（可选） | 每期发放点数（可小数） |
| `issuePeriodMinutes`（可选） | 发放周期（分钟），0 表示不按周期发放 |

### `crater_admin_accounts_billing_members` — 账号成员计费明细

- 接口：`GET /api/v1/admin/accounts/:aid/billing/members`
- 作用域：管理员；只读

```text
【影响面：单账号只读】列出该账号每个成员的计费明细（本期免费余额、额外点数、发放额度覆盖值等）。适合排查「某人为什么余额异常」。计费关闭时返回 409。
```

| 参数 | 说明 |
| --- | --- |
| `aid` | 账号 id |

### `crater_admin_accounts_billing_reset` — 重置账号计费余额

- 接口：`POST /api/v1/admin/accounts/:aid/billing/reset`
- 作用域：管理员；写操作（destructive）

```text
【影响面：单账号全体成员，写，数据不可恢复】把该账号的计费余额按后端逻辑重新结算/重置（本期免费点数），会直接改写该账号下所有成员的余额数字。计费功能关闭时报错。⚠️ 这是「重置」不是「补发」：重置前的余额数字无从回滚，操作前请先 crater_admin_accounts_billing_members 留底。
```

| 参数 | 说明 |
| --- | --- |
| `aid` | 账号 id |

### `crater_admin_resources_vgpu_list` — 查 GPU↔vGPU 关联（管理端）

- 接口：`GET /api/v1/admin/resources/:id/vgpu`
- 作用域：管理员；只读

```text
【影响面：单资源只读】列出某个 GPU 资源已关联的 vGPU 资源及其切分参数（关联记录 id、min/max、描述）。要改/删关联时先用它拿 vgpuId（那是**关联记录 id**，不是资源 id）。资源 id 可用 crater_resources_list 查。
```

| 参数 | 说明 |
| --- | --- |
| `id` | GPU 资源的数字 id |

### `crater_admin_resources_vgpu_link` — 新增 GPU↔vGPU 关联

- 接口：`POST /api/v1/admin/resources/:id/vgpu`
- 作用域：管理员；写操作

```text
【影响面：单资源模型，写，可逆（可解除）】给 GPU 资源挂一个 vGPU 资源，让 GPU 支持切分。vgpuResourceId 是 vGPU 那个资源条目的 id（先 crater_resources_list 找）；min/max 是切分档位约束，min>max 会被后端拒绝。⚠️ 影响调度与计费口径：配错会让该型号 GPU 无法按预期切分出小卡。
```

| 参数 | 说明 |
| --- | --- |
| `id` | GPU 资源 id |
| `vgpuResourceId` | 要关联的 vGPU 资源 id |
| `min`（可选） | 最小切分档位（可选） |
| `max`（可选） | 最大切分档位（可选，须 >= min） |
| `description`（可选） | 备注 |

### `crater_admin_resources_vgpu_update` — 改 GPU↔vGPU 关联参数

- 接口：`PUT /api/v1/admin/resources/:id/vgpu/:vgpuId`
- 作用域：管理员；写操作

```text
【影响面：单资源模型，写，可逆】调整已存在的 GPU↔vGPU 关联的 min/max/描述。vgpuId 是**关联记录 id**（从 crater_admin_resources_vgpu_list 取），不是资源 id。只传要改的字段。
```

| 参数 | 说明 |
| --- | --- |
| `id` | GPU 资源 id |
| `vgpuId` | 关联记录 id（来自 vgpu_list） |
| `vgpuResourceId`（可选） | 改指向的 vGPU 资源 id（一般不需要动） |
| `min`（可选） | 最小切分档位 |
| `max`（可选） | 最大切分档位 |
| `description`（可选） | 备注 |

### `crater_admin_resources_vgpu_unlink` — 解除 GPU↔vGPU 关联

- 接口：`DELETE /api/v1/admin/resources/:id/vgpu/:vgpuId`
- 作用域：管理员；写操作（destructive）

```text
【影响面：单资源模型，写，删除类】删除 GPU 与 vGPU 的关联。⚠️ 解除后该型号 GPU 不再支持对应切分：已在跑的 vGPU 作业不受影响，但新的 vGPU 申请会被调度拒绝或按整卡计费。
```

| 参数 | 说明 |
| --- | --- |
| `id` | GPU 资源 id |
| `vgpuId` | 关联记录 id（来自 vgpu_list） |

### `crater_admin_resources_networks_list` — 查 GPU↔RDMA 网络关联（管理端）

- 接口：`GET /api/v1/admin/resources/:id/networks`
- 作用域：管理员；只读

```text
【影响面：单资源只读】列出某个 GPU 资源已关联的 RDMA/网络资源，用于确认多机训练的高速网络通路。
```

| 参数 | 说明 |
| --- | --- |
| `id` | GPU 资源 id |

### `crater_admin_resources_networks_link` — 关联 GPU↔RDMA 网络

- 接口：`POST /api/v1/admin/resources/:id/networks`
- 作用域：管理员；写操作

```text
【影响面：单资源模型，写，可逆（可解除）】把 RDMA 网络资源挂到某个 GPU 资源上（rdmaId 是 RDMA 资源条目的 id）。⚠️ 影响分布式作业的网络可用性判断：关联错误会让多机作业拿不到 RDMA 或调度失败。
```

| 参数 | 说明 |
| --- | --- |
| `id` | GPU 资源 id |
| `rdmaId` | 要关联的 RDMA 资源 id |

### `crater_admin_resources_networks_unlink` — 解除 GPU↔RDMA 网络关联

- 接口：`DELETE /api/v1/admin/resources/:id/networks/:networkId`
- 作用域：管理员；写操作（destructive）

```text
【影响面：单资源模型，写，删除类】删除 GPU 与 RDMA 网络的关联。⚠️ 解绑后依赖该通路的分布式训练可能无法再被调度到高速网络，已在跑的作业不受影响。
```

| 参数 | 说明 |
| --- | --- |
| `id` | GPU 资源 id |
| `networkId` | RDMA 资源 id |

### `crater_admin_resources_unit_price` — 设置资源计费单价

- 接口：`PUT /api/v1/admin/resources/:id/billing/unit-price`
- 作用域：管理员；写操作

```text
【影响面：全平台计费口径，写，可逆】设置某个资源的计费单价（点数/单位时间）。⚠️ 这是全平台价格：改动会影响之后所有作业的扣费，历史账单不重算；unitPrice 传 0 等于免费，建议先用 crater_resources_prices 看现有单价再改。计费功能未开启时后端可能拒绝。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 资源 id |
| `unitPrice` | 单价（点数，支持小数；0 表示不计费） |

### `crater_admin_resources_sync` — 从集群同步资源清单

- 接口：`POST /api/v1/admin/resources/sync`
- 作用域：管理员；写操作（destructive）

```text
【影响面：全平台资源清单，写，部分不可逆】按集群当前节点实际情况重建资源表：新出现的资源会被创建、数量变化的会更新、**集群上已不存在的资源记录会被删除**。⚠️ 删除会连带影响资源列表展示、标签/单价等人工维护的属性，以及依赖该资源的作业配置可见性；在集群侧网络抖动/节点暂时 NotReady 时调用，可能把仍需要的资源条目删掉。无参数，调用前请确认集群状态正常。
```

_无参数_

### `crater_admin_nodes_list` — 节点列表（管理员视角）

- 接口：`GET /api/v1/admin/nodes`
- 作用域：管理员；只读

```text
【影响面：全平台节点只读】列出所有节点的角色/架构/状态/资源与使用率，是节点类操作的第一步（拿节点名）。节点名就是 k8s 节点名（如 gpu004），后续 label/taint/drain 都用它。
```

_无参数_

### `crater_admin_nodes_detail` — 节点详情（管理员排查用）

- 接口：`GET /api/v1/nodes/:name`
- 作用域：管理员；只读

```text
【影响面：单节点只读】按节点名取节点详情（含该节点上的 Pod 概况），用于排查调度失败/资源占用。管理端没有独立的 `/admin/nodes/:name` 详情路由，这里用通用节点详情接口，并在本 MCP 中限制为管理员调用。
```

| 参数 | 说明 |
| --- | --- |
| `name` | k8s 节点名，如 gpu004 |

### `crater_admin_nodes_marks` — 节点标签/注解/污点汇总

- 接口：`GET /api/v1/admin/nodes/:name/mark`
- 作用域：管理员；只读

```text
【影响面：单节点只读】一次性返回该节点当前的 labels、annotations、taints。改/删标签或污点前建议先看这里，避免误删关键调度标记。
```

| 参数 | 说明 |
| --- | --- |
| `name` | k8s 节点名 |

### `crater_admin_nodes_label_add` — 给节点打标签

- 接口：`POST /api/v1/admin/nodes/:name/label`
- 作用域：管理员；写操作

```text
【影响面：单节点调度属性，写，可逆】新增或覆盖一个节点 label（key/value）。⚠️ label 常被作业的节点选择器（selectors）引用：改掉关键标签会让匹配它的作业无法调度到该节点。
```

| 参数 | 说明 |
| --- | --- |
| `name` | k8s 节点名 |
| `key` | 标签键，如 gpu-type / node-pool |
| `value` | 标签值 |

### `crater_admin_nodes_label_delete` — 删除节点标签

- 接口：`DELETE /api/v1/admin/nodes/:name/label`
- 作用域：管理员；写操作（destructive）

```text
【影响面：单节点调度属性，写，删除类】按 key/value 删除节点 label。⚠️ 删掉调度依赖的标签会让相关作业长期 Pending；value 需与现存值一致，删前先 crater_admin_nodes_marks 确认。
```

| 参数 | 说明 |
| --- | --- |
| `name` | k8s 节点名 |
| `key` | 要删除的标签键 |
| `value` | 该标签当前的值（需与现存值一致） |

### `crater_admin_nodes_annotation_add` — 给节点打注解

- 接口：`POST /api/v1/admin/nodes/:name/annotation`
- 作用域：管理员；写操作

```text
【影响面：单节点元数据，写，可逆】新增或覆盖一个节点 annotation（key/value）。注解通常不影响调度，但可能被某些控制器/告警规则读取，建议 key 加团队前缀。
```

| 参数 | 说明 |
| --- | --- |
| `name` | k8s 节点名 |
| `key` | 注解键 |
| `value` | 注解值 |

### `crater_admin_nodes_annotation_delete` — 删除节点注解

- 接口：`DELETE /api/v1/admin/nodes/:name/annotation`
- 作用域：管理员；写操作（destructive）

```text
【影响面：单节点元数据，写，删除类】按 key/value 删除节点 annotation；删前先 crater_admin_nodes_marks 确认。
```

| 参数 | 说明 |
| --- | --- |
| `name` | k8s 节点名 |
| `key` | 要删除的注解键 |
| `value` | 该注解当前的值 |

### `crater_admin_nodes_taint_add` — 给节点打污点

- 接口：`POST /api/v1/admin/nodes/:name/taint`
- 作用域：管理员；写操作

```text
【影响面：单节点调度，写，可逆】给节点加一个 taint（key/value/effect）。effect 取值：NoSchedule=不再调度新 Pod、PreferNoSchedule=尽量不调度、NoExecute=**连已运行的 Pod 也会被驱逐**。⚠️ 用 NoExecute 等同于小范围排水；没有对应 toleration 的用户作业会立刻被赶走或被挡在门外。
```

| 参数 | 说明 |
| --- | --- |
| `name` | k8s 节点名 |
| `key` | 污点键 |
| `value` | 污点值 |
| `effect` | 污点效果；NoExecute 会驱逐已运行 Pod |
| `reason`（可选） | 操作原因（留档用） |

### `crater_admin_nodes_taint_delete` — 删除节点污点

- 接口：`DELETE /api/v1/admin/nodes/:name/taint`
- 作用域：管理员；写操作（destructive）

```text
【影响面：单节点调度，写，删除类】按 key/value 删除节点 taint，等于放宽该节点的调度限制。⚠️ 删掉隔离类污点后，原本被挡住的高占用作业可能涌入该节点；删前先 crater_admin_nodes_marks 确认。
```

| 参数 | 说明 |
| --- | --- |
| `name` | k8s 节点名 |
| `key` | 要删除的污点键 |
| `value` | 该污点当前的值 |
| `effect`（可选） | 该污点当前的 effect（若后端按 key 匹配可省略） |
| `reason`（可选） | 操作原因（留档用） |

### `crater_admin_nodes_drain` — 排水节点（驱逐其上作业）

- 接口：`POST /api/v1/admin/nodes/:name/drain`
- 作用域：管理员；写操作（destructive）

```text
【影响面：单节点上所有作业，写，不可逆（被驱逐的作业不会自动恢复）】把节点标记为不可调度并驱逐其上的 Pod。⚠️ **会驱逐该节点上正在运行的作业**：这些作业会被终止（用户需重新提交），正在跑的交互式会话/训练进度会丢失。⚠️ 该接口**没有对应的 uncordon/取消排水** 路由：排水后要让节点恢复可调度，需要在集群侧（kubectl uncordon）或其他管理入口处理。调用前请先用 crater_admin_nodes_pods 确认节点上有哪些作业，并提前通知用户。
```

| 参数 | 说明 |
| --- | --- |
| `name` | k8s 节点名 |

### `crater_admin_nodes_pods` — 节点上的 Pod 列表（管理员）

- 接口：`GET /api/v1/admin/nodes/:name/pods`
- 作用域：管理员；只读

```text
【影响面：单节点只读】列出该节点上的 Pod（管理员视角，字段比用户版更多），含所属作业、命名空间、资源、状态。排水/打污点前用它评估影响面；返回里的 Pod 名与 namespace 可用于 crater_admin_nodes_pod_resources 在线调资源。
```

| 参数 | 说明 |
| --- | --- |
| `name` | k8s 节点名 |

### `crater_admin_nodes_pod_resources` — 在线调整 Pod 资源

- 接口：`PUT /api/v1/admin/namespaces/:namespace/pods/:name/resources`
- 作用域：管理员；写操作

```text
【影响面：单个运行中的作业 Pod，写，可逆（改回原值即可）】直接修改运行中 Pod 的 resources（cpu/memory 等）。⚠️ 这是绕过作业模板的在线变更：改小可能导致容器 OOM/被限流，改大可能让节点超卖；后端只允许对「作业 Pod」操作，且会校验调用者对该作业的权限。namespace 一般是作业所在命名空间（如 jobs）。resources 必须是完整的 k8s 资源清单（如 {"cpu":"4","memory":"8Gi"}），未列出的资源键保持原值由后端决定。
```

| 参数 | 说明 |
| --- | --- |
| `namespace` | Pod 所在命名空间，如 jobs |
| `name` | Pod 名（不是作业名；可从 crater_admin_nodes_pods 或作业详情里取） |
| `resources` | 要写入的资源配置，如 {"cpu":"4","memory":"8Gi"}（k8s 数量字符串） |

### `crater_admin_system_billing_get` — 计费配置状态（管理员视角）

- 接口：`GET /api/v1/admin/system-config/billing`
- 作用域：管理员；只读

```text
【影响面：全平台只读】读取计费总开关与参数：功能开关 featureEnabled、是否生效 active、运行中结算开关与周期、作业免费分钟、默认发放点数/周期、按账号覆盖开关，以及 cron 状态。改配置前先读它拿现状。
```

_无参数_

### `crater_admin_system_billing_update` — 修改计费配置（全平台）

- 接口：`PUT /api/v1/admin/system-config/billing`
- 作用域：管理员；写操作

```text
【影响面：全平台所有用户的扣费/发放，写，可逆（改回原值）】修改计费开关与参数，只传要改的字段（后端按指针增量更新）。⚠️ 关掉 featureEnabled/runningSettlementEnabled 会立即停止扣费；改 defaultIssueAmount/Period 会影响所有人之后的发放；开启计费前请确认资源单价已配置（crater_admin_resources_unit_price）与账号发放配置，否则用户余额会瞬间归零/无法提交作业。
```

| 参数 | 说明 |
| --- | --- |
| `featureEnabled`（可选） | 计费功能总开关 |
| `active`（可选） | 计费是否实际生效（feature 开启后还需此开关） |
| `runningSettlementEnabled`（可选） | 运行中作业按周期扣费开关 |
| `runningSettlementIntervalMinutes`（可选） | 运行中结算周期（分钟） |
| `jobFreeMinutes`（可选） | 每次作业的免费分钟数 |
| `defaultIssueAmount`（可选） | 默认每期发放点数（可小数） |
| `defaultIssuePeriodMinutes`（可选） | 默认发放周期（分钟） |
| `accountIssueAmountOverrideEnabled`（可选） | 允许账号自定义发放额度 |
| `accountIssuePeriodOverrideEnabled`（可选） | 允许账号自定义发放周期 |

### `crater_admin_system_llm_get` — 读 LLM 配置（key 已脱敏）

- 接口：`GET /api/v1/admin/system-config/llm`
- 作用域：管理员；只读

```text
【影响面：全平台只读】读取平台 LLM 配置（baseUrl/modelName/apiKey 已脱敏为 ********）。改之前先读它，回写时把 apiKey 原样传回 ******** 即可保留旧密钥。
```

_无参数_

### `crater_admin_system_llm_update` — 写 LLM 配置

- 接口：`PUT /api/v1/admin/system-config/llm`
- 作用域：管理员；写操作

```text
【影响面：全平台 AI 功能（GPU 分析等），写，可逆（改回原值）】更新 LLM 的 baseUrl/modelName/apiKey。apiKey 传 `********` 表示**保留旧密钥**（后端特判）；baseUrl 与 modelName 每次都必须给。validate=true 会让后端立即试连一次，失败则整体回滚并报 409。⚠️ 配错会导致分析类功能全平台不可用。
```

| 参数 | 说明 |
| --- | --- |
| `baseUrl` | OpenAI 兼容接口地址，如 http://172.16.16.110:3002/v1 |
| `modelName` | 模型名，如 qwen2.5-72b-instruct |
| `apiKey`（可选） | API Key；传 ******** 表示保留旧值 |
| `validate`（可选） | true=写入前校验连通性（失败则拒绝写入） |

### `crater_admin_system_pod_bandwidth_get` — 读 Pod 带宽限制配置

- 接口：`GET /api/v1/admin/system-config/pod-bandwidth`
- 作用域：管理员；只读

```text
【影响面：全平台只读】读取 Pod 带宽限制开关与三类带宽值（模型下载/作业入口/作业出口）。
```

_无参数_

### `crater_admin_system_pod_bandwidth_update` — 写 Pod 带宽限制配置

- 接口：`PUT /api/v1/admin/system-config/pod-bandwidth`
- 作用域：管理员；写操作

```text
【影响面：全平台所有新 Pod 的网络限速，写，可逆】设置 Pod 带宽限制。四个字段后端都**必填**，带宽值是 k8s 数量字符串（如 "1G"、"500M"）。⚠️ 限得太低会让模型下载/推理服务超时；只对之后创建的 Pod 生效，已运行的 Pod 不变。改前先 crater_admin_system_pod_bandwidth_get 拿现值。
```

| 参数 | 说明 |
| --- | --- |
| `enabled` | 是否启用 Pod 带宽限制 |
| `modelDownloadBandwidth` | 模型下载带宽，如 1G |
| `jobIngressBandwidth` | 作业入口带宽，如 1G |
| `jobEgressBandwidth` | 作业出口带宽，如 1G |

### `crater_admin_system_model_download_limit_get` — 读模型下载限额（含白名单）

- 接口：`GET /api/v1/admin/system-config/model-download-limit`
- 作用域：管理员；只读

```text
【影响面：全平台只读】读取模型下载限额配置：开关、最大并发、统计窗口小时数、窗口内最多成功下载次数，以及白名单用户 id 列表。
```

_无参数_

### `crater_admin_system_model_download_limit_update` — 写模型下载限额

- 接口：`PUT /api/v1/admin/system-config/model-download-limit`
- 作用域：管理员；写操作

```text
【影响面：全平台用户的模型下载能力，写，可逆】设置模型下载限额。四个数值字段后端都**必填且必须 > 0**，whitelistUserIds 是豁免该限制的用户 id 列表（整表覆盖，不传等于清空白名单）。⚠️ 把 maxSuccessfulDownloads 设小会大面积卡住用户下载；改前先 get 拿现值，避免把白名单洗掉。
```

| 参数 | 说明 |
| --- | --- |
| `enabled` | 是否启用模型下载限额 |
| `maxConcurrent` | 全局最大并发下载数（>0） |
| `windowHours` | 统计窗口小时数（>0） |
| `maxSuccessfulDownloads` | 窗口内每人最多成功下载次数（>0） |
| `whitelistUserIds`（可选） | 豁免白名单用户 id（整表覆盖；不传=清空） |

### `crater_admin_system_gpu_analysis_get` — 读 GPU 分析功能开关

- 接口：`GET /api/v1/admin/system-config/gpu-analysis`
- 作用域：管理员；只读

```text
【影响面：全平台只读】读取 GPU 利用率分析（占卡检测）功能的总开关状态。
```

_无参数_

### `crater_admin_system_gpu_analysis_update` — 开关 GPU 分析功能

- 接口：`PUT /api/v1/admin/system-config/gpu-analysis`
- 作用域：管理员；写操作

```text
【影响面：全平台，写，可逆】开启/关闭 GPU 分析功能。⚠️ 关闭后相关巡检 cronjob 无法被启用（后端会拒绝开启对应 cron），已产生的分析记录保留；开启后需要 LLM 配置可用，否则分析任务会持续失败。
```

| 参数 | 说明 |
| --- | --- |
| `enable` | true=开启 GPU 分析，false=关闭 |

### `crater_admin_system_billing_grant_all` — 给全平台所有用户发点数

- 接口：`POST /api/v1/admin/system-config/billing/extra-balance-all`
- 作用域：管理员；写操作（destructive）

```text
【影响面：**全平台每一个用户**，写，难逆】给所有未被删除的用户统一增加额外点数 delta（后端要求 > 0，不能扣减）。⚠️ 这是一次性群发：人数多、总额大，且没有「撤销」接口（只能逐个用户用 crater_admin_users_adjust_balance 反向扣回）。调用前务必确认 delta 含义（点数，不是金额）与 reason 会留档；计费关闭时该接口可能报错。
```

| 参数 | 说明 |
| --- | --- |
| `delta` | 每人增加的点数，必须 > 0（支持小数） |
| `reason`（可选） | 发放原因（留档，建议必填） |

### `crater_admin_system_billing_reset_all` — 重置全平台计费余额

- 接口：`POST /api/v1/admin/system-config/billing/reset-all`
- 作用域：管理员；写操作（destructive）

```text
【影响面：**全平台所有账号与用户**，写，数据不可恢复】触发一次全平台余额重置：按后端逻辑重新结算每个账号/成员的本期免费余额，并返回受影响的账号数/成员数与时间戳。⚠️ 会一次性改写所有人的余额数字，无法回滚；误调用等于全平台账单被重置。计费功能关闭时会直接报错。执行前请先 crater_admin_accounts_billing_members 抽样留底，并确认当前就是发放周期边界。
```

_无参数_

### `crater_admin_queue_quotas_list` — 队列/用户资源限制列表

- 接口：`GET /api/v1/admin/queue-quotas`
- 作用域：管理员；只读

```text
【影响面：全平台只读】列出队列配额配置项（id/名称/资源限制 map）。这些配额在调度器侧限制单用户可用资源上限，与账号自身的 Volcano 配额（crater_admin_accounts_quota）是两层不同的东西。
```

_无参数_

### `crater_admin_queue_quotas_create` — 新建队列配额

- 接口：`POST /api/v1/admin/queue-quotas`
- 作用域：管理员；写操作

```text
【影响面：命中该配额的账号/用户，写，可逆（可删）】新建一条队列配额配置：name 为配置名，quota 为资源名→数量字符串。⚠️ 配额调小会让正在排队的作业无法被调度；名称冲突会返回 409，建前先 list 一下。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 配额配置名（唯一） |
| `quota` | 资源限制，如 {"cpu":"32","memory":"128Gi","nvidia.com/gpu":"4"} |

### `crater_admin_queue_quotas_update` — 更新队列配额

- 接口：`PUT /api/v1/admin/queue-quotas/:id`
- 作用域：管理员；写操作

```text
【影响面：命中该配额的账号/用户，写，可逆】按 id 更新一条队列配额（name + 整份 quota 覆盖写）。⚠️ quota 是整体覆盖：漏掉的资源键会变成不限制/默认，改前请先 crater_admin_queue_quotas_list 拿全量再改。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 配额配置 id（来自 list） |
| `name` | 配额配置名 |
| `quota` | 完整的资源限制 map（整体覆盖） |

### `crater_admin_queue_quotas_delete` — 删除队列配额

- 接口：`DELETE /api/v1/admin/queue-quotas/:id`
- 作用域：管理员；写操作（destructive）

```text
【影响面：命中该配额的账号/用户，写，删除类】删除一条队列配额配置。⚠️ 删除后相关用户不再受该配额限制（可能瞬间申请到大量资源），也可能回落到默认策略；删前确认它没有在被使用。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 配额配置 id |

### `crater_admin_ops_cronjob_configs` — 巡检 cronjob 配置列表

- 接口：`GET /api/v1/admin/operations/cronjob`
- 作用域：管理员；只读

```text
【影响面：全平台只读】列出所有巡检/清理定时任务（清理类、计费循环、GPU 分析巡检等）的配置：name/type/spec/status/config。看「现在有哪些自动任务、是否 suspended」就调它；改配置用 crater_admin_ops_cronjob_update。
```

_无参数_

### `crater_admin_ops_cronjob_update` — 改巡检 cronjob 配置

- 接口：`PUT /api/v1/admin/operations/cronjob`
- 作用域：管理员；写操作（destructive）

```text
【影响面：全平台自动化，写，可逆（改回原值）】按 name 更新一个 cronjob 的 type/spec/status/config（只传要改的字段）。status 取值：running/idle/suspended/unknown；spec 是 cron 表达式。⚠️ 把清理类任务设成 suspended 等于停掉自动回收，集群可能被占满；把计费循环改成 running 前请确认计费开关状态（后端有校验门）。
```

| 参数 | 说明 |
| --- | --- |
| `name` | cronjob 配置名（来自 configs 列表） |
| `type`（可选） | 任务类型 |
| `spec`（可选） | cron 表达式，如 0 */1 * * * |
| `status`（可选） | 启停状态 |
| `config`（可选） | 任务配置对象（按 name 不同，先看 configs 里的现有值） |

### `crater_admin_ops_cronjob_status` — 查 cronjob 运行状态

- 接口：`POST /api/v1/admin/operations/cronjob/config/status`
- 作用域：管理员；只读

```text
【影响面：全平台只读】按名字批量查 cronjob 的当前状态与调度 entry id。不传 name 等于查全部。排查「自动清理为什么没跑」时先用它看 status 是否为 suspended。
```

| 参数 | 说明 |
| --- | --- |
| `name`（可选） | cronjob 配置名列表；不传=全部 |

### `crater_admin_ops_cronjob_records` — 查巡检执行记录

- 接口：`POST /api/v1/admin/operations/cronjob/record/list`
- 作用域：管理员；只读

```text
【影响面：全平台只读】分页查巡检/清理任务的执行记录，可按任务名、时间范围、状态过滤。时间用 RFC3339 字符串（如 2026-11-01T00:00:00+08:00）。属于「谁在什么时候清理了什么」的追溯依据。
```

| 参数 | 说明 |
| --- | --- |
| `name`（可选） | 任务名列表（不传=全部） |
| `startTime`（可选） | 起始时间，RFC3339 |
| `endTime`（可选） | 结束时间，RFC3339 |
| `status`（可选） | 按状态过滤（如 success/failed，视后端记录值） |

### `crater_admin_ops_clean_low_gpu` — 立即回收低 GPU 利用率作业

- 接口：`POST /api/v1/admin/operations/clean/clean-low-gpu-usage-job`
- 作用域：管理员；写操作（destructive）

```text
【影响面：全平台所有作业，写，不可逆】立刻执行一次「低 GPU 利用率作业回收」：把 GPU 利用率持续低于阈值的作业停止/回收。⚠️ 该操作**不会**给用户确认机会，被判定为低利用率的作业会被直接处理；timeRange 是观察窗口（分钟），util 是利用率阈值（百分比），waitTime 是告警等待时间。误用会批量杀掉用户正在跑的训练。建议先在白名单（crater_admin_ops_whitelist）里排除重要作业，并先看 crater_admin_jobs_all 确认现状。
```

| 参数 | 说明 |
| --- | --- |
| `timeRange` | 必填：观察窗口（分钟），如 30 |
| `waitTime`（可选） | 告警等待时间（分钟），可选 |
| `util`（可选） | GPU 利用率阈值（百分比），可选 |

### `crater_admin_ops_clean_long_running` — 立即处理超长运行作业

- 接口：`POST /api/v1/admin/operations/clean/clean-long-running-job`
- 作用域：管理员；写操作（destructive）

```text
【影响面：全平台所有作业，写，不可逆】立刻执行一次「超长运行作业处理」：把运行时长超过阈值的作业清理/停止。⚠️ batchDays 是批处理类作业的天数阈值、interactiveDays 是交互式作业（Jupyter/WebIDE）的天数阈值，不传则用后端默认。误用会批量打断长期训练；执行前请确认没有正在收敛的关键任务。
```

| 参数 | 说明 |
| --- | --- |
| `batchDays`（可选） | 批处理作业的时长阈值（天） |
| `interactiveDays`（可选） | 交互式作业的时长阈值（天） |

### `crater_admin_ops_clean_waiting_jupyter` — 清理长期排队的 Jupyter 作业

- 接口：`POST /api/v1/admin/operations/clean/clean-waiting-jupyter-job`
- 作用域：管理员；写操作（destructive）

```text
【影响面：全平台排队中的交互式作业，写，不可逆】立刻执行一次「长期排队 Jupyter 作业清理」：把排队超过 waitMinitues 分钟的 Jupyter 作业取消掉（释放排队名额）。⚠️ 单位是**分钟**（后端字段名拼写就是 waitMinitues）；取消后用户需重新提交，交互式环境里的临时内容会丢失。
```

| 参数 | 说明 |
| --- | --- |
| `waitMinitues` | 必填：排队超过多少分钟就清理 |
| `jobTypes`（可选） | 限定作业类型（如 jupyter/webide）；不传由后端默认 |

### `crater_admin_ops_clean_waiting_custom` — 清理长期排队的自定义作业

- 接口：`POST /api/v1/admin/operations/clean/clean-waiting-custom-job`
- 作用域：管理员；写操作（destructive）

```text
【影响面：全平台排队中的自定义/训练作业，写，不可逆】立刻执行一次「长期排队自定义作业清理」：把排队超过 waitMinitues 分钟的作业取消掉。⚠️ 单位是分钟；会打断用户排队中的训练任务，取消不可恢复。
```

| 参数 | 说明 |
| --- | --- |
| `waitMinitues` | 必填：排队超过多少分钟就清理 |
| `jobTypes`（可选） | 限定作业类型（如 custom/pytorch/tensorflow）；不传由后端默认 |

### `crater_admin_ops_add_locktime` — 给作业加锁定时间

- 接口：`PUT /api/v1/admin/operations/add/locktime`
- 作用域：管理员；写操作

```text
【影响面：单个作业，写，可逆（可清除）】给某个作业设置/延长锁定时间：锁定期内该作业不会被低利用率/超时清理任务回收。isPermanent=true 表示永久锁定（请谨慎，等于永久豁免清理）；否则 days/hours/minutes 至少有一个 > 0。name 必须是 **jobName**（k8s 名，如 vsc-crater-admin-261104-c774f），不是显示名。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 作业的 jobName（k8s 名，不是显示名） |
| `isPermanent`（可选） | 永久锁定（true 时忽略时长） |
| `days`（可选） | 锁定天数 |
| `hours`（可选） | 锁定小时数 |
| `minutes`（可选） | 锁定分钟数 |

### `crater_admin_ops_clear_locktime` — 清除作业锁定时间

- 接口：`PUT /api/v1/admin/operations/clear/locktime`
- 作用域：管理员；写操作

```text
【影响面：单个作业，写，可逆（可再加锁）】清除某作业的锁定时间，使其重新受低利用率/超时清理策略约束。name 必须是 jobName（k8s 名）。清除后若该作业利用率确实很低，下一轮清理可能把它回收。
```

| 参数 | 说明 |
| --- | --- |
| `name` | 作业的 jobName（k8s 名，不是显示名） |

### `crater_admin_ops_whitelist` — 运维白名单（不被清理的作业/用户）

- 接口：`GET /api/v1/admin/operations/whitelist`
- 作用域：管理员；只读

```text
【影响面：全平台只读】读取运维白名单：哪些作业/用户不会被自动清理。手工执行清理类操作前先看它，避免误杀白名单对象。
```

_无参数_

### `crater_admin_operation_logs` — 操作审计日志

- 接口：`GET /api/v1/admin/operation-logs`
- 作用域：管理员；只读

```text
【影响面：全平台只读】分页查管理端操作审计日志（操作人、类型、目标、结果、时间），可按人/目标/关键字/时间过滤。用于追溯「谁改了什么」。注意分页参数名是 page 与 **limit**（不是 pageSize），时间是 RFC3339/标准时间字符串。
```

| 参数 | 说明 |
| --- | --- |
| `page`（可选） | 页码，从 1 开始（默认 1） |
| `limit`（可选） | 每页条数（默认 10） |
| `operation_type`（可选） | 按操作类型过滤 |
| `operator`（可选） | 按操作人（登录名）过滤 |
| `target`（可选） | 按操作目标过滤（如节点名/用户名/作业名） |
| `search`（可选） | 关键字模糊搜索 |
| `start_time`（可选） | 起始时间 |
| `end_time`（可选） | 结束时间 |

### `crater_admin_approvals_list` — 全部审批工单

- 接口：`GET /api/v1/admin/approvalorder`
- 作用域：管理员；只读

```text
【影响面：全平台只读】列出所有审批工单（延长作业时长、数据集申请等），按创建时间倒序，含创建人/审批人/状态/内容。后端无分页参数，一次性返回全量；单条详情用 crater_admin_approvals_get。
```

_无参数_

### `crater_admin_approvals_get` — 审批工单详情

- 接口：`GET /api/v1/admin/approvalorder/:id`
- 作用域：管理员；只读

```text
【影响面：单工单只读】按工单 id 取详情（类型/状态/申请内容/理由/审批备注/创建人与审批人）。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 工单 id |

### `crater_admin_approvals_review` — 审核审批工单

- 接口：`PUT /api/v1/admin/approvalorder/:id/review`
- 作用域：管理员；写操作

```text
【影响面：单个工单（可能牵动作业时长/数据集访问），写，可逆性取决于类型】通过/拒绝/取消一个工单。status 只能是 Approved / Rejected / Canceled；**Rejected 必须带 reviewNotes**（后端强制）。⚠️ 批准延长作业时长的工单会实际延长用户作业，拒绝则相当于驳回诉求；只能审核状态为 Pending 的工单。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 工单 id |
| `status` | 审核结果 |
| `reviewNotes`（可选） | 审批备注（Rejected 时必填） |

### `crater_admin_gpu_analysis_list` — GPU 分析记录列表

- 接口：`GET /api/v1/admin/gpu-analysis`
- 作用域：管理员；只读

```text
【影响面：全平台只读】列出 GPU 利用率分析记录（关联作业名、评分、审核状态、涉及资源/节点等），按评分倒序。用来找「疑似占卡不干活」的作业；审核/停机分别用 crater_admin_gpu_analysis_review 与 crater_admin_gpu_analysis_confirm_stop。
```

_无参数_

### `crater_admin_gpu_analysis_review` — 审核 GPU 分析结论

- 接口：`PUT /api/v1/admin/gpu-analysis/:id/review`
- 作用域：管理员；写操作

```text
【影响面：单条分析记录，写，可逆（可再改）】把分析记录标记为「已确认占卡」(2) 或「已忽略」(3)。⚠️ 只是标记结论，**不会**停止作业；要真正停作业用 crater_admin_gpu_analysis_confirm_stop。id 是分析记录 id，不是作业名。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 分析记录 id |
| `reviewStatus` | 2=确认占卡（Confirmed），3=忽略（Ignored） |

### `crater_admin_gpu_analysis_confirm_stop` — 确认并停止问题作业

- 接口：`POST /api/v1/admin/gpu-analysis/:id/confirm-stop`
- 作用域：管理员；写操作（destructive）

```text
【影响面：单个用户作业，写，不可逆】确认某条分析结论并**立即删除对应作业**（作业被强制停止，用户需重新提交）。id 是分析记录 id（不是作业名），后端会按记录里的 jobName 停作业，并把记录标记为已确认。⚠️ 高风险：这是「替用户杀作业」，执行前请确认记录确实指向占卡/异常作业，并尽量先通知用户。
```

| 参数 | 说明 |
| --- | --- |
| `id` | 分析记录 id（来自 gpu_analysis_list） |

### `crater_admin_gpu_analysis_trigger_all` — 对全部运行中作业触发 GPU 分析

- 接口：`POST /api/v1/admin/gpu-analysis/trigger/all-jobs`
- 作用域：管理员；写操作

```text
【影响面：全平台运行中的作业，写，可逆（只产生分析记录）】把符合条件的运行中作业批量加入后台 GPU 分析队列，接口立即返回排队数量，分析异步进行。⚠️ 会消耗 LLM 配额与集群指标查询资源，短时间内重复调用意义不大；需要先在系统配置里开启 GPU 分析功能（crater_admin_system_gpu_analysis_update），否则任务会失败。
```

_无参数_

### `crater_admin_jobs_all` — 全平台作业列表（宽接口）

- 接口：`GET /api/v1/vcjobs/all`
- 作用域：管理员；只读

```text
【影响面：全平台只读，含他人作业】列出所有用户的作业（这是后端不按调用者过滤的宽接口，只允许管理员用）。默认只回最近若干天，用 days=-1 表示不按天数截断；page_size 上限 200（注意参数名是 page_size）。返回项里同时有 `name`（用户填的显示名，可能中文/重名）与 `jobName`（k8s 名）：**所有按作业名操作的接口都要传 jobName**。
```

| 参数 | 说明 |
| --- | --- |
| `page`（可选） | 页码，从 1 开始（默认 1） |
| `page_size`（可选） | 每页条数，默认 10，最大 200 |
| `sort`（可选） | 排序表达式，如 createdAt:desc |
| `search`（可选） | 关键字搜索（≤128 字符） |
| `days`（可选） | 统计天数，-1=不限时间 |
| `job_type`（可选） | 按作业类型过滤（一次一个，如 jupyter/webide/custom） |
| `status`（可选） | 按作业状态过滤（一次一个，如 Running/Pending/Completed） |
| `node`（可选） | 按节点名过滤 |

### `crater_admin_jobs_by_user` — 指定用户的作业列表（宽接口）

- 接口：`GET /api/v1/vcjobs/user/:username`
- 作用域：管理员；只读

```text
【影响面：任意用户只读】列出某个用户的作业（后端不校验归属，只允许管理员用），参数与分页同 crater_admin_jobs_all。username 必须是**登录名**（不是昵称）。注意返回项里的 `jobName` 才是后续所有作业接口要用的名字。
```

| 参数 | 说明 |
| --- | --- |
| `username` | 目标用户的登录名（不是昵称） |
| `page`（可选） | 页码，从 1 开始（默认 1） |
| `page_size`（可选） | 每页条数，默认 10，最大 200 |
| `sort`（可选） | 排序表达式 |
| `search`（可选） | 关键字搜索 |
| `days`（可选） | 统计天数，-1=不限时间 |
| `job_type`（可选） | 按作业类型过滤（一次一个） |
| `status`（可选） | 按作业状态过滤（一次一个） |
| `node`（可选） | 按节点名过滤 |

### `crater_admin_statistics` — 资源使用统计（可跨全集群）

- 接口：`GET /api/v1/statistics`
- 作用域：管理员；只读

```text
【影响面：全平台统计只读】按时间范围返回资源使用统计（核时/卡时/GiB·时）：totalUsage + 时间序列。scope=cluster 是集群总量（仅管理员可查），account 需账号管理员，user 可查任意用户（targetID 填 user_id 或 account_id）。⚠️ startTime/endTime/step/scope 都是必填，时间是 RFC3339（如 2026-11-01T00:00:00+08:00）。
```

| 参数 | 说明 |
| --- | --- |
| `startTime` | 起始时间，RFC3339，如 2026-11-01T00:00:00+08:00 |
| `endTime` | 结束时间，RFC3339 |
| `step` | 聚合粒度 |
| `scope` | 统计维度；cluster 仅管理员可用 |
| `targetID`（可选） | 目标 id（scope=user 填 user_id，scope=account 填 account_id；cluster 忽略） |

</details>


## cli

| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `crater_cli_read` | CLI | `crater <read-only subcommand>` | 仅本人 | 只读 | 把官方 `crater` CLI 当成透传通道，执行**只读**子命令，自动补 --json --no-interactive，返回结构化结果。适合官方 CLI 独有、本 MCP 没有强类型工具的能力：模型/数据集下载任务（download ls\|get\|logs）、审批工单（order ls\|get\|by-n |
| `crater_cli_write` | CLI | `crater <write subcommand>` | 仅本人 | **写（destructive）** | 透传官方 CLI 的**写**命令，只有设置 CRATER_ALLOW_CLI_WRITE=true 后才可用，且仍受白名单限制。典型用途：下载任务（download model\|dataset\|create\|pause\|resume\|retry\|rm）、审批工单（order submit\|edit\|c |

<details><summary>参数与完整描述</summary>

### `crater_cli_read` — 执行官方 crater CLI 的只读命令

- 接口：`CLI crater <read-only subcommand>`
- 作用域：仅本人；只读

```text
把官方 `crater` CLI 当成透传通道，执行**只读**子命令，自动补 --json --no-interactive，返回结构化结果。适合官方 CLI 独有、本 MCP 没有强类型工具的能力：模型/数据集下载任务（download ls|get|logs）、审批工单（order ls|get|by-name）、Pod 诊断（pod containers|events|ingresses|logs|nodeports）、CLI 与平台兼容性（compatibility -p <url>）、镜像构建记录（image build ls|get|template）、镜像授权（image share ls|users|accounts）、CUDA 基础镜像与 Harbor 配额（image cuda ls / image quota get / image harbor info）。禁止：任何写命令（用 crater_cli_write）、auth login/switch、job token|secret|ssh、image harbor credential、file upload|download（沙箱外读写请走 crater_files_*）。注意：本工具用的是**你本机 crater CLI 自己的登录态**，与本 MCP 的账号互相独立；未登录请先在你自己的终端执行 crater auth login。:name 参数要传 jobName（vsc-...-abcde），不是中文显示名。
```

| 参数 | 说明 |
| --- | --- |
| `args` | crater 后面的参数数组，按段拆开，例如 ["job","ls","--page-size","5"]；不要带 "crater" 本身，也不要拼成一条字符串 |
| `timeoutMs`（可选） | 超时毫秒数，默认 60000；下载/构建类可调大 |

### `crater_cli_write` — 执行官方 crater CLI 的写命令（需显式开启）

- 接口：`CLI crater <write subcommand>`
- 作用域：仅本人；写操作（destructive）

```text
透传官方 CLI 的**写**命令，只有设置 CRATER_ALLOW_CLI_WRITE=true 后才可用，且仍受白名单限制。典型用途：下载任务（download model|dataset|create|pause|resume|retry|rm）、审批工单（order submit|edit|cancel、admin order approve|reject）、镜像构建（image build pip-apt|dockerfile|envd|remove、image share add|remove）、管理员清理（admin job delete|lock|unlock|keep|clean）。优先用本 MCP 的强类型工具（crater_jobs_create_*、crater_images_*）：它们有参数校验和更好的错误提示；只有 CLI 独有或 CLI 更成熟的写操作再用本工具。执行前请确认目标对象，避免误删。
```

| 参数 | 说明 |
| --- | --- |
| `args` | crater 后面的参数数组，按段拆开，例如 ["job","ls","--page-size","5"]；不要带 "crater" 本身，也不要拼成一条字符串 |
| `timeoutMs`（可选） | 超时毫秒数，默认 60000；下载/构建类可调大 |

</details>


## feedback

| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `crater_feedback_submit` | POST | `/api/v1/feedback` | 仅本人 | 写 | 当你确认是**平台侧故障**（不是自己参数写错）时提交一条反馈给管理员，例如：接口 5xx / 网关 502 / 长时间超时、作业卡在 Pending 而节点与配额都正常、镜像构建异常失败、文件系统 403 而权限看起来正常、页面数据明显与集群不符。**不要**用它提交：用户参数错误、配额不足、权限不足、自己想问的功能 |
| `crater_feedback_mine` | GET | `/api/v1/feedback/mine` | 仅本人 | 只读 | 列出当前用户提交过的反馈（最近 100 条），包含状态（open 待处理 / in_progress 处理中 / closed 已处理）与管理员回复。适用于：上报故障后想确认是否已被处理；用户问「上次那个问题怎么样了」；上报前检查是否已经报过同一问题。 |

<details><summary>参数与完整描述</summary>

### `crater_feedback_submit` — 向管理员提交平台故障反馈

- 接口：`POST /api/v1/feedback`
- 作用域：仅本人；写操作

```text
当你确认是**平台侧故障**（不是自己参数写错）时提交一条反馈给管理员，例如：接口 5xx / 网关 502 / 长时间超时、作业卡在 Pending 而节点与配额都正常、镜像构建异常失败、文件系统 403 而权限看起来正常、页面数据明显与集群不符。**不要**用它提交：用户参数错误、配额不足、权限不足、自己想问的功能用法（那些直接告诉用户即可）。auto=true 时标题会自动加「[Agent 自动汇报]」前缀；同一故障 30 分钟内只报一次，每小时最多 6 条；内容会自动脱敏（password/token/JWT 等替换成 ***）。提交后请把反馈编号告诉用户，并继续给出可行的替代方案或绕过方式。
```

| 参数 | 说明 |
| --- | --- |
| `category` | 反馈类型：平台故障用 bug；能力缺失/改进建议用 feature；用法疑问用 question；其它用 other |
| `title` | 一句话说明现象，例如：镜像构建接口返回 502 |
| `content` | 详细描述，建议包含：① 触发操作与工具名 ② 报错原文（HTTP 状态码/错误码/关键信息） ③ 涉及对象（作业名 jobName、镜像名、文件路径） ④ 发生时间 ⑤ 已做过的排查 ⑥ 期望行为 |
| `contact`（可选） | 可选：方便回访的联系方式 |
| `auto`（可选） | 是否由 agent 自动上报（true 时标题自动加 [Agent 自动汇报] 前缀） |
| `pageUrl`（可选） | 可选：相关页面路径，例如 /portal/jobs/detail |

### `crater_feedback_mine` — 查看我提交过的反馈与管理员回复

- 接口：`GET /api/v1/feedback/mine`
- 作用域：仅本人；只读

```text
列出当前用户提交过的反馈（最近 100 条），包含状态（open 待处理 / in_progress 处理中 / closed 已处理）与管理员回复。适用于：上报故障后想确认是否已被处理；用户问「上次那个问题怎么样了」；上报前检查是否已经报过同一问题。
```

| 参数 | 说明 |
| --- | --- |
| `onlyUnresolved`（可选） | true 时只返回未处理/处理中的反馈（status != closed） |

</details>
