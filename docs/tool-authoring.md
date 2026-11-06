# 工具开发规范（给实现者 / 给 agent）

本文件是 `src/tools/*.ts` 的统一契约。新增工具只改对应业务域文件，**不要**改 `src/registry.ts`、`src/client.ts`、`src/scope.ts`、`src/index.ts`。

## 1. 一个工具 = 一条 ToolSpec

```ts
// src/registry.ts（节选，实际类型以此为准）
export interface ToolSpec {
  name: string;              // crater_<group>_<action>，全小写+下划线，全局唯一
  group: string;             // jobs / images / files / resources / datasets / admin / auth / profile
  title: string;             // 中文短语，会显示在客户端工具列表里
  description: string;       // 中文，必须说清：做什么、什么时候用、有什么坑
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;              // 完整路径，含 :param / *path 占位，例如 /api/v1/vcjobs/:name/logs
  target?: "main" | "storage";   // storage = 独立进程 storage-server 的 /api/ss/*
  scope: "public" | "self" | "account" | "admin";
  readOnly: boolean;         // 只读=true；任何写操作必须 false（只读模式下会被 MCP 拦住）
  destructive?: boolean;     // 删除/覆盖/停止类操作置 true
  input?: z.ZodRawShape;     // 向 agent 暴露的参数 schema（用 zod，字段要写 .describe()）
  pathParams?: string[];     // input 里用于替换 :param 的键名
  query?: string[];          // input 里作为 query 透传的键名
  body?: "all" | "none" | string[];  // input 里作为 JSON body 的键名；"all"=除 path/query 外全部
  run?: (args, ctx) => Promise<unknown>;  // 复杂场景（多步、二进制、本地文件）才用
  format?: (data, args) => string;        // 需要定制输出文本时才写
}
```

通用执行器会自动：替换路径占位符 → 组 query → 组 JSON body → 带 JWT 请求 → 拆响应外壳 `{code,data}` → 返回 JSON。
`run` 里可以直接用 `ctx.client.request/uploadFile/downloadFile/mkdir/moveFile/removeFile`。

**参考实现**：`src/tools/auth.ts`（含 `run` 自定义）、`src/tools/profile.ts`（含增量语义与多步调用）。

## 2. 硬性约束（违反即视为 bug）

1. **不许碰集群底层**：禁止封装 `/api/v1/namespaces/**`（Pod 终端、容器日志、exec）、`/api/v1/nodes/:name`（PUT）等 k8s 级接口——它们绕过 Crater 的业务权限模型。管理端工具只能封装 `/api/v1/admin/**`。
2. **不许封装「宽接口」**用于非管理员：`GET /api/v1/vcjobs/all`、`/vcjobs/user/:username`、`/vcjobs/billing/all`、`/aijobs/all`、`GET /api/v1/statistics`（跨用户维度）、`GET /api/v1/dataset/detail/:id`。这些只在 `admin` 组出现，且必须 `scope: "admin"`。
3. **只封装 `docs/api-inventory.md` 里确认存在的路径**。表里没有的路径不要凭直觉写。若某能力确实需要但清单里标了 `⚠️待确认`，跳过并在汇报里列出来。
4. **scope 语义**：
   - `self` = 后端按 `UserID` 过滤，只能看/改自己的；
   - `account` = 账号（项目）内共享，判定依赖 `AccountID`；
   - `admin` = 需要 `rolePlatform == 3`；
   - `public` = 免登录（注册/登录/认证模式/whoami 这类）。
5. **写操作一律 `readOnly: false`**；删除/停止/覆盖类额外加 `destructive: true`。
6. **描述必须写清前置条件**。例如创建作业类工具要写明「需要先知道镜像名、可用 GPU 型号、account 名，建议先调 crater_resources_list / crater_images_list」。
7. **不要吞错**：不要 try/catch 后返回假成功。通用执行器抛出的 `CraterError` 会被 MCP 转成带建议的可读错误。
8. **不要打印或用日志泄露 token / 密码**。

## 3. 命名与描述风格

- 工具名：`crater_<group>_<动词短语>`，如 `crater_jobs_create_webide`、`crater_images_build_kaniko`、`crater_admin_users_ban`。
- title：6–14 字中文短语，如「创建 WebIDE 作业」「用 pip/apt 构建镜像」。
- description：3 句以内，包含：① 作用 ② 关键必填项或前置条件 ③ 一个坑/注意点。

## 4. 参数 schema 约定

- 路径参数必须出现在 `input` 里，并写进 `pathParams`，名字与 `:param` 一致。
- 分页用 `page` / `pageSize`；筛选参数放 `query`。
- 枚举型参数用 `z.enum([...])` 或 `z.number().int()` + `.describe()` 说明取值含义（如 1=guest 2=user 3=admin）。
- 可选字段加 `.optional()`；不要给必填字段设默认值来「猜」用户意图。

## 5. 完成标准

- `npx tsc -p tsconfig.json --noEmit` 通过（只允许他人文件尚未写完导致的报错）。
- `node dist/index.js --check` 输出里本组工具数正确、无命名冲突。
- 每个工具都能在 `--list` 里看到 `[METHOD path]`，且与清单一致。
