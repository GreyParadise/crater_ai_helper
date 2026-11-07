# 我们对 Crater 前端做过的定制（升级时需要重新套用）

本文件记录**改动过的 Crater 前端源码**（在 `_crater_src/frontend` 里，不属于本仓库），
便于将来拉取上游新版本时逐条重新应用。后端改动见 `docs/backend-secfix.md` 与 `docs/password-reset.md`。

| # | 文件 | 改动 | 目的 |
| --- | --- | --- | --- |
| 1 | `src/routes/auth/-components/forgot-password-form.tsx` | 删除 mock（`setTimeout` 假成功），改调 `apiForgotPassword` | 忘记密码真正可用 |
| 2 | `src/routes/reset-password.tsx`（新增） | `/reset-password?token=...` 落地页 | 邮件重置链接的目标页 |
| 3 | `src/services/api/auth.ts` | 新增 `apiForgotPassword` / `apiResetPassword` | —— |
| 4 | `src/services/api/context.ts` | 新增 `apiContextChangePassword` | —— |
| 5 | `src/services/api/admin/user.ts` | 新增 `apiAdminResetUserPassword` | —— |
| 6 | `src/routes/admin/users/index.tsx` | 「更多选项」菜单在「编辑信息」后新增 **重置密码** | 管理员重置用户密码 |
| 7 | `src/routes/admin/users/-components/user-reset-password-dialog.tsx`（新增） | 重置确认 + 结果（临时密码 / 邮件是否发出） | —— |
| 8 | `src/routes/portal/more/-components/change-password-dialog.tsx`（新增） | 当前密码 / 新密码 / 确认新密码 | —— |
| 9 | `src/routes/portal/more/user.tsx` | 「用户信息」卡片下方新增 **登录密码** 卡片 + 修改密码按钮 | 登录后自助改密 |
| 10 | `src/components/layout/app-layout.tsx` | 移除 `<WhatsNewDialog />` 的 import 与渲染 | 去掉每次发版都弹的「最近更新内容」弹窗 |
| 11 | `src/components/onboarding/onboarding-tour.tsx`（新增） | 新手引导：7 步、可跨页面跳转、box-shadow 挖洞高亮、状态放模块作用域（路由跳转重建组件也不会丢进度） | 新用户首次进入自动教学 |
| 12 | `src/routes/portal/route.tsx` | 挂载 `<OnboardingTour />` | 只在门户侧触发，admin 后台不打扰 |
| 13 | `data-tour` 埋点：`components/sidebar/app-sidebar.tsx`（sidebar）、`components/sidebar/nav-main.tsx`（每个导航项 `/portal/xxx`）、`components/job/new-job-button.tsx`（new-job）、`routes/portal/more/user.tsx`（email-verify） | 给引导提供锚点 | 高亮定位 |
| 14 | `routes/portal/more/user.tsx` | 「登录密码」卡片底部加 **重新观看新手引导** 按钮 | 可重看 |

说明：

- 第 10 条只是不再挂载组件，`src/components/layout/what-is-new.tsx` 文件保留，需要时重新 import 即可。
  该弹窗的显示条件是比较 localStorage 的 `app-last-confirmed-version` 与代码里的 `CURRENT_VERSION`，
  所以每次改版本号都会重新弹一次。
- 新手引导的完成标记：`localStorage["crater-onboarding-v1:<用户名>"]`；没有标记的账号进入 `/portal` 会自动弹一次。
  想给某个账号重看：用户设置 → 「重新观看新手引导」，或清掉该 key。
- 构建：`pnpm install --frozen-lockfile && pnpm build` → `dist/` → `frontend/Dockerfile`（nginx）打镜像。
- **发版必须用唯一 tag**：前端 Deployment 用 `crater-fe:fe-latest` + `imagePullPolicy: IfNotPresent`，
  `rollout restart` 不会重新拉镜像（踩过：重启成功但页面还是旧的）。一律推形如
  `crater-fe:<变更>-<日期>` 的 tag 再 `kubectl set image`。

已上线的前端镜像 tag：

| tag | 内容 |
| --- | --- |
| `pwreset-20261107` | 忘记密码 + 重置落地页 + 管理员重置密码入口 |
| `chpwd-20261107` | 追加用户设置页「修改密码」 |
| `nowhatsnew-20261107` | 去掉「最近更新内容」弹窗 |
| `onboarding3-20261107` | 新手引导（含邮箱优先引导、可重看） |
