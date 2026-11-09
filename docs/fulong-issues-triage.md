# fulong 反馈的 5 个问题：逐条定位结论（2026-11-09）

用**新建测试账号 `clitest12`（普通用户）+ 官方 CLI（本机从源码构建，版本 dev/ef78b10）**逐条复现。
结论：**2 个是真平台缺陷（已修）、1 个是运维配置缺失（已补）、1 个是环境/网络表现（有可改进项）、1 个与平台无关**。

| # | 用户描述 | 结论 | 状态 |
| --- | --- | --- | --- |
| 1 | `crater file upload` 返回 404 | **真缺陷**：线上 storage-server 镜像是上游预编译版，缺 `POST /api/ss/upload/*path` 路由 | 已修（换用自建镜像） |
| 2 | 私有 Harbor 项目镜像 401 拉不下来 | **真缺陷（配置）**：拉取机器人 `robot$crater-pull-all` 的项目权限里没有 `user-fulong` | 已修（补权限并实测 pull 成功） |
| 3 | Jupyter 创建失败：ingress host 配成 IP | **真缺陷（代码）**：`config.host=172.16.16.140`（IP）被直接写进 `spec.rules[0].host` | 已修（IP/空 host 退化为按路径路由） |
| 4 | SSH / 端口转发入口不稳定 | **部分可改进**：入口本身可用（实测可达），但 NodePort 随作业重建变化、路径入口要求严格尾斜杠 | 待改（给方案） |
| 5 | `python:3.11-slim` glibc 拒绝加载需可执行栈的库 | **与平台无关**：容器基础镜像 + TensorRT 库的 `execstack` 问题 | 给用户侧解法 |

---

## 1. `crater file upload` 404 —— 真缺陷，已修

**复现（admin 与普通用户均相同）**：

```
$ crater file upload probe.txt user/probe.txt
Error: HTTP 404: 404 page not found
```

**定位**：

- 后端源码里 `POST /api/ss/upload/*path → UploadFile` 是**存在**的（`internal/storage/file.go` 的 `RegisterFile`）；
- 但 `/api/ss/**` 实际不是 crater-backend 提供的：ingress `crater-workspace/storage-server-ingress` 把 `/api/ss` 转给
  `crater-acl-gw:7320` → 上游 `webdav-service`；
- 该服务跑的是**上游预编译镜像** `mirror/ghcr.io/raids-lab/storage-server:latest`；
- pod 内直接 `POST localhost:8088/api/ss/upload/...` 也 404，而 `GET /api/ss/files`、`DELETE /api/ss/delete` 正常
  → 说明镜像里的路由表**没有 upload**（比我们源码旧）。

**修复**：

1. 用本仓库源码构建 `cmd/storage-server`，做镜像 `crater/crater-storage:uploadfix3/ingressfix-20261109`；
2. Deployment `crater-workspace/webdav-deployment` 换用该镜像，并加环境变量 **`GIN_MODE=release`**
   （debug 模式会去找 `./etc/debug-config.yaml` 而启动失败；release 模式读 `/etc/config/config.yaml`，即挂载的 `ss-config`）；
3. 容器以 root 运行（PVC `/crater` 下子目录属主不一致，非 root 会 500 `permission denied`，日志可佐证）。

**验证（普通用户 clitest12，严格独立 CLI 配置目录）**：

```
crater file upload normal-probe.txt user/normal-probe.txt   → Uploaded ... (34 bytes)
crater file ls user/                                        → normal-probe.txt  file 34
crater file download user/normal-probe.txt dl.txt           → Downloaded（内容回读一致）
crater file rm user/normal-probe.txt --yes                  → Removed
```

**回滚**：`kubectl -n crater-workspace set image deploy/webdav-deployment webdav=172.16.16.126:30003/mirror/ghcr.io/raids-lab/storage-server:latest`

---

## 2. 私有 Harbor 项目镜像 401 —— 拉取机器人少了一个项目，已修

**证据（Harbor API `/api/v2.0/robots`，注意 Harbor UI 在 **30013** 端口）**：

```
robot$crater-pull-all   level=system
  project:user-lijianxin / user-test / user-test1 / user-crater-admin / user-jvkit   ← 没有 user-fulong
```

而 fulong 的镜像就在 `user-fulong`（私有项目，2 个仓库：`v100-bench`、`comfyui-minimax-h3-v100`）。
作业 Pod 的 `imagePullSecrets` 只有 `harbor-cred`（= 该机器人），所以拉自己的镜像 **401**。

**修复**：给机器人补 `user-fulong`（`repository:pull` + `artifact:read`），`PUT /api/v2.0/robots/1` → 200。

**验证**：

```
GET http://172.16.16.126:30003/v2/user-fulong/v100-bench/tags/list  (robot 凭据) → 200 {"tags":["v1"]}
docker pull 172.16.16.126:30003/user-fulong/v100-bench:v1           → Downloaded newer image ✅
```

**遗留建议**：这属于"新用户/新项目要手工授权"的坑。已有 CronJob `harbor-user-project-guard`，应该扩展到
「项目创建时自动给 `crater-pull-all` 授权」，否则每新增一个用户都会重演。

---

## 3. Jupyter 创建失败（ingress host 是 IP）—— 真缺陷，已修

**复现**：

```
$ crater job create jupyter --name probe --image busybox:latest --cpu 1 --memory 1Gi
Error: HTTP 500: failed to create jupyter ingress: Ingress.networking.k8s.io "ing-...-notebook" is invalid:
spec.rules[0].host: Invalid value: "172.16.16.140": must be a DNS name, not an IP address
```

**根因**：`internal/service/vcjob/runtime.go` 里 jupyter 分支调用
`CreateIngressWithPrefix(..., config.GetConfig().Host, baseURL)`，而集群配置 `host: 172.16.16.140` 是 **IP**；
`pkg/crclient/service.go` 直接把它塞进 `Rules[0].Host`，K8s 拒绝。修掉 host 后还有第二层：
`spec.tls[0].hosts[0]: Invalid value: ""`（TLS 也要跳过）。

**修复（`pkg/crclient/service.go`）**：

```go
host = normalizeIngressHost(host)  // 空 / IP / 带 scheme / 带端口 → 归一化为 ""
...
if host != "" { ingress.Spec.TLS = []networkingv1.IngressTLS{{Hosts: []string{host}, SecretName: ...}} }
...
if host == "" { return prefix, nil }   // 无域名时返回相对路径，由前端拼平台地址
```

**验证**：

```
clitest12: crater job create jupyter --name user-jup-test ... → job submitted（jpt-clitest12-261109-f9d6d）
           crater job ls → 只看到自己 1 条（自作用域正常）
```

> 顺带说明：之前 webide 能建成功，是因为它走的是 `CreateNamedIngress`（host 拼成 `9eefa-3.172.16.16.140`
> 这种"标签.IP"形式，RFC1123 校验碰巧通过），而 jupyter 走的是把 host 原样当 host 的路径 —— 两条代码路径不一致才是根因。

---

## 4. SSH / 端口转发"不稳定" —— 入口本身可用，但有两个已知弱点

**实测（从用户网络侧）**：

| 检查 | 结果 |
| --- | --- |
| SSH 入口 `np-<user>-<id>`（NodePort 32443） | 三个节点 IP（.126/.127/.130）**全部可连** ✅ |
| webide 路径入口 `/ingress/<baseurl>/` | HTTP 302（跳到带尾斜杠的地址）✅ |
| `/ingress/<baseurl>/lab`（少一次重定向、或不带尾斜杠） | **404** ⚠️ |
| ingress-nginx | 1/1 Running ✅ |

**结论**：不是"完全到不了"，而是**容易用错地址**。两个真实弱点：

1. **SSH 端口随作业重建变化**：NodePort 由 Service 随机分配、且 Service 带 ownerReference 随作业删除；
   用户保存的 `ssh -p 32443` 在作业重建后就失效 → 表现为"时好时坏"。
2. **端口转发是路径重写入口**：`use-regex + rewrite-target=/$1`，必须严格带尾斜杠；且 `.../lab` 这类少一层
   重定向的地址会 404。很多客户端（Jupyter/WebIDE 里的绝对路径跳转、WebSocket 升级）对这种前缀重写敏感。

**建议改法（未实施，等确认）**：
- SSH 改用**固定端口池**（按用户/账号分配 nodePort，或统一走 `crater-cli ssh` 的 `kubectl port-forward` 隧道），避免每次作业重建后端口变化；
- 转发入口统一由平台生成**带尾斜杠的完整 URL**并在前端展示，同时给 ingress 增加
  `nginx.ingress.kubernetes.io/proxy-read-timeout`（已有 3600）与 `proxy-http-version 1.1` / websocket 支持。

---

## 5. `python:3.11-slim` glibc 拒绝加载需可执行栈的库 —— 与 Crater 无关

现象是 TensorRT builder（`libnvinfer_builder_resource.so`）要求 **executable stack**，
而较新的 glibc（2.41）/containerd 默认拒绝 `RWE` 段。这是**容器基础镜像 + 第三方库**的问题，不是平台调度/存储/网络问题。

用户侧解法（任选其一）：
- 用官方 TensorRT 镜像（`nvcr.io/nvidia/tensorrt:*`）作为 base，而不是 `python:3.11-slim`；
- 对库打补丁降低栈权限：`execstack -c libnvinfer_builder_resource.so.*` 或 `patchelf --clear-execstack`；
- 构建时加 `--security-opt seccomp=unconfined`（不推荐长期）；
- 平台侧可做的只有：在文档里给出上面三条，无需改代码。

---

## 附：本次验证对生产的影响与现场还原

| 项目 | 说明 |
| --- | --- |
| 测试账号 | `clitest12`（普通用户，验证后保留便于复测，可随时封禁）；`clitest11` 已永久封禁 |
| 测试作业 | 全部删除，集群无残留（`kubectl get vcjob,pod` 已核） |
| 节点状态 | 未占用，`taints=None` |
| 变更的线上组件 | `crater-backend`→`ingressfix2-20261109`；`webdav-deployment`→`crater-storage:ingressfix-20261109`（+`GIN_MODE=release`）；Harbor 机器人权限+1 项 |
| 回滚方式 | 后端/前端镜像 tag 都可回退；存储服务回滚见第 1 节 |

---

## 追加（2026-11-09 中午）：Jupyter 页面 "Something went wrong!" 的三层原因

修完 ingress host 后，作业能建、能跑、ingress 也在，但浏览器打开 `/ingress/jupyter/<jobName>` 只看到
JupyterLab 的 **"Something went wrong!"**。继续拆，一共三层，缺一层都不通：

| 层 | 现象 | 根因 | 处理 |
| --- | --- | --- | --- |
| ① 创建 | 建作业直接 500 | `config.host` 是 IP，被原样写进 `spec.rules[0].host` | 已修（IP/空 → 按路径路由，`cb73775`） |
| ② 网络 | 经 ingress 访问 Pod **超时**（集群内直连也超时） | 作业创建时下发**与作业同名的 NetworkPolicy**，`ingress[].from` 只允许**同一 volcano 作业的 Pod**；ingress-nginx 不在白名单 → 全部丢弃 | 新增命名空间级放行策略 `allow-ingress-nginx-web-access`（NetworkPolicy 是并集，只加不减，不削弱作业隔离）。清单：`crater-deploy/manifests/networkpolicy-allow-ingress-nginx.yaml` |
| ③ 地址 | iframe 加载后被浏览器拦 | 后端把访问地址写死成 `https://<host>/ingress/...`（jupyter）和 `https://<prefix>.<host>`（webide）；平台是 **http 访问 + 自签证书**，且 `<prefix>.<IP>` 根本无法解析 | 已修：无可用域名时返回同源相对路径 `/ingress/<baseURL>`、`/ingress/<baseURL>-<prefix>` |

**排查关键证据**：

```
# ② 层：pod 内监听正常，但外部连不上
pod 内 /proc/net/tcp → 00000000:22B8 (LISTEN, 0.0.0.0:8888) ✅
同节点探针 nc -vz 10.52.2.158 8888 → Connection timed out ❌
cilium endpoint 列表 → POLICY (ingress) = Enabled          ← 有策略在生效
kubectl get netpol jpt-... → from: podSelector{volcano.sh/job-name=<同作业>}  ← ingress-nginx 不在其中
补一条 namespaceSelector=ingress-nginx 后 → 立刻 200
```

**最终验收（浏览器实测）**：打开 `/ingress/jupyter/jpt-crater-admin-261109-83ad9`，
内嵌 JupyterLab 正常渲染（Launcher / Notebook / Python 3 kernel / Console / Terminal 全部可用），
控制台无 JS 错误。测试作业已删除。

> 顺带发现：**webide 的入口地址也是坏的**（`https://c964b-1.172.16.16.140` 无法解析），
> 已一并改成 path 形式，实测 `GET /ingress/crater-admin-261109-c964b-c964b-1/` → 200。
