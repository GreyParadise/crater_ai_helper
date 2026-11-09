# 真机实测记录（live verification）

> 所有结论都来自实际请求与本会话的真实响应，不是推断。
> 目标环境：Crater 面板 `http://172.16.16.140`（集群 `172.16.16.126`，k3s v1.36.4 + Volcano v1.16.0，
> 后端镜像 `172.16.16.126:30003/crater/crater-be:be-127`）。
> 身份：`crater-admin`（userId=1, rolePlatform=3, accountId=3 `q-3`, accessMode=3）。

---

## 1. 环境与镜像差异（决定了哪些接口不能封装）

上游 `main` 比线上镜像新，仓库里 `_crater_src` 快照也**既不是线上版也不是最新版**。判据：

| 探测 | 结果 | 结论 |
| --- | --- | --- |
| `GET /api/v1/aijobs/all` | 404 | 线上没有 AI 作业 manager |
| `GET /api/v1/spjobs/*`、`GET /api/v1/tensorboard/*` | 404 | 同上 |
| `GET /api/v1/storage/my-quota`、`/api/v1/storage/dirsize/*`、`/api/v1/storage/capabilities` | 404 | 主后端的 storage 只读接口不存在 |
| `GET /api/v1/admin/storage/**` | 404 | 同上 |
| `GET /api/v1/admin/system-config/scheduler-extender` | 404（GET） | 整对跳过 |
| `POST /api/ss/upload/*path` | 404 | 上传必须走 WebDAV `PUT /api/ss/*path` |
| `GET /api/v1/context/prequeue` | **200 `{"backfillEnabled":false}`** | 线上**有**该路由（源码快照里没有 → 快照比线上旧） |
| `GET /api/v1/context/attributes` | 404 | 只有 `PUT`，读属性用 `/api/auth/check` |
| `GET /api/v1/jobtemplate/1` | 500 `Failed to get job template` | 路由存在（非 404），id=1 记录不存在 |

> 由此确定原则：**以线上响应为准**，源码只用来核对字段名；源码里查不到不等于线上没有（`context/prequeue`），
> 源码里有也不等于线上有（`aijobs`）。

---

## 2. 存储服务（storage-server，独立进程）

`/api/ss/*` 是**另一个进程**，主后端的 `/api/v1/files` 不存在。实测可用组合：

| 操作 | 请求 | 结果 |
| --- | --- | --- |
| 建目录 | `MKCOL /api/ss/user/<dir>` | 201（父目录必须存在，且只能建一级；已存在 → 409 `directory path already exists`；根 → 403） |
| 上传 | `PUT /api/ss/<逻辑路径>`（裸 body） | 201 `Created`；`overwrite=false` 且已存在 → 409 |
| 下载 | `GET /api/ss/download/<逻辑路径>` | 200 + 二进制 |
| 移动 | `POST /api/ss/move/<源> {"dst":"<目标>"}` | 200；目标已存在直接报错（不覆盖） |
| 删除 | `DELETE /api/ss/delete/<逻辑路径>` | 200 `Delete file successfully`（RemoveAll 语义、幂等、无回收站） |
| 列目录 | `GET /api/ss/files/<逻辑路径>` | 200；带 `rw=true` 走 `/api/ss/rwfiles`（只含可写空间，无权限 → 401） |
| 用量 | `GET /api/ss/usage` | 200（`public` 4.31 MiB / 12 files 等） |
| 写权限 | `GET /api/v1/storage/verify` | 200 `{userId:1, rootPath:"q-3", permission:3, permissionName:"ReadWrite"}` |

**逻辑路径语义**：`user` = 自己的空间根（实测物理落点 `/crater/users/u-admin/...`）、`user/<sub>`、
`account` = 当前账号空间、`public`、`dataset/<id>`；逻辑根只读。
`/api/ss/userspace` 与 `/api/ss/queuespace` **仅平台管理员可调**（源码 `file.go` 里判断 `RolePlatform`），
所以非管理员调用时工具会返回 `available:false` + 降级提示，而不是假装成功。

---

## 3. 端到端闭环证据（MCP → Crater → k8s）

### 3.1 作业创建 → 运行 → 日志 → 删除

```
crater_jobs_create_training
  { name: "mcp-smoke-echo",
    image:  { imageLink: "172.16.16.126:30003/base-images/python:3.11-slim-ssh", archs: ["amd64"] },
    resource: { cpu: "1", memory: "1Gi" },
    shell: "bash", command: "echo hello-from-crater-mcp && id && ls /", workingDir: "/tmp" }
→ 作业已提交：jobName=sg-crater-admin-261106-892b0（显示名：mcp-smoke-echo） 队列=q-a3-u1
crater_jobs_get          → jobType=custom, namespace=crater-workspace, status=Running→Succeeded
crater_jobs_logs         → phase=Succeeded:
                            hello-from-crater-mcp
                            uid=0(root) gid=0(root) groups=0(root)
                            bin boot crater-start.sh dev etc home ...
crater_jobs_stop         → 已请求删除作业 sg-crater-admin-261106-892b0
```

清理核验：面板列表回到 6 条（无 `mcp-smoke`），集群 `kubectl get vcjob -n crater-workspace` 无 `sg-crater-admin-261106-*`，
无残留 Pod。

> 附带事实：容器以 **root** 运行（`uid=0`），这是已知待改项（非本次范围）。

### 3.2 文件上传 → 列目录 → 下载 → 越权拦截 → 删除

```
crater_files_upload { localPath:"upload.txt", path:"user/__mcp_smoke__/hello.txt", overwrite:true }
→ ok, bytes=52, autoCreatedDirs=["user/__mcp_smoke__"], response="Created"
crater_files_list   { path:"user/__mcp_smoke__" }        → total=1, entries=[hello.txt]
crater_files_download { path:"user/__mcp_smoke__/hello.txt", localPath:"download.txt" }
→ 落盘内容 = "hello from crater-mcp smoke 2026-11-06T07:31:43.032Z"（与上传一致）
crater_files_download { path:..., localPath:"..\\..\\evil.txt" }
→ 被 GuardError 拦下：localPath 必须位于 CRATER_WORK_DIR 之内
crater_files_mkdir  { path:"user/__mcp_smoke__" }        → created=false, alreadyExists=true
crater_files_delete { path:"user/__mcp_smoke__/hello.txt" } → existed=true, "Delete file successfully"
crater_files_delete { path:"user/__mcp_smoke__", recursive:true } → existed=true, wasDir=true
crater_files_list   { path:"user", nameContains:"__mcp_smoke__" } → total=0
```

### 3.3 作业读取面（同一个真实 WebIDE 作业）

| 工具 | 结果摘要 |
| --- | --- |
| `crater_jobs_list` | 6 个作业；`jobName` / 显示名 / 类型 / 状态 / 账号 / 资源齐全 |
| `crater_jobs_facets` | `job_type: jupyter 3, webide 3`；`status: Deleted 2, Freed 2, Failed ...` |
| `crater_jobs_get` | `vsc-crater-admin-261104-c774f`：namespace、jobType、scheduleType、资源等 |
| `crater_jobs_pods` | `vsc-crater-admin-261104-c774f-default0-0` / node `gpu004` / ip `10.52.3.169` / `webide:8888` |
| `crater_jobs_logs` | `/vcjobs/:jobName/pods` → `/namespaces/:ns/pods/:pod/containers/:c/log?tailLines=N`，返回 **base64**，工具自动解码为文本 |
| `crater_jobs_get_secret` | WebIDE 访问地址 + 随机密码（工具描述已标注「含敏感凭据」） |
| `crater_jobs_get_token` | 对 webide 作业正确报 `Job type is not Jupyter` |
| `crater_jobs_yaml` / `_events` / `_billing_detail` / `_template_from_job` | 均 200 且有内容 |
| `crater_jobs_get`（乱填 name） | 被归属白名单拦下：「你的作业列表里找不到…」 |

### 3.4 管理端读取面（admin 身份）

| 工具 | 结果摘要 |
| --- | --- |
| `crater_admin_users_list` | 6 个用户（后端不分页，MCP 本地切片） |
| `crater_admin_users_baseinfo` | `test / lijianxin / ...` 含 space |
| `crater_admin_accounts_list` | `default→/public`、`q-3` 等 |
| `crater_admin_nodes_list` | `llm004`(control-plane)、`gpu004`(worker) 等 |
| `crater_admin_system_billing_get` | `featureEnabled=true, active=false` |
| `crater_admin_system_llm_get` | `baseUrl=http://172.16.16.110:3002/v1`，apiKey 已掩码 |
| `crater_admin_ops_cronjob_configs` / `_status` | 定时任务配置与状态（`biling-base-loop` suspended） |
| `crater_admin_operation_logs` | `total=1`（分页参数是 `limit`，非 `pageSize`） |
| `crater_admin_jobs_all` | 全量作业视图（含 owner） |

---

## 4. 创建作业的必填字段（空 body 探测法）

对 5 个创建接口发空 body，用 binding 报错反推必填项（**均为 400，无副作用**）：

| 接口 | 必填 | 说明 |
| --- | --- | --- |
| `POST /vcjobs/webide` `jupyter` `pytorch` `tensorflow` | `name` | `image` 是 struct 级 `required`，空 body 先被 `name` 拦下 |
| `POST /vcjobs/training` | `name`、`workingDir` | 另有 `image` 结构校验 |
| `POST /vcjobs/*` 的 `image` | `{imageLink, archs?}` | `ImageBaseInfo`：`json:"imageLink"` / `json:"archs"` |
| `POST /vcjobs/training` | `resource`（map<string,string>）、`shell?`、`command?` | `v1.ResourceList`，GPU 键随型号（`nvidia.com/gpu` 等） |
| `POST /vcjobs/tensorflow` `pytorch` | `tasks[]{name,replicas,resource,image,shell?,command?,workingDir?,ports?}` | 分布式用 tasks |
| `CreateJobCommon` | `name`；`volumeMounts` / `envs` / `selectors` / `template` / `alertEnabled` / `cpuPinningEnabled` / `forwards` 可选 | `datasetMounts` 后端**无人读取** → 工具不暴露 |

数据集与镜像写接口同样用空 body 反推（400 且带字段名）：

| 接口 | 必填字段 |
| --- | --- |
| `POST /dataset/create` | `Name`、`URL`、`Describe` |
| `POST /dataset/update` | `DatasetID`、`Name`、`Describe`、`URL` |
| `POST /dataset/share/user` | `DatasetID`、`UserIDs` |
| `POST /dataset/share/queue` | `DatasetID`、`QueueIDs` |
| `POST /dataset/cancelshare/*` | `DatasetID`（+ 对应用户/账号 ID） |
| `POST /images/kaniko` | 无 binding 必填，但服务层要求 base image 匹配 `([^/]+/){2}([^:]+):([^/]+)$` |
| `POST /images/dockerfile` | Dockerfile 里必须能抽出 `FROM` |
| `POST /images/deleteimage` | `DeleteImageByIDListRequest.IDList` |
| `POST /images/remove` | `DeleteKanikoByIDListRequest.IDList` |

⚠️ **探测教训**：`POST /images/envd` 与 `POST /images/image` 空 body 返回 **200**，其中 `envd` 会真的建出
一个 kaniko 构建任务（本次产生 ID=44，已删除；`remove` 对 Running 任务只置失败，需等状态落定再删一次）。
今后对「无 binding 必填」的写接口不做空 body 探测。

---

## 5. 分页 / 参数名不统一的实测结论

| 接口 | 分页参数 | 备注 |
| --- | --- | --- |
| `GET /api/v1/vcjobs` | `page` + `page_size` | 不是 `pageSize` |
| `GET /api/v1/admin/operation-logs` | `page` + `limit` | |
| `GET /api/v1/admin/queue-quotas`、`approvalorder`、`gpu-analysis` | 无 | 全量返回 |
| `GET /api/v1/admin/users` | 无 | MCP 本地做筛选/分页 |
| `GET /api/v1/jobtemplate/list` | 无 | 空时为 `null` |

其余关键事实：

- 所有 `/vcjobs/:name/**` 与运维 locktime/清理接口要的是 **`jobName`**（如 `vsc-crater-admin-261104-c774f`），
  `name` 只是显示名（可以是中文）→ 工具统一做一次列表解析（既修 500，又当归属白名单）。
- `GET /api/v1/vcjobs` 列表项同时有 `name`（显示名）与 `jobName`（k8s 名）。
- 镜像列表元素的主键是**大写 `ID`**；`images/quota` 是对象 `{used,quota,project,total}` 而非分页。
- 统计类 `GET /api/v1/statistics` 可查任意用户（`scope=user&targetID=...`），非管理员在 MCP 层直接封死。

---

## 6. MCP 侧自检（可复现）

```bash
node dist/index.js --check    # 176 个工具（当时；现 180，见 mcp-design §5）（auth:6, profile:7, jobs:24, images:25, files:12, resources:12, datasets:13, admin:77）
node dist/index.js --list     # 每个工具带 METHOD /path
npm run smoke                 # 握手 + 全量只读工具接线 + 只读闸 + 身份；本次结果：全部通过
npm run catalog               # 生成 docs/tool-catalog.md
```

`--check` / `--list` 现在**不需要凭证**（离线可用）；`--whoami` / `smoke` 才需要 `CRATER_*`。

本次 `smoke` 覆盖当时 176 个工具中的 **90 个只读工具**（现只读工具 92 个）：**49 个 `PASS`**（返回真实数据）、
**41 个 `ARGS`**（MCP 层拦下「缺少必填参数」，说明工具已正确接线且声明了必填项，属预期）；
`CRATER_READ_ONLY=true` 下写工具 100% 被 `GUARD` 拦下（抽查 `crater_profile_update`）。

参数化工具的「真实调用」证据不靠 smoke，而靠上面的端到端小节（作业建/日志/删、文件四件套、作业读取面 12 个带参工具）。
