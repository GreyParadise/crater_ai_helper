# Crater 后端 HTTP API 全表（源码级审计）

> **审计对象**：`C:\Users\Administrator\Desktop\AI\k8s及插件\_crater_src\backend`
> **审计方式**：只读。逐文件读 `internal/route.go`、`internal/register.go`、`internal/handler/*/` 下全部 manager 的 `RegisterPublic/RegisterProtected/RegisterAdmin`，以及 `internal/middleware/jwt.go`、`internal/util/{token,context}.go`、`pkg/constants/const.go`、`internal/storage/router.go`。
> **审计时间**：2026-11-06
> **约定**：`⚠️待确认` 表示静态阅读无法 100% 确定之处（已尽量给出判断依据，未编造）。

## 0. 结论速览

| 项目 | 数量 |
| --- | --- |
| manager 数量（`handler.Registers`） | **28** |
| manager 注册的 HTTP 路由 | **305** |
| ├ Public（`/api`，免登录） | **9** |
| ├ Protected（`/api/v1`，需 JWT） | **164** |
| └ Admin（`/api/v1/admin`，需平台管理员） | **132** |
| 框架级路由（不在 manager 内） | 2（`/healthz`、`/swagger/*any`） |
| **合计（含框架级）** | **307** |
| 独立进程 storage-server 路由（不在上面统计内） | 32（按 method+path 展开；见 2.31） |

> ⚠️ 对需求清单的三点事实修正：
> 1. **没有独立的 `files` manager，也没有 `/api/v1/files`** —— 文件管理拆成两处：主后端 `/api/v1/storage/*`（只做配额/能力/token 校验）与**独立进程 storage-server** 的 `/api/ss/*`（WebDAV + 上传/下载/列目录/移动/删除，见 2.31）。
> 2. **没有独立的 `admin` manager** —— 管理端路由由每个 manager 自己的 `RegisterAdmin` 声明，统一挂在 `/api/v1/admin/<manager名>` 下（如 `/api/v1/admin/users`、`/api/v1/admin/nodes`、`/api/v1/admin/system-config`）。
> 3. **没有 `images/pip-apt`，也没有 `/admin/system-config/prequeue`** —— pip+apt 合并构建走 `POST /api/v1/images/kaniko`（body 含 `requirements` + `packages`）；prequeue 只存在于调度器侧逻辑，无 HTTP 端点。

---

# 第 1 部分：常量与中间件事实

## 1.1 三档前缀的真实字符串

`backend/pkg/constants/const.go`（全文 11 行，前 8 行为前缀与标签键）：

```go
// backend/pkg/constants/const.go:3-7
const (
	APIPrefix        = "api"
	APIV1Prefix      = "api/v1"
	APIV1AdminPrefix = "api/v1/admin"
)
```

注意：常量值**不带前导斜杠**。gin 的 `Engine.RouterGroup.basePath` 初始为 `"/"`，`joinPaths` 内部用 `path.Join` 归一化，因此实际注册出来的路径带前导斜杠，即 `/api/...`、`/api/v1/...`、`/api/v1/admin/...`（已按 `gin v1.10.1` 的 `utils.go:128 joinPaths` + `gin.go addRoute` 的 `assert1(path[0]=='/')` 交叉验证）。本文所有路径均按**真实完整路径**书写。

## 1.2 路由装配方式（三档如何拼出来）

```go
// backend/internal/route.go:42-70
func (b *Backend) RegisterService(conf *handler.RegisterConfig) {
	managers := registerManagers(conf)

	publicRouter := b.Group(constants.APIPrefix)                 // /api
	for _, mgr := range managers {
		mgr.RegisterPublic(publicRouter.Group(mgr.GetName()))     // /api/<name>
	}

	protectedRouter := b.Group(constants.APIV1Prefix)             // /api/v1
	protectedRouter.Use(middleware.AuthProtected(conf.UserBanService))
	for _, mgr := range managers {
		mgr.RegisterProtected(protectedRouter.Group(mgr.GetName())) // /api/v1/<name>
	}

	adminRouter := b.Group(constants.APIV1AdminPrefix)            // /api/v1/admin
	adminRouter.Use(middleware.AuthProtected(conf.UserBanService), middleware.AuthAdmin())
	for _, mgr := range managers {
		mgr.RegisterAdmin(adminRouter.Group(mgr.GetName()))        // /api/v1/admin/<name>
	}
}
```

补充事实：

- manager 通过 `init()` 往全局切片 `handler.Registers` 注册工厂函数（`internal/handler/interface.go:64`：`var Registers = []func(config *RegisterConfig) Manager{}`），`internal/register.go:17-24` 遍历并实例化；`internal/register.go:7-13` 用空白导入拉起 7 个子包（`aijob/image/operations/spjob/tensorboard/tool/vcjob`），其余 manager 在 `internal/handler` 根包内。
- 每个 manager 名来自自身结构体字段 `name`，由 `GetName()` 返回（唯一例外：`TensorboardMgr.GetName()` 直接 `return "tensorboard"`）。
- **重名现象（重要）**：**两个 manager 都叫 `storage`** —— `StorageMgr`（配额/能力）和 `JWTTokenMgr`（`jwttoken.go:22` 里 `name: "storage"`）。二者共用同一个 `/api/v1/storage` 前缀，只是路由不同。
- 三档的 group 是**同名前缀不同档位**，所以同一个路径字面量可能同时出现在 `/api/v1/xxx` 与 `/api/v1/admin/xxx`（例如 `POST /api/v1/dataset/share/user` 与 `POST /api/v1/admin/dataset/share/user` 是**两个不同的 handler**）。
- 框架级路由：`s.GET("/healthz")`（`route.go:24`）、`s.GET("/swagger/*any")`（`route.go:37`），Swagger 的 `BasePath` 设为 `/api`（`route.go:35`）。

## 1.3 `middleware.AuthProtected` 判定逻辑摘要

源码：`backend/internal/middleware/jwt.go:17-91`。执行顺序：

1. **取 token**
   - 若请求头 `Upgrade: websocket` → 从 **query 参数 `?token=`** 取（`jwt.go:21-22`，终端/日志流用）。
   - 否则从 `Authorization` 头取，必须形如 `Bearer <token>`；`split(" ")` 后 `len(t) < 2 || t[0] != "Bearer"` 直接 401（`resputil.TokenInvalid`，`jwt.go:24-31`）。
2. **解析/校验 token**：`util.GetTokenMgr().CheckToken(authToken)`（`jwt.go:33`）→ `internal/util/token.go:107-122` 用 `jwt.ParseWithClaims` + HS256 对称密钥（`config.NewTokenConf().AccessTokenSecret`）解析，失败返回 401 `resputil.TokenExpired`（注意：过期与签名错误都归到这一类）。
   - access/refresh 的 TTL 来自配置 `AccessTokenExpiryHour` / `RefreshTokenExpiryHour`（`token.go:70-105`）。**CheckToken 不区分 access/refresh**，两者格式相同（同一 secret、同一 claims）。
3. **封禁用户处理**（`jwt.go:39-49`）：若注入了 `UserBanService`，调用
   `userBanService.RequireCapability(ctx, token.UserID, service.UserBanCapabilityPlatformAccess)`；
   失败直接 `resputil.HandleError` + `Abort`。即：**被封禁用户在中间件层就被挡掉所有 Protected/Admin 请求**（`PlatformAccess` 能力）。更细粒度的能力（`JobSubmission`/`ImageBuild`/`ModelDownload`/`DatasetDownload`）由业务 handler 自己再调 `handler.RequireUserBanCapability(...)`（`internal/handler/user_ban_guard.go`）。
4. **写操作强一致校验（关键！）**：`if c.Request.Method != "GET"`（`jwt.go:52-85`）
   1. 查库取用户：`query.User.Where(ID = token.UserID).First()`，查不到 → 401 "User not found"；
   2. **平台角色必须与 token 内一致**：`user.Role != token.RolePlatform` → 401 "Platform token not match"（防止降权后旧 token 继续用）；
   3. **账号内角色/访问模式必须与 token 内一致**：查 `user_account (user_id=user.ID, account_id=token.AccountID)`，不存在 → 401 "UserQueue not found"；`userQueue.Role != token.RoleAccount || userQueue.AccessMode != token.AccountAccessMode` → 401 "Queue role not match"。
   4. **唯一豁免**：`c.Request.URL.Path == "/api/v1/auth/switch"`（切项目时 token 里的账号权限本来就过期，允许放行）。
   → 结论：**GET 请求只看 token 快照；非 GET 请求每次都要回库校验角色/访问模式**（token 里的权限数据“写时”新鲜、“读时”可能是旧的）。
5. 最后 `util.SetJWTContext(c, token)` 把 claims 写进 gin context，`c.Next()`。

## 1.4 `middleware.AuthAdmin` 判定逻辑

```go
// backend/internal/middleware/jwt.go:93-102
func AuthAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := util.GetToken(c)
		if token.RolePlatform != model.RoleAdmin {
			resputil.HTTPError(c, http.StatusUnauthorized, "Not Admin", resputil.TokenInvalid)
			c.Abort()
			return
		}
		c.Next()
	}
}
```

- 判定依据只有一条：**token 中的 `RolePlatform == model.RoleAdmin`**（`dao/model/const.go`，`RoleGuest=1, RoleUser=2, RoleAdmin=3`）。
- 因为 admin 组先挂了 `AuthProtected`，所以 admin 请求同样要先过 JWT + 封禁 + 非 GET 回库校验；`AuthAdmin` 只是末位加一道角色闸。
- **注意**：它只看**平台**管理员，**不看账号内管理员**（`UserAccount.Role`）。账号管理员能力由业务层自己判（见第 4 部分）。

## 1.5 `util.GetToken(c)` 能拿到的字段

```go
// backend/internal/util/token.go:28-37
JWTMessage struct {
	UserID            uint             `json:"userID"`           // User ID
	AccountID         uint             `json:"queueID"`          // Queue ID（现=Account ID）
	Username          string           `json:"username"`         // Username
	AccountName       string           `json:"queueName"`        // Queue name（现=Account name）
	RoleAccount       model.Role       `json:"roleQueue"`        // Role in queue (e.g. user, admin)
	AccountAccessMode model.AccessMode `json:"accessMode"`       // AccessMode in account
	PublicAccessMode  model.AccessMode `json:"publicaccessmode"` // Public Accessmode
	RolePlatform      model.Role       `json:"rolePlatform"`     // Role in platform (e.g. guest, user, admin)
}
```

JWT 实际签发的 claims（`token.go:17-27`，注意 key 全是两位缩写）：

```go
JWTClaims struct {
	UserID           uint             `json:"ui"`
	QueueID          uint             `json:"qi"`
	Username         string           `json:"un"`
	QueueName        string           `json:"qn"`
	RoleQueue        model.Role       `json:"rq"`
	RolePlatform     model.Role       `json:"rp"`
	AccessMode       model.AccessMode `json:"am"`
	PublicAccessMode model.AccessMode `json:"pa"`
	jwt.RegisteredClaims          // 只设了 ExpiresAt
}
```

`GetToken` 从 gin context 取值（`internal/util/context.go:44-62`），key 为：

```go
UserIDKey = "x-user-id"; UsernameKey = "x-user-name"
AccountIDKey = "x-queue-id"; AccountNameKey = "x-queue-name"
RoleAccountKey = "x-role-queue"; RolePlatformKey = "x-role-platform"
AccountAccessModeKey = "x-access-mode"; PublicAccessModeKey = "x-public-access-mode"
```

⚠️ 注意 `GetToken` 里对 `RoleAccount/RolePlatform/AccountAccessMode/PublicAccessMode` 用了**无检查的类型断言**（`roleQueue.(model.Role)`），若 context 里没写入这些 key 会 **panic**（只在没经过 `AuthProtected` 却调用 `GetToken` 的路径上才会触发；当前所有业务路由都过中间件，因此正常不会崩）。写 MCP 时若复用这些 handler 需保证走同一中间件。

枚举取值（`backend/dao/model/const.go:12-14, 28-34`）：
`RoleGuest(1) / RoleUser(2) / RoleAdmin(3)`；`AccessMode：AccessModeNA(1)/AccessModeRO(2)/AccessModeRW(3)/AccessModeAO(4)`。

## 1.6 其它会横切所有接口的事实

- 统一响应包装：`resputil.Success` / `resputil.Error` / `resputil.HTTPError` / `resputil.Page[T]`（分页响应）。业务错误码见 `internal/bizerr`。
- OpenAPI 文档在 `backend/docs`（swag 生成），`BasePath=/api`，`/swagger/index.html` 可读；但代码里的 `@Router` 注释与真实前缀存在不一致（注释常写 `/v1/xxx`），**以本文表格的实测拼接结果为准**。
- 请求体绑定：几乎全部 `c.ShouldBindJSON`（body）、`c.ShouldBindUri`（路径参数，`binding:"required"`）、`c.ShouldBindQuery`（query）；绑定失败统一 `resputil.BadRequestError`。

---

# 第 2 部分：API 全表

阅读说明：

- 「档」列：`Public` = `/api` 免登录；`Protected` = `/api/v1` 需 JWT；`Admin` = `/api/v1/admin` 需平台管理员。
- 「源文件:行号」指**路由注册那一行**（不是 handler 实现），文件均在 `backend/internal/handler/` 下。子目录路由注明 `子目录/文件`。
- gin 参数（`:name`、`:id`、`:aid`、`:uid`、`:datasetId`、`:vuuid`、`*path`）原样保留。
- handler 列写 Go 方法名，便于直接 `grep`/跳转。

## 2.1 框架级路由（不在 manager 内）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/healthz` | 无(裸) | 匿名闭包 | K8s 健康检查，返回 `{"message":"ok"}` | internal/route.go:24 |
| GET | `/swagger/*any` | 无(裸) | ginSwagger.WrapHandler | Swagger UI（BasePath=/api） | internal/route.go:37 |

## 2.2 `auth`（AuthMgr，name=`auth`）— 登录/注册/切项目

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/login` | Public | `Login` | 用户名密码 / LDAP 登录，返回 accessToken+refreshToken+context+user | auth.go:59 |
| GET | `/api/auth/check` | Public | `Check` | 手动解析 Bearer token，返回 context/user/version（不经过 AuthProtected） | auth.go:60 |
| POST | `/api/auth/signup` | Public | `Signup` | 自助注册（受 `auth.normal.allowRegister` 开关限制） | auth.go:61 |
| POST | `/api/auth/refresh` | Public | `RefreshToken` | 用 refreshToken 换新 token 对 | auth.go:62 |
| GET | `/api/auth/mode` | Public | `GetAuthMode` | 返回启用的认证方式（LDAP/普通登录/普通注册） | auth.go:63 |
| POST | `/api/v1/auth/switch` | Protected | `SwitchQueue` | 切换当前项目(account)，重新签发 token（唯一豁免写校验的接口） | auth.go:67 |

> 无 Admin 路由。

## 2.3 `users`（UserMgr，name=`users`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/users/ban` | Protected | `GetCurrentUserBanStatus` | 当前用户的封禁状态与封禁记录 | user.go:46 |
| GET | `/api/v1/users/:name/ban` | Protected | `GetVisibleUserBanStatus` | 查看指定用户封禁状态（可见性受限版） | user.go:47 |
| GET | `/api/v1/users/:name` | Protected | `GetUser` | 查询单个用户详情（昵称/角色/导师/课题组/头像/余额） | user.go:48 |
| GET | `/api/v1/users/email/verified` | Protected | `CheckIfEmailVerified` | 当前用户邮箱是否已验证 | user.go:49 |
| GET | `/api/v1/admin/users` | Admin | `ListUser` | 用户全量列表（分页/筛选） | user.go:53 |
| GET | `/api/v1/admin/users/billing/summary` | Admin | `ListUserBillingSummary` | 全平台用户计费汇总 | user.go:54 |
| GET | `/api/v1/admin/users/baseinfo` | Admin | `ListUserBaseInfo` | 用户基础信息（name/nickname/space）精简列表 | user.go:55 |
| DELETE | `/api/v1/admin/users/:name` | Admin | `DeleteUser` | 删除用户 | user.go:56 |
| PUT | `/api/v1/admin/users/:name/role` | Admin | `UpdateRole` | 修改用户平台角色（guest/user/admin） | user.go:57 |
| PUT | `/api/v1/admin/users/:name/attributes` | Admin | `UpdateUserAttributesByAdmin` | 覆盖写用户 attributes（昵称/邮箱/导师/课题组/电话/头像等） | user.go:58 |
| POST | `/api/v1/admin/users/:name/billing/extra-balance` | Admin | `AdjustUserExtraBalance` | 按增量（可负）调整用户额外点数，带行锁 | user.go:59 |
| GET | `/api/v1/admin/users/:name/billing/accounts` | Admin | `GetUserBillingAccounts` | 用户在各账号下的余额/发放明细 | user.go:60 |
| GET | `/api/v1/admin/users/:name/ban` | Admin | `GetUserBanStatus` | 用户封禁状态 + 历史记录 | user.go:61 |
| PUT | `/api/v1/admin/users/:name/ban` | Admin | `UpdateUserBanStatus` | 封禁/解封（时长 + 能力限制项 + 原因） | user.go:62 |

## 2.4 `accounts`（AccountMgr，name=`accounts`）— 账号/项目

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/accounts` | Protected | `UserListAccounts` | 当前用户可访问的账号列表（name/nickname/role/access/expiredAt） | account.go:113 |
| GET | `/api/v1/accounts/by-name/:name` | Protected | `GetAccountByName` | 按账号名取账号信息 | account.go:114 |
| GET | `/api/v1/accounts/:aid/billing/config` | Protected | `UserGetAccountBillingConfig` | 账号计费发放配置（需账号管理员 + 计费用户可见） | account.go:120 |
| PUT | `/api/v1/accounts/:aid/billing/config` | Protected | `UserUpdateAccountBillingConfig` | 修改账号计费发放配置（需账号管理员） | account.go:121 |
| GET | `/api/v1/accounts/:aid/billing/members` | Protected | `UserListAccountBillingMembers` | 账号成员计费明细 | account.go:122 |
| PUT | `/api/v1/accounts/:aid/billing/members/:uid` | Protected | `UserUpdateAccountBillingMemberIssueAmount` | 修改某成员的发放额度（需账号管理员） | account.go:123 |
| POST | `/api/v1/accounts/:aid/billing/reset` | Protected | `UserResetAccountBillingBalance` | 重置账号计费余额（需账号管理员） | account.go:124 |
| POST | `/api/v1/accounts/:aid/users/:uid` | Protected | `UserAddAccountMember` | 把用户加入账号 | account.go:128 |
| POST | `/api/v1/accounts/:aid/users/:uid/update` | Protected | `UserUpdateAccountMember` | 更新账号成员（全量字段） | account.go:129 |
| DELETE | `/api/v1/accounts/:aid/users/:uid` | Protected | `UserRemoveAccountMember` | 把用户移出账号 | account.go:130 |
| GET | `/api/v1/accounts/:aid/users/out` | Protected | `UserListUsersOutOfAccount` | 不在该账号内的用户候选列表 | account.go:131 |
| GET | `/api/v1/accounts/:aid/users` | Protected | `UserListAccountMembers` | 账号成员列表 | account.go:132 |
| PUT | `/api/v1/accounts/:aid/users/:uid` | Protected | `UserUpdateAccountMemberPartial` | 部分更新成员关系（accessmode/role/quota） | account.go:133 |
| GET | `/api/v1/admin/accounts` | Admin | `AdminListAccounts` | 账号全量列表（分页） | account.go:137 |
| POST | `/api/v1/admin/accounts` | Admin | `CreateAccount` | 创建账号（含 quota/admins/过期时间） | account.go:138 |
| GET | `/api/v1/admin/accounts/:aid` | Admin | `GetAccountByID` | 账号详情 | account.go:139 |
| GET | `/api/v1/admin/accounts/:aid/quota` | Admin | `GetQuota` | 账号 Volcano 配额（guaranteed/deserved/capability） | account.go:140 |
| GET | `/api/v1/admin/accounts/:aid/billing/config` | Admin | `GetAccountBillingConfig` | 账号计费配置（管理员视角） | account.go:141 |
| PUT | `/api/v1/admin/accounts/:aid/billing/config` | Admin | `UpdateAccountBillingConfig` | 修改账号计费配置（管理员视角） | account.go:142 |
| GET | `/api/v1/admin/accounts/:aid/billing/members` | Admin | `AdminListAccountBillingMembers` | 成员计费明细（管理员视角） | account.go:143 |
| PUT | `/api/v1/admin/accounts/:aid/billing/members/:uid` | Admin | `AdminUpdateAccountBillingMemberIssueAmount` | 改成员发放额度（管理员视角） | account.go:144 |
| POST | `/api/v1/admin/accounts/:aid/billing/reset` | Admin | `AdminResetAccountBillingBalance` | 重置账号余额（管理员视角） | account.go:145 |
| PUT | `/api/v1/admin/accounts/:aid` | Admin | `UpdateAccount` | 更新账号（昵称/配额/管理员/过期） | account.go:146 |
| DELETE | `/api/v1/admin/accounts/:aid` | Admin | `DeleteAccount` | 删除账号 | account.go:147 |
| POST | `/api/v1/admin/accounts/add/:aid/:uid` | Admin | `AdminAddAccountMember` | 加成员（管理员） | account.go:148 |
| POST | `/api/v1/admin/accounts/update/:aid/:uid` | Admin | `AdminUpdateAccountMember` | 改成员（管理员全量） | account.go:149 |
| GET | `/api/v1/admin/accounts/userIn/:aid` | Admin | `AdminListAccountMembers` | 账号内成员（管理员） | account.go:150 |
| GET | `/api/v1/admin/accounts/userOutOf/:aid` | Admin | `AdminListUsersOutOfAccount` | 账号外用户（管理员） | account.go:151 |
| DELETE | `/api/v1/admin/accounts/:aid/:uid` | Admin | `AdminRemoveAccountMember` | 移除成员（管理员） | account.go:152 |
| PUT | `/api/v1/admin/accounts/userIn/:aid` | Admin | `AdminUpdateAccountMemberPartial` | 部分更新成员关系（管理员） | account.go:153 |

> ⚠️ 路由冲突风险：`/api/v1/admin/accounts/:aid` 与 `/api/v1/admin/accounts/add/:aid/:uid`、`userIn/:aid`、`update/:aid/:uid` 并存。gin 的静态段优先于参数段，因此 `GET /api/v1/admin/accounts/add` 这类请求会命中 `:aid` 路由；反向不受影响。但 `DELETE /api/v1/admin/accounts/:aid/:uid` 与 `DELETE /api/v1/admin/accounts/:aid` 属不同深度，无冲突。

## 2.5 `images`（ImagePackMgr，name=`images`）— 镜像

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/images/kaniko` | Protected | `UserListKaniko` | 我的镜像构建任务列表（kaniko records） | image/interface.go:37 |
| POST | `/api/v1/images/kaniko` | Protected | `UserCreateByPipApt` | 基于源镜像 + pip requirements + apt packages 构建新镜像 | image/interface.go:38 |
| POST | `/api/v1/images/dockerfile` | Protected | `UserCreateByDockerfile` | 用 Dockerfile 构建镜像 | image/interface.go:39 |
| POST | `/api/v1/images/envd` | Protected | `UserCreateByEnvd` | 用 envd 构建镜像 | image/interface.go:40 |
| POST | `/api/v1/images/remove` | Protected | `UserRemoveKanikoByID` | 删除/取消我的某个构建任务记录 | image/interface.go:41 |
| GET | `/api/v1/images/image` | Protected | `UserListImage` | 我可用的镜像列表（公共 + 本账号 + 我的私有 + 他人分享） | image/interface.go:43 |
| POST | `/api/v1/images/image` | Protected | `UserUploadImage` | 直接登记一个已有镜像链接（上传记录） | image/interface.go:44 |
| DELETE | `/api/v1/images/image/:id` | Protected | `DeleteImageByID` | 按 ID 删除我的镜像 | image/interface.go:45 |
| GET | `/api/v1/images/available` | Protected | `ListAvailableImages` | 按任务类型（jupyter/webide/training…）列出可选镜像 | image/interface.go:47 |
| GET | `/api/v1/images/getbyname` | Protected | `GetKanikoByImagePackName` | 按镜像包名查构建详情 | image/interface.go:48 |
| POST | `/api/v1/images/quota` | Protected | `UpdateProjectQuota` | 修改我的 Harbor 项目存储配额（size） | image/interface.go:49 |
| GET | `/api/v1/images/podname` | Protected | `GetImagepackPodName` | 查构建 Pod 名/命名空间/节点 | image/interface.go:51 |
| POST | `/api/v1/images/credential` | Protected | `UserGetProjectCredential` | 取/建我的 Harbor 项目账号密码 | image/interface.go:52 |
| GET | `/api/v1/images/quota` | Protected | `UserGetProjectDetail` | 我的 Harbor 项目用量/配额 | image/interface.go:53 |
| POST | `/api/v1/images/valid` | Protected | `CheckLinkValidity` | 批量校验镜像链接是否存在 | image/interface.go:54 |
| POST | `/api/v1/images/description` | Protected | `UserChangeImageDescription` | 改我的镜像描述（仅 owner） | image/interface.go:55 |
| POST | `/api/v1/images/deleteimage` | Protected | `UserDeleteImageByIDList` | 批量删除我的镜像（idList） | image/interface.go:56 |
| POST | `/api/v1/images/type` | Protected | `UserChangeImageTaskType` | 改镜像任务类型（仅 owner） | image/interface.go:57 |
| GET | `/api/v1/images/harbor` | Protected | `GetHarborIP` | 返回 Harbor 地址 | image/interface.go:58 |
| POST | `/api/v1/images/tags` | Protected | `UserChangeImageTags` | 改镜像标签（仅 owner） | image/interface.go:59 |
| GET | `/api/v1/images/template` | Protected | `GetKanikoTemplateByImagePackName` | 取构建模板（Dockerfile/template） | image/interface.go:60 |
| POST | `/api/v1/images/share` | Protected | `UserShareImage` | 分享镜像给用户或账号（type=user/account） | image/interface.go:62 |
| DELETE | `/api/v1/images/share` | Protected | `UserCancelShareImage` | 取消分享 | image/interface.go:63 |
| GET | `/api/v1/images/share` | Protected | `GetImageGrantedUserOrAccount` | 查镜像已授权用户/账号 | image/interface.go:64 |
| GET | `/api/v1/images/user` | Protected | `UserSearchUngrantedUsers` | 搜未授权的用户（用于分享） | image/interface.go:65 |
| GET | `/api/v1/images/account` | Protected | `UserGetImageUngrantedAccounts` | 未授权的账号列表 | image/interface.go:66 |
| GET | `/api/v1/images/cudabaseimage` | Protected | `UserGetCudaBaseImages` | CUDA 基础镜像标签列表（构建下拉用） | image/interface.go:67 |
| POST | `/api/v1/images/arch` | Protected | `UserUpdateImageArch` | 改镜像架构列表（仅 owner） | image/interface.go:68 |
| GET | `/api/v1/admin/images/kaniko` | Admin | `AdminListKaniko` | 全量构建任务列表 | image/interface.go:72 |
| GET | `/api/v1/admin/images/image` | Admin | `AdminListImage` | 全量镜像列表 | image/interface.go:73 |
| POST | `/api/v1/admin/images/deleteimage` | Admin | `AdminDeleteImageByIDList` | 批量删除任意镜像 | image/interface.go:74 |
| POST | `/api/v1/admin/images/remove` | Admin | `AdminRemoveKanikoByIDList` | 批量删除任意构建记录 | image/interface.go:75 |
| POST | `/api/v1/admin/images/type` | Admin | `AdminChangeImageTaskType` | 改任意镜像任务类型 | image/interface.go:76 |
| POST | `/api/v1/admin/images/change/:id` | Admin | `AdminUpdateImagePublicStatus` | 切换镜像公开状态 | image/interface.go:77 |
| POST | `/api/v1/admin/images/description` | Admin | `AdminChangeImageDescription` | 改任意镜像描述 | image/interface.go:78 |
| POST | `/api/v1/admin/images/tags` | Admin | `AdminChangeImageTags` | 改任意镜像标签 | image/interface.go:79 |
| POST | `/api/v1/admin/images/arch` | Admin | `AdminUpdateImageArch` | 改任意镜像架构 | image/interface.go:80 |
| POST | `/api/v1/admin/images/cudabaseimage` | Admin | `AdminAddCudaBaseImage` | 新增 CUDA 基础镜像条目 | image/interface.go:81 |
| DELETE | `/api/v1/admin/images/cudabaseimage/:id` | Admin | `AdminDeleteCudaBaseImage` | 删除 CUDA 基础镜像条目 | image/interface.go:82 |

## 2.6 `vcjobs`（VolcanojobMgr，name=`vcjobs`）— Volcano 作业

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/vcjobs` | Protected | `GetSelfJobs` | 我的作业列表（user+account 双重过滤） | vcjob/vcjob.go:82 |
| GET | `/api/v1/vcjobs/facets` | Protected | `GetSelfJobFacets` | 我的作业筛选项聚合（状态/类型/节点计数） | vcjob/vcjob.go:83 |
| GET | `/api/v1/vcjobs/all` | Protected | `GetAllJobsInDays` | **全平台**作业列表（默认 14 天，无过滤） | vcjob/vcjob.go:84 |
| GET | `/api/v1/vcjobs/all/facets` | Protected | `GetAllJobFacets` | 全平台作业 facets | vcjob/vcjob.go:85 |
| GET | `/api/v1/vcjobs/user/:username` | Protected | `GetUserJobsInDays` | **任意**指定用户的作业列表（无归属校验） | vcjob/vcjob.go:86 |
| GET | `/api/v1/vcjobs/user/:username/facets` | Protected | `GetUserJobFacets` | 任意指定用户的作业 facets | vcjob/vcjob.go:87 |
| GET | `/api/v1/vcjobs/billing` | Protected | `GetSelfJobBilling` | 我的作业计费汇总 | vcjob/vcjob.go:88 |
| GET | `/api/v1/vcjobs/billing/all` | Protected | `GetAllJobBillingInDays` | 全平台作业计费汇总 | vcjob/vcjob.go:89 |
| GET | `/api/v1/vcjobs/billing/user/:username` | Protected | `GetUserJobBillingInDays` | 任意用户的作业计费 | vcjob/vcjob.go:90 |
| DELETE | `/api/v1/vcjobs/:name` | Protected | `DeleteJob` | 删除作业（非管理员仅限自己的） | vcjob/vcjob.go:91 |
| GET | `/api/v1/vcjobs/:name/detail` | Protected | `GetJobDetail` | 作业详情（含 Pod 详情） | vcjob/vcjob.go:93 |
| GET | `/api/v1/vcjobs/:name/billing` | Protected | `GetJobBillingDetail` | 单作业计费明细 | vcjob/vcjob.go:94 |
| GET | `/api/v1/vcjobs/:name/yaml` | Protected | `GetJobYaml` | 作业 YAML | vcjob/vcjob.go:95 |
| GET | `/api/v1/vcjobs/:name/pods` | Protected | `GetJobPods` | 作业 Pod 列表 | vcjob/vcjob.go:96 |
| GET | `/api/v1/vcjobs/:name/template` | Protected | `GetJobTemplate` | 由作业反推的提交模板（复制作业用） | vcjob/vcjob.go:97 |
| GET | `/api/v1/vcjobs/:name/event` | Protected | `GetJobEvents` | 作业/Pod 事件 | vcjob/vcjob.go:98 |
| PUT | `/api/v1/vcjobs/:name/alert` | Protected | `ToggleAlertState` | 开关作业邮件提醒 | vcjob/vcjob.go:99 |
| POST | `/api/v1/vcjobs/:name/ssh` | Protected | `OpenSSH` | 为作业 Pod 开启/暴露 SSH（返回 IP/端口） | vcjob/vcjob.go:102 |
| POST | `/api/v1/vcjobs/:name/snapshot` | Protected | `CreateSnapshot` | 对 Jupyter/Custom 作业做快照（打包镜像） | vcjob/vcjob.go:105 |
| POST | `/api/v1/vcjobs/jupyter` | Protected | `CreateJupyterJob` | 创建 Jupyter 作业 | vcjob/vcjob.go:108 |
| GET | `/api/v1/vcjobs/:name/token` | Protected | `GetJobToken` | 取 Jupyter 访问 token/URL | vcjob/vcjob.go:109 |
| POST | `/api/v1/vcjobs/webide` | Protected | `CreateWebIDEJob` | 创建 WebIDE 作业 | vcjob/vcjob.go:112 |
| GET | `/api/v1/vcjobs/:name/secret` | Protected | `GetWebIDESecret` | 取 WebIDE 访问凭据 | vcjob/vcjob.go:113 |
| POST | `/api/v1/vcjobs/training` | Protected | `CreateTrainingJob` | 创建自定义/custom 训练作业 | vcjob/vcjob.go:116 |
| POST | `/api/v1/vcjobs/tensorflow` | Protected | `CreateTensorflowJob` | 创建 TensorFlow 分布式作业 | vcjob/vcjob.go:119 |
| POST | `/api/v1/vcjobs/pytorch` | Protected | `CreatePytorchJob` | 创建 PyTorch 分布式作业（复用 tensorflow 的 tasks 结构） | vcjob/vcjob.go:122 |
| GET | `/api/v1/admin/vcjobs` | Admin | `GetAllJobsInDays` | 全平台作业列表（管理员入口） | vcjob/vcjob.go:126 |
| GET | `/api/v1/admin/vcjobs/facets` | Admin | `GetAllJobFacets` | 全平台作业 facets | vcjob/vcjob.go:127 |
| GET | `/api/v1/admin/vcjobs/user/:username` | Admin | `GetUserJobsInDays` | 指定用户作业列表 | vcjob/vcjob.go:128 |
| GET | `/api/v1/admin/vcjobs/user/:username/facets` | Admin | `GetUserJobFacets` | 指定用户作业 facets | vcjob/vcjob.go:129 |
| GET | `/api/v1/admin/vcjobs/billing` | Admin | `GetAllJobBillingInDays` | 全平台计费 | vcjob/vcjob.go:130 |
| GET | `/api/v1/admin/vcjobs/billing/user/:username` | Admin | `GetUserJobBillingInDays` | 指定用户计费 | vcjob/vcjob.go:131 |
| GET | `/api/v1/admin/vcjobs/:name/billing` | Admin | `GetJobBillingDetail` | 单作业计费 | vcjob/vcjob.go:132 |
| DELETE | `/api/v1/admin/vcjobs/:name` | Admin | `AdminDeleteJob` | 管理员删除任意作业 | vcjob/vcjob.go:134 |

## 2.7 `storage`（StorageMgr，name=`storage`）— 存储配额（不是文件读写）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/storage/capabilities` | Protected | `GetCapabilitySummary` | 当前用户可见的存储能力摘要（是否启用配额/可读用量/可读配额） | storage.go:101 |
| GET | `/api/v1/storage/dirsize/*path` | Protected | `GetDirectorySize` | 查询某个逻辑空间目录的体积（`*path` 为逻辑路径） | storage.go:102 |
| GET | `/api/v1/storage/my-quota` | Protected | `GetMyQuota` | 我的存储用量/配额 | storage.go:103 |
| GET | `/api/v1/admin/storage/capabilities` | Admin | `GetCapabilities` | 存储后端完整能力（含 PVC/CSI/quota provider 等诊断字段） | storage.go:107 |
| GET | `/api/v1/admin/storage/user-spaces` | Admin | `GetAllUserSpaceSizes` | 全部用户空间的用量 | storage.go:108 |
| POST | `/api/v1/admin/storage/user-spaces/refresh` | Admin | `RefreshUserSpaceSizes` | 强制刷新用户空间用量缓存 | storage.go:109 |
| PUT | `/api/v1/admin/storage/user-spaces/:user/quota` | Admin | `SetUserSpaceQuota` | 设置指定用户的存储配额（body `{"quota":int64}`） | storage.go:110 |

## 2.8 `storage`（JWTTokenMgr，name 也是 `storage`）— storage-server 的 token 校验

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/storage/verify` | Protected | `VerifyToken` | 校验 JWT 并返回 `TokenReq{userId, rootPath, permission}` 给 storage-server 用 | jwttoken.go:31 |

> ⚠️ 与 2.7 共用 `/api/v1/storage` 前缀但路由不重叠（`/verify` vs `/capabilities`…）。注意 `GET /api/v1/storage/verify` 与 `GET /api/v1/storage/dirsize/*path` 之外的静态段不冲突。

## 2.9 `dataset`（DatasetMgr，name=`dataset`）— 数据集

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/dataset/source-logo/:sourceId` | Public | `GetSourceLogo` | 返回平台缓存的模型源站 logo（免登录） | dataset.go:45 |
| GET | `/api/v1/dataset/mydataset` | Protected | `GetDatasets` | 我能看的数据集（我关联的 + 默认账号 + 我所在账号关联的） | dataset.go:49 |
| GET | `/api/v1/dataset/:datasetId/usersNotIn` | Protected | `ListUsersOutOfDataset` | 未共享到该数据集的用户 | dataset.go:50 |
| GET | `/api/v1/dataset/:datasetId/usersIn` | Protected | `ListUserOfDataset` | 已共享到该数据集的用户 | dataset.go:51 |
| GET | `/api/v1/dataset/:datasetId/queuesNotIn` | Protected | `ListQueuesOutOfDataset` | 未共享的账号/队列 | dataset.go:52 |
| GET | `/api/v1/dataset/:datasetId/queuesIn` | Protected | `ListQueueOfDataset` | 已共享的账号/队列 | dataset.go:53 |
| POST | `/api/v1/dataset/create` | Protected | `CreateDataset` | 创建数据集 | dataset.go:54 |
| DELETE | `/api/v1/dataset/delete/:id` | Protected | `DeleteDataset` | 删除数据集（仅创建者） | dataset.go:55 |
| POST | `/api/v1/dataset/share/user` | Protected | `ShareDatasetWithUser` | 分享给用户（仅 owner） | dataset.go:56 |
| POST | `/api/v1/dataset/share/queue` | Protected | `ShareDatasetWithQueue` | 分享给账号/队列（仅 owner） | dataset.go:57 |
| POST | `/api/v1/dataset/cancelshare/user` | Protected | `CancelShareDatasetWithUser` | 取消用户分享（仅 owner） | dataset.go:58 |
| POST | `/api/v1/dataset/cancelshare/queue` | Protected | `CancelShareDatasetWithQueue` | 取消账号分享（仅 owner） | dataset.go:59 |
| GET | `/api/v1/dataset/detail/:datasetId` | Protected | `GetDatasetByID` | 数据集详情 | dataset.go:60 |
| POST | `/api/v1/dataset/update` | Protected | `UpdateDataset` | 更新数据集（仅 owner） | dataset.go:61 |
| GET | `/api/v1/admin/dataset/alldataset` | Admin | `GetAllDataset` | 全量数据集 | dataset.go:65 |
| POST | `/api/v1/admin/dataset/share/user` | Admin | `AdminShareDatasetWithUser` | 管理员分享数据集给用户 | dataset.go:66 |
| POST | `/api/v1/admin/dataset/share/queue` | Admin | `AdminShareDatasetWithQueue` | 管理员分享给账号 | dataset.go:67 |
| POST | `/api/v1/admin/dataset/cancelshare/user` | Admin | `AdminCancelShareDatasetWithUser` | 管理员取消用户分享 | dataset.go:68 |
| POST | `/api/v1/admin/dataset/cancelshare/queue` | Admin | `AdmincancelShareDatasetWithQueue` | 管理员取消账号分享 | dataset.go:69 |

## 2.10 `resources`（ResourceMgr，name=`resources`）— 资源/GPU 型号

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/resources` | Protected | `ListResource` | 资源列表（CPU/内存/GPU 型号等，query `withVendorDomain`/`domainPrefix`） | resource.go:52 |
| GET | `/api/v1/resources/billing/prices` | Protected | `ListBillingPrices` | 各资源单价（计费开启时） | resource.go:53 |
| GET | `/api/v1/resources/:id/networks` | Protected | `GetGPUNetworks` | GPU 关联的 RDMA 网络 | resource.go:54 |
| GET | `/api/v1/resources/:id/vgpu` | Protected | `GetGPUVGPUResources` | GPU 切分出的 vGPU 资源 | resource.go:55 |
| POST | `/api/v1/admin/resources/sync` | Admin | `SyncResource` | 从集群同步资源到数据库 | resource.go:59 |
| PUT | `/api/v1/admin/resources/:id` | Admin | `UpdateResource` | 改资源 label/type | resource.go:60 |
| PUT | `/api/v1/admin/resources/:id/billing/unit-price` | Admin | `UpdateResourceUnitPrice` | 改资源计费单价 | resource.go:61 |
| DELETE | `/api/v1/admin/resources/:id` | Admin | `DeleteResource` | 删除资源 | resource.go:62 |
| POST | `/api/v1/admin/resources/:id/networks` | Admin | `LinkGPUToRDMA` | 关联 GPU↔RDMA 网络 | resource.go:63 |
| GET | `/api/v1/admin/resources/:id/networks` | Admin | `GetGPUNetworks` | 查 GPU 关联网络（管理员视角） | resource.go:64 |
| DELETE | `/api/v1/admin/resources/:id/networks/:networkId` | Admin | `DeleteResourceLink` | 解除 GPU↔网络关联 | resource.go:65 |
| POST | `/api/v1/admin/resources/:id/vgpu` | Admin | `LinkGPUToVGPU` | 关联 GPU↔vGPU | resource.go:67 |
| GET | `/api/v1/admin/resources/:id/vgpu` | Admin | `GetGPUVGPUResources` | 查 GPU↔vGPU（管理员视角） | resource.go:68 |
| PUT | `/api/v1/admin/resources/:id/vgpu/:vgpuId` | Admin | `UpdateGPUVGPULink` | 更新 vGPU 关联参数 | resource.go:69 |
| DELETE | `/api/v1/admin/resources/:id/vgpu/:vgpuId` | Admin | `DeleteGPUVGPULink` | 解除 vGPU 关联 | resource.go:70 |

## 2.11 `nodes`（NodeMgr，name=`nodes`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/nodes` | Protected | `ListNode` | 节点列表（含资源/使用率） | node.go:79 |
| PUT | `/api/v1/nodes/:name` | Protected | `UpdateNodeunschedule` | **设置节点是否禁止调度（⚠️ 属于 Protected，非 Admin）** | node.go:80 |
| GET | `/api/v1/nodes/:name` | Protected | `GetNode` | 节点详情 | node.go:81 |
| GET | `/api/v1/nodes/:name/pods` | Protected | `GetPodsForNode` | 节点上 Pod 列表 | node.go:82 |
| GET | `/api/v1/nodes/:name/gpu` | Protected | `ListNodeGPUInfo` | 节点 GPU 信息 | node.go:83 |
| GET | `/api/v1/admin/nodes` | Admin | `ListNode` | 节点列表（管理员入口） | node.go:87 |
| GET | `/api/v1/admin/nodes/:name/pods` | Admin | `AdminGetPodsForNode` | 节点 Pod 列表（管理员视角，含更多字段） | node.go:88 |
| GET | `/api/v1/admin/nodes/:name/gpu` | Admin | `ListNodeGPUInfo` | 节点 GPU 信息 | node.go:89 |
| GET | `/api/v1/admin/nodes/:name/mark` | Admin | `GetNodeMarks` | 节点 label/annotation/taint 汇总 | node.go:90 |
| POST | `/api/v1/admin/nodes/:name/label` | Admin | `AddNodeLabel` | 加/改 label（body `{key,value}`） | node.go:91 |
| DELETE | `/api/v1/admin/nodes/:name/label` | Admin | `DeleteNodeLabel` | 删 label | node.go:92 |
| POST | `/api/v1/admin/nodes/:name/annotation` | Admin | `AddNodeAnnotation` | 加/改 annotation | node.go:93 |
| DELETE | `/api/v1/admin/nodes/:name/annotation` | Admin | `DeleteNodeAnnotation` | 删 annotation | node.go:94 |
| POST | `/api/v1/admin/nodes/:name/taint` | Admin | `AddNodeTaint` | 加 taint（`{key,value,effect,reason}`） | node.go:95 |
| DELETE | `/api/v1/admin/nodes/:name/taint` | Admin | `DeleteNodeTaint` | 删 taint | node.go:96 |
| POST | `/api/v1/admin/nodes/:name/drain` | Admin | `DrainNode` | 驱逐节点（drain） | node.go:97 |

> 本 manager **没有** `/admin/nodes/:name/mark` 之外的 label/taint 批量接口；也没有独立的 `drain` 取消接口（⚠️ 反向取消 drain 需看 `UpdateNodeunschedule` 或用 `UpdateNode` 之外的路径，静态代码中未见 `uncordon` 独立路由）。

## 2.12 `statistics`（StatisticsMgr，name=`statistics`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/statistics` | Protected | `GetStatistics` | 资源使用统计（query：`startTime/endTime/step=day|week/scope=user|account|cluster/targetID`），核时/卡时/ GiB·时 | statistics.go:36 |

> 无 Admin 路由（`RegisterAdmin` 空）。**注意**：`scope=cluster` 仅管理员可查；`scope=account` 需账号管理员；`scope=user` **任意用户可查任意用户**（见第 4 部分）。

## 2.13 `system-config`（SystemConfigMgr，name=`system-config`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/system-config/billing` | Protected | `GetBillingStatus` | 计费开关状态（用户可读，用于前端隐藏入口） | system_config.go:50 |
| GET | `/api/v1/system-config/model-download-limit` | Protected | `GetModelDownloadLimitConfig` | 我的模型下载限额状态（含 exempt） | system_config.go:51 |
| GET | `/api/v1/admin/system-config/llm` | Admin | `GetLLMConfig` | 读 LLM 配置（apiKey 脱敏） | system_config.go:56 |
| PUT | `/api/v1/admin/system-config/llm` | Admin | `UpdateLLMConfig` | 写 LLM 配置（可选 validate 立即校验） | system_config.go:57 |
| DELETE | `/api/v1/admin/system-config/llm` | Admin | `ResetLLMConfig` | 重置 LLM 配置 | system_config.go:59 |
| GET | `/api/v1/admin/system-config/gpu-analysis` | Admin | `GetGpuAnalysisStatus` | GPU 分析功能开关 | system_config.go:61 |
| PUT | `/api/v1/admin/system-config/gpu-analysis` | Admin | `SetGpuAnalysisStatus` | 设置 GPU 分析开关（`{enable}`） | system_config.go:62 |
| GET | `/api/v1/admin/system-config/scheduler-extender` | Admin | `GetSchedulerExtenderConfig` | 调度器扩展配置（extender 开关/队列配额开关/等待容忍秒数） | system_config.go:63 |
| PUT | `/api/v1/admin/system-config/scheduler-extender` | Admin | `UpdateSchedulerExtenderConfig` | 更新调度器扩展配置 | system_config.go:64 |
| GET | `/api/v1/admin/system-config/model-download-limit` | Admin | `GetAdminModelDownloadLimitConfig` | 读模型下载限额（含白名单 userIds） | system_config.go:65 |
| PUT | `/api/v1/admin/system-config/model-download-limit` | Admin | `UpdateModelDownloadLimitConfig` | 更新模型下载限额 | system_config.go:66 |
| GET | `/api/v1/admin/system-config/pod-bandwidth` | Admin | `GetAdminPodBandwidthConfig` | Pod 带宽限制配置 | system_config.go:67 |
| PUT | `/api/v1/admin/system-config/pod-bandwidth` | Admin | `UpdateAdminPodBandwidthConfig` | 更新 Pod 带宽限制 | system_config.go:68 |
| GET | `/api/v1/admin/system-config/billing` | Admin | `GetBillingStatus` | 计费状态（管理员视角，含 cron 状态） | system_config.go:70 |
| PUT | `/api/v1/admin/system-config/billing` | Admin | `SetBillingStatus` | 设置计费开关/周期/免费分钟等 | system_config.go:71 |
| POST | `/api/v1/admin/system-config/billing/reconcile` | Admin | `TriggerBillingBaseLoop` | 手动触发一次计费基础循环（对账） | system_config.go:72 |
| POST | `/api/v1/admin/system-config/billing/reset-all` | Admin | `ResetAllBillingBalances` | 重置全部账号/用户余额 | system_config.go:73 |
| POST | `/api/v1/admin/system-config/billing/extra-balance-all` | Admin | `GrantAllUsersExtraBalance` | 给全部用户发放额外点数 | system_config.go:74 |

> ⚠️ 本管理端**没有** `prequeue` 与 `pod-bandwidth` 之外的 prequeue 路由：源码里 prequeue 相关只存在于 vcjob 创建逻辑（集群侧排队），**不存在 `/admin/system-config/prequeue` 接口**（用户需求清单里的 prequeue 在 2.16 `context` 只有 `job-resource-summary`/`resource-limit-check`，无 prequeue 端点）。

## 2.14 `approvalorder`（ApprovalOrderMgr，name=`approvalorder`）— 审批工单

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/approvalorder` | Protected | `GetMyApprovalOrders` | 我创建的审批工单列表 | approvalorder.go:45 |
| GET | `/api/v1/approvalorder/:id` | Protected | `GetApprovalOrder` | 工单详情（本人） | approvalorder.go:46 |
| POST | `/api/v1/approvalorder` | Protected | `CreateApprovalOrder` | 创建工单（延长作业时长/数据集申请等） | approvalorder.go:47 |
| PUT | `/api/v1/approvalorder/:id` | Protected | `UpdateApprovalOrder` | 更新工单（本人） | approvalorder.go:48 |
| DELETE | `/api/v1/approvalorder/:id` | Protected | `DeleteApprovalOrder` | 删除工单（本人） | approvalorder.go:49 |
| GET | `/api/v1/approvalorder/name/:name` | Protected | `GetApprovalOrderByName` | 按名字查工单 | approvalorder.go:50 |
| GET | `/api/v1/admin/approvalorder` | Admin | `ListAllApprovalOrders` | 全部工单 | approvalorder.go:55 |
| GET | `/api/v1/admin/approvalorder/:id` | Admin | `GetApprovalOrderAdmin` | 工单详情（管理员） | approvalorder.go:56 |
| PUT | `/api/v1/admin/approvalorder/:id/review` | Admin | `ReviewApprovalOrderAdmin` | 审核工单（approve/reject + 备注） | approvalorder.go:57 |
| PUT | `/api/v1/admin/approvalorder/check` | Admin | `UpdateApprovalOrderByJobStatus` | 批量校验待审批的“作业锁定”工单有效性 | approvalorder.go:58 |

## 2.15 `model-download`（ModelDownloadMgr，name=`model-download`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/model-download/models/download` | Protected | `CreateDownload` | 提交模型/数据集下载任务（HuggingFace/ModelScope 等） | modeldownload.go:83 |
| GET | `/api/v1/model-download/models/downloads` | Protected | `ListDownloads` | 我可见的下载记录（分页 + 状态聚合） | modeldownload.go:84 |
| GET | `/api/v1/model-download/models/downloads/:id` | Protected | `GetDownload` | 下载详情 | modeldownload.go:85 |
| GET | `/api/v1/model-download/models/downloads/:id/logs` | Protected | `GetDownloadLogs` | 下载 Job 日志 | modeldownload.go:86 |
| POST | `/api/v1/model-download/models/downloads/:id/retry` | Protected | `RetryDownload` | 重试下载 | modeldownload.go:87 |
| POST | `/api/v1/model-download/models/downloads/:id/pause` | Protected | `PauseDownload` | 暂停下载 | modeldownload.go:88 |
| POST | `/api/v1/model-download/models/downloads/:id/resume` | Protected | `ResumeDownload` | 恢复下载 | modeldownload.go:89 |
| DELETE | `/api/v1/model-download/models/downloads/:id` | Protected | `DeleteDownload` | 删除下载记录（自己提交的） | modeldownload.go:90 |
| GET | `/api/v1/admin/model-download/models/downloads` | Admin | `ListAllDownloads` | 全量下载记录（管理员） | modeldownload.go:94 |
| DELETE | `/api/v1/admin/model-download/models/downloads/:id` | Admin | `AdminDeleteDownload` | 删除任意下载记录 | modeldownload.go:95 |

## 2.16 `queue-quotas`（QueueQuotaMgr，name=`queue-quotas`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/queue-quotas` | Admin | `GetQueueQuotas` | 队列/用户配额配置列表 | queue_quota.go:35 |
| POST | `/api/v1/admin/queue-quotas` | Admin | `CreateQueueQuota` | 新建配额配置（body `{name, quota{resource:string}}`） | queue_quota.go:36 |
| PUT | `/api/v1/admin/queue-quotas/:id` | Admin | `UpdateQueueQuota` | 更新配额配置 | queue_quota.go:37 |
| DELETE | `/api/v1/admin/queue-quotas/:id` | Admin | `DeleteQueueQuota` | 删除配额配置 | queue_quota.go:38 |

> Protected/Public 均为空实现（`queue_quota.go:31-32`）。

## 2.17 `context`（ContextMgr，name=`context`）— 当前上下文/配额/属性

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/context/quota` | Protected | `GetQuota` | 我在当前账号的 Volcano 配额/已用（按 user+account 统计运行中作业） | context.go:57 |
| GET | `/api/v1/context/job-resource-summary` | Protected | `GetJobResourceSummary` | 我的作业资源汇总（运行/排队数、CPU/内存/加速器） | context.go:58 |
| POST | `/api/v1/context/resource-limit-check` | Protected | `CheckResourceLimit` | 提交前检查是否超过队列资源限制 | context.go:59 |
| GET | `/api/v1/context/billing/summary` | Protected | `GetBillingSummary` | 我的计费余额汇总 | context.go:60 |
| PUT | `/api/v1/context/attributes` | Protected | `UpdateUserAttributes` | 更新我自己的 attributes（昵称/邮箱/导师/课题组/电话/头像；UID/GID 被强制保留） | context.go:61 |
| POST | `/api/v1/context/email/code` | Protected | `SendUserVerificationCode` | 向指定邮箱发 6 位验证码 | context.go:62 |
| POST | `/api/v1/context/email/update` | Protected | `UpdateUserEmail` | 校验验证码并标记邮箱已验证 | context.go:63 |

## 2.18 `jobtemplate`（JobTemplateMgr，name=`jobtemplate`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/jobtemplate/list` | Protected | `ListJobTemplate` | 我的作业模板列表 | jobtemplate.go:33 |
| POST | `/api/v1/jobtemplate/create` | Protected | `CreateJobTemplate` | 新建作业模板 | jobtemplate.go:34 |
| DELETE | `/api/v1/jobtemplate/delete/:id` | Protected | `DeleteJobTemplate` | 删除模板 | jobtemplate.go:35 |
| GET | `/api/v1/jobtemplate/:id` | Protected | `GetJobTemplate` | 模板详情 | jobtemplate.go:36 |
| PUT | `/api/v1/jobtemplate/update/:id` | Protected | `UpdateJobTemplate` | 更新模板 | jobtemplate.go:37 |

## 2.19 `aijobs`（AIJobMgr，name=`aijobs`）— 推荐/自定义 AI 任务（旧链路）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/aijobs/:id/token` | Protected | `GetJupyterToken` | 取 AI 任务的 Jupyter token（先按 `AccountName` 查，再比对 `UserName`） | aijob/emias.go:74 |
| GET | `/api/v1/aijobs` | Protected | `ListUserJob` | **当前账号内** AI 任务列表（按 `token.AccountName` 过滤，**不是**按用户） | aijob/emias.go:75 |
| GET | `/api/v1/aijobs/all` | Protected | `ListAllJob` | **全平台** AI 任务（`taskService.ListAll()`，无过滤） | aijob/emias.go:76 |
| GET | `/api/v1/aijobs/quota` | Protected | `GetQuota` | AI 任务配额（按 `AccountName`） | aijob/emias.go:77 |
| DELETE | `/api/v1/aijobs/:id` | Protected | `Delete` | 删除任务（`GetByQueueAndID(AccountName, id)` → **账号内任意任务**） | aijob/emias.go:78 |
| GET | `/api/v1/aijobs/:id/detail` | Protected | `GetDetail` | 任务详情（账号内） | aijob/emias.go:80 |
| GET | `/api/v1/aijobs/:id/yaml` | Protected | `GetJobYaml` | 任务 YAML | aijob/emias.go:81 |
| GET | `/api/v1/aijobs/:id/pods` | Protected | `GetJobPods` | 任务 Pod | aijob/emias.go:82 |
| GET | `/api/v1/aijobs/:id/event` | Protected | `GetJobEvents` | 任务事件 | aijob/emias.go:83 |
| POST | `/api/v1/aijobs/training` | Protected | `CreateCustom` | 创建自定义训练任务 | aijob/emias.go:85 |
| POST | `/api/v1/aijobs/jupyter` | Protected | `CreateJupyterJob` | 创建 Jupyter 任务 | aijob/emias.go:86 |
| GET | `/api/v1/admin/aijobs` | Admin | `ListUserJob` | 任务列表（管理员入口，⚠️ 复用了用户级 handler） | aijob/emias.go:90 |
| GET | `/api/v1/admin/aijobs/:id/detail` | Admin | `GetDetail` | 任务详情（管理员入口） | aijob/emias.go:91 |

## 2.20 `spjobs`（SparseJobMgr，name=`spjobs`）— 稀疏推荐作业（RecommendDLJob CRD）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/spjobs` | Protected | `List` | 稀疏作业列表 | spjob/spjob.go:75 |
| GET | `/api/v1/spjobs/all` | Protected | `List` | 同上（别名） | spjob/spjob.go:76 |
| DELETE | `/api/v1/spjobs/:name` | Protected | `Delete` | 删除（`rolePermit` 校验：仅自己或 admin） | spjob/spjob.go:77 |
| GET | `/api/v1/spjobs/:name/detail` | Protected | `GetByName` | 详情 | spjob/spjob.go:79 |
| GET | `/api/v1/spjobs/:name/yaml` | Protected | `GetYaml` | YAML | spjob/spjob.go:80 |
| GET | `/api/v1/spjobs/:name/pods` | Protected | `GetJobPods` | Pod 列表 | spjob/spjob.go:81 |
| GET | `/api/v1/spjobs/:name/events` | Protected | `GetJobEvents` | 事件 | spjob/spjob.go:82 |
| POST | `/api/v1/spjobs/training` | Protected | `Create` | 创建稀疏训练作业 | spjob/spjob.go:84 |
| POST | `/api/v1/spjobs/analyze` | Protected | `AnalyzeResourceUsage` | 资源用量分析/推荐 | spjob/spjob.go:86 |
| GET | `/api/v1/admin/spjobs` | Admin | `List` | 列表（管理员入口） | spjob/spjob.go:90 |
| GET | `/api/v1/admin/spjobs/:name/detail` | Admin | `GetByName` | 详情（管理员入口） | spjob/spjob.go:91 |

## 2.21 `gpu-analysis`（GpuAnalysisMgr，name=`gpu-analysis`）— 仅管理端

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/gpu-analysis` | Admin | `ListAnalyses` | GPU 利用率分析记录列表 | gpu_analysis.go:56 |
| PUT | `/api/v1/admin/gpu-analysis/:id/review` | Admin | `UpdateReviewStatus` | 审核分析结论 | gpu_analysis.go:57 |
| POST | `/api/v1/admin/gpu-analysis/:id/confirm-stop` | Admin | `ConfirmAndStopJob` | 确认并停止问题作业 | gpu_analysis.go:60 |
| POST | `/api/v1/admin/gpu-analysis/trigger/pod` | Admin | `TriggerPodAnalysis` | 对指定 Pod 触发分析（`{namespace,podName}` 必填） | gpu_analysis.go:62 |
| POST | `/api/v1/admin/gpu-analysis/trigger/job` | Admin | `TriggerJobAnalysis` | 对指定作业触发分析 | gpu_analysis.go:63 |
| POST | `/api/v1/admin/gpu-analysis/trigger/all-jobs` | Admin | `TriggerAllJobsAnalysis` | 对全部作业批量触发 | gpu_analysis.go:64 |

> Protected/Public 空实现。⚠️ 路由顺序风险：`PUT /:id/review` 与 `POST /trigger/pod` 前缀不同（PUT vs POST），无冲突。

## 2.22 `recommenddljob`（RecommendDLJobMgr，name=`recommenddljob`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/recommenddljob/analyze` | Protected | `AnalyzeResourceUsage` | 依据历史作业推荐资源配置 | recommenddljob.go:38 |

## 2.23 `operations`（OperationsMgr，name=`operations`）— 运维（仅管理端）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/operations/whitelist` | Admin | `GetWhiteList` | 运维白名单（不清理的作业/用户） | operations/operations.go:58 |
| PUT | `/api/v1/admin/operations/keep/:name` | Admin | `SetKeepWhenLowResourceUsage` | 设置某作业在低利用率时是否保留 | operations/operations.go:59 |
| GET | `/api/v1/admin/operations/cronjob` | Admin | `GetCronjobConfigs` | 全部巡检 cronjob 配置 | operations/operations.go:60 |
| PUT | `/api/v1/admin/operations/cronjob` | Admin | `UpdateCronjobConfig` | 更新单个 cronjob 配置（body=model.CronJobConfig） | operations/operations.go:61 |
| PUT | `/api/v1/admin/operations/add/locktime` | Admin | `AddLockTime` | 增加作业锁定时间 | operations/operations.go:62 |
| PUT | `/api/v1/admin/operations/clear/locktime` | Admin | `ClearLockTime` | 清除作业锁定时间 | operations/operations.go:63 |
| POST | `/api/v1/admin/operations/clean/clean-low-gpu-usage-job` | Admin | `HandleLowGPUUsageJobs` | 立即执行“低 GPU 利用率作业回收” | operations/operations.go:65 |
| POST | `/api/v1/admin/operations/clean/clean-long-running-job` | Admin | `HandleLongTimeRunningJobs` | 立即执行“超长运行作业处理” | operations/operations.go:66 |
| POST | `/api/v1/admin/operations/clean/clean-waiting-jupyter-job` | Admin | `HandleWaitingJupyterJobs` | 清理长期排队的 Jupyter 作业 | operations/operations.go:67 |
| POST | `/api/v1/admin/operations/clean/clean-waiting-custom-job` | Admin | `HandleWaitingCustomJobs` | 清理长期排队的自定义作业 | operations/operations.go:68 |
| POST | `/api/v1/admin/operations/cronjob/config/name` | Admin | `GetCronjobNames` | 可用 cronjob 名称列表 | operations/operations.go:69 |
| POST | `/api/v1/admin/operations/cronjob/config/status` | Admin | `GetCronjobConfigStatus` | 指定 cronjob 的状态 | operations/operations.go:70 |
| POST | `/api/v1/admin/operations/cronjob/record/time` | Admin | `GetCronjobRecordTimeRange` | 巡检记录时间范围 | operations/operations.go:71 |
| POST | `/api/v1/admin/operations/cronjob/record/list` | Admin | `GetCronjobRecords` | 巡检记录分页列表 | operations/operations.go:72 |
| POST | `/api/v1/admin/operations/cronjob/record/delete` | Admin | `DeleteCronjobRecords` | 删除巡检记录 | operations/operations.go:73 |

## 2.24 `operation-logs`（OperationLogMgr，name=`operation-logs`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/operation-logs` | Admin | `ListOperationLogs` | 操作审计日志列表 | operations/operation_log.go:39 |
| DELETE | `/api/v1/admin/operation-logs` | Admin | `ClearOperationLogs` | 清空操作审计日志 | operations/operation_log.go:40 |

## 2.25 `tensorboard`（TensorboardMgr，name=`tensorboard`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/tensorboard/auth` | Public | `AuthorizeIngress` | TensorBoard Ingress 侧鉴权（Cookie/token 校验，供 ingress 反代回调） | tensorboard/tensorboard.go:61 |
| POST | `/api/v1/tensorboard` | Protected | `UserCreate` | 为某作业创建 TensorBoard 面板 | tensorboard/tensorboard.go:65 |
| GET | `/api/v1/tensorboard` | Protected | `UserList` | 我的 TensorBoard 面板列表 | tensorboard/tensorboard.go:66 |
| GET | `/api/v1/tensorboard/source/:jobName` | Protected | `UserGetSourceConfig` | 取该作业可用的 TensorBoard 源配置 | tensorboard/tensorboard.go:67 |
| DELETE | `/api/v1/tensorboard/:id` | Protected | `UserDelete` | 删除我的面板 | tensorboard/tensorboard.go:68 |
| POST | `/api/v1/tensorboard/:id/access` | Protected | `UserCreateAccessSession` | 校验归属并下发短期访问 Cookie | tensorboard/tensorboard.go:69 |

> 无 Admin 路由（`tensorboard.go:63` 空实现）。

## 2.26 `namespaces`（APIServerMgr，name=`namespaces`）— Pod 级操作

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/namespaces/:namespace/pods/:name/events` | Protected | `GetPodEvents` | Pod 事件 | tool/podcontainer.go:115 |
| GET | `/api/v1/namespaces/:namespace/pods/:name/containers` | Protected | `GetPodContainers` | Pod 容器列表 | tool/podcontainer.go:117 |
| GET | `/api/v1/namespaces/:namespace/pods/:name/containers/:container/log` | Protected | `GetPodContainerLog` | 容器日志（一次性） | tool/podcontainer.go:118 |
| GET | `/api/v1/namespaces/:namespace/pods/:name/containers/:container/log/stream` | Protected | `StreamPodContainerLog` | 容器日志流式（SSE/流） | tool/podcontainer.go:119 |
| GET | `/api/v1/namespaces/:namespace/pods/:name/ingresses` | Protected | `GetPodIngresses` | Pod 关联的 Ingress | tool/podcontainer.go:122 |
| POST | `/api/v1/namespaces/:namespace/pods/:name/ingresses` | Protected | `CreatePodIngress` | 为 Pod 建 Ingress（暴露端口） | tool/podcontainer.go:123 |
| DELETE | `/api/v1/namespaces/:namespace/pods/:name/ingresses` | Protected | `DeletePodIngress` | 删除 Ingress | tool/podcontainer.go:124 |
| GET | `/api/v1/namespaces/:namespace/pods/:name/nodeports` | Protected | `GetPodNodeports` | Pod 关联的 NodePort Service | tool/podcontainer.go:127 |
| POST | `/api/v1/namespaces/:namespace/pods/:name/nodeports` | Protected | `CreatePodNodeport` | 建 NodePort Service | tool/podcontainer.go:128 |
| DELETE | `/api/v1/namespaces/:namespace/pods/:name/nodeports` | Protected | `DeletePodNodeport` | 删 NodePort Service | tool/podcontainer.go:129 |
| PUT | `/api/v1/admin/namespaces/:namespace/pods/:name/resources` | Admin | `UpdatePodResources` | 在线调整 Pod 资源 | tool/podcontainer.go:692 |
| PUT | `/api/v1/admin/namespaces/:namespace/pods/:name/containers/:container/resources` | Admin | `UpdatePodResources` | 在线调整单容器资源 | tool/podcontainer.go:693 |

## 2.27 `websocket`（WebsocketMgr，name=`websocket`）— 终端

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/websocket/namespaces/:namespace/pods/:name/containers/:container/terminal` | Protected | `GetPodContainerTerminal` | Pod 容器 Web Terminal（ws 升级，token 从 `?token=` 取） | tool/websocket.go:50 |

## 2.28 `cli`（CLICompatibilityMgr，name=`cli`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/cli/compatibility` | Public | `GetCompatibility` | 返回 CLI 兼容性信息（apiVersion/minSupportedCliApiVersion/appVersion…） | cli_compatibility.go:44 |

## 2.29 `metrics`（MetricsMgr，name=`metrics`）

| Method | 完整路径 | 档 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/metrics` | Public | `GetMetrics` | Prometheus 抓取端点（会先按 DB 统计 completed/running 作业数再输出） | metrics.go:28 |

> ⚠️ 该端点**免登录**，且每次抓取都全表 `Find()` 作业（`metrics.go:80`），MCP 侧不要高频调用。

## 2.30 空 manager / 无路由 manager 说明

以下 manager 存在但**某几档没有任何路由**（不是遗漏，是源码如此）：

| manager | Public | Protected | Admin | 说明 |
| --- | --- | --- | --- | --- |
| `auth` | 5 | 1 | 0 | 管理端无认证类路由 |
| `users` | 0 | 4 | 10 | — |
| `accounts` | 0 | 13 | 17 | — |
| `images` | 0 | 28 | 11 | — |
| `vcjobs` | 0 | 26 | 8 | — |
| `dataset` | 1 | 13 | 5 | — |
| `resources` | 0 | 4 | 11 | — |
| `nodes` | 0 | 5 | 11 | — |
| `statistics` | 0 | 1 | 0 | 集群维度靠 scope 参数 + 角色判定 |
| `system-config` | 0 | 2 | 16 | — |
| `approvalorder` | 0 | 6 | 4 | — |
| `model-download` | 0 | 8 | 2 | — |
| `queue-quotas` | 0 | **0** | 4 | 只有管理端 |
| `gpu-analysis` | 0 | **0** | 6 | 只有管理端 |
| `operations` | 0 | **0** | 15 | 只有管理端（`RegisterPublic`/`RegisterProtected` 为空函数体） |
| `operation-logs` | 0 | **0** | 2 | 只有管理端 |
| `context` | 0 | 7 | 0 | — |
| `jobtemplate` | 0 | 5 | 0 | — |
| `recommenddljob` | 0 | 1 | 0 | — |
| `aijobs` | 0 | 11 | 2 | — |
| `spjobs` | 0 | 9 | 2 | — |
| `tensorboard` | 1 | 5 | 0 | — |
| `namespaces` | 0 | 10 | 2 | — |
| `websocket` | 0 | 1 | 0 | — |
| `cli` | 1 | 0 | 0 | 只有 public |
| `metrics` | 1 | 0 | 0 | 只有 public |
| `storage`（StorageMgr） | 0 | 3 | 4 | — |
| `storage`（JWTTokenMgr） | 0 | 1 | 0 | 只有 public 之外的 verify |

**不存在**的 manager（需求清单里提到但源码中确实没有独立 manager）：`files`、`admin`、`prequeue`、`images/pip-apt` 路由、`users/:id` 资料更新路由（详见第 3 部分）。

## 2.31 独立进程 storage-server 的路由（`backend/internal/storage/router.go`）

> 这是**另一个进程**（`storage-server.Dockerfile` / `cmd/`），与上表 `/api/v1/*` 不是同一套 gin 实例；它自带 JWT 校验（`CheckJWTToken`，`internal/storage/file.go:65-78`）。

| Method | 完整路径 | 鉴权 | handler | 作用 | 源文件:行号 |
| --- | --- | --- | --- | --- | --- |
| GET | `/internal/storage/capabilities` | 内部 token | `GetQuotaCapabilities` | 存储配额能力 | internal/storage/quota.go:25 |
| GET | `/internal/storage/usage` | 内部 token | `GetDirectoryUsage` | 目录用量 | quota.go:26 |
| GET | `/internal/storage/quota` | 内部 token | `GetDirectoryQuota` | 目录配额 | quota.go:27 |
| PUT | `/internal/storage/quota` | 内部 token | `SetDirectoryQuota` | 设目录配额 | quota.go:28 |
| PUT/PROPFIND/PROPPATCH | `/api/ss`、`/api/ss/*path` | JWT + 空间权限 | `WebDav` | WebDAV 读写（前端“文件管理器”底层） | router.go:15-16 |
| MKCOL | `/api/ss`、`/api/ss/*path` | JWT + 空间权限 | `CreateDirectory` | 建目录 | router.go:18-19 |
| OPTIONS | `/api/ss`、`/api/ss/*path` | 无 | gin 默认 | 预检 | file.go:867-868 |
| GET | `/api/ss/files`、`/api/ss/files/*path` | JWT | `GetFiles` | 列目录（只读视图） | file.go:869-870 |
| GET | `/api/ss/rwfiles`、`/api/ss/rwfiles/*path` | JWT | `GetFilesWithRWAcc` | 列目录（含读写权限标记） | file.go:871-872 |
| GET | `/api/ss/admin/files`、`/api/ss/admin/files/*path` | JWT(admin) | `GetAllFiles` | 管理员全量列目录 | file.go:873-874 |
| GET | `/api/ss/download/*path` | JWT | `Download` | 下载文件 | file.go:875 |
| POST | `/api/ss/upload/*path` | JWT | `UploadFile` | 上传文件 | file.go:876 |
| DELETE | `/api/ss/delete/*path` | JWT | `DeleteFile` | 删除文件 | file.go:877 |
| DELETE | `/api/ss/files`、`/api/ss/files/*path` | JWT | `RemoveFile` | 删除文件（WebDAV 风格入口） | router.go:24-25 |
| GET | `/api/ss/userspace` | JWT | `GetUserSpace` | 我的用户空间路径 | file.go:878 |
| GET | `/api/ss/queuespace` | JWT | `GetAccountSpace` | 当前账号空间路径 | file.go:879 |
| GET | `/api/ss/dataset/:id`、`/api/ss/dataset/:id/*path` | JWT | `GetDatasetFiles` | 数据集目录浏览 | file.go:880-881 |
| POST | `/api/ss/move/*path` | JWT | `MoveFile` | 移动/重命名 | internal/storage/dataset.go:327 |
| POST | `/api/ss/datasets/:id/move` | JWT | `MoveDatasetOrModel` | 数据集/模型整体移动 | dataset.go:328 |
| POST | `/api/ss/datasets/restore` | JWT | `RestoreDatasetOrModel` | 恢复数据集/模型 | dataset.go:329 |

**空间（space）语义（`internal/storage/file.go:99-130, 88-96`）**：
逻辑根目录由 `config.Storage.Prefix.{user,account,public}` 三段前缀 + 实体 `Space` 字段拼成；用户在 URL `*path` 里直接使用逻辑路径。权限由 token 推导：平台 admin → `ReadWrite`；`AccountID==0`（未选账号）→ 用 `PublicAccessMode`；否则用 `AccountAccessMode`（RO 时禁止 `PROPPATCH/MKCOL/PUT/DELETE`，`file.go:195-199`）。

---

# 第 3 部分：关键写接口的请求/响应结构

> 所有 body 均按 `c.ShouldBindJSON`（个别用 `ShouldBind`，见注）绑定；`binding:"required"` 为 gin/validator 的**必填**标记。gin 默认 `validator` 对 **零值** 判空：字符串 `""`、数字 `0`、bool `false`、指针 `nil` 都算缺失（指针类型可用来表达“显式传 false/0”）。
> 统一响应外壳：`resputil.Response[T]`（含 code/message/data 语义），分页用 `resputil.Page[T]`。

## 3.1 登录 / 注册

### `POST /api/auth/login`（`auth.go:73-85`）

```go
LoginReq struct {
	AuthMethod AuthMethod `json:"auth" binding:"required"` // [normal, ldap]；后续还有 "token"(legacy ACT)
	Username   *string    `json:"username"`                // ldap / normal 必传（业务层校验，非 binding）
	Password   *string    `json:"password"`                // ldap / normal 必传（业务层校验）
	Token      *string    `json:"token"`                   // Legacy ACT API token（deprecated）
}
```

```go
LoginResp struct {
	AccessToken  string              `json:"accessToken"`
	RefreshToken string              `json:"refreshToken"`
	Context      AccountContext      `json:"context"`
	User         model.UserAttribute `json:"user"`
}

AccountContext struct {
	Queue        string           `json:"queue"`        // Current Queue Name（现=Account name）
	RoleQueue    model.Role       `json:"roleQueue"`    // 账号内角色
	RolePlatform model.Role       `json:"rolePlatform"` // 平台角色
	AccessQueue  model.AccessMode `json:"accessQueue"`  // 账号内访问模式
	AccessPublic model.AccessMode `json:"accessPublic"` // 平台公共访问模式
	Space        string           `json:"space"`        // 用户 PVC 子路径
}
```

- **必填**：`auth`。`username`/`password` 在 `auth=normal|ldap` 时由业务逻辑校验（缺失返回 400）。
- 认证方式枚举：`AuthMethodNormal="normal"`、`AuthMethodLDAP="ldap"`（`auth.go:143-148`）；是否开放由 `GET /api/auth/mode` 决定。
- token 载荷见 1.5；access/refresh 同一 secret，仅 TTL 不同。

### `POST /api/auth/signup`（`auth.go:975-979`）

```go
SignupReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}
```

- 行为：检查 `config.Auth.Normal.AllowRegister`，关闭则 **403**；用户名已存在则 **409**；成功后创建用户（默认角色 guest/user 由 `createUser` 决定）。
- 响应：无固定结构体，`resputil.Success`（⚠️ 不返回 token，需再调 login）。

### `POST /api/auth/refresh`（`auth.go:1085-1092`）

```go
// auth.go:1085-1092
RefreshReq struct {
	RefreshToken string `json:"refreshToken" binding:"required"` // 不需要添加 `Bearer ` 前缀
}
RefreshResp struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
}
```

> 已核对：字段名确为 `refreshToken`，且**不要**加 `Bearer ` 前缀（`auth.go:1086` 注释原文）。

### `POST /api/v1/auth/switch`（`auth.go:1133-1135`）

```go
SwitchQueueReq struct {
	Queue string `json:"queue" binding:"required"` // 目标账号名
}
```

- 校验：账号存在 + 当前用户在该账号内有 `user_account` 记录（`auth.go:1167-1175`），失败返回 "Queue not found"。
- 响应：`LoginResp`（新 token + 新 context）。

### `GET /api/auth/check`（`auth.go:87-107`）

```go
CheckResp struct {
	Context AccountContext      `json:"context"`
	User    model.UserAttribute `json:"user"`
	Version VersionInfo         `json:"version"`
}
VersionInfo struct {
	AppVersion string `json:"appVersion"`; CommitSHA string `json:"commitSHA"`
	BuildType  string `json:"buildType"`; BuildTime  string `json:"buildTime"`
}
```

## 3.2 用户信息完善 / 邮箱（**注意：没有 `PUT /api/v1/users/:id`**）

源码中**不存在** `PUT /api/v1/users/:id` 这类“改自己资料”的路由。用户资料更新实际有两条路：

### (a) 用户自助：`PUT /api/v1/context/attributes`（`context.go:354-383`）

请求体直接是 `model.UserAttribute`（`dao/model/user.go:27-44`）：

```go
model.UserAttribute struct {
	ID       uint    `json:"id,omitempty"`        // ID
	Name     string  `json:"name,omitempty"`      // 账号（登录名）
	Nickname string  `json:"nickname,omitempty"`  // 昵称，未指定时与账号相同
	Email    *string `json:"email,omitempty"`     // 邮箱
	Teacher  *string `json:"teacher,omitempty"`   // 老师
	Group    *string `json:"group,omitempty"`     // 课题组
	ExpiredAt *string `json:"expiredAt,omitempty"`// 过期时间
	Phone    *string `json:"phone,omitempty"`     // 电话
	Avatar   *string `json:"avatar,omitempty"`    // 头像
	UID      *string `json:"uid,omitempty"`       // 文件系统 UID
	GID      *string `json:"gid,omitempty"`       // 文件系统 GID
}
```

- 必填：**无 binding 标记**（整体覆盖写）。
- 安全点：`ID/UID/GID` 会被**强制回填为旧值**（`context.go:371-374`），用户改不了。
- 响应：`resputil.Success("User attributes updated successfully")`。

### (b) 管理员改他人：`PUT /api/v1/admin/users/:name/attributes`（`user.go:476-506`）

- 路径参数：`:name` = 用户名（`UserNameReq{ Name string \`uri:"name" binding:"required"\` }`）。
- Body：同上 `model.UserAttribute`；此外会同步 `user.Nickname = attributes.Nickname`（`user.go:498`）。
- 必填：无。

### 邮箱更新与验证（`context.go:69-75`）

```go
SendCodeReq struct {  // POST /api/v1/context/email/code
	Email string `json:"email"`   // 无 binding，但业务必须非空（否则验证码键为 ""）
}
CheckCodeReq struct { // POST /api/v1/context/email/update
	Email string `json:"email"`
	Code  string `json:"code"`
}
```

- 流程：`email/code` 发 6 位码 → 内存缓存 `verifyCodeCache[email]=code`（`context.go:29, 412-413`，**进程内 map，多副本不共享**）→ `email/update` 比对成功后写 `user.last_email_verified_at`。
- **不会**把 `Email` 写回 `attributes`（只写验证时间戳），email 字段的真实写入仍需 `PUT /api/v1/context/attributes`。
- 查询是否已验证：`GET /api/v1/users/email/verified`。
- 是否封禁：`GET /api/v1/users/ban`。

### 管理员封禁：`PUT /api/v1/admin/users/:name/ban`（`user_ban.go:17-25`）

```go
UpdateUserBanReq struct {
	Banned          *bool                     `json:"banned" binding:"required"` // 必填；true=封，false=解
	IsPermanent     bool                      `json:"isPermanent"`              // 永久封禁
	Days            int                       `json:"days"`
	Hours           int                       `json:"hours"`
	Minutes         int                       `json:"minutes"`
	BanRestrictions model.UserBanRestrictions `json:"banRestrictions"`          // 逐项能力限制
	Reason          string                    `json:"reason" binding:"max=500"`
}
model.UserBanRestrictions struct {
	PlatformAccess  bool `json:"platformAccess"`   // 禁止登录平台
	JobSubmission   bool `json:"jobSubmission"`    // 禁止提交作业
	ImageBuild      bool `json:"imageBuild"`       // 禁止构建镜像
	ModelDownload   bool `json:"modelDownload"`    // 禁止下载模型
	DatasetDownload bool `json:"datasetDownload"`  // 禁止下载数据集
}
```

### 管理员改角色：`PUT /api/v1/admin/users/:name/role`

```go
UpdateRoleReq struct { Role model.Role `json:"role" binding:"required"` } // 1=guest 2=user 3=admin
```

### 管理员调余额：`POST /api/v1/admin/users/:name/billing/extra-balance`

```go
AdjustUserExtraBalanceReq struct {
	Delta  service.BillingAmountInput `json:"delta" binding:"required"` // 可正可负；内部为定点数输入
	Reason string                     `json:"reason"`
}
AdjustUserExtraBalanceResp struct {
	UserID uint; Username string; BeforeBalance float64; Delta float64; AfterBalance float64  // json: userId/username/beforeBalance/delta/afterBalance
}
```

## 3.3 作业创建（`/api/v1/vcjobs/*`）与作业操作

### 公共字段 `CreateJobCommon`（`vcjob/vcjob.go:226-236`，内联进所有 Create 请求体）

```go
CreateJobCommon struct {
	Name              string                       `json:"name" binding:"required"`   // 必填：展示名（中文可）
	VolumeMounts      []util.VolumeMount           `json:"volumeMounts,omitempty"`    // 存储挂载
	DatasetMounts     []DatasetMount               `json:"datasetMounts,omitempty"`   // 数据集挂载
	Envs              []v1.EnvVar                  `json:"envs,omitempty"`            // 环境变量
	Selectors         []v1.NodeSelectorRequirement `json:"selectors,omitempty"`       // 节点选择约束
	Template          string                       `json:"template"`                  // 模板名（来源 jobtemplate）
	AlertEnabled      bool                         `json:"alertEnabled"`              // 完成后邮件通知（需邮箱已验证）
	CpuPinningEnabled bool                         `json:"cpuPinningEnabled"`         // CPU 绑核
	Forwards          []Forward                    `json:"forwards,omitempty"`        // ingress/nodeport 转发
}
DatasetMount struct {
	DatasetID uint   `json:"datasetID"`
	MountPath string `json:"mountPath"`
}
ImageBaseInfo struct {           // vcjob/util.go:99-102
	ImageLink string   `json:"imageLink"`
	Archs     []string `json:"archs"`
}
```

`Forward` 为 `vcjobservice.Forward` 的别名（`vcjob.go:181`，字段见 `internal/service/vcjob`）。

### `POST /api/v1/vcjobs/jupyter`（`vcjob/jupyter.go:33-37`）

```go
CreateJupyterReq struct {
	CreateJobCommon `json:",inline"`
	Resource        v1.ResourceList `json:"resource"`            // cpu/memory/nvidia.com/gpu 等 k8s 数量字符串
	Image           ImageBaseInfo   `json:"image" binding:"required"` // 必填
}
```

- 必填：`name` + `image`（`image.imageLink` 需有效）。
- 固定端口 8888（`JupyterPort`），生成 `jpt-<user>-xxxx` 作业名；调 `preCheckCreateJob(..., requireInteractiveLimit=true)`（**交互作业有额外并发上限**）。
- 响应：`resputil.Success`（⚠️ 无固定 DTO，只返回消息/ok）。

### `POST /api/v1/vcjobs/webide`（`vcjob/webide.go:43`）

请求体**同 `CreateJupyterReq`**（`webide.go:43: var req CreateJupyterReq`）。区别：镜像/启动命令按 WebIDE 处理，凭据用 `GET /api/v1/vcjobs/:name/secret` 取。

### `POST /api/v1/vcjobs/training`（custom，`vcjob/custom.go:22-29`）

```go
CreateCustomReq struct {
	CreateJobCommon `json:",inline"`
	Resource        v1.ResourceList `json:"resource"`
	Image           ImageBaseInfo   `json:"image" binding:"required"`  // 必填
	Shell           *string         `json:"shell"`                     // 如 "bash"
	Command         *string         `json:"command"`                   // 启动命令
	WorkingDir      string          `json:"workingDir" binding:"required"` // 必填
}
```

### `POST /api/v1/vcjobs/tensorflow`（`vcjob/tensorflow.go:20-41`）

```go
CreateTensorflowReq struct {
	CreateJobCommon `json:",inline"`
	Tasks           []TaskReq `json:"tasks"`   // 多 role（ps/worker…）
}
TaskReq struct {
	Name       string          `json:"name"`
	Replicas   int32           `json:"replicas"`
	Resource   v1.ResourceList `json:"resource"`
	Image      ImageBaseInfo   `json:"image"`
	Shell      *string         `json:"shell"`
	Command    *string         `json:"command"`
	WorkingDir *string         `json:"workingDir"`
	Ports      []PortReq       `json:"ports"`
}
PortReq struct { Name string `json:"name"`; Port int32 `json:"port"` }
```

### `POST /api/v1/vcjobs/pytorch`（`vcjob/pytorch.go:24`）

请求体**复用 `CreateTensorflowReq`**（`var req CreateTensorflowReq`）。即 pytorch 与 tensorflow 的 body 结构完全一致，仅任务类型/启动命令不同。

**创建作业的公共副作用（所有 Create 共用，写 MCP 时要注意）**
1. `util.CheckStorageQuota(token.Username, req.VolumeMounts, ...)` → 存储配额不足直接失败；
2. `preCheckCreateJob`：封禁能力 `JobSubmission` → 计费余额校验 `OnJobCreateCheck(userID, accountID)` → 交互作业并发限制（jupyter/webide） → 资源限额检查（`CheckResourcesBeforeCreateJob`）；
3. `vcqueue.EnsureAccountQueueExists` / `EnsureUserQueueExists`（自动建 Volcano queue）；
4. `req.AlertEnabled && !CheckUserEmail` → `resputil.UserEmailNotVerified`；
5. 作业名由服务端生成（`utils.GenerateJobName("jpt|sg|tf|pt|wbi", username)`），**不接受客户端指定 k8s 名**。

### 作业列表 / 详情 / 日志 / 删除 / secret / token / ssh

| 接口 | 请求 | 响应结构（源） |
| --- | --- | --- |
| `GET /api/v1/vcjobs`（列表） | query：`days`(默认-1=全部)、`page`、`page_size`(1-200)、`sort`、`search`、`job_type`(多值)、`status`(多值)、`node` | `resputil.Page[JobResp]`（`vcjob/vcjob.go:517-536`） |
| `GET /api/v1/vcjobs/:name/detail` | 路径 `:name`=`jobName`（k8s 名） | `JobDetailResp`（`vcjob.go:877-905`，含 pods/resources/status） |
| `GET /api/v1/vcjobs/:name/yaml` | — | YAML 文本 |
| `GET /api/v1/vcjobs/:name/pods` | — | `[]PodDetail`（`vcjob.go:918-926`：name/namespace/nodename/ip/port/resource/phase） |
| `GET /api/v1/vcjobs/:name/event` | — | 事件列表 |
| `GET /api/v1/vcjobs/:name/template` | — | 可复用的提交模板（结构同 Create*Req 的公共部分）⚠️待确认返回具体字段 |
| **日志** | ⚠️ **vcjobs 下没有独立 `/logs` 路由**；容器日志走 `GET /api/v1/namespaces/:ns/pods/:name/containers/:c/log`（一次性）或 `.../log/stream`（流式） | `GetJobLogResp{ Logs map[string]string \`json:"logs"\` }`（`vcjob.go:512-514`）是 vcjob 内部用的日志聚合类型 |
| `DELETE /api/v1/vcjobs/:name` | — | 成功/失败消息；非 admin 只能删自己的（`getJob` 过滤） |
| `GET /api/v1/vcjobs/:name/secret` | — | WebIDE 凭据（⚠️ 见 handler 返回结构） |
| `GET /api/v1/vcjobs/:name/token` | — | `JupyterTokenResp{baseURL,token,podName,namespace,fullURL}`（`vcjob.go:165-171`） |
| `POST /api/v1/vcjobs/:name/ssh` | 路径 `:name`；body 无（`JobActionReq` 只用 uri） | `SSHResp{ open bool, data SSHPortData }`（`vcjob.go:913-916`，`SSHPortData` 含 ip/port） |
| `PUT /api/v1/vcjobs/:name/alert` | 路径 `:name` | 开关结果消息 |
| `POST /api/v1/vcjobs/:name/snapshot` | 路径 `:name` + body（⚠️待确认具体字段名，见 `CreateSnapshot` 实现） | 快照/打包结果 |
| `GET /api/v1/vcjobs/:name/billing` | — | `JobBillingResp{jobName,name,billedPointsTotal}`（`vcjob.go:538-542`） |

```go
JobResp struct {                     // vcjob/vcjob.go:517-536
	Name                    string          `json:"name"`
	JobName                 string          `json:"jobName"`      // k8s 作业名（后续所有 :name 用它）
	Owner                   string          `json:"owner"`
	UserInfo                model.UserInfo  `json:"userInfo"`
	JobType                 string          `json:"jobType"`      // jupyter/webide/pytorch/tensorflow/custom
	WaitingToleranceSeconds *int64          `json:"waitingToleranceSeconds,omitempty"`
	Queue                   string          `json:"queue"`        // 展示为账号昵称
	Status                  string          `json:"status"`
	PodGroupPhase           string          `json:"podGroupPhase,omitempty"`
	CreationTimestamp       metav1.Time     `json:"createdAt"`
	RunningTimestamp        metav1.Time     `json:"startedAt"`
	CompletedTimestamp      metav1.Time     `json:"completedAt"`
	Nodes                   []string        `json:"nodes"`
	Resources               v1.ResourceList `json:"resources"`
	Locked                  bool            `json:"locked"`
	PermanentLocked         bool            `json:"permanentLocked"`
	LockedTimestamp         metav1.Time     `json:"lockedTimestamp"`
	BilledPointsTotal       float64         `json:"billedPointsTotal"`
}
```

## 3.4 镜像（`/api/v1/images/*`，`image/types.go`）

```go
// POST /api/v1/images/kaniko —— pip/apt 合并构建（无独立 pip-apt 路由）
CreateKanikoRequest struct {
	SourceImage        string   `json:"image"`        // 源镜像
	PythonRequirements string   `json:"requirements"` // pip requirements 文本
	APTPackages        string   `json:"packages"`     // apt 包（空格分隔）
	Description        string   `json:"description"`
	ImageName          string   `json:"name"`         // 目标镜像名
	ImageTag           string   `json:"tag"`          // 目标 tag
	Tags               []string `json:"tags"`
	Template           string   `json:"template"`
	Archs              []string `json:"archs"`
}

// POST /api/v1/images/dockerfile
CreateByDockerfileRequest struct {
	Description  string             `json:"description"`
	Dockerfile   string             `json:"dockerfile"`
	ImageName    string             `json:"name"`
	ImageTag     string             `json:"tag"`
	Tags         []string           `json:"tags"`
	Template     string             `json:"template"`
	Archs        []string           `json:"archs"`
	VolumeMounts []util.VolumeMount `json:"volumeMounts,omitempty"`
}

// POST /api/v1/images/envd
CreateByEnvdRequest struct {
	Description string            `json:"description"`
	Envd        string            `json:"envd"`       // envd 构建脚本/配置
	ImageName   string            `json:"name"`
	ImageTag    string            `json:"tag"`
	Python      string            `json:"python"`
	Base        string            `json:"base"`       // 基础镜像
	Tags        []string          `json:"tags"`
	Template    string            `json:"template"`
	BuildSource model.BuildSource `json:"buildSource"`
	Archs       []string          `json:"archs"`
}

// POST /api/v1/images/image —— 登记已有镜像链接
UploadImageRequest struct {
	ImageLink   string        `json:"imageLink"`
	TaskType    model.JobType `json:"taskType"`    // jupyter/webide/training…
	Description string        `json:"description"`
	Tags        []string      `json:"tags"`
	Archs       []string      `json:"archs"`
}
```

> **必填性**：上面三个构建请求体在源码中**都没有 `binding:"required"`**（`image/types.go:11-53`），即由后续业务逻辑校验（空 `image`/`name` 会在构建阶段失败）。MCP 侧建议自行强制 `image`、`name`、`tag`。

其余镜像接口的入参与出参（全部在 `image/types.go`）：

| 接口 | 请求 | 关键字段 |
| --- | --- | --- |
| `GET /api/v1/images/image` | 无 | 响应 `ListImageResponse{ imageList: []*ImageInfo }`（`types.go:156-158, 237-250`） |
| `GET /api/v1/images/kaniko` | 无 | 响应 `ListKanikoResponse{ kanikoList: []KanikoInfo }` |
| `GET /api/v1/images/available` | query `type`（JobType，**required**） | `ListAvailableImageResponse{ images []*ImageInfo }` |
| `GET /api/v1/images/getbyname` | query `name`（required） | `GetKanikoResponse`（含 dockerfile/podName/status…） |
| `GET /api/v1/images/podname` | query `id`（required） | `GetKanikoPodResponse{name,namespace,nodeName}` |
| `POST /api/v1/images/quota` | `UpdateProjectQuotaRequest{ size int64 \`json:"size" binding:"required"\` }` | — |
| `GET /api/v1/images/quota` | 无 | `GetProjectDetailResponse{used,quota,project,total}` |
| `POST /api/v1/images/credential` | 无 | `GetProjectCredentialResponse{name,password}`（Harbor 账号） |
| `POST /api/v1/images/valid` | `CheckLinkValidityRequest{ linkPairs []ImageInfoLinkPair }` | `CheckLinkValidityResponse{linkPairs}` |
| `POST /api/v1/images/description` | `ChangeImageDescriptionRequest{ id uint; description string }` | ⚠️ 无 binding，业务层按 owner 校验 |
| `POST /api/v1/images/deleteimage` | `DeleteImageByIDListRequest{ idList []uint \`binding:"required"\` }` | 逐个 `requireImageOwner` |
| `POST /api/v1/images/type` | `ChangeImageTaskTypeRequest{ id uint; taskType model.JobType }` | 同上 |
| `POST /api/v1/images/tags` | `ChangeImageTagsRequest{ id uint; tags []string }` | 同上 |
| `POST /api/v1/images/arch` | `UpdateImageArchRequest{ id uint \`required\`; archs []string \`required\` }` | 同上 |
| `POST/DELETE /api/v1/images/share` | `ShareImageRequest{ idList []uint; imageID uint; type string }` / `CancelShareImageRequest{ id, imageID, type }` | `type=user|account` |
| `GET /api/v1/images/share` | query `imageID`（required） | `ImageGrantResponse{userList,accountList}` |
| `GET /api/v1/images/user` | query `imageID`(required) + `name` | `SearchUserResponse` |
| `GET /api/v1/images/account` | query `imageID`（required） | 账号列表 |
| `DELETE /api/v1/images/image/:id` | 路径 `:id` | 仅 owner |
| `POST /api/v1/images/remove` | `CancelKanikoByIDRequest{ id uint \`required\` }` | 删除构建记录 |
| `GET /api/v1/images/cudabaseimage` | 无 | `CudaBaseImagesResponse{cudaBaseImages}` |
| `POST/DELETE /admin/images/cudabaseimage...` | `CudaBaseImageCreateRequest{imageLabel,label,value 全 required}` / 路径 `:id` | — |
| `POST /admin/images/change/:id` | 路径 `:id` | 切换公开状态 |

## 3.5 文件管理（**分两套，都不在 `/api/v1/files`**）

### (a) 主后端只做配额/能力（`/api/v1/storage`，见 2.7/2.8）

- `GET /api/v1/storage/capabilities` → `StorageCapabilitySummary{quota_enabled,usage_readable,quota_readable}`
- `GET /api/v1/storage/my-quota` → 用量/配额
- `GET /api/v1/storage/dirsize/*path` → 目录体积
- 管理员：`PUT /api/v1/admin/storage/user-spaces/:user/quota`，body `SetUserSpaceQuotaRequest{ Quota int64 \`json:"quota" binding:"required"\` }`
- `GET /api/v1/storage/verify` → `TokenReq{ userId uint, rootPath string, permission FilePermission }`（`FilePermission`: `1=NotAllowed 2=ReadOnly 3=ReadWrite`）

### (b) 真正的文件读写 = 独立进程 storage-server（`/api/ss/*`，见 2.31）

| 操作 | 接口 | 说明 |
| --- | --- | --- |
| 列目录 | `GET /api/ss/files/*path`、`GET /api/ss/rwfiles/*path` | 返回 `[]Files{name,size,isdir,modifytime,sys}`（`internal/storage/file.go:41-47`） |
| 上传 | `POST /api/ss/upload/*path` | multipart 或 raw body（⚠️待确认前端用法，见 `upload.go`） |
| 下载 | `GET /api/ss/download/*path` | 直接返回文件流 |
| 删除 | `DELETE /api/ss/delete/*path`、`DELETE /api/ss/files/*path` | — |
| 重命名/移动 | `POST /api/ss/move/*path`、`POST /api/ss/datasets/:id/move` | — |
| 建目录 | `MKCOL /api/ss/*path` | WebDAV 语义 |
| 写文件 | `PUT /api/ss/*path` | WebDAV PUT |
| 空间根 | `GET /api/ss/userspace`、`GET /api/ss/queuespace` | 返回我的用户空间/当前账号空间路径 |

**路径里的“空间”语义（关键）**：`*path` 的第一段就是逻辑空间，由 `config.Storage.Prefix` 决定，共三类：`user/<space>`（个人）、`account/<space>`（账号共享）、`public`（公共）。权限矩阵见 1.6 与 `file.go:88-96, 99-130`。**没有 `?space=public|user|account` 这类 query 参数**——空间是路径前缀，不是查询参数。

## 3.6 管理端请求体

### 账号（`/api/v1/admin/accounts`，`account.go`）

```go
// POST /api/v1/admin/accounts，PUT /api/v1/admin/accounts/:aid 共用
AccountCreateOrUpdateReq struct {
	Nickname string `json:"name" binding:"required"`   // ⚠️ json 名是 name（展示名），不是 nickname
	Quota    struct {
		Guaranteed v1.ResourceList `json:"guaranteed"`
		Deserved   v1.ResourceList `json:"deserved"`
		Capability v1.ResourceList `json:"capability"`
	} `json:"quota"`
	WithoutVolcano bool      `json:"withoutVolcano"`
	Admins         []uint    `json:"admins"`        // 账号管理员 userID 列表
	ExpiredAt      time.Time `json:"ExpiredAt"`     // ⚠️ 大写 E
}
AccountBillingConfigUpdateReq struct {
	IssueAmount        *service.BillingAmountInput `json:"issueAmount"`
	IssuePeriodMinutes *int                        `json:"issuePeriodMinutes" binding:"omitempty,gte=0"`
}
UpdateUserProjectReq struct {            // 成员关系更新（PUT .../users/:uid）
	AccessMode string          `json:"accessmode" binding:"required"` // "ro"/"rw" 等
	Role       string          `json:"role" binding:"required"`       // "user"/"admin"
	Quota      v1.ResourceList `json:"quota"`
}
UserProjectReq struct { QueueID uint `uri:"aid" binding:"required"`; UserID uint `uri:"uid" binding:"required"` }
ListAllReq struct {                      // GET /api/v1/admin/accounts 的 query
	PageIndex *int  `form:"pageIndex" binding:"required"`; PageSize *int `form:"pageSize" binding:"required"`
	NameLike  *string `form:"nameLike"`; OrderCol *string `form:"orderCol"`; Order *payload.Order `form:"order"`
}
```

### 资源（`/api/v1/admin/resources`）

```go
UpdateResourceReq struct {
	Label *string                   `json:"label" binding:"omitempty"`
	Type  *model.CraterResourceType `json:"type" binding:"omitempty"`
}
UpdateResourceUnitPriceReq struct { UnitPrice service.BillingAmountInput `json:"unitPrice"` }
// POST /sync、POST /:id/networks、POST /:id/vgpu 等：body 为空或复用 UpdateResourceReq，⚠️待确认具体字段
```

### 节点（`/api/v1/admin/nodes`）

```go
NodeLabel      struct { Key string `json:"key"`; Value string `json:"value"` }
NodeAnnotation struct { Key string `json:"key"`; Value string `json:"value"` }
NodeTaint      struct { Key string `json:"key"`; Value string `json:"value"`; Effect string `json:"effect"`; Reason string `json:"reason"` }
NodeScheduleRequest struct { Reason string `json:"reason"` }  // PUT /api/v1/nodes/:name（禁止调度）
NodeMark       struct { Labels []NodeLabel; Annotations []NodeAnnotation; Taints []NodeTaint } // GET /mark 响应
NodePodRequest struct { Name string `uri:"name" binding:"required"` }
```

### 系统配置（`/api/v1/admin/system-config`，`system_config.go:79-194`）

```go
UpdateLLMConfigReq struct {
	BaseURL   string `json:"baseUrl" binding:"required"`
	APIKey    string `json:"apiKey"`
	ModelName string `json:"modelName" binding:"required"`
	Validate  bool   `json:"validate"`      // 立即校验连通性
}
SetGpuAnalysisStatusReq struct { Enable bool `json:"enable"` }
UpdateSchedulerExtenderConfigReq struct {
	SchedulerExtenderEnabled   *bool  `json:"schedulerExtenderEnabled" binding:"required"`
	QueueQuotaEnabled          *bool  `json:"queueQuotaEnabled" binding:"required"`
	JobWaitingToleranceSeconds *int64 `json:"jobWaitingToleranceSeconds" binding:"required,gt=0"`
}
UpdateModelDownloadLimitConfigReq struct {
	Enabled                *bool  `json:"enabled" binding:"required"`
	MaxConcurrent          *int64 `json:"maxConcurrent" binding:"required,gt=0"`
	WindowHours            *int64 `json:"windowHours" binding:"required,gt=0"`
	MaxSuccessfulDownloads *int64 `json:"maxSuccessfulDownloads" binding:"required,gt=0"`
	WhitelistUserIDs       []uint `json:"whitelistUserIds"`
}
UpdatePodBandwidthConfigReq struct {
	Enabled                *bool  `json:"enabled" binding:"required"`
	ModelDownloadBandwidth string `json:"modelDownloadBandwidth" binding:"required"`
	JobIngressBandwidth    string `json:"jobIngressBandwidth" binding:"required"`
	JobEgressBandwidth     string `json:"jobEgressBandwidth" binding:"required"`
}
SetBillingStatusReq struct {   // 全部字段都是指针：只改传了的
	FeatureEnabled *bool; Active *bool; RunningSettlementEnabled *bool
	RunningSettlementIntervalMinutes *int; JobFreeMinutes *int
	DefaultIssueAmount *service.BillingAmountInput; DefaultIssuePeriodMinutes *int
	AccountIssueAmountOverrideEnabled *bool; AccountIssuePeriodOverrideEnabled *bool   // json 名同字段首字母小写
}
GrantAllUsersExtraBalanceReq struct {
	Delta  service.BillingAmountInput `json:"delta" binding:"required"`
	Reason string                     `json:"reason"`
}
```

- 响应：`BillingStatusResp`（`system_config.go:152-164`）、`ModelDownloadLimitConfigResp`、`AdminModelDownloadLimitConfigResp`、`PodBandwidthConfigResp`、`SchedulerExtenderConfigResp`、`GpuAnalysisStatusResp{enabled}`、`ResetAllBillingBalancesResp`、`GrantAllUsersExtraBalanceResp`。
- **没有 `prequeue` 相关端点**（详见 2.13 注释）。

### 队列配额（`/api/v1/admin/queue-quotas`）

```go
QueueQuotaReq struct {
	Name  string            `json:"name"`   // ⚠️ 无 binding
	Quota map[string]string `json:"quota"`  // 资源名→数量字符串
}
QueueQuotaIDReq struct { ID uint `uri:"id" binding:"required"` }
QueueQuotaResp  struct { Quotas []QueueQuotaConfigItemResp `json:"quotas"` }
```

### 运维（`/api/v1/admin/operations/*`）

- `PUT /cronjob`：body = `model.CronJobConfig`（`{name,type,spec,status,config}`；`config` 会被 marshal 成 JSON 字符串存库，`operations/cronjob.go:31-90`）。
- `PUT /keep/:name`、`PUT /add|clear/locktime`、`POST /clean/*`、`POST /cronjob/*`：⚠️ body 字段未在路由层固定，见各 handler 的 `ShouldBindJSON` 目标（`operations/clean.go`/`lock.go`）。
- `GET /whitelist` → 白名单。

### 审批工单（`/api/v1/approvalorder`、`/api/v1/admin/approvalorder`）

```go
ApprovalOrderreq struct {           // POST /api/v1/approvalorder
	Name           string                    `json:"name" binding:"required"`
	Type           model.ApprovalOrderType   `json:"type" binding:"required"`
	Status         model.ApprovalOrderStatus `json:"status"`
	TypeID         uint                      `json:"approvalorderTypeID"`         // 关联数据集/任务 ID
	Reason         string                    `json:"approvalOrderReason"`
	ExtensionHours uint                      `json:"approvalOrderExtensionHours"` // 延长小时数
}
UpdateApprovalOrder struct {        // PUT /api/v1/approvalorder/:id
	ApprovalOrderreq           // 同名同 tag 全量 + 下面两个
	ReviewerID  uint   `json:"reviewerID"`
	ReviewNotes string `json:"reviewNotes"`
}
ReviewApprovalOrderReq struct {     // PUT /api/v1/admin/approvalorder/:id/review
	Status      model.ApprovalOrderStatus `json:"status" binding:"required"`
	ReviewNotes string                    `json:"reviewNotes"`
}
ApprovalOrderResp struct {           // 响应
	ID uint; Name string; Type model.ApprovalOrderType; Status model.ApprovalOrderStatus
	Content model.ApprovalOrderContent; ReviewNotes string; CreatedAt time.Time
	CreatorID uint; Creator model.UserInfo; ReviewerID uint; Reviewer model.UserInfo
}
```

### GPU 分析（`/api/v1/admin/gpu-analysis/*`）

```go
TriggerAnalysisReq struct { Namespace string `json:"namespace" binding:"required"`; PodName string `json:"podName" binding:"required"` }
UpdateReviewStatusReq struct { /* ⚠️ 见 gpu_analysis.go:146 */ }
TriggerJobAnalysisReq struct { /* ⚠️ 见 gpu_analysis.go:201 */ }
```

### 模型下载（`/api/v1/model-download/*`）

```go
CreateDownloadReq struct {
	Name     string `json:"name" binding:"required"`                        // HF/ModelScope 仓库名
	Revision string `json:"revision"`                                       // 分支/commit
	Source   string `json:"source"`                                         // 源站（huggingface/modelscope…）
	Category string `json:"category" binding:"required,oneof=model dataset"`
	Token    string `json:"token"`                                          // 私有仓库 token，仅作 env 传入，不落库
}
DownloadActionReq struct { Token string `json:"token"`; Revision *string `json:"revision"` } // retry/pause/resume
ListDownloadsReq struct { Page int `form:"page"`; PageSize int `form:"pageSize,default=20"`; Category,Status,Search string }
ModelDownloadListResp struct { Total int64 `json:"total"`; Items []ModelDownloadResp `json:"items"`; Summary map[string]int64 `json:"summary"` }
```

- `ModelDownloadResp` 字段见 `modeldownload.go:117-151`（含 `canManage/canDelete/canViewLogs` 权限位，**MCP 可直接复用**）。

## 3.7 统计与上下文

### `GET /api/v1/statistics`（`internal/payload/statistics.go:21-27`）

```go
StatisticsReq struct {
	StartTime time.Time       `json:"startTime" form:"startTime" binding:"required"`
	EndTime   time.Time       `json:"endTime" form:"endTime" binding:"required"`
	Step      TimeStep        `json:"step" form:"step" binding:"oneof=day week"`
	Scope     StatisticsScope `json:"scope" form:"scope" binding:"oneof=user account cluster"`
	TargetID  uint            `json:"targetID" form:"targetID"`  // user_id 或 account_id；cluster 忽略
}
StatisticsResp struct {
	TotalUsage map[string]ResourceDetail `json:"totalUsage"` // key=资源名，如 nvidia.com/v100
	Series     []TimePointData           `json:"series"`
}
ResourceDetail struct { Usage float64 `json:"usage"`; Label string `json:"label"`; Type string `json:"type"` } // type: gpu/vgpu/rdma/common
TimePointData  struct { Timestamp time.Time `json:"timestamp"`; Usage map[string]float64 `json:"usage"` }
```

### `GET /api/v1/context/*`

```go
// GET /api/v1/context/quota —— 响应为 Volcano 配额 + 已用量（⚠️ 结构由 handler 内联 gin.H/自定义，见 context.go:113-200）
// GET /api/v1/context/job-resource-summary
JobResourceSummaryResp struct {
	RunningJobs  int                                 `json:"runningJobs"`
	PendingJobs  int                                 `json:"pendingJobs"`
	CPU          JobResourceSummaryUsageResp         `json:"cpu"`
	Memory       JobResourceSummaryUsageResp         `json:"memory"`
	Accelerators []JobResourceSummaryAcceleratorResp `json:"accelerators"`
}
JobResourceSummaryUsageResp struct { Used, Running, Pending string; Limit *string `json:"limit,omitempty"` }
JobResourceSummaryAcceleratorResp struct { Resource, Used, Running, Pending string; Limit *string }

// POST /api/v1/context/resource-limit-check
ResourceLimitCheckReq struct { RequestedResources map[string]string `json:"requestedResources"` }
// 响应：service.ResourceLimitCheckResult（⚠️ 见 internal/service）

// GET /api/v1/context/billing/summary
BillingSummaryResp struct {
	PeriodFreeBalance float64 `json:"periodFreeBalance"`; ExtraBalance float64 `json:"extraBalance"`
	TotalAvailable float64 `json:"totalAvailable"; LastIssuedAt *time.Time; NextIssueAt *time.Time
	EffectiveIssueAmount float64; EffectiveIssuePeriodMinute int
}

// PUT /api/v1/context/attributes —— model.UserAttribute（见 3.2）
// POST /api/v1/context/email/code —— SendCodeReq{email}
// POST /api/v1/context/email/update —— CheckCodeReq{email,code}
// GET /api/v1/users/email/verified / GET /api/v1/users/ban —— 见 3.2
```

---

# 第 4 部分：权限作用域要点（为 MCP 权限映射准备）

## 4.1 四道闸门（任何 MCP 封装都必须按这个顺序理解）

| # | 闸门 | 位置 | 判定内容 | 对 MCP 的含义 |
| --- | --- | --- | --- | --- |
| 1 | 档位 | `route.go:48/56/65` | Public 免登录；Protected 需 JWT；Admin 需 `RolePlatform==admin` | 「能不能调」的最外层；admin 路由 = 全平台能力 |
| 2 | Token 一致性 | `middleware/jwt.go:52-85` | **非 GET** 每次回库校验 `user.Role == token.RolePlatform` 且 `user_account(user,account)` 存在且 `Role/AccessMode` 与 token 一致 | 改了角色/移除账号后，旧 token 的**写**请求立即失效；**读**请求仍可用旧快照 → MCP 缓存 token 会导致“能读不能写” |
| 3 | 封禁能力 | `jwt.go:39-49` + `handler.RequireUserBanCapability` | `PlatformAccess`（中间件级）+ `JobSubmission/ImageBuild/ModelDownload/DatasetDownload`（业务级） | 被封禁用户的 token 依然“有效”，只是被 403；MCP 需把 ban 状态作为独立错误类型透出 |
| 4 | 行级过滤 | 各 handler | `token.UserID` / `token.AccountID` / `token.Username` 拼 where | 决定「自己的 / 账号的 / 全平台」，见 4.2 |

## 4.2 三档作用域清单（逐接口）

### A. 只能看/操作「自己的」（`UserID` 过滤）

| 接口 | 过滤证据 |
| --- | --- |
| `GET /api/v1/vcjobs`、`/facets`、`/billing` | `jobListScope{UserID:&token.UserID, AccountID:&token.AccountID}`（`vcjob/vcjob.go:567-570, 631-634, 730`） |
| `GET/DELETE/PUT /api/v1/vcjobs/:name/*`（detail/yaml/pods/event/template/alert/token/secret/ssh/snapshot/billing/删除） | `getJob()`：非 admin 时 `WHERE account_id=? AND user_id=?`（`vcjob/util.go:462-477`）→ **只认自己的作业，同账号他人作业也看不到** |
| `GET /api/v1/storage/my-quota`、`/dirsize/*path`、`/capabilities` | 只作用于 `token.Username` 的 space（`storage.go` + `internal/storage/file.go:99-130`） |
| `GET /api/v1/context/*`（quota/job-resource-summary/billing/summary） | `UserID+AccountID` 双条件（`context.go:118-122, 312-313`） |
| `PUT /api/v1/context/attributes`、`POST /api/v1/context/email/*` | 只写 `token.UserID` 指向的行（`context.go:364, 400, 445`） |
| `GET /api/v1/users/ban`、`GET /api/v1/users/email/verified` | 当前用户（`user.go:46,49`） |
| 镜像写操作：`POST /images/description|tags|type|arch`、`POST /images/deleteimage`、`DELETE /images/image/:id` | `requireImageOwner()`：`image.id=? AND image.user_id=token.UserID`（`image/image.go:1177-1193`） |
| `GET /api/v1/images/kaniko` | `kaniko.user_id = token.UserID`（`image/buildmgr.go:34`） |
| 模型下载：`/retry|pause|resume`、`DELETE /:id` | `download.CreatorID == token.UserID`（否则需 admin，`modeldownload.go:197, 234`） |
| `POST /api/v1/model-download/models/download` | 下载记录以 `CreatorID=token.UserID` 落库 |
| 作业模板写：`POST /create`、`PUT /update/:id`、`DELETE /delete/:id` | ⚠️ 未见 owner 校验（见 4.4 风险 6） |
| `POST /api/v1/spjobs/training`、`DELETE /api/v1/spjobs/:name` | `rolePermit()`：`RolePlatform==admin || token.Username == reqName`（`spjob/spjob.go:94-100`） |
| `POST /api/v1/auth/switch` | 必须在该账号的 `user_account` 中（`auth.go:1173`） |

### B. 「账号内共享」（`AccountID` 过滤 / 账号管理员判定）

| 接口 | 过滤证据 / 判定 |
| --- | --- |
| `GET /api/v1/accounts` | `user_account.user_id = token.UserID`（`account.go:186`），返回我所在的账号 + 我在其中的 role/access |
| `GET /api/v1/accounts/:aid/*`（billing/config、members、reset、users…） | 先 bind `:aid`，再 `checkAccountAdmin(userID, accountID)`（`account.go:1612-1622`）或 `checkUserInAccount`（`account.go:1625-1632`）→ **账号管理员可管本账号，普通成员只读** |
| `GET /api/v1/dataset/mydataset` | `user_dataset.user_id=token.UserID` **∪** `account_dataset.account_id ∈ {默认账号, token.AccountID}`（`dataset.go:159-182`） |
| `POST /api/v1/dataset/share/*`、`/update`、`/delete` | 先验 `dataset.user_id == token.UserID`（`dataset.go:398,491,578,676`）→ **只有创建者能改/分享** |
| `GET /api/v1/images/image` | 公共 + `ImageAccountID=1` 公共 + 本账号共享 + 我的私有 + 他人分享给我（`image/image.go:79-119`） |
| `GET /api/v1/statistics?scope=account&targetID=<aid>` | 非 admin 必须是该账号的 `RoleAdmin`（`statistics.go:81-109`） |
| `GET /api/v1/aijobs`、`/aijobs/quota`、`/aijobs/:id/{detail,token}`、`DELETE /aijobs/:id` | 全部按 **`token.AccountName`** 过滤（`aijob/emias.go:120,135,270,321,438,542`）→ 属于**账号内共享**，同账号任意成员可读/删他人 AI 任务 |
| `GET /api/v1/model-download/models/downloads` | 创建者 + 我提交过请求的记录（`Relation`: creator/submitted，`modeldownload.go:197-290`） |
| `GET /api/v1/vcjobs`（self）与 `:name/*` | ⚠️ 注意：这里**不是**账号共享，是 user+account **双条件**，别人在**同一账号**里也看不到你的作业 |
| `GET /api/v1/spjobs`、`aijobs` 列表 | 基本按 user 过滤（`spjob` 用 `rolePermit` 的 username 对比） |

### C. Admin 全量（`/api/v1/admin/**`，132 条）

全部要求 `RolePlatform==admin`（`middleware.AuthAdmin`）。其中带行级特判的：

- `DELETE /api/v1/admin/vcjobs/:name`（`AdminDeleteJob`）→ 无过滤；
- `PUT /api/v1/admin/namespaces/:ns/pods/:name/resources` → **仍会调 `checkUserPermissionForJob`**（`tool/podcontainer.go:905-906, 984-1004`）：admin 直接过，非 admin（理论上到不了这里）要求 account+user 匹配；
- `GET /api/v1/admin/gpu-analysis`、`operations/*`、`system-config/*`、`queue-quotas`、`operation-logs` → 纯 admin，无行级过滤。

### D. ⚠️ 「比预期更宽松」的接口（MCP 必须显式约束）

| 接口 | 实际情况 | 风险 |
| --- | --- | --- |
| `GET /api/v1/vcjobs/all`、`/all/facets`、`/billing/all` | Protected 档，**任何登录用户**可拉全平台作业/计费 | 数据越权：普通用户能看到别人作业的资源、费用 |
| `GET /api/v1/vcjobs/user/:username`、`/billing/user/:username` | Protected 档，`resolveJobUserScope` 只查目标用户是否存在，**不校验调用者身份**（`vcjob/vcjob.go:695-708`） | 可枚举任意用户作业 |
| `GET /api/v1/statistics?scope=user&targetID=<uid>` | 注释明确「所有用户可互相查询」（`statistics.go:111-116`） | 任意用户用量可见 |
| `GET /api/v1/aijobs/all` | Protected 档，`taskService.ListAll()` 全量无过滤（`aijob/emias.go:335-348`） | 全部 AI 任务可见 |
| `GET /api/v1/dataset/detail/:datasetId` | 仅按 ID 查，**无归属/共享校验**（`dataset.go:209-225`） | 只要有 ID 就能读任意数据集元信息 |
| `GET /api/v1/users/:name` | 任意登录用户可读任意用户详情；仅 `extraBalance` 受 `canViewUserExtraBalance` 保护（`user.go:340-366`） | 用户画像泄露 |
| `GET /api/v1/jobtemplate/list` | `WHERE ID IS NOT NULL`，**全局**模板（含他人私有模板，`jobtemplate.go:67-89`） | 模板泄露 |
| `PUT /api/v1/nodes/:name`（`UpdateNodeunschedule`） | **Protected 档**，任何登录用户可禁止节点调度（`node.go:80`） | 集群级破坏（应属 admin） |
| `GET /api/v1/namespaces/:ns/pods/:name/{events,containers,containers/:c/log,ingresses,nodeports}`、`POST/DELETE ingresses|nodeports` | 只有 JWT，**无 pod 归属校验**（源码 `tool/podcontainer.go:761` 留着 `// TODO: Check if the user has permission to view the pod`） | 任意用户可读任意 Pod 日志/建 Ingress/NodePort |
| `GET /api/v1/websocket/.../terminal` | 同上，**无归属校验**，只要 JWT 即可 exec 任意 Pod 容器（`tool/websocket.go:134-172`） | 等同集群 shell，最高危 |
| `GET /api/metrics`、`GET /api/cli/compatibility`、`GET /api/dataset/source-logo/:id`、`GET /api/tensorboard/auth` | 完全免登录 | 信息暴露面（metrics 还会全表扫作业） |

## 4.3 关键接口的权限映射速查（供 MCP tool 定义直接抄）

| MCP 能力（建议 tool 名） | 后端接口 | 需要的档位 | 作用域 | 附加校验 |
| --- | --- | --- | --- | --- |
| `auth.login` | `POST /api/auth/login` | Public | — | 无 |
| `auth.me` | `POST /api/auth/check` 或 `GET /api/v1/context/quota` | Public / Protected | self | 无 |
| `account.list_mine` | `GET /api/v1/accounts` | Protected | self∈accounts | 无 |
| `account.switch` | `POST /api/v1/auth/switch` | Protected | self∈account | `user_account` 存在 |
| `job.list_mine` | `GET /api/v1/vcjobs` | Protected | self(user+account) | — |
| `job.get` | `GET /api/v1/vcjobs/:name/detail` | Protected | self(user+account) | 非 admin 只能自己 |
| `job.logs` | `GET /api/v1/namespaces/:ns/pods/:pod/containers/:c/log[/stream]` | Protected | **无校验**（需 MCP 侧自建校验） | — |
| `job.delete` | `DELETE /api/v1/vcjobs/:name` | Protected | self | 同 `getJob` |
| `job.create_jupyter` / `_webide` / `_training` / `_pytorch` / `_tensorflow` | `POST /api/v1/vcjobs/{jupyter,webide,training,pytorch,tensorflow}` | Protected | self | ban `JobSubmission` + 计费余额 + 资源限额 + 存储配额 + 邮箱（alertEnabled 时） |
| `image.list` | `GET /api/v1/images/image` | Protected | 公共+账号+自己+被分享 | 无 |
| `image.build` | `POST /api/v1/images/{kaniko,dockerfile,envd}` | Protected | self | ban `ImageBuild` |
| `image.share` | `POST /api/v1/images/share` | Protected | owner | `requireImageOwner` |
| `file.list` / `file.upload` / `file.download` / `file.delete` | `/api/ss/files/*path`、`/api/ss/upload/*path`、`/api/ss/download/*path`、`/api/ss/delete/*path`（**storage-server 进程**） | JWT | 路径空间前缀 + `AccessMode` | RO 时禁止写 |
| `quota.mine` | `GET /api/v1/context/quota`、`/storage/my-quota`、`/context/billing/summary` | Protected | self | — |
| `admin.user.ban` | `PUT /api/v1/admin/users/:name/ban` | Admin | 全平台 | — |
| `admin.user.role` | `PUT /api/v1/admin/users/:name/role` | Admin | 全平台 | — |
| `admin.account.quota` | `PUT /api/v1/admin/accounts/:aid` + `GET /api/v1/admin/accounts/:aid/quota` | Admin | 全平台 | — |
| `admin.node.mark` | `POST/DELETE /api/v1/admin/nodes/:name/{label,annotation,taint}`、`POST /:name/drain` | Admin | 全平台 | — |
| `admin.billing.toggle` | `PUT /api/v1/admin/system-config/billing` | Admin | 全平台 | 指针字段：只传要改的 |
| `admin.queue_quota.*` | `/api/v1/admin/queue-quotas[/:id]` | Admin | 全平台 | — |

## 4.4 对「账号用户权限内做 MCP 封装」最需要注意的 3 个约束

1. **不要把 `vcjobs/all`、`vcjobs/user/:username`、`aijobs/all`、`statistics?scope=user`、`namespaces/**`（含终端）暴露给普通用户**。
   这些接口在 Crater 里属于 Protected 档但**没有行级校验**（证据：`vcjob/vcjob.go:695-708`、`statistics.go:111-116`、`tool/podcontainer.go:761` TODO、`tool/websocket.go:134`）。MCP 若按「JWT 通过就放行」实现，等于把全平台作业与本集群任意 Pod 的 shell 交给每个账号用户。**必须由 MCP 侧自行加“仅 self/仅本账号”的白名单**，把“能调”和“该调”分开。

2. **权限是「档位 + 回库一致性 + 行级过滤」三层叠加，且读/写不对称**。
   - 非 GET 请求每次都会回库比对 `Role/RoleAccount/AccountAccessMode`（`middleware/jwt.go:52-85`），所以 MCP **缓存 token 会导致读成功、写 401**；正确做法是遇到 401 就重新 login/refresh，而不是重试。
   - 唯一豁免写校验的是 `/api/v1/auth/switch`（`jwt.go:71`），切账号后必须**换用返回的新 token**，否则后续写请求会因 `RoleAccount/AccountAccessMode` 与库不一致而 401。
   - 封禁用户不会被 401（token 有效），而是被 403；`PlatformAccess` 之外的四类能力（提交作业/构建镜像/下载模型/下载数据集）要按业务接口分别映射（`service.UserBanRestrictions`）。

3. **作业/镜像/文件的“归属”语义各不相同，不能一把尺子量到底**。
   - 作业：`user_id + account_id` 双条件（同账号他人也看不到）；
   - 镜像：`image.user_id` 为 owner，但**可见性**是「公共 ∪ 账号共享 ∪ 私有 ∪ 他人分享」，写操作一律 `requireImageOwner`；
   - 文件（storage-server）：归属由**路径前缀空间**（`user/<space>` / `account/<space>` / `public`）+ token 的 `AccessMode`（RO/RW）共同决定，`AccountID==0` 时用 `PublicAccessMode`（`internal/storage/file.go:88-96, 195-199`）；且它是**独立进程**，MCP 需要另行配置 base URL 与 JWT 透传。
   - 数据集：**只有创建者能改/分享**，可见性靠 `user_dataset ∪ account_dataset(默认账号 + 当前账号)`。

---

# 附录 A：本文档的可复现提取方法

```powershell
$h = "C:\Users\Administrator\Desktop\AI\k8s及插件\_crater_src\backend\internal\handler"
# 1) 列出所有 manager 及其 group 名
Select-String -Path "$h\*.go","$h\*\*.go" -Pattern 'func \(mgr \*\w+\) GetName|name:\s*"'
# 2) 列出所有路由注册行（带行号）
Select-String -Path "$h\*.go","$h\*\*.go" -Pattern '\.(GET|POST|PUT|DELETE|PATCH)\("' | Where-Object {$_.Filename -notlike "*_test.go"}
# 3) 三档前缀与装配
Get-Content "..\backend\pkg\constants\const.go"; Get-Content "..\backend\internal\route.go"
# 4) 行级过滤证据
Select-String -Path "$h\*.go","$h\*\*.go" -Pattern 'UserID\.Eq\(token\.UserID\)|AccountID\.Eq\(token\.AccountID\)|Username\.Eq\(token\.Username\)'
```

# 附录 B：⚠️待确认清单（静态阅读未能闭环）

1. `POST /api/v1/vcjobs/:name/snapshot` 的请求体字段（`CreateSnapshot` 实现内部未逐行读）。
2. `resource.go` 中 `POST /sync`、`POST /:id/networks`、`POST /:id/vgpu`、`PUT /:id/vgpu/:vgpuId` 的 body 结构（handler 内可能各自 `ShouldBindJSON` 到内联匿名结构）。
3. `operations` 下 `PUT /keep/:name`、`PUT /add|clear/locktime`、`POST /clean/*`、`POST /cronjob/*` 的请求体。
4. `gpu_analysis.go:146 UpdateReviewStatusReq`、`gpu_analysis.go:201 TriggerJobAnalysisReq` 的完整字段。
5. `GET /api/v1/context/quota` 的响应结构（handler 内可能用 `gin.H` 组装）。
6. storage-server 的 `POST /api/ss/upload/*path` 是 multipart 还是原始流（`upload.go` 未逐行读）。
7. `GET /api/v1/vcjobs/:name/secret`（`GetWebIDESecret`）的返回字段。

> 以上 7 项均**不影响**第 1、2、4 部分的结论（路径/档位/权限闸门已逐行核对），只影响个别请求/响应字段的具体形状。

> 已在本次审计中闭环的两项（原待确认）：`RefreshReq` = `{refreshToken string \`json:"refreshToken" binding:"required"\`}`（`auth.go:1085-1087`，不带 `Bearer ` 前缀）；`aijobs` 列表作用域 = 按 `token.AccountName`（账号内），见 `aijob/emias.go:319-333`。

---

## 附录 A. 本项目自研新增接口（不在上游 305 条之内）

> 本仓库已转入团队自维护，下列接口由我们自行添加（实现在 `_crater_src/backend`，迁移见 `cmd/gorm-gen/models/migrate.go`）。
> 审计口径与上文一致：全部为 gin 路由，作用域标注同 §4。

| 方法 | 路径 | 作用域 | 说明 | 实现 |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/forgot-password` | 公开 | 邮箱重置密码：发一次性链接（防枚举、5 分钟冷却） | `internal/handler/password_reset.go` |
| POST | `/api/auth/reset-password` | 公开 | 用令牌重置密码（30 分钟有效、只存 sha256） | 同上 |
| POST | `/api/v1/context/password` | Protected | 登录后自助改密（校验原密码；LDAP 模式拒绝） | `internal/handler/context_password.go` |
| POST | `/api/v1/admin/users/:name/reset-password` | Admin | 管理员重置为「用户名+123」并发通知邮件 | `internal/handler/user_password_reset.go` |
| POST | `/api/v1/feedback` | Protected（仅本人） | 提交平台反馈（网页与 agent 共用） | `internal/handler/feedback.go` |
| GET | `/api/v1/feedback/mine` | Protected（仅本人） | 我的反馈 + 管理员回复 | 同上 |
| GET | `/api/v1/admin/feedback` | Admin | 全部反馈（可按状态过滤） | 同上 |
| PUT | `/api/v1/admin/feedback/:id` | Admin | 改状态 / 回复（记录回复人与时间） | 同上 |

新增数据表：`password_reset_tokens`（迁移 `202611071200`）、`feedbacks`（迁移 `202611071300`）。

