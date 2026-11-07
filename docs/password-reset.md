# 邮箱重置密码 + 管理员重置密码（含 SMTP 修复）

2026-11-07 实施。用户报障："登录页有忘记密码入口，但已验证邮箱的用户也收不到重置链接"。

## 1. 排查结论：两个独立问题

### 问题 A：忘记密码功能**从未实现**（前端是假实现）

线上前端产物里（`/assets/index-*.js`）提交逻辑就是一个定时器：

```js
mutationFn: t => (logger.info("Sending reset email", t), new Promise(r => setTimeout(() => r(), 1000))),
onSuccess: () => { toast.success("重置密码邮件已发送，请查收") }
```

源码里留着 TODO（`frontend/src/routes/auth/-components/forgot-password-form.tsx`）：
`// 这里添加发送重置密码邮件的API调用 / 目前只是模拟API调用`。

后端侧：**整条 password 路由为 0 条**（没有忘记密码、也没有登录后改密码），
`POST /api/auth/forgot-password`、`/api/auth/reset-password` 等全部 404。
所以「收不到重置链接」与邮箱是否已验证无关 —— 请求根本没发出去。

### 问题 B：邮件通道本身也坏了（这才是隐藏更深的问题）

用现成的验证码接口实测：

```
POST /api/v1/context/email/code → 500（耗时 20.08s）
E1107 smtp.go:81] Failed to send email to ...: EOF
```

根因在 `backend/pkg/alert/smtp.go`：

```go
d := gomail.NewDialer(sa.host, sa.port, sa.username, sa.password)
d.SSL = false   // ← 配置是 465（隐式 TLS），这里强制走明文+STARTTLS → 服务端直接断开 → EOF
```

对照实验（同一台机器、同一套凭据）：

| 实验 | 结果 |
| --- | --- |
| 465 端口发明文 `EHLO` | 空响应（即 gomail 报的 EOF） |
| 465 端口先 TLS 再 `EHLO` | `220 163.com Anti-spam GT ...` ✅ |
| `smtp.163.com:465` TLS 登录（配置里的账号+授权码） | `LOGIN: OK` / `NOOP: 250 OK` ✅ |
| 集群到 465/587/25 的 TCP 连通性 | 全部可达 ✅ |

结论：网络、账号、授权码、TLS 都没问题，就是这行把 465 的端口语义搞错了。

## 2. 改动清单

### 后端（`_crater_src/backend`）

| 文件 | 改动 |
| --- | --- |
| `pkg/alert/smtp.go` | `d.SSL = smtpImplicitTLSPort(port)`（465/994 = 隐式 TLS，其它 = 明文+STARTTLS） |
| `pkg/alert/interface.go` | `AlertInterface` 增加 `SendPasswordResetLink` / `SendPasswordResetNotice` |
| `pkg/alert/alert.go` | 两个邮件模板：重置链接（30 分钟、一次性）、管理员重置通知（含临时密码 + 提示尽快改） |
| `dao/model/password_reset.go`（新增） | `PasswordResetToken`：只存 `sha256(token)`、`expires_at`、`used_at`、`request_ip` |
| `cmd/gorm-gen/models/migrate.go` | 新增迁移 `202611071200`：建 `password_reset_tokens` 表 |
| `internal/handler/password_reset.go`（新增） | `POST /api/auth/forgot-password`、`POST /api/auth/reset-password` |
| `internal/handler/user_password_reset.go`（新增） | `POST /api/v1/admin/users/:name/reset-password` |
| `internal/handler/auth.go` / `user.go` | 注册上述三个路由 |

三个接口的行为：

- **forgot-password**（公开）：按 `users.attributes->>'email'`（忽略大小写）查用户 → 生成 32 字节随机令牌，
  只存哈希 → 发链接 `${config.host}/reset-password?token=...` → 30 分钟有效。
  **无论邮箱是否存在都返回同一句成功文案**（防账号枚举）；同一账号 5 分钟冷却（防刷）；
  被封禁用户跳过发送；发信失败会把刚建的令牌作废。
- **reset-password**（公开）：校验令牌（存在 / 未用 / 未过期）→ bcrypt 存新密码 →
  本次令牌置为已用 + 作废该用户其它未用令牌 → 单次使用。
- **admin reset**（管理端）：密码重置为 `用户名 + "123"`，作废该用户未用的重置令牌，
  并给该用户邮箱发「密码已被重置」通知；响应返回 `tempPassword / emailSent / email`。

### 前端（`_crater_src/frontend`）

| 文件 | 改动 |
| --- | --- |
| `services/api/auth.ts` | 新增 `apiForgotPassword` / `apiResetPassword` |
| `services/api/admin/user.ts` | 新增 `apiAdminResetUserPassword` |
| `routes/auth/-components/forgot-password-form.tsx` | 删掉 mock，接真接口；成功提示用后端返回文案 |
| `routes/reset-password.tsx`（新增） | `/reset-password` 落地页：从 query 取 token，两次输入校验，成功后引导去登录 |
| `routes/admin/users/index.tsx` | 「更多选项」菜单在「编辑信息」后新增 **重置密码** 项 |
| `routes/admin/users/-components/user-reset-password-dialog.tsx`（新增） | 确认弹窗 + 结果展示（用户名 / 临时密码 / 邮件是否发出） |

## 3. 部署（两个镜像）

```bash
# 后端
docker build --platform linux/amd64 --build-arg BIN_DIR=. -t 172.16.16.126:30003/crater/crater-be:pwreset-20261107e .
docker push 172.16.16.126:30003/crater/crater-be:pwreset-20261107e
kubectl -n crater set image deploy/crater-backend \
  crater-backend-container=...:pwreset-20261107e migration=...:pwreset-20261107e

# 前端（pnpm build → dist → nginx 镜像）
pnpm install --frozen-lockfile && pnpm build
docker build -t 172.16.16.126:30003/crater/crater-fe:pwreset-20261107 .
docker push 172.16.16.126:30003/crater/crater-fe:pwreset-20261107
kubectl -n crater set image deploy/crater-frontend \
  crater-frontend-container=...:pwreset-20261107 fe-imgfix=...:pwreset-20261107
```

**踩过的坑（重要）**：前端原本用可变 tag `crater-fe:fe-latest` + `imagePullPolicy: IfNotPresent`，
`kubectl rollout restart` 不会重新拉镜像，导致"重启成功但页面还是旧的"。
以后发版必须用**唯一 tag**（这次改用 `pwreset-20261107`）。

## 4. 实测结果（2026-11-07）

| 用例 | 结果 |
| --- | --- |
| 验证码邮件（修复 SMTP 后） | `Sent email to 2200544104@qq.com`，742ms ✅（修复前 20s + EOF） |
| 忘记密码 → 发重置链接 | 200 + `reset link sent to user=crater-admin email=2*********@qq.com`，令牌入库 ✅ |
| 不存在的邮箱 | 返回同样的成功文案（防枚举）✅ |
| 令牌重置密码 | 200「密码已重置，请用新密码登录」；新密码登录 200 ✅ |
| 同一令牌重复使用 | 400「该重置链接已被使用，请重新申请」✅ |
| 管理员重置 clitest04 | `{tempPassword:"clitest04123", emailSent:true}`；临时密码登录 200、旧密码 401 ✅ |
| 前端 `/reset-password?token=x` | 200，产物含 `ResetPasswordRoute` ✅ |
| 前端 forgot 表单 | 产物调用 `auth/forgot-password` ✅ |
| 前端管理员菜单 | 产物含 `userTable.resetPassword` ✅ |

## 5. 安全设计

- 令牌 32 字节随机、**只存 sha256**，库被读也无法还原链接；
- 一次性 + 30 分钟有效；同一账号重新申请时旧令牌作废；
- 统一响应文案防账号枚举；同账号 5 分钟冷却；被禁用户不发送；
- 登录后修改密码的入口暂未做（用户可走「忘记密码」自助改），后续可补一个 `POST /api/v1/context/password`。

## 6. 登录后自助修改密码（2026-11-07 追加）

用户设置页（`/portal/more/user`）原来只有头像/邮箱，没有改密码入口。本次补上：

**后端**：`POST /api/v1/context/password`（Protected，`internal/handler/context_password.go`）

- body：`{ oldPassword, newPassword }`；
- 校验原密码（bcrypt）、新密码长度 6~64、新密码不能与原密码相同；
- LDAP 模式下直接拒绝（密码由 LDAP 管理）；历史账号没有本地密码时给出可读提示；
- 成功后作废该用户尚未使用的邮箱重置令牌。

**前端**

| 文件 | 改动 |
| --- | --- |
| `services/api/context.ts` | 新增 `apiContextChangePassword` |
| `routes/portal/more/-components/change-password-dialog.tsx`（新增） | 弹窗：当前密码 / 新密码 / 确认新密码，zod 校验两次一致 |
| `routes/portal/more/user.tsx` | 「用户信息」卡片下方新增 **登录密码** 卡片 + 「修改密码」按钮 + 弹窗 |

**实测**（clitest05 普通用户）：

| 用例 | 结果 |
| --- | --- |
| 原密码错误 | 400「原密码不正确」 |
| 新密码过短（123） | 400「新密码长度需在 6~64 个字符之间」 |
| 正常修改 | 200「密码修改成功」 |
| 新密码登录 | 200 |
| 旧密码登录 | 401 |

镜像：`crater-be:chpwd-20261107`、`crater-fe:chpwd-20261107`。
