# 路由存在性核查（实测）

> 生成时间：2026-11-06T07:12:42.841Z　目标：`http://172.16.16.140`　账号：`crater-admin`
> 方法：从 `api-inventory.md` 提取全部路由，GET 直接打、POST 用空 body 打（binding 先失败，安全）、PUT/DELETE/PATCH 不探测。

**合计 314 条：存在 125，缺失 27，未探测 162**

> 「缺失」= 返回 gin 的 `404 page not found`，说明**当前部署**上没有这条路由（可能是源码分支与线上镜像版本不一致，或该路由被我 materialize 的参数掩盖）。

## 缺失路由

| Method | 路径 | 状态 |
| --- | --- | --- |
| GET | `/api/v1/storage/capabilities` | 404 |
| GET | `/api/v1/storage/dirsize/*path` | 404 |
| GET | `/api/v1/storage/my-quota` | 404 |
| GET | `/api/v1/admin/storage/capabilities` | 404 |
| GET | `/api/v1/admin/storage/user-spaces` | 404 |
| GET | `/api/v1/admin/system-config/scheduler-extender` | 404 |
| GET | `/api/v1/aijobs/:id/token` | 404 |
| GET | `/api/v1/aijobs` | 404 |
| GET | `/api/v1/aijobs/all` | 404 |
| GET | `/api/v1/aijobs/quota` | 404 |
| GET | `/api/v1/aijobs/:id/detail` | 404 |
| GET | `/api/v1/aijobs/:id/yaml` | 404 |
| GET | `/api/v1/aijobs/:id/pods` | 404 |
| GET | `/api/v1/aijobs/:id/event` | 404 |
| GET | `/api/v1/admin/aijobs` | 404 |
| GET | `/api/v1/admin/aijobs/:id/detail` | 404 |
| GET | `/api/v1/spjobs` | 404 |
| GET | `/api/v1/spjobs/all` | 404 |
| GET | `/api/v1/spjobs/:name/detail` | 404 |
| GET | `/api/v1/spjobs/:name/yaml` | 404 |
| GET | `/api/v1/spjobs/:name/pods` | 404 |
| GET | `/api/v1/spjobs/:name/events` | 404 |
| GET | `/api/v1/admin/spjobs` | 404 |
| GET | `/api/v1/admin/spjobs/:name/detail` | 404 |
| GET | `/api/tensorboard/auth` | 404 |
| GET | `/api/v1/tensorboard` | 404 |
| GET | `/api/v1/tensorboard/source/:jobName` | 404 |

## 全部结果

| Method | 路径 | 状态 | 存在 | 备注 |
| --- | --- | --- | --- | --- |
| GET | `/healthz` | 200 | ✅ | <!doctype html> <!-- Copyright 2025 RAIDS Lab Licensed under the Apache Lice |
| POST | `/api/auth/login` | SKIP | — | 有副作用，未探测 |
| GET | `/api/auth/check` | 200 | ✅ | {"code":0,"data":{"context":{"queue":"q-3","roleQueue":3,"rolePlatform":3,"acces |
| POST | `/api/auth/signup` | SKIP | — | 有副作用，未探测 |
| POST | `/api/auth/refresh` | SKIP | — | 有副作用，未探测 |
| GET | `/api/auth/mode` | 200 | ✅ | {"code":0,"data":{"enableLdap":false,"enableNormalLogin":true,"enableNormalRegis |
| POST | `/api/v1/auth/switch` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/users/ban` | 200 | ✅ | {"code":0,"data":{"banned":false,"permanentBanned":false,"banRestrictions":{"pla |
| GET | `/api/v1/users/:name/ban` | 404 | ✅ | {"code":40401,"data":null,"msg":"User not found"} |
| GET | `/api/v1/users/:name` | 500 | ✅ | {"code":99999,"data":null,"msg":"get user failed, detail: record not found"} |
| GET | `/api/v1/users/email/verified` | 200 | ✅ | {"code":0,"data":{"verified":true,"lastEmailVerifiedAt":"2026-09-24T16:42:32.659 |
| GET | `/api/v1/admin/users` | 200 | ✅ | {"code":0,"data":[{"id":6,"name":"fulong","role":2,"status":2,"extraBalance":0," |
| GET | `/api/v1/admin/users/billing/summary` | 200 | ✅ | {"code":0,"data":[{"userId":6,"username":"fulong","extraBalance":0,"periodFreeTo |
| GET | `/api/v1/admin/users/baseinfo` | 200 | ✅ | {"code":0,"data":[{"name":"test","nickname":"test","space":"test"},{"name":"liji |
| DELETE | `/api/v1/admin/users/:name` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/users/:name/role` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/users/:name/attributes` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/users/:name/billing/extra-balance` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/users/:name/billing/accounts` | 500 | ✅ | {"code":99999,"data":null,"msg":"failed to load user: record not found"} |
| GET | `/api/v1/admin/users/:name/ban` | 404 | ✅ | {"code":40401,"data":null,"msg":"User not found"} |
| PUT | `/api/v1/admin/users/:name/ban` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/accounts` | 200 | ✅ | {"code":0,"data":[{"name":"q-3","nickname":"云容器","role":3,"access":3,"expiredAt" |
| GET | `/api/v1/accounts/by-name/:name` | 404 | ✅ | {"code":40401,"data":null,"msg":"account not found: account name '测试' does not e |
| GET | `/api/v1/accounts/:aid/billing/config` | 409 | ✅ | {"code":40902,"data":null,"msg":"billing feature is disabled"} |
| PUT | `/api/v1/accounts/:aid/billing/config` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/accounts/:aid/billing/members` | 409 | ✅ | {"code":40902,"data":null,"msg":"billing feature is disabled"} |
| PUT | `/api/v1/accounts/:aid/billing/members/:uid` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/accounts/:aid/billing/reset` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/accounts/:aid/users/:uid` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/accounts/:aid/users/:uid/update` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/accounts/:aid/users/:uid` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/accounts/:aid/users/out` | 200 | ✅ | {"code":0,"data":null,"msg":""} |
| GET | `/api/v1/accounts/:aid/users` | 200 | ✅ | {"code":0,"data":[{"id":1,"name":"crater-admin","role":"3","accessmode":"3","use |
| PUT | `/api/v1/accounts/:aid/users/:uid` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/accounts` | 200 | ✅ | {"code":0,"data":[{"id":1,"name":"default","nickname":"公共账户","space":"/public"," |
| POST | `/api/v1/admin/accounts` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/accounts/:aid` | 200 | ✅ | {"code":0,"data":{"id":1,"name":"default","nickname":"公共账户","space":"/public","q |
| GET | `/api/v1/admin/accounts/:aid/quota` | 200 | ✅ | {"code":0,"data":{"cpu":{"label":"cpu","allocated":{"amount":0,"format":"Decimal |
| GET | `/api/v1/admin/accounts/:aid/billing/config` | 200 | ✅ | {"code":0,"data":{"issueAmount":1000,"issuePeriodMinutes":43200,"effectiveIssueA |
| PUT | `/api/v1/admin/accounts/:aid/billing/config` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/accounts/:aid/billing/members` | 200 | ✅ | {"code":0,"data":[{"userId":1,"username":"crater-admin","nickname":"crater-admin |
| PUT | `/api/v1/admin/accounts/:aid/billing/members/:uid` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/accounts/:aid/billing/reset` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/accounts/:aid` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/admin/accounts/:aid` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/accounts/add/:aid/:uid` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/accounts/update/:aid/:uid` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/accounts/userIn/:aid` | 200 | ✅ | {"code":0,"data":[{"id":1,"name":"crater-admin","role":"3","accessmode":"3","use |
| GET | `/api/v1/admin/accounts/userOutOf/:aid` | 200 | ✅ | {"code":0,"data":null,"msg":""} |
| DELETE | `/api/v1/admin/accounts/:aid/:uid` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/accounts/userIn/:aid` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/images/kaniko` | 200 | ✅ | {"code":0,"data":{"kanikoList":[{"ID":6,"imageLink":"172.16.16.126:30013/user-cr |
| POST | `/api/v1/images/kaniko` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/images/dockerfile` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/images/envd` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/images/remove` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/images/image` | 200 | ✅ | {"code":0,"data":{"imageList":[{"ID":10,"imageLink":"172.16.16.126:30013/user-cr |
| POST | `/api/v1/images/image` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/images/image/:id` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/images/available` | 200 | ✅ | {"code":0,"data":{"images":[{"ID":10,"imageLink":"172.16.16.126:30013/user-crate |
| GET | `/api/v1/images/getbyname` | 400 | ✅ | {"code":40001,"data":null,"msg":"validate image get parameters failed, err Key:  |
| POST | `/api/v1/images/quota` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/images/podname` | 400 | ✅ | {"code":40001,"data":null,"msg":"validate image get parameters failed, err Key:  |
| POST | `/api/v1/images/credential` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/images/quota` | 200 | ✅ | {"code":0,"data":{"used":0.4562481688335538,"quota":40,"project":"user-crater-ad |
| POST | `/api/v1/images/valid` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/images/description` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/images/deleteimage` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/images/type` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/images/harbor` | 200 | ✅ | {"code":0,"data":{"ip":"https://172.16.16.126:30013"},"msg":""} |
| POST | `/api/v1/images/tags` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/images/template` | 400 | ✅ | {"code":40001,"data":null,"msg":"validate image get parameters failed, err Key:  |
| POST | `/api/v1/images/share` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/images/share` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/images/share` | 400 | ✅ | {"code":40001,"data":null,"msg":"validate failed"} |
| GET | `/api/v1/images/user` | 400 | ✅ | {"code":40001,"data":null,"msg":"validate failed"} |
| GET | `/api/v1/images/account` | 400 | ✅ | {"code":40001,"data":null,"msg":"validate failed"} |
| GET | `/api/v1/images/cudabaseimage` | 200 | ✅ | {"code":0,"data":{"cudaBaseImages":[{"id":1,"label":"CUDA 12.4 + Ubuntu 22.04"," |
| POST | `/api/v1/images/arch` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/images/kaniko` | 200 | ✅ | {"code":0,"data":{"kanikoList":[{"ID":21,"imageLink":"172.16.16.126:30013/user-j |
| GET | `/api/v1/admin/images/image` | 200 | ✅ | {"code":0,"data":{"imageList":[{"ID":10,"imageLink":"172.16.16.126:30013/user-cr |
| POST | `/api/v1/admin/images/deleteimage` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/images/remove` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/images/type` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/images/change/:id` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/images/description` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/images/tags` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/images/arch` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/images/cudabaseimage` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/admin/images/cudabaseimage/:id` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/vcjobs` | 200 | ✅ | {"code":0,"data":{"items":[{"name":"测试","jobName":"vsc-crater-admin-261104-c774f |
| GET | `/api/v1/vcjobs/facets` | 200 | ✅ | {"code":0,"data":{"facets":{"job_type":[{"value":"jupyter","count":3},{"value":" |
| GET | `/api/v1/vcjobs/all` | 200 | ✅ | {"code":0,"data":{"items":[{"name":"测试","jobName":"vsc-crater-admin-261104-c774f |
| GET | `/api/v1/vcjobs/all/facets` | 200 | ✅ | {"code":0,"data":{"facets":{"gpu_resource":[{"value":"gpu","count":1}],"job_type |
| GET | `/api/v1/vcjobs/user/:username` | 200 | ✅ | {"code":0,"data":{"items":[{"name":"测试","jobName":"vsc-crater-admin-261104-c774f |
| GET | `/api/v1/vcjobs/user/:username/facets` | 200 | ✅ | {"code":0,"data":{"facets":{"job_type":[{"value":"jupyter","count":3},{"value":" |
| GET | `/api/v1/vcjobs/billing` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| GET | `/api/v1/vcjobs/billing/all` | 200 | ✅ | {"code":0,"data":[{"jobName":"jpt-crater-admin-261104-7535f","name":"节点测试","bill |
| GET | `/api/v1/vcjobs/billing/user/:username` | 200 | ✅ | {"code":0,"data":[{"jobName":"jpt-crater-admin-261104-7535f","name":"节点测试","bill |
| DELETE | `/api/v1/vcjobs/:name` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/vcjobs/:name/detail` | 500 | ✅ | {"code":99999,"data":null,"msg":"record not found"} |
| GET | `/api/v1/vcjobs/:name/billing` | 200 | ✅ | {"code":0,"data":{"jobName":"","name":"","billedPointsTotal":0},"msg":""} |
| GET | `/api/v1/vcjobs/:name/yaml` | 500 | ✅ | {"code":99999,"data":null,"msg":"record not found"} |
| GET | `/api/v1/vcjobs/:name/pods` | 500 | ✅ | {"code":99999,"data":null,"msg":"record not found"} |
| GET | `/api/v1/vcjobs/:name/template` | 500 | ✅ | {"code":99999,"data":null,"msg":"record not found"} |
| GET | `/api/v1/vcjobs/:name/event` | 500 | ✅ | {"code":99999,"data":null,"msg":"record not found"} |
| PUT | `/api/v1/vcjobs/:name/alert` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/vcjobs/:name/ssh` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/vcjobs/:name/snapshot` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/vcjobs/jupyter` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/vcjobs/:name/token` | 500 | ✅ | {"code":99999,"data":null,"msg":"record not found"} |
| POST | `/api/v1/vcjobs/webide` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/vcjobs/:name/secret` | 500 | ✅ | {"code":99999,"data":null,"msg":"record not found"} |
| POST | `/api/v1/vcjobs/training` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/vcjobs/tensorflow` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/vcjobs/pytorch` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/vcjobs` | 200 | ✅ | {"code":0,"data":{"items":[{"name":"测试","jobName":"vsc-crater-admin-261104-c774f |
| GET | `/api/v1/admin/vcjobs/facets` | 200 | ✅ | {"code":0,"data":{"facets":{"gpu_resource":[{"value":"gpu","count":1}],"job_type |
| GET | `/api/v1/admin/vcjobs/user/:username` | 200 | ✅ | {"code":0,"data":{"items":[{"name":"测试","jobName":"vsc-crater-admin-261104-c774f |
| GET | `/api/v1/admin/vcjobs/user/:username/facets` | 200 | ✅ | {"code":0,"data":{"facets":{"job_type":[{"value":"jupyter","count":3},{"value":" |
| GET | `/api/v1/admin/vcjobs/billing` | 200 | ✅ | {"code":0,"data":[{"jobName":"jpt-crater-admin-261104-7535f","name":"节点测试","bill |
| GET | `/api/v1/admin/vcjobs/billing/user/:username` | 200 | ✅ | {"code":0,"data":[{"jobName":"jpt-crater-admin-261104-7535f","name":"节点测试","bill |
| GET | `/api/v1/admin/vcjobs/:name/billing` | 200 | ✅ | {"code":0,"data":{"jobName":"","name":"","billedPointsTotal":0},"msg":""} |
| DELETE | `/api/v1/admin/vcjobs/:name` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/storage/capabilities` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/storage/dirsize/*path` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/storage/my-quota` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/admin/storage/capabilities` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/admin/storage/user-spaces` | 404 | ❌ | 路由不存在 |
| POST | `/api/v1/admin/storage/user-spaces/refresh` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/storage/user-spaces/:user/quota` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/storage/verify` | 200 | ✅ | {"code":0,"data":{"userId":1,"rootPath":"q-3","permission":3},"msg":""} |
| GET | `/api/dataset/source-logo/:sourceId` | 404 | ✅ |  |
| GET | `/api/v1/dataset/mydataset` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| GET | `/api/v1/dataset/:datasetId/usersNotIn` | 500 | ✅ | {"code":40001,"data":null,"msg":"this dataset not exist"} |
| GET | `/api/v1/dataset/:datasetId/usersIn` | 500 | ✅ | {"code":40001,"data":null,"msg":"this dataset not exist"} |
| GET | `/api/v1/dataset/:datasetId/queuesNotIn` | 500 | ✅ | {"code":40001,"data":null,"msg":"this dataset not exist"} |
| GET | `/api/v1/dataset/:datasetId/queuesIn` | 500 | ✅ | {"code":40001,"data":null,"msg":"this dataset not exist"} |
| POST | `/api/v1/dataset/create` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/dataset/delete/:id` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/dataset/share/user` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/dataset/share/queue` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/dataset/cancelshare/user` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/dataset/cancelshare/queue` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/dataset/detail/:datasetId` | 500 | ✅ | {"code":40001,"data":null,"msg":"this dataset not exist"} |
| POST | `/api/v1/dataset/update` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/dataset/alldataset` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| POST | `/api/v1/admin/dataset/share/user` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/dataset/share/queue` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/dataset/cancelshare/user` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/dataset/cancelshare/queue` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/resources` | 200 | ✅ | {"code":0,"data":[{"ID":4,"name":"hugepages-1Gi","vendorDomain":null,"resourceTy |
| GET | `/api/v1/resources/billing/prices` | 200 | ✅ | {"code":0,"data":[{"id":4,"name":"hugepages-1Gi","label":"hugepages-1Gi","unitPr |
| GET | `/api/v1/resources/:id/networks` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| GET | `/api/v1/resources/:id/vgpu` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| POST | `/api/v1/admin/resources/sync` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/resources/:id` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/resources/:id/billing/unit-price` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/admin/resources/:id` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/resources/:id/networks` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/resources/:id/networks` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| DELETE | `/api/v1/admin/resources/:id/networks/:networkId` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/resources/:id/vgpu` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/resources/:id/vgpu` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| PUT | `/api/v1/admin/resources/:id/vgpu/:vgpuId` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/admin/resources/:id/vgpu/:vgpuId` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/nodes` | 200 | ✅ | {"code":0,"data":[{"name":"llm002","role":"control-plane","arch":"amd64","status |
| PUT | `/api/v1/nodes/:name` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/nodes/:name` | 500 | ✅ | {"code":99999,"data":null,"msg":"List nodes pods failed, err Node \"测试\" not fou |
| GET | `/api/v1/nodes/:name/pods` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| GET | `/api/v1/nodes/:name/gpu` | 200 | ✅ | {"code":0,"data":{"name":"测试","haveGPU":false,"gpuCount":0,"gpuDevices":[],"gpuU |
| GET | `/api/v1/admin/nodes` | 200 | ✅ | {"code":0,"data":[{"name":"gpu004","role":"worker","arch":"amd64","status":"Read |
| GET | `/api/v1/admin/nodes/:name/pods` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| GET | `/api/v1/admin/nodes/:name/gpu` | 200 | ✅ | {"code":0,"data":{"name":"测试","haveGPU":false,"gpuCount":0,"gpuDevices":[],"gpuU |
| GET | `/api/v1/admin/nodes/:name/mark` | 500 | ✅ | {"code":99999,"data":null,"msg":"Get node marks failed, err Node \"测试\" not foun |
| POST | `/api/v1/admin/nodes/:name/label` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/admin/nodes/:name/label` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/nodes/:name/annotation` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/admin/nodes/:name/annotation` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/nodes/:name/taint` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/admin/nodes/:name/taint` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/nodes/:name/drain` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/statistics` | 400 | ✅ | {"code":40004,"data":null,"msg":"invalid query parameters"} |
| GET | `/api/v1/system-config/billing` | 200 | ✅ | {"code":0,"data":{"featureEnabled":true,"active":false,"runningSettlementEnabled |
| GET | `/api/v1/system-config/model-download-limit` | 200 | ✅ | {"code":0,"data":{"enabled":true,"maxConcurrent":5,"windowHours":2,"maxSuccessfu |
| GET | `/api/v1/admin/system-config/llm` | 200 | ✅ | {"code":0,"data":{"baseUrl":"http://172.16.16.110:3002/v1","apiKey":"*********** |
| PUT | `/api/v1/admin/system-config/llm` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/admin/system-config/llm` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/system-config/gpu-analysis` | 200 | ✅ | {"code":0,"data":{"enabled":false},"msg":""} |
| PUT | `/api/v1/admin/system-config/gpu-analysis` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/system-config/scheduler-extender` | 404 | ❌ | 路由不存在 |
| PUT | `/api/v1/admin/system-config/scheduler-extender` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/system-config/model-download-limit` | 200 | ✅ | {"code":0,"data":{"enabled":true,"maxConcurrent":5,"windowHours":2,"maxSuccessfu |
| PUT | `/api/v1/admin/system-config/model-download-limit` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/system-config/pod-bandwidth` | 200 | ✅ | {"code":0,"data":{"enabled":false,"modelDownloadBandwidth":"1G","jobIngressBandw |
| PUT | `/api/v1/admin/system-config/pod-bandwidth` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/system-config/billing` | 200 | ✅ | {"code":0,"data":{"featureEnabled":true,"active":false,"runningSettlementEnabled |
| PUT | `/api/v1/admin/system-config/billing` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/system-config/billing/reconcile` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/system-config/billing/reset-all` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/system-config/billing/extra-balance-all` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/approvalorder` | 200 | ✅ | {"code":0,"data":null,"msg":""} |
| GET | `/api/v1/approvalorder/:id` | 500 | ✅ | {"code":99999,"data":null,"msg":"approval order not found"} |
| POST | `/api/v1/approvalorder` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/approvalorder/:id` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/approvalorder/:id` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/approvalorder/name/:name` | 200 | ✅ | {"code":0,"data":null,"msg":""} |
| GET | `/api/v1/admin/approvalorder` | 200 | ✅ | {"code":0,"data":null,"msg":""} |
| GET | `/api/v1/admin/approvalorder/:id` | 500 | ✅ | {"code":99999,"data":null,"msg":"approval order not found"} |
| PUT | `/api/v1/admin/approvalorder/:id/review` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/approvalorder/check` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/model-download/models/download` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/model-download/models/downloads` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| GET | `/api/v1/model-download/models/downloads/:id` | 404 | ✅ | {"code":40401,"data":null,"msg":"download not found"} |
| GET | `/api/v1/model-download/models/downloads/:id/logs` | 404 | ✅ | {"code":40401,"data":null,"msg":"download not found"} |
| POST | `/api/v1/model-download/models/downloads/:id/retry` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/model-download/models/downloads/:id/pause` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/model-download/models/downloads/:id/resume` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/model-download/models/downloads/:id` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/model-download/models/downloads` | 200 | ✅ | {"code":0,"data":[],"msg":""} |
| DELETE | `/api/v1/admin/model-download/models/downloads/:id` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/queue-quotas` | 200 | ✅ | {"code":0,"data":{"quotas":[]},"msg":""} |
| POST | `/api/v1/admin/queue-quotas` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/queue-quotas/:id` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/admin/queue-quotas/:id` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/context/quota` | 200 | ✅ | {"code":0,"data":{"cpu":{"label":"cpu","allocated":{"amount":3,"format":"Decimal |
| GET | `/api/v1/context/job-resource-summary` | 200 | ✅ | {"code":0,"data":{"runningJobs":1,"pendingJobs":0,"cpu":{"used":"3","running":"3 |
| POST | `/api/v1/context/resource-limit-check` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/context/billing/summary` | 200 | ✅ | {"code":0,"data":{"periodFreeBalance":0,"extraBalance":0,"totalAvailable":0,"las |
| PUT | `/api/v1/context/attributes` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/context/email/code` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/context/email/update` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/jobtemplate/list` | 200 | ✅ | {"code":0,"data":null,"msg":""} |
| POST | `/api/v1/jobtemplate/create` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/jobtemplate/delete/:id` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/jobtemplate/:id` | 500 | ✅ | {"code":99999,"data":null,"msg":"Failed to get job template"} |
| PUT | `/api/v1/jobtemplate/update/:id` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/aijobs/:id/token` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/aijobs` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/aijobs/all` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/aijobs/quota` | 404 | ❌ | 路由不存在 |
| DELETE | `/api/v1/aijobs/:id` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/aijobs/:id/detail` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/aijobs/:id/yaml` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/aijobs/:id/pods` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/aijobs/:id/event` | 404 | ❌ | 路由不存在 |
| POST | `/api/v1/aijobs/training` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/aijobs/jupyter` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/aijobs` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/admin/aijobs/:id/detail` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/spjobs` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/spjobs/all` | 404 | ❌ | 路由不存在 |
| DELETE | `/api/v1/spjobs/:name` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/spjobs/:name/detail` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/spjobs/:name/yaml` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/spjobs/:name/pods` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/spjobs/:name/events` | 404 | ❌ | 路由不存在 |
| POST | `/api/v1/spjobs/training` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/spjobs/analyze` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/spjobs` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/admin/spjobs/:name/detail` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/admin/gpu-analysis` | 200 | ✅ | {"code":0,"data":null,"msg":""} |
| PUT | `/api/v1/admin/gpu-analysis/:id/review` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/gpu-analysis/:id/confirm-stop` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/gpu-analysis/trigger/pod` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/gpu-analysis/trigger/job` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/gpu-analysis/trigger/all-jobs` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/recommenddljob/analyze` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/operations/whitelist` | 200 | ✅ | {"code":0,"data":null,"msg":""} |
| PUT | `/api/v1/admin/operations/keep/:name` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/operations/cronjob` | 200 | ✅ | {"code":0,"data":{"configs":[{"ID":1,"CreatedAt":"2026-09-24T10:15:54.483638+08: |
| PUT | `/api/v1/admin/operations/cronjob` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/operations/add/locktime` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/operations/clear/locktime` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/operations/clean/clean-low-gpu-usage-job` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/operations/clean/clean-long-running-job` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/operations/clean/clean-waiting-jupyter-job` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/operations/clean/clean-waiting-custom-job` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/operations/cronjob/config/name` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/operations/cronjob/config/status` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/operations/cronjob/record/time` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/operations/cronjob/record/list` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/admin/operations/cronjob/record/delete` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/admin/operation-logs` | 200 | ✅ | {"code":0,"data":{"total":1,"items":[{"id":1,"operator":"crater-admin","operator |
| DELETE | `/api/v1/admin/operation-logs` | SKIP | — | 有副作用，未探测 |
| GET | `/api/tensorboard/auth` | 404 | ❌ | 路由不存在 |
| POST | `/api/v1/tensorboard` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/tensorboard` | 404 | ❌ | 路由不存在 |
| GET | `/api/v1/tensorboard/source/:jobName` | 404 | ❌ | 路由不存在 |
| DELETE | `/api/v1/tensorboard/:id` | SKIP | — | 有副作用，未探测 |
| POST | `/api/v1/tensorboard/:id/access` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/namespaces/:namespace/pods/:name/events` | 200 | ✅ | {"code":0,"data":null,"msg":""} |
| GET | `/api/v1/namespaces/:namespace/pods/:name/containers` | 500 | ✅ | {"code":99999,"data":null,"msg":"Pod \"测试\" not found"} |
| GET | `/api/v1/namespaces/:namespace/pods/:name/containers/:container/log` | 500 | ✅ | {"code":99999,"data":null,"msg":"failed to get log: the server could not find th |
| GET | `/api/v1/namespaces/:namespace/pods/:name/containers/:container/log/stream` | 500 | ✅ | {"code":99999,"data":null,"msg":"failed to get log stream: pods \"测试\" not found |
| GET | `/api/v1/namespaces/:namespace/pods/:name/ingresses` | 200 | ✅ | {"code":0,"data":{"ingresses":[]},"msg":""} |
| POST | `/api/v1/namespaces/:namespace/pods/:name/ingresses` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/namespaces/:namespace/pods/:name/ingresses` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/namespaces/:namespace/pods/:name/nodeports` | 500 | ✅ | {"code":99999,"data":null,"msg":"Pod \"测试\" not found"} |
| POST | `/api/v1/namespaces/:namespace/pods/:name/nodeports` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/v1/namespaces/:namespace/pods/:name/nodeports` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/namespaces/:namespace/pods/:name/resources` | SKIP | — | 有副作用，未探测 |
| PUT | `/api/v1/admin/namespaces/:namespace/pods/:name/containers/:container/resources` | SKIP | — | 有副作用，未探测 |
| GET | `/api/v1/websocket/namespaces/:namespace/pods/:name/containers/:container/terminal` | 400 | ✅ | Bad Request {"code":40001,"data":null,"msg":"websocket: the client is not using  |
| GET | `/api/cli/compatibility` | 200 | ✅ | {"code":0,"data":{"apiVersion":1,"minSupportedCliApiVersion":1,"appVersion":"dev |
| GET | `/api/metrics` | 200 | ✅ | # HELP completed_jobs_total Total number of completed jobs # TYPE completed_jobs |
| GET | `/api/ss/download/*path` | 400 | ✅ | {"code":40001,"data":null,"msg":"can't find file"} |
| POST | `/api/ss/upload/*path` | SKIP | — | 有副作用，未探测 |
| DELETE | `/api/ss/delete/*path` | SKIP | — | 有副作用，未探测 |
| GET | `/api/ss/userspace` | 200 | ✅ | {"code":0,"data":[{"username":"test","space":"test"},{"username":"lijianxin","sp |
| GET | `/api/ss/queuespace` | 200 | ✅ | {"code":0,"data":[{"queuename":"default","space":"/public"},{"queuename":"q-3"," |
| POST | `/api/ss/move/*path` | SKIP | — | 有副作用，未探测 |
| POST | `/api/ss/datasets/:id/move` | SKIP | — | 有副作用，未探测 |
| POST | `/api/ss/datasets/restore` | SKIP | — | 有副作用，未探测 |
