# Crater MCP Server 设计说明

> 版本：v1.0（2026-11-06）
> 目标：把 Crater 平台**包成一个 MCP 服务**，交给 Codex / DeepSeek Harness / opencode / Kimi Code 等 agent 框架直接接管，
> 全程**只在账号用户权限内**动作，不触碰 Crater 底层（不读库、不碰 k8s API、不越过后端鉴权）。

---

## 0. 为什么改方向

原方案（`docs/legacy-assistant-design.md`，v1.0，28 接口 + 自研 prompt 引擎）是把 AI 助手**嵌进 Crater 内部**：

| 嵌入方案的问题 | MCP 反转方案的优势 |
| --- | --- |
| 要改 Crater 后端代码、跟前端联调、随上游版本漂移而返工 | 零侵入：Crater 源码一行不改，只用它的公开 HTTP API |
| 只能自己写一套 function-calling，模型能力受限于平台内置 LLM 配置 | 直接用 agent 框架自己的模型、工具循环、多轮记忆、本地文件与终端能力 |
| 每个能力都要写 prompt + 解析，效果不可控 | 能力 = 一个工具，agent 自然编排；逻辑与提示词解耦 |
| 只能服务 Crater 用户，且必须在平台里点 | 用户在本地跑 MCP，agent 里一句话就能操作平台 |

结论：**把 Crater 变成 agent 的工具箱，而不是把 agent 塞进 Crater。**

---

## 1. 总体架构

```
┌─────────────────────────── 用户本机 ───────────────────────────┐
│                                                                │
│  Codex / opencode / Kimi Code / DeepSeek Harness               │
│        │  stdio (MCP JSON-RPC)                                 │
│        ▼                                                       │
│  crater-mcp 进程（本仓库）                                      │
│   ├── 工具注册表   src/tools/*.ts    （180 个工具，按域分组）      │
│   ├── 通用执行器   src/registry.ts   （路径/query/body 拼装）      │
│   ├── 作用域守卫   src/scope.ts      （只读闸 / admin 闸 / 宽接口闸）│
│   └── HTTP 客户端  src/client.ts     （登录、refresh、401 自愈、上传下载）│
│                                                                │
└───────────────────────────┬────────────────────────────────────┘
                            │ HTTPS/HTTP + Bearer JWT
                            ▼
┌───────────────────── Crater 平台（.126） ─────────────────────┐
│  panel/ingress ──► crater-be（gin）                           │
│                     ├── /api          公开（登录/注册/认证模式）  │
│                     ├── /api/v1       需 JWT + 封禁校验          │
│                     └── /api/v1/admin 需 rolePlatform == 3      │
│  storage-server（独立进程）──► /api/ss/*  文件读写/WebDAV        │
│  k8s / Volcano / Harbor / Longhorn（MCP 完全不接触）            │
└───────────────────────────────────────────────────────────────┘
```

**关键设计原则**

1. **身份即权限**：MCP 进程持有的是**用户自己的 Crater 凭证**，每次请求都用他的 JWT。越权在协议层就不可能——不是靠 MCP 判断，而是后端会拒。
2. **不碰底层**：MCP 不持有 kubeconfig、不直连数据库、不调 kubectl。所有能力都等价于「用户在网页上点一下」。
3. **工具即 API**：一个 Crater 接口 ≈ 一条 `ToolSpec`，声明式定义，不写业务逻辑。
4. **危险接口在 MCP 层再上一道锁**：后端有一批「Protected 但不校验归属」的接口（见 §4.3），MCP 显式封掉。

---

## 2. 代码结构

```
crater_ai_helper/
├── src/
│   ├── index.ts          # 入口：stdio transport、工具注册、--list/--check/--whoami
│   ├── config.ts         # 环境变量 → CraterConfig
│   ├── client.ts         # CraterClient：login/refresh/request/upload/download + 401 自愈
│   ├── errors.ts         # CraterError：HTTP 状态 + 业务码 + 给 agent 的可执行建议
│   ├── scope.ts          # 作用域守卫（只读闸 / admin 闸 / 宽接口闸 / 只读账号闸）
│   ├── registry.ts       # ToolSpec 类型 + 通用执行器 + 错误转文本
│   └── tools/
│       ├── auth.ts       # 登录/注册/whoami/切账号/refresh
│       ├── profile.ts    # 资料完善/邮箱验证/账单摘要/配额
│       ├── jobs.ts       # 作业创建（5 类）/列表/详情/日志/启停/凭据
│       ├── images.ts     # 镜像构建（envd/dockerfile/kaniko）/查询/共享/删除
│       ├── files.ts      # 文件管理（storage-server：列/传/下/删/移/建目录）
│       ├── resources.ts  # 资源/节点/统计/上下文（只读）
│       ├── datasets.ts   # 数据集创建/分享/成员
│       ├── admin.ts      # 管理端：用户/账号/资源/节点/系统配置/队列配额/运维/审批
│       ├── cli.ts        # 官方 CLI 透传（只读白名单 + 写命令开关）
│       ├── feedback.ts   # 故障上报（提交/我的反馈；去重 + 限流 + 脱敏）
│       └── index.ts      # 聚合 + 校验（唯一性/命名规范）
├── docs/
│   ├── mcp-design.md          ← 本文件
│   ├── api-inventory.md       # Crater 真实 API 全表（305 条，逐行核对源码）
│   ├── tool-authoring.md      # 工具开发契约
│   └── legacy-assistant-design.md  # 已废弃的「嵌入式 AI 助手」方案
├── scripts/              # 冒烟测试脚本
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 3. 配置项

全部走环境变量（agent 框架的 MCP 配置里写 `env`），**不落盘、不外发**。

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `CRATER_BASE_URL` | ✅ | — | 面板地址，如 `http://172.16.16.140`（ingress VIP）或 NodePort |
| `CRATER_USERNAME` | ✅* | — | 登录名 |
| `CRATER_PASSWORD` | ✅* | — | 密码（仅在本地进程内使用） |
| `CRATER_ACCESS_TOKEN` | ✅* | — | 直接用 JWT（与用户名密码二选一） |
| `CRATER_REFRESH_TOKEN` | | — | 配合 access token 用于续期 |
| `CRATER_ACCOUNT` | | 登录返回的默认账号 | 登录后自动切到该账号（项目），如 `q-3` |
| `CRATER_READ_ONLY` | | `false` | `true` = 所有写操作工具直接拒绝，不发请求 |
| `CRATER_ALLOW_ADMIN` | | `true` | `false` = 不注册管理端工具（即使本人是管理员） |
| `CRATER_ENFORCE_SELF_SCOPE` | | `true` | `true` = 非管理员禁止触达「后端不校验归属」的宽接口 |
| `CRATER_STORAGE_BASE_URL` | | 同 `CRATER_BASE_URL` | storage-server 单独域名时才需要 |
| `CRATER_TIMEOUT_MS` | | `30000` | 普通请求超时 |
| `CRATER_TRANSFER_TIMEOUT_MS` | | `600000` | 上传/下载超时 |
| `CRATER_WORK_DIR` | | 系统临时目录/crater-mcp | 上传源与下载目标的**允许根目录**（见 §4.5） |

---

## 4. 安全模型

### 4.1 后端本身有四道闸（MCP 只是继承者）

依据 `backend/internal/middleware/jwt.go` 与各 handler：

| 闸 | 位置 | 规则 |
| --- | --- | --- |
| ① JWT | `AuthProtected` | `Authorization: Bearer <token>`，HS256 校验，过期/签名错都归 401 `TokenExpired` |
| ② 封禁 | `AuthProtected` | `RequireCapability(PlatformAccess)`，被封禁 → 403（不是 401） |
| ③ 写时回库 | `AuthProtected`（非 GET） | 每次比对 `Role`、`RoleAccount`、`AccessMode` 与 token 内快照，不一致 → 401 |
| ④ 归属过滤 | 各 handler | 作业按 `user_id + account_id`；镜像写操作 `requireImageOwner`；文件按路径前缀 + AccessMode；数据集按创建者/分享 |

**MCP 侧必须理解的两个后果**：

- **读/写鉴权不对称**：GET 只信 token 快照，写操作每次回库。所以「能读不能写」是权限被改的真实信号，不是 bug。客户端的处理是：401 → refresh → 仍 401 → 整轮重新 login → 重试一次（`client.ts` `recoverAuth`）。
- **`/api/v1/auth/switch` 是唯一豁免**：切账号后必须换用响应里的新 token，`switchAccount()` 已处理。

### 4.2 MCP 三道本地闸（`src/scope.ts`）

| 闸 | 触发条件 | 行为 |
| --- | --- | --- |
| 只读闸 | `CRATER_READ_ONLY=true` 且工具 `readOnly=false` | 直接抛 `GuardError`，不发请求 |
| 管理闸 | 工具 `scope="admin"` 且 `rolePlatform != 3` | 拒绝并提示当前角色 |
| 宽接口闸 | `CRATER_ENFORCE_SELF_SCOPE=true`、非管理员、命中宽接口清单 | 拒绝并给出替代工具建议 |
| 只读账号闸 | 账号内 `AccessMode=2(RO)` 且工具为写操作 | 提前给出可读原因（后端本来也会 403） |

### 4.3 宽接口清单（后端不做归属校验，MCP 必须收窄）

来自 `docs/api-inventory.md` §4.2-D，逐条对应源码：

| 接口 | 风险 | MCP 处置 |
| --- | --- | --- |
| `GET /api/v1/vcjobs/all`、`/vcjobs/billing/all` | 列出全平台作业与账单 | 仅 admin 组 |
| `GET /api/v1/vcjobs/user/:username` | 可枚举任意用户作业 | 仅 admin 组 |
| `GET /api/v1/aijobs/all` | `ListAll()` 跨账号 | 仅 admin 组 |
| `GET /api/v1/statistics` | 支持跨用户维度 | 非管理员只用 context 系列自己的口径 |
| `PUT /api/v1/nodes/:name` | 改节点调度状态，却只挂 Protected | **完全不封装** |
| `/api/v1/namespaces/**` | 含 Pod 终端、容器日志、exec（源码留 TODO 未校验 pod 权限） | **只放行一个受控例外**：`GET .../containers/:c/log`（读作业日志的唯一真实路径），由 `crater_jobs_logs` 先校验「pod 属于调用者的作业」；终端/exec/pod 列表/ingress 等全部封死 |
| `GET /api/v1/dataset/detail/:id` | 只按 ID 查 | 非 admin 不封装 |

### 4.4 权限语义差异（写工具描述时不能一刀切）

| 资源 | 可见性 | 写权限 |
| --- | --- | --- |
| 作业（vcjobs） | 自己的（`user_id + account_id` 双条件，同账号他人也看不到） | 自己的 |
| 镜像 | 公共 ∪ 账号共享 ∪ 私有 ∪ 被分享 | 仅 owner |
| 文件 | 路径前缀空间（`user/<space>`、`account/<space>`、`public`）+ token 的 AccessMode | 需 RW |
| 数据集 | `user_dataset ∪ account_dataset` | 仅创建者 |
| AI 任务（aijobs） | 账号内共享（同账号成员可读可删他人任务） | 账号内 |

### 4.5 本地文件沙箱（上传/下载）

文件工具的 `localPath` 参数会被解析为绝对路径，必须落在 `CRATER_WORK_DIR` 之内，否则拒绝。
实现要点：`path.resolve` 后做 `path.relative(workDir, target)` 检查（不以 `..` 开头且非绝对路径），
且在目录不存在时先创建；不使用符号链接跟随逻辑（写入时目标若已是符号链接则拒绝）。

### 4.6 不做什么（明确边界）

- ❌ 不做多租户托管：一个 MCP 进程 = 一个 Crater 身份。要多人用，就各自本地跑。
- ❌ 不缓存用户密码到磁盘、不写日志输出 token。
- ❌ 不绕过 Crater 任何鉴权（没有 service account、没有后端密钥、没有直连数据库）。
- ❌ 不提供 Pod shell / kubectl 能力（哪怕管理员也不给，避免「agent 拿到集群」）。

---

## 5. 工具目录（按域）

> **180 个工具 / 10 个域**（只读 92、写 88、destructive 29）。
> 逐个工具的完整参数与作用域见自动生成的 [`tool-catalog.md`](tool-catalog.md)（`npm run catalog`）；
> 简表见 `node dist/index.js --list`；每个工具都在 `src/tools/<group>.ts` 里有对应 `ToolSpec`。

| 域 | 文件 | 数量 | 覆盖能力 | 典型工具 |
| --- | --- | --- | --- | --- |
| auth | `auth.ts` | 6 | 登录/注册/身份/切账号/续期 | `crater_auth_whoami`、`crater_auth_login`、`crater_auth_switch_account` |
| profile | `profile.ts` | 7 | 资料完善、邮箱验证、账单摘要、配额 | `crater_profile_update`、`crater_profile_verify_email` |
| jobs | `jobs.ts` | 24 | 5 类作业创建、列表、详情、YAML、事件、日志（base64 解码）、计费、启停、快照、SSH、入口凭据、资源预检、模板 | `crater_jobs_create_webide`、`crater_jobs_create_pytorch`、`crater_jobs_logs` |
| images | `images.ts` | 25 | envd/dockerfile/kaniko 构建、列表、任务状态、tag/arch/type、共享、删除、Harbor 配额 | `crater_images_build_kaniko`、`crater_images_share` |
| files | `files.ts` | 12 | 列目录（递归/过滤/分页）、上传（自动建父目录）、下载、删除、移动、建目录、数据集目录、用量、写权限 | `crater_files_upload`、`crater_files_download` |
| resources | `resources.ts` | 12 | 资源型号、节点（详情/GPU/Pod）、单价、上下文、统计快照（全只读） | `crater_resources_list`、`crater_nodes_list` |
| datasets | `datasets.ts` | 13 | 数据集创建/更新/删除/分享/成员（`detail/:id` 故意不封装，改从 `mydataset` 精确命中） | `crater_datasets_share_queue` |
| admin | `admin.ts` | 77 | 用户、账号、资源、节点、系统配置、队列配额、运维清理、审批、GPU 分析、全量作业视图与统计 | `crater_admin_users_ban`、`crater_admin_system_billing_update` |
| cli | `cli.ts` | 2 | 官方 CLI 透传：`crater_cli_read`（≈90 条只读命令白名单）、`crater_cli_write`（需 `CRATER_ALLOW_CLI_WRITE=true`，带硬拒绝清单） | `crater_cli_read`、`crater_cli_write` |
| feedback | `feedback.ts` | 2 | 故障上报：提交反馈（去重 / 限流 / 脱敏，`impact`+`confidence` 结构化落库）、查看我的反馈与管理员回复 | `crater_feedback_submit`、`crater_feedback_mine` |

**分层与风险标注**：每个工具都带 MCP 标准注解 `readOnlyHint` / `destructiveHint`，
agent 框架可据此决定是否要人类确认（例如 opencode、Codex 会对 destructive 工具弹确认）。

---

## 6. 接入各 agent 框架

### 6.1 通用前提

```bash
# 本地开发（未发布 npm 时）
git clone <repo> && cd crater_ai_helper
npm install && npm run build
node dist/index.js --check     # 校验
node dist/index.js --whoami    # 用环境变量登录一次，确认身份
```

发布后可以 `npx -y crater-mcp` 直接跑（`bin` 已配好）。

### 6.2 Codex CLI（`~/.codex/config.toml`）

```toml
[mcp_servers.crater]
command = "npx"
args = ["-y", "crater-mcp"]
startup_timeout_sec = 30
tool_timeout_sec = 120

[mcp_servers.crater.env]
CRATER_BASE_URL = "http://172.16.16.140"
CRATER_USERNAME = "your-name"
CRATER_PASSWORD = "your-password"
CRATER_ACCOUNT = "q-3"
```

### 6.3 opencode（`opencode.json`）

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "crater": {
      "type": "local",
      "command": ["npx", "-y", "crater-mcp"],
      "enabled": true,
      "environment": {
        "CRATER_BASE_URL": "http://172.16.16.140",
        "CRATER_USERNAME": "your-name",
        "CRATER_PASSWORD": "your-password"
      }
    }
  }
}
```

### 6.4 Kimi Code / DeepSeek Harness / Claude Desktop 等

这类客户端普遍吃 `mcpServers` 形状的 JSON，把下面这段贴进对应配置文件即可
（**具体文件名以各框架文档为准**，字段名是一致的）：

```json
{
  "mcpServers": {
    "crater": {
      "command": "npx",
      "args": ["-y", "crater-mcp"],
      "env": {
        "CRATER_BASE_URL": "http://172.16.16.140",
        "CRATER_USERNAME": "your-name",
        "CRATER_PASSWORD": "your-password"
      }
    }
  }
}
```

若客户端只支持 HTTP，可用任意 stdio→HTTP 桥（如 `supergateway`）；MCP 本身不内置 HTTP 传输（见 §8 里程碑 M4）。

### 6.5 只想让 agent 读、不给它写权限

```json
"env": { "CRATER_READ_ONLY": "true" }
```

### 6.6 非管理员用户

`CRATER_ALLOW_ADMIN=false` 可以让管理端工具**根本不注册**——比运行时拒绝更干净，也省 token。

---

## 7. 典型 agent 用法（把需求翻译成工具链）

| 用户说 | agent 会怎么做 |
| --- | --- |
| 「帮我开个 WebIDE，用 A100，两小时后交作业」 | `crater_auth_whoami` → `crater_resources_list` → `crater_images_list` → `crater_jobs_create_webide` → 返回入口 URL/凭据 |
| 「我刚才那个作业挂了，看下日志」 | `crater_jobs_list` → `crater_jobs_logs` → 分析错误 → 建议改镜像/命令 |
| 「把环境里装好的 torch 2.4 打成镜像」 | `crater_jobs_list`（找运行中的 WebIDE）→ `crater_images_build_envd` |
| 「把这个 csv 传到我的空间并让作业能读到」 | `crater_files_my_space` → `crater_files_upload` → 在作业工具里填挂载路径 |
| 「这个月我花了多少」 | `crater_profile_billing_summary` → `crater_resources_prices` 交叉核算 |
| 「把 test1 的作业停了」（管理员） | `crater_admin_jobs_all` 定位 → 该用户作业名 → `crater_jobs_stop`（以管理员身份） |
| 「给新来的同学开账号并放进 q-3」 | `crater_admin_users_list` → `crater_admin_users_role` → `crater_admin_accounts_add_user` |

---

## 8. 里程碑

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| M1 | API 全量审计（305 路由 + 权限映射） | ✅ 完成（`docs/api-inventory.md`） |
| M2 | 核心骨架：客户端、鉴权自愈、守卫、注册器、CLI | ✅ 完成 |
| M3 | 5 大业务域工具（auth/profile/jobs/images/files/resources/datasets） | ✅ 本版 |
| M4 | 管理端工具全量 + destructive 标注 | ✅ 本版 |
| M5 | 真机冒烟（.126 只读 + 写路径 dry-run） | 见 §9 |
| M6 | 发布 npm、双传输（HTTP/SSE）、审计日志、Playwright 端到端 | 待做 |

---

## 9. 测试策略

1. **静态**：`node dist/index.js --check`（工具名校验、唯一性、必填 schema）
2. **协议**：`node dist/index.js --list` 与真实 MCP 客户端握手（stdio）
3. **只读冒烟**：用真实账号跑全部 `readOnly:true` 工具，断言不抛 `CraterError`
4. **写路径**：默认用**无效参数**触发后端 400（验证路径/字段名正确但不真建资源），
   关键写工具（创建作业、构建镜像）在有专门测试账号时才真跑，跑完立即清理
5. **越权回归**：用普通用户 token 调 admin 工具，断言被 `GuardError` 拦住；用普通用户调宽接口，断言被拦

`scripts/smoke.mjs` 覆盖 3、5 两项。

---

## 10. 实测差异（2026-11-06，目标 .126 生产部署）

源码清单（`api-inventory.md`，来自 upstream `main`）与**线上镜像的实际行为**存在差异，工具实现一律以实测为准。
完整 GET 矩阵见 `docs/verified-routes.md`（`scripts/verify-routes.mjs` 生成）。

### 10.1 线上不存在的能力（清单里有、实测 404）

| 范围 | 结论 | 影响 |
| --- | --- | --- |
| `aijobs/**`、`spjobs/**`、`tensorboard/**` | 整个 manager 未部署 | 不封装（旧链路 AI 任务/稀疏作业/TensorBoard） |
| `/api/v1/storage/**`（capabilities / my-quota / dirsize） | 未部署 | 存储用量改用 storage-server 的 `/api/ss/usage` |
| `/api/v1/admin/storage/**` | 未部署 | 不做存储配额管理 |
| `/api/v1/admin/system-config/scheduler-extender` | 未部署 | 不做 |
| `POST /api/ss/upload/*path` | storage-server 镜像较旧，未包含 | **上传改走 WebDAV `PUT`** |

### 10.2 路径与参数的实测修正

| 清单/直觉 | 实测真相 |
| --- | --- |
| `GET /api/v1/vcjobs/list` | 不存在。我的作业列表是 `GET /api/v1/vcjobs` |
| `GET /api/v1/vcjobs/:name/detail` 中的 `:name` | 必须是 **`jobName`**（如 `vsc-crater-admin-261104-c774f`），传显示名（如「测试」）返回 500 `record not found` |
| `GET /api/v1/vcjobs/:name/logs` | 不存在。日志真实链路：`/vcjobs/:jobName/pods` → `/namespaces/:ns/pods/:pod/containers` → `/namespaces/:ns/pods/:pod/containers/:c/log?tailLines=N`，且 **返回 base64** |
| `GET /api/v1/context/attributes` | 不存在（只有 PUT）。读资料用 `GET /api/auth/check` 的 `user` 字段 |
| `GET /api/v1/dataset/users`、`/dataset/queues` | 不存在，需按 §2.9 表的真实形态 |
| `GET /api/v1/admin/users/facets`、`GET /api/v1/admin/resources` | 不存在（裸集合未注册，资源管理走 `:name` 子路径） |
| `/api/v1/images/arch` | 不存在 |

### 10.3 storage-server 实测能力（都走 `target: "storage"`）

| 操作 | 实测 |
| --- | --- |
| 列目录 `GET /api/ss/files/<path>`、`/rwfiles/<path>` | 200，`[{name,size,isdir,modifytime,sys}]` |
| 上传 `PUT /api/ss/<path>` | **201 Created**（覆盖写） |
| 下载 `GET /api/ss/download/<path>` | 200 裸字节 |
| 建目录 `MKCOL /api/ss/<path>` | **201 Created**（父目录必须存在，否则 409） |
| 移动 `POST /api/ss/move/<path>` + `{"dst":"..."}` | 200 `move files successfully` |
| 删除 `DELETE /api/ss/delete/<path>` | 200（幂等，路径不存在也 success） |
| 用量 `GET /api/ss/usage` | 200，按空间返回 `{usedBytes,totalFiles,capacityGb}` |
| `PROPFIND /api/ss/<path>` | 207（WebDAV，MCP 未使用） |

### 10.4 逻辑路径语义（实测）

- `user` = 我的用户空间**根**（已自动重定向到 `/crater/users/<space>`），**不要**再拼用户名
- `user/<子目录>`、`account`（当前账号空间根）、`public`（公共空间根）、`dataset/<id>`
- 逻辑根 `/` 只读（`MKCOL /api/ss/__x__` → 403 notAllowed）

### 10.5 作业创建必填项（实测 binding 报错）

- 五类创建的公共必填：`name`（`CreateJobCommon.Name`）
- `POST /api/v1/vcjobs/training` 额外必填 `workingDir`
- `pytorch` 复用 `CreateTensorflowReq`，`webide` 复用 `CreateJupyterReq`（见 §3.3 结构体）
- 提交前可用 `POST /api/v1/context/resource-limit-check`（实测 `{enabled,exceeded,details}`）与 `GET /api/v1/context/prequeue`（`{backfillEnabled}`）做预检
---

## 11. 8 个域全部落地后的收口记录（2026-11-06 晚；现为 10 个域，见 §5）

> 详细的真机证据（每条请求的真实响应）见 [`live-verification.md`](live-verification.md)。

### 11.1 交付状态

- `node dist/index.js --check` → **180 个工具**（auth 6 / profile 7 / jobs 24 / images 25 / files 12 / resources 12 / datasets 13 / admin 77 / cli 2 / feedback 2）。
- `npm run smoke`（对 `http://172.16.16.140`，admin 身份）→ **全部通过**：握手、当时 90 个只读工具接线（现 92 个）、只读闸、身份输出。
- 作业链路真机闭环：`crater_jobs_create_training` 建出 `sg-crater-admin-261106-892b0` → 容器内 `echo` 成功 →
  `crater_jobs_logs` 读回 `hello-from-crater-mcp` → `crater_jobs_stop` 删除 → 面板与集群均无残留。
- 文件链路真机闭环：上传（自动建父目录）→ 列目录 → 下载校验内容 → 越界路径被拦 → 删除 → 再列目录为空。

### 11.2 本轮定下的跨组契约

1. **远端路径参数统一叫 `path`**（files 组原先 upload 用 `remotePath`、download 用 `path`，已统一）。
2. **上传自动逐级 MKCOL 建父目录**，返回 `autoCreatedDirs`；不再要求 agent 先手工建目录。
3. **纯预检 POST 视为只读**：`crater_jobs_resource_limit_check` 标 `readOnly: true`（后端无副作用），
   这样 `CRATER_READ_ONLY=true` 时也能用。
4. **每个 `:name` 类作业工具都做一次列表解析**（jobName 精确 → 显示名唯一匹配 → 否则报错），
   既避免中文名导致的 500，也顺带成为「只能操作自己的作业」的归属白名单。
5. **`GET /api/v1/dataset/detail/:id` 不封装**（后端不校验归属），详情改从 `mydataset` 结果里精确命中。
6. **统计类宽接口只进 admin 组**：`/api/v1/statistics`、`/vcjobs/all`、`/vcjobs/user/:username` 等，
   普通组用 `/api/v1/context/*` 的自身维度数据替代。

### 11.3 新发现的坑（已写进工具描述）

- `GET /api/v1/context/prequeue` **线上存在**（200 `{"backfillEnabled":false}`），但仓库里的 `_crater_src`
  快照没有该路由 → **事实以线上响应为准，源码只用来核对字段名**。
- `PUT /admin/users/:name/ban` 的 `banRestrictions` 不传 = 五项全 false = **只记封禁状态、什么都不限制**；
  要立刻踢人必须显式 `platformAccess: true`。
- `POST /images/envd`、`POST /images/image` 空 body 会返回 **200**（前者还会真的建出构建任务）——
  对「无 binding 必填」的写接口做空 body 探测要格外小心（工具描述里已提示 agent 不要空调用）。
- `/api/ss/userspace`、`/api/ss/queuespace` 仅平台管理员可调；非管理员工具返回 `available:false` 并指路逻辑路径 `user`/`account`。
- `rwfiles`（`?rw=true`）是「只含可写空间」，不是「带读写标记」；带路径且无写权限时直接 401。
- 分页参数三套并存：`vcjobs` 用 `page_size`、`operation-logs` 用 `limit`、其余多数不分页。
- 容器以 **root** 运行（`uid=0`），与之前记录的「非 root 容器」待改项一致，本轮未改动。

---

## 12. 故障上报通道（`feedback` 组 + `crater-incident-report` skill，2026-11-09）

agent 在真实排障中会撞到平台侧问题（接口 5xx、ingress host 被填成 IP、CLI 缺上传接口、私有镜像拉取 401…）。
以前这种情况只能靠用户口头反馈，信息残缺、也无法量化影响面。本轮把"上报"做成 agent 可用的一等能力。

### 12.1 两个工具

| 工具 | 作用 | 关键行为 |
| --- | --- | --- |
| `crater_feedback_submit` | 提交反馈到 `POST /api/v1/feedback` | `auto: true` → 标题加 `[Agent 自动汇报]` 前缀；`impact`/`confidence` 写入正文首行供管理员分诊；**同签名 30 分钟去重**、**每小时上限 6 条**、提交前**脱敏**（password/token/secret/Authorization/Bearer/JWT → `***`） |
| `crater_feedback_mine` | 读 `GET /api/v1/feedback/mine` | 上报前查重、上报后跟踪管理员回复；可按未处理过滤 |

去重/限流状态放在**进程内**（`src/tools/feedback.ts` 模块级 Map/数组）：MCP 实例生命周期内有效，
不写库、不改后端 —— 因为这是"防 agent 刷屏"的客户端礼貌，不是安全边界。

### 12.2 skill 与工具的分工

工具只负责"发一条格式正确的反馈"，**判断该不该发是 skill 的事**：

```
skills/crater-incident-report/SKILL.md
  §0 硬性要求   MUST：判定为平台侧 → 必须调 submit 并在回答里带编号；禁止静默失败；
                       唯一例外：命中否决项 / 用户明确说不用报（都要写明理由）
  §1 判断框架   Q1 归因（平台/环境/用户资产/用户操作/外部依赖）→ Q2 影响面 → Q3 能否自救 → Q4 置信度
  §2 否决项     换掉用户侧变量就消失 / 报错指向用户输入 / 已知过渡态（新注册 60s 内 403 等）
  §5 取证与提交 证据清单 + 标准调用模板 + 字段速查 + 返回值处理 + 通道不可用兜底
  §6 案例       5 个真实案例（含管理员事后核实的真值）用于校准判断
```

**为什么不用关键词表**：第一版曾用"5xx/超时/403…"清单，实测立刻失效——
"私有 Harbor 401""CLI 没有上传接口""ingress host 用 IP"都不在清单里，
而"python:3.11-slim glibc 拒绝可执行栈"这种用户环境问题又容易被误报。
改成"归因 + 影响面 + 置信度"的判断框架后，用 5 个真实案例回归，4 条完全命中、1 条需要"先量化再定性"。

### 12.3 与网页端反馈的关系

同一张表 `feedbacks`，同一套管理端处理页（`/admin/feedback`）：

- 用户手动提交：网页 `/portal/more/feedback`；
- agent 自动提交：本 MCP 的 `crater_feedback_submit`（标题带 `[Agent 自动汇报]` 前缀）；
- 管理员统一在 `/admin/feedback` 列表 → 点击弹窗看详情 → 改状态 + 回复；
- 用户/agent 都能用 `crater_feedback_mine`（或网页「我的反馈」）看到回复。

> 关闭方式：`CRATER_TOOL_GROUPS` 里去掉 `feedback` 即可（skill 会自动退化为"整理好证据贴给用户手动提交"）。

