# 后端权限收口（管理员 / 普通用户分级）

2026-11-07 实施。起因：用官方 `crater` CLI 以**新注册的普通用户**实测，发现 4 组只套了
`AuthProtected` 的接口没有任何归属校验，普通用户可以直接读到全平台数据。

## 1. 修复前的实测证据（普通用户 clitest01）

| CLI 命令 | 路由 | 修复前 |
| --- | --- | --- |
| `crater job ls --all` | `GET /api/v1/vcjobs/all` | ✅ 返回 8 条全平台作业（fulong 3 / crater-admin 5 / lijianxin 1） |
| `crater job ls --user fulong` | `GET /api/v1/vcjobs/user/:username` | ✅ 返回别人的 3 条作业 |
| `crater pod containers --namespace crater-workspace <别人的 pod>` | `GET /api/v1/namespaces/:ns/pods/:name` | ✅ 返回容器列表 |
| `crater pod logs ... <别人的 pod>` | `GET .../containers/:c/log` | ✅ 读到别人容器真实日志（含内部 IP） |
| `crater user get crater-admin` | `GET /api/v1/users/:name` | ✅ 返回 `role=3 / group=管理员 / extraBalance / status` |

管理端 `/api/v1/admin/**` 当时是正确的（11 条命令全部 `HTTP 401: Not Admin`），
问题只出在 Protected 组里这几条“全平台口径”的路由。

## 2. 改动（4 个文件，都在 `_crater_src/backend`）

### 2.1 新增 `internal/middleware/scope.go`

```go
// RequireAdmin: 非管理员 → 403（区别于 AuthAdmin 的 401，便于客户端区分“未登录/无权限”）
func RequireAdmin() gin.HandlerFunc

// RequireAdminOrSelf: 管理员，或 URL 参数 param 的值 == 调用者用户名
func RequireAdminOrSelf(param string) gin.HandlerFunc
```

### 2.2 `internal/handler/vcjob/vcjob.go`（RegisterProtected）

```go
g.GET("all", middleware.RequireAdmin(), mgr.GetAllJobsInDays)
g.GET("all/facets", middleware.RequireAdmin(), mgr.GetAllJobFacets)
g.GET("user/:username", middleware.RequireAdminOrSelf("username"), mgr.GetUserJobsInDays)
g.GET("user/:username/facets", middleware.RequireAdminOrSelf("username"), mgr.GetUserJobFacets)
g.GET("billing/all", middleware.RequireAdmin(), mgr.GetAllJobBillingInDays)
g.GET("billing/user/:username", middleware.RequireAdminOrSelf("username"), mgr.GetUserJobBillingInDays)
```

### 2.3 `internal/handler/tool/podcontainer.go`（/api/v1/namespaces/**）

新增 `RequirePodAccess()` 中间件，套到全部 10 条 Pod 路由（含写操作：建/删 ingress、建/删 nodeport）：

- 管理员：放行；
- 普通用户：要求 Pod 的 `crater.raids.io/task-user` 标签 == 自己（兼容旧标签 `aisystem.github.com/task-user`）；
  标签缺失时回退 `pod → volcano job → DB 作业记录(Job.UserID) → 用户`；
- 普通用户只能访问 `Namespaces.Job` 配置的作业命名空间，避免借 Pod 接口探测系统命名空间。

### 2.4 `internal/handler/user.go`（`GET /api/v1/users/:name`）

分级返回，沿用已有的 `canViewUserExtraBalance` 风格：

```go
if !canViewUserPrivateFields(token, user) { // 非管理员且非本人
    userResp.Status = 0
    userResp.Banned = false
    userResp.ExtraBalance = 0
}
```

公开字段保留（`id/name/nickname/avatar/group/teacher/role/createdAt`），前端
`/portal/users/:name` 资料页仍可正常打开。

## 3. 构建与发布

```powershell
# 1) 编译（Go 1.25.4，目标 linux/amd64）
go build -ldflags="-w -s -X main.AppVersion=1.1.1-secfix" -o bin-linux_amd64/controller cmd/crater/main.go
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin-linux_amd64/migrate cmd/gorm-gen/models/migrate.go
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin-linux_amd64/model-metadata-refresh cmd/model-metadata-refresh/main.go

# 2) 在控制面 172.16.16.126 上打镜像（该机 docker 已把 172.16.16.126:30003 配为 insecure-registry）
docker build --platform linux/amd64 --build-arg BIN_DIR=. -t 172.16.16.126:30003/crater/crater-be:secfix-20261107 .
docker push 172.16.16.126:30003/crater/crater-be:secfix-20261107

# 3) 滚动更新
kubectl -n crater set image deploy/crater-backend \
  crater-backend-container=172.16.16.126:30003/crater/crater-be:secfix-20261107 \
  migration=172.16.16.126:30003/crater/crater-be:secfix-20261107
```

镜像内 `/controller` 的 sha256 与本地构建一致（`32cbd552…d55ff3`），确认打进去的是改后代码。

**回滚**：

```bash
kubectl -n crater set image deploy/crater-backend \
  crater-backend-container=172.16.16.126:30003/crater/crater-be:be-127 \
  migration=172.16.16.126:30003/crater/crater-be:be-127
```

## 4. 修复后复测（普通用户 clitest02）

| 命令 | 修复前 | 修复后 |
| --- | --- | --- |
| `job ls --all` | 8 条全平台作业 | **403** `this endpoint returns platform-wide data and requires an admin account` |
| `job ls --user fulong` | 别人 3 条作业 | **403** `you can only access records that belong to you` |
| `pod containers <fulong 的 pod>` | 容器列表 | **403** `this pod does not belong to your jobs` |
| `pod logs <fulong 的 pod>` | 别人容器日志 | **403** 同上 |
| `user get crater-admin` | `status=2 / extraBalance=11000` | `status=0 / extraBalance=0`（公开字段仍可见） |
| `job ls`（自己，0 条） | OK | OK |
| `job ls --user clitest02`（自己） | OK | OK |
| `user get clitest02`（自己） | OK | OK（本人完整字段） |
| `node ls` | OK | OK |
| `admin user ls` | 401 | 401（不变） |

管理员回归：`job ls --all` → OK；`pod logs <别人的 pod>` → OK；`user get` → 完整字段（`status=2 / extraBalance=11000`）。

## 5. 尚未收口的同类风险（同类模式，建议后续按需处理）

| 路由 | 位置 | 现状 |
| --- | --- | --- |
| `GET /api/v1/aijobs/all` | `handler/emias.go:76` | Protected，全平台 AI 作业列表 |
| `GET /api/v1/spjobs/all` | `handler/spjob.go:76` | Protected，全平台 SP 作业列表 |
| `GET /api/v1/dataset/alldataset` | `handler/dataset.go:65` | Protected，全平台数据集列表 |
| `GET /api/v1/dataset/detail/:id` | `handler/dataset.go` | 只按 ID 查，不校验归属 |
| `GET /api/v1/nodes/:name/pods` | `handler/node.go:82` | Protected，可看节点上所有 Pod |
| `GET /api/v1/statistics` | `handler/statistics.go` | 支持跨用户统计 |
| 终端 websocket | `handler/websocket.go`（路径按版本可能不同） | Pod 终端，同样需要归属校验 |

我们的 MCP 侧对前 6 项已有 `CRATER_ENFORCE_SELF_SCOPE` 守卫（`src/scope.ts`），
所以**通过 MCP 走不会泄漏**；但官方 CLI / 直接调 API 仍能触达，建议同样收口。

## 6. 测试账号清理

- `clitest01`、`clitest02` 均已**永久封禁**（`banRestrictions.platformAccess=true`），复测返回
  `HTTP 403: Your account is banned from accessing the platform`。
- 记录仍留在库中（显示为已封禁）；如需彻底删除需直接操作数据库。
