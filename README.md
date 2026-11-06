# crater-mcp

把 [Crater](https://github.com/raids-lab/crater) ML 训练平台**包成一个 MCP 服务**，交给 Codex / DeepSeek Harness / opencode / Kimi Code 等 agent 框架直接接管。

> 你不需要在 Crater 里点按钮，也不需要给 Crater 改一行代码——在 agent 里说一句
> 「用 A100 开个 WebIDE，把 /public/datasets/xxx 挂上」，它就通过 MCP 调 Crater 的公开 HTTP API 把作业建好。

**边界**：MCP 全程以你自己的 Crater 账号身份调用平台接口，权限与你在网页端完全一致；
不读数据库、不碰 k8s、不越过 Crater 任何鉴权。

---

## 为什么是 MCP，而不是嵌入式助手

旧方案（`docs/legacy-assistant-design.md`）想在 Crater 内部塞一个聊天助手：要为每个能力写 prompt、
要跟后端联调、要跟上游版本漂移一起维护。改成 MCP 后：

| | 嵌入式助手 | MCP 反转 |
| --- | --- | --- |
| 侵入性 | 改 Crater 源码 + 前端 | **零侵入**，只用公开 API |
| 模型 | 绑定平台配置的 LLM | 用 agent 自己的模型，随时换 |
| 能力 | 28 个手写工具 + prompt 工程 | 工具即接口，agent 自己编排 |
| 效果 | 受限于 prompt 与解析 | 用上 agent 的规划、多轮、本地文件/终端能力 |
| 维护 | 跟着 Crater 版本返工 | Crater 加接口时加一条 `ToolSpec` |

---

## 快速开始

```bash
git clone <this-repo> && cd crater_ai_helper
npm install && npm run build

# 只需填这一个文件（已被 .gitignore 忽略，不会进仓库）
cp .env.example .env      # 然后改 CRATER_BASE_URL / CRATER_USERNAME / CRATER_PASSWORD

node dist/index.js --check     # 工具定义校验（离线可跑，176 个工具）
node dist/index.js --whoami    # 登录一次，打印身份/账号/空间（排查配置最快）
node dist/index.js --list      # 列出全部工具及其对应后端接口
npm run smoke                  # 真机冒烟：握手 + 90 个只读工具接线 + 只读闸
```

配置查找顺序：环境变量 > `CRATER_ENV_FILE` 指定的文件 > 当前目录 `.env` > 包根目录 `.env`。
所以客户端里可以只写 `command` + `args`，凭证全放 `.env`。

接入 agent（以 Codex 为例，`~/.codex/config.toml`）：

```toml
[mcp_servers.crater]
command = "npx"
args = ["-y", "crater-mcp"]

[mcp_servers.crater.env]
CRATER_BASE_URL = "http://172.16.16.140"
CRATER_USERNAME = "your-name"
CRATER_PASSWORD = "your-password"
CRATER_ACCOUNT = "q-3"
```

opencode / Kimi Code / DeepSeek Harness 的配置写法见 [`docs/mcp-design.md`](docs/mcp-design.md) §6。

---

## 工具覆盖

**176 个工具 / 8 个域**（只读 90，写 86，其中 28 个 destructive）：

| 域 | 数量 | 能力 |
| --- | --- | --- |
| `auth` | 6 | 登录、注册、我是谁、切换账号（项目）、续期 |
| `profile` | 7 | 资料完善、邮箱验证、账单摘要、配额与占用 |
| `jobs` | 24 | WebIDE / Jupyter / PyTorch / TensorFlow / 自定义作业创建，列表、详情、YAML、事件、**日志（base64 自动解码）**、计费、入口凭据、停止、快照、SSH、资源预检、模板 |
| `images` | 25 | envd / Dockerfile / kaniko 构建，镜像查询、任务状态、tag/架构/类型修改、共享、删除、Harbor 配额 |
| `files` | 12 | 列目录（递归/过滤/分页）、上传、下载、删除、移动、建目录、数据集目录浏览、用量、写权限校验 |
| `resources` | 12 | GPU/CPU 型号、节点（详情/GPU/Pod）、单价、上下文、统计快照（只读） |
| `datasets` | 13 | 数据集创建、更新、删除、分享给用户/账号、成员与候选查询 |
| `admin` | 77 | 用户（封禁/角色/余额/属性）、账号（成员/配额/账单）、资源（vgpu/网络/单价/同步）、节点（标签/注解/污点/排水/Pod 资源）、系统配置（计费/LLM/带宽/下载限速/GPU 分析）、队列配额、运维清理与锁时、审批工单、GPU 分析、全量作业与统计 |

每个工具的完整参数、作用域、读写标记见自动生成的 [`docs/tool-catalog.md`](docs/tool-catalog.md)（`npm run catalog` 重新生成）；
`node dist/index.js --list` 打印 `METHOD /path`，可与 [`docs/api-inventory.md`](docs/api-inventory.md)（305 条真实路由、逐行核对源码）对照。

---

## 安全模型

1. **身份即权限**：MCP 用你的 JWT 调接口，越权在协议层就不可能。
2. **三道本地闸**（`src/scope.ts`）：只读模式、管理端角色、宽接口收窄。
3. **危险接口一律不封装**：`/api/v1/namespaces/**`（Pod 终端/日志）、`PUT /api/v1/nodes/:name`（节点调度）等后端仅做登录校验的接口，MCP 里根本没有对应工具。
4. **写操作带 `destructiveHint`**：删除、封禁、排水、清理类工具会被客户端要求人类确认。
5. **本地文件沙箱**：上传/下载的本地路径被限制在 `CRATER_WORK_DIR` 内。

细节见 [`docs/mcp-design.md`](docs/mcp-design.md) §4。

---

## 文档

| 文件 | 内容 |
| --- | --- |
| [`docs/mcp-design.md`](docs/mcp-design.md) | 架构、配置、安全模型、接入方式、里程碑、测试策略 |
| [`docs/api-inventory.md`](docs/api-inventory.md) | Crater 全部 305 条路由 + 中间件链路 + 请求体结构 + 权限映射 |
| [`docs/tool-catalog.md`](docs/tool-catalog.md) | 176 个工具的参数/作用域/读写标记（自动生成） |
| [`docs/live-verification.md`](docs/live-verification.md) | 真机实测记录：路由存在性、字段事实、端到端闭环证据 |
| [`docs/tool-authoring.md`](docs/tool-authoring.md) | 新增工具的契约与硬性约束 |
| `docs/legacy-assistant-design.md` | 已废弃的嵌入式助手方案（存档） |

---

## 开发

```bash
npm run dev        # tsc --watch
npm run typecheck  # 只查类型
npm run build      # 产出 dist/
npm run smoke      # 真机冒烟（需要可用的 CRATER_* 环境变量）
npm run catalog    # 重新生成 docs/tool-catalog.md
npm run probe      # 探测后端路由是否存在（--all 含管理端）
npm run verify     # 用 GET 复核 docs/api-inventory.md 里的路由
```

新增一个工具：在对应 `src/tools/<group>.ts` 的 `specs` 数组里追加一条 `ToolSpec`，
然后 `npm run build && node dist/index.js --check`。
