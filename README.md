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

# 内网下载整包（不需要访问 GitHub）：生成后由门户 /downloads/crater-mcp.zip 提供
node scripts/pack-download.mjs
node dist/index.js --check     # 工具定义校验（离线可跑，180 个工具）
node dist/index.js --whoami    # 登录一次，打印身份/账号/空间（排查配置最快）
node dist/index.js --list      # 列出全部工具及其对应后端接口
npm run smoke                  # 真机冒烟：握手 + 全部只读工具接线 + 只读闸
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

**180 个工具 / 10 个域**（只读 92，写 88，其中 29 个 destructive；含 2 个官方 CLI 透传工具 + 2 个故障上报工具）：

| 域 | 数量 | 能力 |
| --- | --- | --- |
| `auth` | 6 | 登录、注册、我是谁、切换账号（项目）、续期 |
| `profile` | 7 | 资料完善、邮箱验证、账单摘要、配额与占用 |
| `jobs` | 24 | WebIDE / Jupyter / PyTorch / TensorFlow / 自定义作业创建，列表、详情、YAML、事件、**日志（base64 自动解码）**、计费、入口凭据、停止、快照、SSH、资源预检、模板 |
| `images` | 25 | envd / Dockerfile / kaniko 构建，镜像查询、任务状态、tag/架构/类型修改、共享、删除、Harbor 配额 |
| `files` | 12 | 列目录（递归/过滤/分页）、上传、下载、删除、移动、建目录、数据集目录浏览、用量、写权限校验 |
| `resources` | 12 | GPU/CPU 型号、节点（详情/GPU/Pod）、单价、上下文、统计快照（只读） |
| `datasets` | 13 | 数据集创建、更新、删除、分享给用户/账号、成员与候选查询 |
| `cli` | 2 | 官方 `crater` CLI 透传：只读命令默认放行，写命令需 `CRATER_ALLOW_CLI_WRITE=true`；覆盖模型/数据集下载任务、审批工单、Pod 诊断、兼容性检查等 CLI 独有能力 |
| `feedback` | 2 | 故障上报：提交反馈（`auto` 自动加 `[Agent 自动汇报]` 前缀、`impact`/`confidence` 结构化、30 分钟去重、每小时 6 条上限、凭据自动脱敏）、查看我的反馈与管理员回复 |
| `admin` | 77 | 用户（封禁/角色/余额/属性）、账号（成员/配额/账单）、资源（vgpu/网络/单价/同步）、节点（标签/注解/污点/排水/Pod 资源）、系统配置（计费/LLM/带宽/下载限速/GPU 分析）、队列配额、运维清理与锁时、审批工单、GPU 分析、全量作业与统计 |

每个工具的完整参数、作用域、读写标记见自动生成的 [`docs/tool-catalog.md`](docs/tool-catalog.md)（`npm run catalog` 重新生成）；
`node dist/index.js --list` 打印 `METHOD /path`，可与 [`docs/api-inventory.md`](docs/api-inventory.md)（305 条真实路由、逐行核对源码）对照。

### token 开销与按域裁剪

MCP 的代价是**会话一开始就把全部工具 schema 注入上下文**。实测（`tools/list` 序列化后）：

| 配置 | 工具数 | schema 大小 | 估算 token |
| --- | --- | --- | --- |
| 默认（10 域全开） | 180 | 193.8 KiB | 66k ~ 91k |
| `CRATER_TOOL_GROUPS=auth,profile,jobs,files,images,datasets` | 87 | 106.6 KiB | 36k ~ 50k |
| `CRATER_TOOL_GROUPS=jobs,files,auth` | 42 | 63.6 KiB | 22k ~ 30k |
| `CRATER_TOOL_GROUPS=jobs` | 24 | 47.6 KiB | 16k ~ 23k |
| `CRATER_TOOL_GROUPS=cli`（只有官方 CLI 透传） | 2 | 3.2 KiB | ≈1k |
| 只留上报通道 `feedback`（配 CLI 用） | 2 | 2.9 KiB | ≈1k |

所以建议按用途裁剪：日常训推用第二个，只做作业用第三个；管理端（77 个工具、70 KiB）默认就别开。
`CRATER_ALLOW_ADMIN=false` 会再剔掉整组 admin。

**与官方 CLI 结合**：`cli` 组只占 3.2 KiB，却把官方 100+ 子命令接进来（模型下载、审批、Pod 诊断、兼容性检查）。
省 token 的极致玩法是 `CRATER_TOOL_GROUPS=cli`（1k token）+ 让 agent 用官方 Skills 探路；
需要强约束和高频主路径时再开对应业务域。分工与白名单见 [`docs/cli-bridge.md`](docs/cli-bridge.md)。

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
### 配套 Agent Skill

`skills/crater-mcp-ops/SKILL.md` 是给 agent 的**操作指引**（不是代码）：它不增加能力，只规定
`skills/crater-incident-report/SKILL.md` 定义**故障自动上报**：什么算平台故障、要收集哪些证据、
`crater_feedback_submit` 怎么填、上报后要给用户什么兜底方案。

（下面这段是 crater-mcp-ops 的说明）它不增加能力，只规定
"什么意图走哪条路、哪些参数最容易传错、失败怎么读错误"。装上它之后，agent 会先读指引再动手，
比让它裸猜工具名可靠得多。

```bash
# 装到 Claude Code / Codex / Cursor 等支持的 agent（任选其一）
npx skills add <本仓库路径或 GitHub URL> -l      # 先看有哪些 skill
npx skills add <本仓库路径或 GitHub URL> -g --all # 全局安装
```

官方 CLI 的两套 Skill 与我们这套不冲突：官方 `crater-cli-*` 教 agent 用 CLI，
我们这套教 agent **优先用 MCP 强类型工具、缺口才走 CLI 透传**。
| [`docs/files-access-and-scope-fix.md`](docs/files-access-and-scope-fix.md) | 新用户文件系统 403（ACL 账号同步）、概览页 403、引导不触发 三处修复 |
| [`docs/platform-audit-20261109.md`](docs/platform-audit-20261109.md) | 平台巡检报告：用户视角 + Agent 视角缺陷清单（含 2 条假 bug 澄清与清理记录） |
| [`docs/fulong-issues-triage.md`](docs/fulong-issues-triage.md) | 用户反馈 5 个问题的逐条定位结论（2 真缺陷已修 / 1 配置已补 / 1 待改 / 1 与平台无关） |
| [`docs/self-maintained-repo-and-feedback.md`](docs/self-maintained-repo-and-feedback.md) | 转入自维护：源码仓库与「平台内反馈」系统 |
| [`docs/ui-changes.md`](docs/ui-changes.md) | 我们对 Crater 前端的全部定制（升级时需重新套用的补丁清单） |
| [`docs/password-reset.md`](docs/password-reset.md) | 邮箱重置密码 + 管理员重置密码 + SMTP 465 修复的排查与实施 |
| [`docs/backend-secfix.md`](docs/backend-secfix.md) | 后端权限收口：普通用户越权读全平台数据的修复、验证与回滚 |
| [`docs/dsh-setup.md`](docs/dsh-setup.md) | 装进 DeepSeek Harness：cordis.patch.yml 写法、生效方式、排查 |
| [`docs/cli-bridge.md`](docs/cli-bridge.md) | 与官方 crater CLI 的分工、只读/写白名单、本平台实测 |
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
