# 自维护分支：仓库与"平台内反馈"

2026-11-07。项目转入团队自行维护（不再跟随官方版本更新），因此做了两件事：
把源码纳入我们自己的 Git 仓库，把「问题反馈」从跳官方 GitHub Issues 改成平台内收集。

## 1. Git 仓库

| 仓库 | 内容 | 远端 |
| --- | --- | --- |
| `crater_ai_helper` | MCP 服务、文档、脚本（本仓库） | `git@github.com:GreyParadise/crater_ai_helper.git`，分支 `feature/assistant` |
| Crater 源码（`_crater_src`） | backend / frontend / cli / charts / skills / website | `git@github.com:GreyParadise/crater_local.git`，分支 `main` |

Crater 源码原本只是一份**没有 `.git` 的快照**，无法继承上游提交历史。处理方式：
在该目录 `git init -b main`，首个提交 `f092a73`「init: 基于上游 Crater 源码快照，转入团队自维护」
（1804 个文件，pack 约 16 MB），**此后的改动一律按提交记录**。

`.gitignore` 追加了本地规则，避免把大件与凭据推上去：

```
frontend/node_modules/  frontend/dist/  website/node_modules/  website/.docusaurus/  website/build/
.env  .local/  *.local  backend/bin/  bin/
```

> 若将来想接回上游历史：`git remote add upstream git@github.com:raids-lab/crater.git`，
> 再用 `git rebase --root` / graft 把快照对齐到某个上游 commit——因为快照版本号不明确
> （chart/frontend 都是占位版本），这一步需要人工确认基线 commit 后再做。

## 2. 平台内反馈（替代官方 GitHub Issues）

原来「用户菜单 → 问题反馈」是 `window.open('https://github.com/raids-lab/crater/issues')`。
现在改成平台内页面，反馈落库、管理员可回复、用户能看到回复。

### 后端（`_crater_src/backend`）

| 文件 | 内容 |
| --- | --- |
| `dao/model/feedback.go`（新增） | `feedbacks` 表：提交人/类型/标题/描述/联系方式/页面路径/状态/管理员回复 |
| `internal/handler/feedback.go`（新增） | Manager `feedback`，4 个接口 |
| `cmd/gorm-gen/models/migrate.go` | 新增迁移 `202611071300` 建表 |

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `POST /api/v1/feedback` | 登录用户 | 提交（类型 bug/feature/question/other；标题≤120 字、描述≤4000 字） |
| `GET /api/v1/feedback/mine` | 登录用户 | 我的反馈（含管理员回复） |
| `GET /api/v1/admin/feedback?status=` | 管理员 | 全部反馈，可按状态过滤 |
| `PUT /api/v1/admin/feedback/:id` | 管理员 | 改状态 / 回复（记录回复人与时间） |

### 前端（`_crater_src/frontend`）

| 文件 | 内容 |
| --- | --- |
| `services/api/feedback.ts`（新增） | 四个接口的封装 |
| `routes/portal/more/feedback.tsx`（新增） | 用户页：`/portal/more/feedback`，含提交表单 + 「我的反馈」列表（展示状态与管理员回复） |
| `routes/admin/feedback/index.tsx`（新增） | 管理员页：`/admin/feedback`，列表 + 改状态 + 直接回复 |
| `components/sidebar/nav-user.tsx` | 「问题反馈」由跳官方 Issues 改为 `navigate('/portal/more/feedback')` |
| `routes/admin/route.tsx` | 管理端侧边栏新增「用户反馈」入口 |

### Agent 侧：MCP 上报通道（2026-11-09 追加）

除网页表单，agent 也能直接上报（同一张 `feedbacks` 表、同一个管理端处理页）：

| 组件 | 位置 | 作用 |
| --- | --- | --- |
| `crater_feedback_submit` | `src/tools/feedback.ts` | 提交反馈；`auto:true` 加 `[Agent 自动汇报]` 前缀；`impact`/`confidence` 写入正文首行；去重（同签名 30 分钟）、限流（每小时 6 条）、脱敏（凭据 → `***`） |
| `crater_feedback_mine` | 同上 | 上报前查重、上报后跟踪管理员回复 |
| `crater-incident-report` skill | `skills/crater-incident-report/SKILL.md` | 判断"该不该报、怎么报"：§0 硬性要求（MUST 上报 / 禁止静默失败）、四问判断框架、证据清单、标准调用模板、5 个真实案例 |

管理端无需区分来源：列表里 `[Agent 自动汇报]` 前缀即机器上报；点开弹窗可看正文首行的
`【影响面：…　置信度：…】` 做分诊。

---

## 3. 实测

- 建表：`to_regclass('public.feedbacks')` → `feedbacks` ✅
- 提交 → 我的反馈 → 管理员回复 → 用户侧看到回复，全链路 OK ✅
- 页面：`/portal/more/feedback` 正常渲染（表单 + 我的反馈 + 管理员回复）✅
- 菜单：「问题反馈」现在**站内跳转**到 `/portal/more/feedback`，不再打开新标签页/官方仓库 ✅
- 管理端：`/admin/feedback` 列表可见、可改状态与回复 ✅
- 自测数据已清理（`feedbacks` 表当前 0 行）

镜像：`crater-be:feedback-20261107`、`crater-fe:feedback-20261107`。

## 1.1 实际推送结果（2026-11-07）

| 仓库 | 分支 | 提交 | 内容 |
| --- | --- | --- | --- |
| `GreyParadise/crater_ai_helper` | `feature/assistant` | `b44648e` | MCP 服务、文档、脚本（本仓库） |
| `GreyParadise/crater_local` | `main` | `d38a5d1` | Crater 源码：`f092a73` 基线快照 + `d38a5d1` 本地定制清单（`LOCAL_CHANGES.md`） |

推送方式：**SSH**（本机 key 已认证为 `GreyParadise`，无需 token）。

推送前做过的安全检查（`_crater_src`）：

- 跟踪文件 1805 个，**不含** `node_modules/`、`frontend/dist/`、`.env`、`.local/`；
- 5 个已知明文口令（Harbor admin、crater-admin、ACL gateway、SMTP 授权码、JWT secret）
  在源码树中**均未出现**。

> 仓库根目录的 `LOCAL_CHANGES.md` 逐文件列出了我们相对上游的全部改动，方便以后 review 或迁移。
