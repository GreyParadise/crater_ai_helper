# 本次迭代产生的镜像 tag（都在 172.16.16.126:30003）

| tag | 说明 |
| --- | --- |
| crater-be:secfix-20261107 | 权限收口：vcjobs/all、user/:username、namespaces、users/:name |
| crater-be:pwreset-20261107c/e | 邮件 SSL 修复 + 忘记密码/令牌重置 + 管理员重置密码 |
| crater-be:chpwd-20261107 | 登录后自助改密码 |
| crater-be:scopefix-20261107 | /vcjobs/all 改为按调用者过滤（修概览页 403） |
| crater-be:feedback-20261107 | 平台内反馈系统（当前线上） |
| crater-fe:pwreset-20261107 | 忘记密码接线 + /reset-password + 管理员重置入口 |
| crater-fe:chpwd-20261107 | 用户设置加「修改密码」 |
| crater-fe:nowhatsnew-20261107 | 去掉「最近更新内容」弹窗 |
| crater-fe:onboarding3-20261107 | 新手引导（7 步，邮箱优先） |
| crater-fe:onboarding5-20261107 | 修复切账号不触发引导 |
| crater-fe:filesinit-20261107 | 文件系统未开通时显示初始化提示 |
| crater-fe:feedback-20261107 | 平台内反馈页面 |
| crater-fe:mcpguide-20261107 | 概览页「MCP 接入指南」按钮 + 首版 HTML 指南 |
| crater-fe:mcpguide4-20261107 | 指南重做为产品级单页文档（双主题/Tab/预算计算器/复制/滚动高亮） |
| crater-fe:feedback-dialog-20261109 | 管理端反馈改列表 + 点击弹窗看详情 |
| crater-fe:nodeoccupy-20261109 | 节点「取消独占」用账号名匹配污点 |
| crater-be:ingressfix2-20261109 | jupyter ingress：host 为 IP/空时按路径路由 |
| crater-be:jupurl-20261109 | 作业入口 URL（Jupyter/WebIDE）在 IP/空 host 时改用 path 入口（当前线上） |
| crater-storage:ingressfix-20261109 | 自建 storage-server（含 /api/ss/upload，当前线上，ns crater-workspace/webdav-deployment） |

> 发版务必用唯一 tag：前端 Deployment 是 imagePullPolicy: IfNotPresent，
> 用 e-latest 这类可变 tag 时 ollout restart 不会重新拉镜像（踩过）。