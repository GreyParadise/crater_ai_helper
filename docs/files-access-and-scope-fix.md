# 文件系统 403（新用户）+ 概览页 403 的排查与修复

2026-11-07。新用户 `ceshi` 反馈：平台概览报 403、文件系统「请求失败」。

## 问题一：平台概览 403（我上一轮改动的副作用）

现象：`GET /api/v1/vcjobs/all?page=1&page_size=10&days=7` → 403
`forbidden: this endpoint returns platform-wide data and requires an admin account`。

原因：上一轮权限收口时，我把 `/vcjobs/all`、`/vcjobs/all/facets`、`/vcjobs/billing/all`
整条路由设成「仅管理员」。但**门户「平台概览」的作业信息表**就是用这个接口渲染的，
普通用户直接白屏 + 报错。

修复（`backend/internal/handler/vcjob/vcjob.go`）：

- 去掉这三条路由的 `middleware.RequireAdmin()`；
- 新增 `allJobsScopeForCaller(c)`：管理员返回空 scope（全平台），普通用户返回 `{UserID: 自己}`；
  `GetAllJobsInDays` / `GetAllJobFacets` 改用它；
- `GetAllJobBillingInDays` 里对非管理员追加 `WHERE user_id = 调用者`。

即：**接口不再 403，而是「管理员看全平台、普通用户只看自己」**——既修好前端又保住隔离。
`user/:username` 那三条仍然只允许「管理员或本人」。

## 问题二：文件系统 403（与本仓库无关，是外部文件网关的账号同步缺失）

现象：`GET /api/ss/files/` → 403 `{"error":"forbidden","reason":"unauthenticated"}`。

排查过程：

1. `/api/ss/*` 由 **`crater-acl-gw`**（ns `crater-workspace`，镜像 `crater-acl-gw:v6`）转发到 webdav-service；
2. 它的日志：`{"ev":"deny","user":"ceshi","kind":"root","path":"/files/","reason":"unauthenticated"}` ——
   已经解析出用户名，说明 JWT 没问题，是「账号在它的库里不存在」；
3. 该网关用**独立数据库** `crater_files`（`crater-meta` 集群，`ACL_DSN` 指向 `crater-meta-rw`），
   其中 `users` 表只有 5 个历史用户（usr_admin / usr_lijianxin / usr_test / usr_jvkit / usr_test1），
   新注册用户（fulong、junvon、ceshi…）都没同步进去；
4. 对照：同一接口用 `crater-admin` 访问是 200 → 与后端/cookie 无关，纯 ACL 库缺行。

修复：

- **补数据**：把 Crater 的全部有效用户写入 `crater_files.users`
  （`username='usr_'+name`、`display=name`、`portal_name=name`、`home_dir=space`、
  `uid=gid=2000+users.id` 避免与既有 1000~1004 冲突；`ON CONFLICT DO NOTHING` 幂等）；
  `crater_gateway` 已授予 `INSERT, UPDATE ON users`（原先是只读）。
- **自动同步**：新增 CronJob `crater-workspace/crater-acl-user-sync`（**每分钟**一次），
  从 Crater 库生成 INSERT 语句灌到 ACL 库；凭据放在同命名空间的 secret `crater-acl-sync`。
  镜像用 `172.16.16.126:30003/mirror/cloudnative-pg/postgresql:16.10`（已镜像进 Harbor）。

> 注意：`crater-meta-rw` 指向 **crater-meta-2**（10.52.0.172）才是主库；
> crater-meta-1 是副本，直接往 -1 写会被复制冲突/回滚。

## 问题三：切换账号后新手引导不弹（要刷新才出现）

原因两个叠加：

1. 自动触发用模块级 `boolean autoStarted`，一旦为 true 就再也不评估 → 换账号不触发；
2. 「1.5 秒后启动」的定时器写在 `useEffect` 里并返回 cleanup —— **登录后路由会重挂组件**，
   cleanup 把定时器取消，而模块标记已置位、不会再重排 → 永不触发。

修复（`frontend/src/components/onboarding/onboarding-tour.tsx`）：

- 定时器提到模块级（`autoStartTimer`），不再随组件卸载被取消；
- 按「用户名」判定（`scheduleAutoStart(username)`），登出时 `cancelAutoStart()` 并清空引导状态；
- 手动重看 / 跳过时也会取消待触发的定时器。

## 验证

| 用例 | 结果 |
| --- | --- |
| 新用户 `/vcjobs/all`、`all/facets`、`billing/all` | 200，且只返回自己的数据 ✅ |
| 管理员 `/vcjobs/all` | 200，`total=6`（全平台）✅ |
| 新用户 `/api/ss/files/` | 200，能列出 `user` 目录 ✅ |
| 文件系统页面 | 正常渲染「公共空间 / 用户空间」，无报错 ✅ |
| 平台概览页面 | 无 403，作业信息显示「暂无数据」 ✅ |
| 退出登录 → 同标签页登录新账号（不刷新） | 新手引导正常弹出 ✅ |
| 已完成引导的账号再次进入 | 不再弹 ✅ |

镜像：`crater-be:scopefix-20261107`、`crater-fe:onboarding5-20261107`。

## 附：初始化窗口内的友好提示（2026-11-07 追加）

新用户注册后到 ACL 同步完成之间（最长约 1 分钟），`/api/ss/*` 会返回 403 `unauthenticated`。
之前前端会弹「请求失败，请稍后重试」，体验像是故障。现在改为**明确的初始化提示**：

前端（`frontend/src/components/file/files-initializing.tsx` 新增 + `file-system-table.tsx` 接线）：

- 新增 `apiGetFilesAwaitProvision()`：同样请求 `/api/ss/files/...`，但把
  `403 + reason=unauthenticated` 识别成专用错误 `FilesInitializingError`，
  并调用 `markApiErrorHandled()` **抑制全局报错提示**；
- 命中该错误时文件系统页不再渲染表格/空间卡片，而是显示面板：
  - 标题「文件系统正在初始加载中，请稍等片刻」
  - 说明「个人文件空间正由系统自动开通，通常 1 分钟内完成，无需手动操作」
  - 倒计时「预计还需 N 秒」（按 90 秒预算倒数）
  - 每 10 秒自动重试 + 「立即重试」按钮，开通后自动切换成正常文件列表
- 其它错误（真故障/无权限）仍走原有错误处理，不会被这层掩盖。

实测（clitest10，临时把该用户从 ACL 库删掉复现窗口、暂停 CronJob 后再恢复）：

| 时刻 | 页面表现 |
| --- | --- |
| 打开页面（未开通） | 显示「文件系统正在初始加载中，预计还需 86 秒」，无报错弹窗 |
| 触发同步后 | **约 55 秒**自动切换成「公共空间 / 用户空间」，无需手动刷新 |
| 已开通用户 | 直接显示文件空间，不出现该面板 |

镜像：`crater-fe:filesinit-20261107`。
