---
name: crater-platform-qa
description: >
  从真实用户视角对 Crater 平台做端到端体检：先用 Playwright 走一遍网页端（登录/引导/概览/作业/文件/镜像/数据/账号/反馈/权限边界），
  再用 crater-mcp 以同一账号走一遍 Agent 调用路径，最后输出带严重级别、复现步骤与「是否可能是设计如此」判断的缺陷清单。
  只做检测与取证，不修改平台配置、不修代码。适用于「平台发版后回归」「用户反馈某功能不好用」「MCP 接入验收」等场景。
---

# Crater 平台用户视角测试（QA）

## 0. 这个 skill 解决什么

平台有两类使用者，出问题的地方完全不同：

| 使用者 | 入口 | 典型故障 |
| --- | --- | --- |
| 人 | 浏览器 `/portal/**` | 页面 403/白屏、接口 4xx/5xx、按钮点了没反应、iframe 打不开、引导/文案错 |
| Agent | MCP（stdio，178 工具）+ 官方 CLI 桥接 | 工具报错语义不清、自作用域与页面不一致、跨用户/越权、慢调用超时 |

所以**必须两端都测、用同一个账号测**：只测网页会漏掉"页面能用但 agent 用不了"，只测 MCP 会漏掉"agent 能用但页面崩"。

## 1. 铁律（先读，避免制造事故）

1. **只读为主**：不改系统配置、不改节点状态、不动别人的作业。**不要**点「排空节点」「禁止调度」「取消独占」这类集群级操作。
2. **写操作必须可回收**：创建的作业/文件/目录/反馈要记下来，测完删掉；命名统一带前缀，便于识别（如 `qa-<日期>-<序号>`）。
3. **不要跑贵作业**：镜像构建、模型下载、大数据集挂载、多卡训练一律跳过，或只在必要时用最小规格。
4. **凭据不落盘到仓库**：测试账号口令写到 `%TEMP%` 或 `.local/`（已 gitignore）。
5. **证据优先**：每条结论都要带「现象 + 复现步骤 + 证据（HTTP 码/控制台报错/接口返回）」，否则一律标 `待复现`。
6. **区分"缺陷"与"设计如此"**：拿到现象先问三句——是不是权限设计？是不是配额/审批限制？是不是安全收敛（脱敏/自作用域）？

## 2. 准备

```bash
# 1) 平台地址（本集群）
BASE=http://172.16.16.140

# 2) 建测试账号（开放注册时）
curl -sS -X POST "$BASE/api/auth/signup" -H 'Content-Type: application/json' \
  -d '{"username":"qa-YYYYMMDD","password":"<随机>"}'

# 3) 等文件网关同步（≤1 分钟；不同步则 /api/ss/* 一律 403 unauthenticated）
#    验证：用该账号 login 拿 token，GET /api/ss/files/ 应为 200

# 4) 浏览器自动化
npm i --prefix %TEMP%\pw playwright-core
#    Edge: "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

# 5) CLI（可选，需从源码构建）
go build -o crater.exe ./cli        # 官方 CLI，%APPDATA%\crater 存会话
#    ⚠️ 它忽略 CRATER_CONFIG_DIR，切账号要换 APPDATA

# 6) MCP
npm i && npm run build              # crater_ai_helper → dist/index.js
```

## 3. 网页端测试清单（Playwright）

**技术要点**（这几条不做，结果会全是假错）：

- **登录态注入**：先 `goto /auth`，再 `localStorage.setItem('access_token'/'refresh_token', ...)`，**然后重新 goto 目标页**；
- `/auth` 会被**偶发重定向**（首帧还没读到 token），必须"最多重试 6 次、每次 2.5s"；
- 监听 `pageerror` + `console.error` + `response.status() >= 400` + `requestfailed`，**按 URL 去重**后统计；
- 截图留证：每个关键页面一张（浅色 + 深色各一次抽样即可）。

| # | 流程 | 断言点（真实用户会看什么） |
| --- | --- | --- |
| A | 登录/登出 | 表单校验、密码错误提示、勾选隐私策略才能登录、登出后回登录页 |
| B | 新手引导 | 新账号首次进入应触发；首步引导「绑定验证邮箱」；跳过/完成后不再弹；换账号再登录应再次触发 |
| C | 平台概览 | 卡片数字不全为 0 且不报 403；「作业信息」表能渲染（普通用户只看自己）；无 `Request failed` 文案 |
| D | 我的作业 | 列表/筛选/分页/排序；创建 jupyter 与 webide 成功且状态流转正常；详情页 tabs 都能出数据；日志滚动；停止作业；删除 |
| E | 作业入口 | Jupyter/WebIDE 的 iframe 能加载（这是历史高发区：NetworkPolicy、https 自签、通配子域不可解析） |
| F | 文件系统 | 列目录 → 上传 → 列出现 → 下载回读一致 → 新建目录 → 重命名/移动 → 删除；路径带中文/空格/`#`/`%` 的边界 |
| G | 镜像 | 镜像列表/可用镜像/标签；构建入口不提交真实构建；共享与权限提示可读 |
| H | 数据 | 数据集列表、详情、文件浏览；模型列表；共享文件 |
| I | 账号与资料 | 改昵称、邮箱验证按钮的显示条件、修改密码（旧密码错/新密码弱口令）、点数与账单显示 |
| J | 问题反馈 | 提交成功、出现在「我的反馈」、状态徽章正确、空态文案 |
| K | 权限边界 | 普通用户直接访问 `/admin/**` 应被拦截（不是白屏、不是半渲染）；直接打 `/api/v1/admin/**` 应 401/403 |
| L | 韧性 | 刷新中途、深链直达内页、切换语言、深色模式、窄屏（390px）下关键页面不塌 |

## 4. MCP 侧测试清单

一个脚本内起多个 MCP 实例，用 **同一测试账号** 的 env（`CRATER_ENV_FILE`）跑：

| # | 用例 | 期望 |
| --- | --- | --- |
| M1 | `crater_auth_whoami` | 返回 userId/username/accountId/rolePlatform |
| M2 | `crater_jobs_list` / `get` / `logs` / `pods` | 只返回自己的作业；日志能出内容 |
| M3 | `crater_jobs_create_jupyter` → 等 Running → 删除 | 创建成功；`jobName` 与页面一致 |
| M4 | `crater_files_list` / `upload` / `download` / `mkdir` / `rm` | 与页面同一存储视图（同一个 `user/` 目录） |
| M5 | `crater_images_list` / `available` | 至少能看到平台公共镜像 |
| M6 | `crater_profile_quota` / `crater_auth_switch_account` | 配额与页面一致；切账号后作用域随之变化 |
| M7 | `crater_resources_list` / 节点信息 | 与页面「节点信息」一致 |
| M8 | `crater_datasets_list` | 与页面「数据集」一致 |
| M9 | 传中文显示名当 `jobName` | 应给出可读的纠正提示（不能只报 `record not found`） |
| M10 | 读别人的作业 | 应拒绝并说明原因（自作用域） |
| M11 | 开 `CRATER_ALLOW_ADMIN=true` 调 admin 工具（普通账号） | 应拒绝并说明角色不足 |
| M12 | `CRATER_READ_ONLY=true` 下调写工具 | 应拒绝并给出关闭方法 |
| M13 | CLI 桥接 `auth login` / `job token` / 白名单外命令 | 硬拒绝；给的理由要能指导用户下一步 |
| M14 | 慢调用（创建作业/镜像构建） | 超时是否可配（`toolCallTimeoutMs`），错误信息是否可诊断 |

## 5. 判级标准

| 级别 | 定义 | 例子 |
| --- | --- | --- |
| **P0 阻断** | 主流程不可用 / 数据错误 / 越权 | 建不了作业、页面白屏、普通用户能看到别人数据 |
| **P1 严重** | 核心功能有替代路径但用户会卡住 | 上传 404、iframe 打不开、必填项无提示 |
| **P2 一般** | 体验缺陷、信息不一致 | 数字对不上、错误文案是英文报错栈、空态文案缺失 |
| **P3 轻微** | 观感/文案/一致性 | 文案错别字、深色模式下对比度差 |
| **设计使然** | 看起来像 bug，其实是权限/配额/安全设计 | 普通用户看不到别人作业、余额脱敏为 0、admin 页 401 |

> 判「设计使然」必须能指出**代码或配置依据**（中间件、开关、配置项），否则归到 P2 并要求补充说明文案。

## 6. 交付格式

```markdown
## 结论
| # | 级别 | 现象 | 通道 | 是否可能设计如此 | 证据 | 复现步骤 |
```

并在最后给出：**测试覆盖矩阵**（测了什么/没测什么）、**清理记录**（删掉的作业/文件）、**下次建议优先补测**的点。

## 7. 已知坑（踩过的，直接抄）

- `/api/ss/**` 由独立服务 `storage-server` 提供（不是 crater-backend），镜像旧就会缺路由 → 404 全挂；
- 新账号在文件网关同步前，`/api/ss/*` 返回 403 `unauthenticated`（前端应显示"初始化中"）；
- 作业入口三方对齐：jupyter `--NotebookApp.base_url=`、ingress path、返回给前端的 `fullURL` 必须是同一个前缀；
- 作业同名 NetworkPolicy 只放行同作业 Pod，`ingress-nginx` 不在白名单时访问必超时；
- 前端 Deployment 是 `IfNotPresent`，回归前先确认跑的是新镜像（用唯一 tag）；
- 别用 `crater job get <中文名>`，要传 `jobName`。
