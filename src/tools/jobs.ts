/**
 * 组：jobs —— 作业（Volcano vcjob）创建 / 查询 / 日志 / 启停 / 入口凭据
 *
 * 事实来源（已按源码 + 线上实测校正，见 docs/verified-routes.md）：
 * 1. 列表是 `GET /api/v1/vcjobs`（后端按 `UserID + AccountID` 双重过滤，只能看自己的）；
 *    `/vcjobs/all`、`/vcjobs/user/:username` 是「Protected 但不校验归属」的宽接口，归 admin 组，本组不封装。
 * 2. 路径参数 `:name` 必须是 **jobName**（k8s 名，如 `vsc-alice-261104-c774f`），不是中文显示名 `name`；
 *    用显示名会 500 `record not found`。本组所有作业级工具都先做一次「jobName / 显示名」解析（`resolveJobName`），
 *    顺带起到归属校验作用（列表本身只返回自己的作业）。
 * 3. **vcjobs 下没有 `/logs` 路由**（实测 404）。容器日志的真实链路是
 *    `/vcjobs/:jobName/pods` → `/namespaces/:ns/pods/:pod/containers` → `/namespaces/:ns/pods/:pod/containers/:c/log`，
 *    且最后一跳返回的 `data` 是 **base64 编码的原始字节**，必须解码。`src/scope.ts` 只为这一条日志路径开了受控例外。
 * 4. 创建作业走 Go 结构体（`internal/handler/vcjob/{jupyter,webide,custom,tensorflow}.go`）：
 *    公共字段 `CreateJobCommon` + 各类型特有字段；`resource` 是 k8s `ResourceList` 的 map[string]string，
 *    GPU 键随型号（`nvidia.com/gpu`、`nvidia.com/a100`…）；`image` 是 `{imageLink, archs}`；
 *    命令入口是 `shell`/`command`/`workingDir`（custom 与 task）；交互作业的启动命令由后端写死。
 * 5. `datasetMounts` 虽然出现在 `CreateJobCommon` 里，但**没有任何 handler 读它**（挂载全部走 `volumeMounts[type=2]`），
 *    所以这里不暴露它，避免「传了却静默无效」。
 */
import { z } from "zod";
import { defaultFormat, type ToolContext, type ToolSpec } from "../registry.js";
import { GuardError } from "../errors.js";

/* ------------------------------------------------------------------ *
 * 常量与通用说明
 * ------------------------------------------------------------------ */

const JOBNAME_HINT =
  "作业的 jobName（列表返回的 jobName 字段，k8s 名，如 vsc-alice-261104-c774f）。" +
  "它不是中文显示名 name；若你确实传了显示名，本工具会先查一次 /api/v1/vcjobs 尝试自动解析（同名多义会报错）。";

const PRECHECK_NOTE =
  "提交前建议先确认：① 镜像名（crater_images_list）② 可用 GPU 型号与资源键名（crater_resources_list）" +
  "③ 当前用量与余额（crater_jobs_billing / crater_profile_quota）④ 用 crater_jobs_resource_limit_check 干跑一次限额。";

const JOB_TYPES = ["jupyter", "webide", "pytorch", "tensorflow", "kuberay", "deepspeed", "openmpi", "custom"] as const;

/** 单容器作业的容器名 = jobType（后端建 Pod 时容器名就是类型名） */
const DEFAULT_CONTAINER_BY_TYPE: Record<string, string> = {
  webide: "webide",
  jupyter: "jupyter",
  custom: "custom",
};


const JOB_STATUSES = [
  "Prequeue",
  "Pending",
  "Aborting",
  "Aborted",
  "Running",
  "Restarting",
  "Completing",
  "Completed",
  "Terminating",
  "Terminated",
  "Failed",
  "Deleted",
  "Freed",
  "Cancelled",
] as const;

/* ------------------------------------------------------------------ *
 * 解析 & 小工具
 * ------------------------------------------------------------------ */

interface JobListItem {
  name?: string | null;
  jobName?: string | null;
  jobType?: string | null;
  status?: string | null;
  queue?: string | null;
  createdAt?: string | null;
  resources?: Record<string, string> | null;
}

interface JobPageResp {
  items?: JobListItem[] | null;
  total?: number | null;
  page?: number | null;
  page_size?: number | null;
}

interface PodDetailItem {
  name?: string | null;
  namespace?: string | null;
  nodename?: string | null;
  ip?: string | null;
  port?: string | null;
  phase?: string | null;
  resource?: Record<string, string> | null;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function asInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter((x): x is string => !!x);
  const one = asString(v);
  return one ? [one] : [];
}

function formatResources(res?: Record<string, string> | null): string {
  if (!res) return "-";
  const parts = Object.entries(res).map(([k, v]) => `${k}=${String(v)}`);
  return parts.length ? parts.join(", ") : "-";
}

interface ResolvedJob {
  jobName: string;
  jobType?: string;
}

/**
 * 把「用户可能传的显示名」解析成真正的 jobName（顺带带回 jobType）。
 *
 * 注意：`/api/v1/vcjobs` 后端按 UserID+AccountID 过滤，所以这里查得到的作业一定属于调用者；
 * 查不到就直接报错——不会把「别人的作业名」透传给后端（等于 MCP 侧的归属白名单）。
 */
async function resolveJob(ctx: ToolContext, raw: unknown): Promise<ResolvedJob> {
  const value = asString(raw);
  if (!value) throw new GuardError("jobName 不能为空，请传 crater_jobs_list 返回的 jobName 字段");

  const page = await ctx.client.request<JobPageResp | null>({
    method: "GET",
    path: "/api/v1/vcjobs",
    query: { page: 1, page_size: 200, days: -1, search: value },
  });
  const items = page?.items ?? [];

  const exact = items.find((j) => j.jobName === value);
  if (exact) return { jobName: value, jobType: exact.jobType ?? undefined };

  const byDisplayName = items.filter((j) => (j.name ?? "").trim() === value);
  const first = byDisplayName[0];
  if (byDisplayName.length === 1 && first?.jobName) {
    return { jobName: first.jobName, jobType: first.jobType ?? undefined };
  }
  if (byDisplayName.length > 1) {
    const candidates = byDisplayName.map((j) => `${j.jobName ?? "?"}(${j.jobType ?? "?"})`).join("、");
    throw new GuardError(
      `显示名「${value}」对应 ${byDisplayName.length} 个作业：${candidates}。请改用具体的 jobName。`,
    );
  }

  throw new GuardError(
    `你的作业列表里找不到 jobName 或显示名为「${value}」的作业（列表按当前用户 + 当前账号过滤，别人的作业看不到）。` +
      `请先调 crater_jobs_list 拿到准确的 jobName；若作业确实存在，确认它是否在另一个账号/项目下（crater_auth_switch_account）。`,
  );
}

async function resolveJobName(ctx: ToolContext, raw: unknown): Promise<string> {
  return (await resolveJob(ctx, raw)).jobName;
}

/** 把后端 `[]byte` 被 JSON 化的 base64 日志解回文本 */
function decodeLogPayload(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") return defaultFormat(raw);
  const compact = raw.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return raw;
  const decoded = Buffer.from(compact, "base64").toString("utf8");
  const roundTrip = Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "");
  return roundTrip === compact.replace(/=+$/, "") ? decoded : raw;
}

function buildJobListQuery(args: Record<string, unknown>): Record<string, string | number> {
  const q: Record<string, string | number> = {};
  const page = asInt(args.page);
  if (page !== undefined) q.page = page;
  const pageSize = asInt(args.pageSize);
  if (pageSize !== undefined) q.page_size = pageSize;
  const days = asInt(args.days);
  if (days !== undefined) q.days = days;
  const sort = asString(args.sort);
  if (sort) q.sort = sort;
  const search = asString(args.search);
  if (search) q.search = search;
  const node = asString(args.node);
  if (node) q.node = node;
  const types = asStringArray(args.jobTypes);
  if (types.length) q.job_type = types.join(",");
  const statuses = asStringArray(args.statuses);
  if (statuses.length) q.status = statuses.join(",");
  return q;
}

/** 创建成功后把 volcano Job 对象裁剪成有用信息 */
function formatCreated(data: unknown): string {
  const job = data as
    | {
        metadata?: { name?: string; annotations?: Record<string, string> };
        spec?: { queue?: string };
        status?: { state?: { phase?: string } };
      }
    | null
    | undefined;
  const jobName = job?.metadata?.name;
  if (!jobName) return defaultFormat(data);
  const displayName = job?.metadata?.annotations?.["crater.raids.io/task-name"];
  return [
    `作业已提交：jobName=${jobName}${displayName ? `（显示名：${displayName}）` : ""}`,
    `队列=${job?.spec?.queue ?? "?"}，当前相位=${job?.status?.state?.phase ?? "刚创建，尚未回填"}`,
    "下一步：crater_jobs_list 看状态 → crater_jobs_get 看详情/事件 → crater_jobs_logs 看日志；" +
      "WebIDE 用 crater_jobs_get_secret、Jupyter 用 crater_jobs_get_token 取入口地址与凭据。",
    "作业完整 YAML 可用 crater_jobs_yaml 查看。",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * 参数 schema 片段（字段名严格对齐 Go struct 的 json tag）
 * ------------------------------------------------------------------ */

const resourceSchema = z
  .record(z.string(), z.string())
  .describe(
    "k8s 资源量（map<string,string>）。标准键：cpu（如 \"4\"）、memory（如 \"16Gi\"）、" +
      "GPU 键随型号：nvidia.com/gpu 或 nvidia.com/a100 等（先用 crater_resources_list 确认可用键名）。" +
      "requests 与 limits 由后端按 cpuPinningEnabled 自动派生，这里只传一份。",
  );

const imageSchema = z.object({
  imageLink: z
    .string()
    .min(1)
    .describe("镜像完整地址，例如 harbor.example.com/raids/hep_container:2025-01-15；先用 crater_images_list / crater_images_available 确认"),
  archs: z
    .array(z.string())
    .optional()
    .describe("镜像支持的架构，如 [\"amd64\"] / [\"arm64\"]；不填则不加架构亲和，amd64/arm64 混部时可能调度到错误架构节点"),
});

const volumeMountSchema = z.object({
  type: z
    .number()
    .int()
    .min(1)
    .max(2)
    .optional()
    .describe("挂载类型：1=文件/目录（用 subPath 指定逻辑路径，默认值）；2=数据集（用 datasetID 指定）"),
  datasetID: z.number().int().min(1).optional().describe("type=2 时必填：数据集 ID（crater_datasets_mine 的 id）"),
  subPath: z
    .string()
    .optional()
    .describe(
      "type=1 时必填：逻辑路径，第一段必须是 user / account / public，" +
        "例如 user/exp1（我的空间）、account/shared/data（账号共享）、public/datasets/coco；其他前缀后端会报 invalid mount path format",
    ),
  mountPath: z.string().min(1).describe("容器内挂载点绝对路径，例如 /home/alice/exp1 或 /data"),
});

const envSchema = z.object({
  name: z.string().min(1).describe("环境变量名"),
  value: z.string().describe("环境变量值（明文存放，不要放密码/令牌）"),
});

const selectorSchema = z.object({
  key: z.string().min(1).describe("节点标签键，例如 kubernetes.io/hostname、nvidia.com/gpu.product"),
  operator: z
    .enum(["In", "NotIn", "Exists", "DoesNotExist", "Gt", "Lt"])
    .describe("比较算子；Exists/DoesNotExist 不需要 values"),
  values: z.array(z.string()).optional().describe("比较值列表，In/NotIn 必填"),
});

const forwardSchema = z.object({
  type: z.number().int().min(1).max(2).optional().describe("1=Ingress（走平台域名 + 鉴权，默认）；2=NodePort（直接暴露节点端口）"),
  name: z.string().min(1).describe("端口名，同时作为转发规则名，例如 tensorboard"),
  port: z.number().int().min(1).max(65535).describe("容器内要对外暴露的端口"),
});

/** CreateJobCommon（所有创建接口都内联这些字段） */
function createCommonShape(): z.ZodRawShape {
  return {
    name: z
      .string()
      .min(1)
      .describe("作业显示名（作业列表里的「名称」，中文可以）。它不是 k8s 名：k8s 名由后端按类型前缀生成（jpt/sg/tf/pt/vsc）"),
    volumeMounts: z
      .array(volumeMountSchema)
      .optional()
      .describe("存储/数据集挂载。数据集用 type=2 + datasetID；普通目录用 type=1 + subPath"),
    envs: z.array(envSchema).optional().describe("容器环境变量（后端还会自动追加 NB_USER / NB_UID / NB_GID）"),
    selectors: z
      .array(selectorSchema)
      .optional()
      .describe("节点选择约束（传了就变成 **required** 亲和，标签写错会一直 Pending；不传则后端按是否申请 GPU 自动给软亲和）"),
    template: z.string().optional().describe("作业模板名（来自 crater_jobs_templates），只记录来源，不影响调度"),
    alertEnabled: z
      .boolean()
      .optional()
      .describe("作业结束时是否发邮件通知；为 true 时要求邮箱已验证，否则后端直接报 UserEmailNotVerified"),
    cpuPinningEnabled: z
      .boolean()
      .optional()
      .describe("是否 CPU 绑核（requests=limits，独占物理核，适合性能测试）；不填为 false（limits 比 requests 多 1m CPU / 1Mi 内存，便于在线调资源）"),
    forwards: z
      .array(forwardSchema)
      .optional()
      .describe("把容器端口暴露出去（TensorBoard、自定义 API 等）；不填则只有交互作业自带入口"),
  };
}

const taskSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("角色名，同时作为容器名与 volcano task 名：master / worker / ps / chief 等；名为 worker 的角色完成会触发整个作业成功"),
  replicas: z.number().int().min(1).describe("该角色的副本数（分布式训练里 master/ps 通常为 1）"),
  resource: resourceSchema,
  image: imageSchema,
  shell: z.string().optional().describe("入口 shell，默认 sh；只有同时给了 command 才生效"),
  command: z.string().optional().describe("启动命令（后端拼成 `<shell> -c <command>`）；不填则用镜像自带 ENTRYPOINT"),
  workingDir: z.string().optional().describe("容器工作目录，例如 /home/alice/exp1"),
  ports: z
    .array(
      z.object({
        name: z.string().min(1).describe("端口名（框架约定名，如 tf-job-port、master-port、pt-dist-port）"),
        port: z.number().int().min(1).max(65535).describe("容器端口号"),
      }),
    )
    .optional()
    .describe("容器端口声明；分布式框架（TF / PyTorch）靠端口名互相发现，名字要与镜像里的框架配置一致"),
});

/* ------------------------------------------------------------------ *
 * 便捷工厂：所有「按 jobName 操作」的工具共用同一套解析 + 调用逻辑
 * ------------------------------------------------------------------ */

interface JobByNameConfig {
  name: string;
  title: string;
  description: string;
  /** 路径后缀（不含 jobName），例如 "/detail"；空串表示作业本体 */
  suffix: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  readOnly: boolean;
  destructive?: boolean;
  format?: (data: unknown, args: Record<string, unknown>) => string;
}

function jobByNameSpec(cfg: JobByNameConfig): ToolSpec {
  const spec: ToolSpec = {
    name: cfg.name,
    group: "jobs",
    title: cfg.title,
    description: cfg.description,
    method: cfg.method,
    path: `/api/v1/vcjobs/:name${cfg.suffix}`,
    scope: "self",
    readOnly: cfg.readOnly,
    input: { jobName: z.string().min(1).describe(JOBNAME_HINT) },
    run: async (args, ctx) => {
      const jobName = await resolveJobName(ctx, args.jobName);
      return ctx.client.request({
        method: cfg.method,
        path: `/api/v1/vcjobs/${encodeURIComponent(jobName)}${cfg.suffix}`,
      });
    },
  };
  if (cfg.destructive !== undefined) spec.destructive = cfg.destructive;
  if (cfg.format) spec.format = cfg.format;
  return spec;
}

/* ------------------------------------------------------------------ *
 * 工具定义
 * ------------------------------------------------------------------ */

export const specs: ToolSpec[] = [
  /* ---------------- 创建类（写） ---------------- */
  {
    name: "crater_jobs_create_webide",
    group: "jobs",
    title: "创建 WebIDE 作业（code-server）",
    description:
      "提交一个基于 code-server 的交互式 WebIDE 作业（容器名 webide、端口 8888），启动后用 crater_jobs_get_secret 取访问地址与随机密码。" +
      PRECHECK_NOTE +
      "注意：交互作业有**并发数上限**（后端 CheckInteractiveLimitBeforeCreate），超了会直接拒绝；这类作业默认 3 天后随 TTL 回收。",
    method: "POST",
    path: "/api/v1/vcjobs/webide",
    scope: "self",
    readOnly: false,
    input: {
      ...createCommonShape(),
      resource: resourceSchema,
      image: imageSchema.describe("镜像**必填**：必须自带 code-server（WebIDE 镜像），普通训练镜像启动会立刻失败"),
    },
    body: "all",
    format: formatCreated,
  },
  {
    name: "crater_jobs_create_jupyter",
    group: "jobs",
    title: "创建 Jupyter 作业",
    description:
      "提交一个 JupyterLab 交互式作业（容器名 jupyter、端口 8888），启动后用 crater_jobs_get_token 取带 token 的访问地址。" +
      PRECHECK_NOTE +
      "注意：交互作业有并发上限；`/token` 只在作业 Running 时可用，对其他类型作业调它会报 Job type is not Jupyter。",
    method: "POST",
    path: "/api/v1/vcjobs/jupyter",
    scope: "self",
    readOnly: false,
    input: {
      ...createCommonShape(),
      resource: resourceSchema,
      image: imageSchema.describe("镜像**必填**：需要自带 jupyter lab 与 /usr/local/bin/unified-start.sh 的镜像"),
    },
    body: "all",
    format: formatCreated,
  },
  {
    name: "crater_jobs_create_training",
    group: "jobs",
    title: "创建自定义（custom）训练作业",
    description:
      "提交一个单机 custom 作业（jobType=custom、k8s 名前缀 sg-）：自己指定镜像、shell/command、workingDir，跑完即结束，适合训练脚本与批处理。" +
      "`workingDir` **必填**（后端 binding:required）；只给镜像不给 command 时用镜像 ENTRYPOINT。" +
      "注意：`forwards` 里配的端口只在容器存活期间有效，作业结束入口即消失。",
    method: "POST",
    path: "/api/v1/vcjobs/training",
    scope: "self",
    readOnly: false,
    input: {
      ...createCommonShape(),
      resource: resourceSchema,
      image: imageSchema,
      shell: z.string().optional().describe("启动 shell，例如 bash 或 sh；不填时后端默认 sh（仅当给了 command 才生效）"),
      command: z.string().optional().describe("启动命令，例如 `python train.py --epochs 10`（后端拼成 `<shell> -c <command>`）"),
      workingDir: z.string().min(1).describe("容器工作目录，**必填**，例如 /home/alice/exp1（通常指向你已挂载的目录）"),
    },
    body: "all",
    format: formatCreated,
  },
  {
    name: "crater_jobs_create_pytorch",
    group: "jobs",
    title: "创建 PyTorch 分布式作业",
    description:
      "提交多角色 PyTorch 训练作业（k8s 名前缀 pt-）：请求体与 tensorflow 完全一致，按 tasks 声明 master/worker 等角色，各自 replicas、资源、镜像、命令与端口。" +
      "注意：至少要有一个角色的 name 是 worker —— 只有 worker 完成才会把整个作业标记成功；" +
      "分布式端口靠 `ports` 的 name 与镜像内框架配置（MASTER_ADDR / MASTER_PORT）对齐，写错会一直卡在通信。",
    method: "POST",
    path: "/api/v1/vcjobs/pytorch",
    scope: "self",
    readOnly: false,
    input: {
      ...createCommonShape(),
      tasks: z.array(taskSchema).min(1).describe("角色列表（必填，至少 1 个）；常见写法：master(replicas=1) + worker(replicas=N)"),
    },
    body: "all",
    format: formatCreated,
  },
  {
    name: "crater_jobs_create_tensorflow",
    group: "jobs",
    title: "创建 TensorFlow 分布式作业",
    description:
      "提交多角色 TensorFlow 训练作业（k8s 名前缀 tf-）：结构同 pytorch，tasks 里声明 ps/worker/chief 等角色，后端按角色建 volcano 多任务并启用 svc/env 插件。" +
      "注意：MinAvailable 取所有角色 replicas 之和，必须全部排上才启动，单角色资源写大了会整体 Pending；" +
      "`selectors` 一旦填就是强制亲和，标签写错会永远调度不上。",
    method: "POST",
    path: "/api/v1/vcjobs/tensorflow",
    scope: "self",
    readOnly: false,
    input: {
      ...createCommonShape(),
      tasks: z.array(taskSchema).min(1).describe("角色列表（必填）；TF 常见写法：ps(replicas=1) + worker(replicas=N)"),
    },
    body: "all",
    format: formatCreated,
  },

  /* ---------------- 查询类（只读） ---------------- */
  {
    name: "crater_jobs_list",
    group: "jobs",
    title: "我的作业列表",
    description:
      "分页列出**我自己的**作业（后端按 UserID + AccountID 双过滤，看不到别人的）。返回含 jobName（后续所有作业级工具的入参）、显示名、类型、状态、账号、资源。" +
      "注意：每页条数默认 10、最大 200，翻页请显式传 pageSize；`days` 不传等于全部历史，传 7 只看 7 天内创建的。",
    method: "GET",
    path: "/api/v1/vcjobs",
    scope: "self",
    readOnly: true,
    input: {
      page: z.number().int().min(1).optional().describe("页码，从 1 开始，默认 1"),
      pageSize: z.number().int().min(1).max(200).optional().describe("每页条数，默认 10，最大 200"),
      days: z.number().int().optional().describe("只看最近 N 天创建的作业（-1 = 全部，默认 -1）"),
      search: z.string().optional().describe("关键字（对显示名、jobName、账号、用户名等模糊匹配，最长 128 字符）"),
      sort: z
        .string()
        .optional()
        .describe(
          "排序字段，逗号分隔最多 3 个，字段前加 - 表示倒序；可用：createdAt / jobName / name / status / jobType / " +
            "owner / queue / billedPointsTotal / startedAt / completedAt，默认 createdAt 倒序",
        ),
      jobTypes: z.array(z.enum(JOB_TYPES)).optional().describe("按作业类型过滤（多选）"),
      statuses: z.array(z.enum(JOB_STATUSES)).optional().describe("按状态过滤（多选），如 [\"Running\"]"),
      node: z.string().optional().describe("只看跑在某个节点上的作业（节点名）"),
    },
    run: async (args, ctx) =>
      ctx.client.request({ method: "GET", path: "/api/v1/vcjobs", query: buildJobListQuery(args) }),
    format: (data) => {
      const page = data as JobPageResp | null;
      const items = page?.items ?? [];
      if (!items.length) return "没有符合条件的作业（换个 days / search / statuses，或确认当前账号下确实没提交过）。";
      const lines = items.map(
        (j) =>
          `${j.jobName ?? "?"} | ${j.name ?? "-"} | ${j.jobType ?? "-"} | ${j.status ?? "-"} | ${j.queue ?? "-"} | ` +
          `${j.createdAt ?? "-"} | ${formatResources(j.resources)}`,
      );
      return [
        `共 ${page?.total ?? items.length} 个作业（第 ${page?.page ?? 1} 页，每页 ${page?.page_size ?? items.length}）`,
        "jobName | 显示名 | 类型 | 状态 | 账号 | 创建时间 | 资源",
        ...lines,
        "",
        "后续用 jobName（第一列）调用 crater_jobs_get / crater_jobs_logs / crater_jobs_stop 等。",
      ].join("\n");
    },
  },
  {
    name: "crater_jobs_facets",
    group: "jobs",
    title: "我的作业筛选项聚合",
    description:
      "返回我自己作业的 facet 聚合（job_type / status 各自的分组计数），用于先摸清「我有哪些类型、哪些状态的作业」再发精确的列表查询。",
    method: "GET",
    path: "/api/v1/vcjobs/facets",
    scope: "self",
    readOnly: true,
    input: {
      days: z.number().int().optional().describe("只看最近 N 天（-1 = 全部，默认 -1）"),
      search: z.string().optional().describe("关键字过滤"),
      jobTypes: z.array(z.enum(JOB_TYPES)).optional().describe("按类型过滤"),
      statuses: z.array(z.enum(JOB_STATUSES)).optional().describe("按状态过滤"),
      node: z.string().optional().describe("节点名过滤"),
    },
    run: async (args, ctx) =>
      ctx.client.request({ method: "GET", path: "/api/v1/vcjobs/facets", query: buildJobListQuery(args) }),
  },
  {
    name: "crater_jobs_billing",
    group: "jobs",
    title: "我的作业计费汇总",
    description:
      "返回我的作业计费汇总（逐作业的计费点数合计）。用于核对「我的作业花了多少」；账号余额请用 crater_profile_billing_summary。",
    method: "GET",
    path: "/api/v1/vcjobs/billing",
    scope: "self",
    readOnly: true,
    input: {},
  },
  jobByNameSpec({
    name: "crater_jobs_get",
    title: "作业详情（含 Pod、事件、终止原因）",
    description:
      "按 jobName 取作业详情：状态、队列、资源、用户名/昵称、namespace、profileData（资源使用画像）、scheduleData（拉镜像耗时）、events 与容器终止状态。" +
      "排查「为什么一直 Pending / 为什么失败」的第一站。返回 record not found 通常说明传的是显示名、或作业属于别人。",
    suffix: "/detail",
    method: "GET",
    readOnly: true,
  }),
  jobByNameSpec({
    name: "crater_jobs_pods",
    title: "作业的 Pod 列表",
    description:
      "列出该作业当前的所有 Pod（name / namespace / nodename / ip / port / phase / 资源）。crater_jobs_logs 内部就是靠它定位 Pod。" +
      "注意 Pod 只在作业存活期间存在，作业结束（TTL 回收）后再查会是空列表。",
    suffix: "/pods",
    method: "GET",
    readOnly: true,
  }),
  jobByNameSpec({
    name: "crater_jobs_yaml",
    title: "作业 YAML",
    description:
      "返回该作业在集群里的完整 Volcano Job YAML（含 task / affinity / volumes 等）。排查调度失败、亲和写错、挂载缺失时比详情更直观。" +
      "注意输出可能很长，不要整段贴回给用户。",
    suffix: "/yaml",
    method: "GET",
    readOnly: true,
  }),
  jobByNameSpec({
    name: "crater_jobs_events",
    title: "作业与 Pod 事件",
    description:
      "返回该作业相关的事件列表（调度失败、镜像拉取失败、OOMKilled、被驱逐等都在这里）。作业起不来但详情里没有原因时优先看它。" +
      "注意事件有时效性，过期会被集群清理。",
    suffix: "/event",
    method: "GET",
    readOnly: true,
  }),
  jobByNameSpec({
    name: "crater_jobs_billing_detail",
    title: "单作业计费明细",
    description:
      "返回该作业的计费点数合计（jobName / name / billedPointsTotal）。平台未开启计费或对普通用户不开放时，返回的是全 0 的空结构。",
    suffix: "/billing",
    method: "GET",
    readOnly: true,
  }),
  jobByNameSpec({
    name: "crater_jobs_template_from_job",
    title: "由作业反推提交参数",
    description:
      "读取该作业的提交参数快照（后端由作业自身的记录还原成 Create*Req 的公共部分），用于「照着这个作业再提一个」。" +
      "返回内容可喂给 crater_jobs_create_*；注意它不含新作业的 name（显示名），需要你自己重新起。",
    suffix: "/template",
    method: "GET",
    readOnly: true,
  }),
  jobByNameSpec({
    name: "crater_jobs_get_token",
    title: "取 Jupyter 入口地址与 token",
    description:
      "返回 Jupyter 作业的入口：baseURL / fullURL / token / podName / namespace，直接用 fullURL 打开即可。" +
      "**仅 Jupyter 类型**且作业必须 Running（否则报 Job not running / Job type is not Jupyter）。" +
      "返回内容含**访问凭据**（token 等于登录密码），不要回显给第三方或写进文档。",
    suffix: "/token",
    method: "GET",
    readOnly: true,
    format: (data) =>
      ["⚠️ 以下含访问凭据（token 可直接登录你的 Jupyter），只在本地使用，不要写进文档/仓库。", defaultFormat(data)].join("\n"),
  }),
  jobByNameSpec({
    name: "crater_jobs_get_secret",
    title: "取 WebIDE 入口凭据",
    description:
      "返回 WebIDE 作业的入口（baseURL / fullURL / token / podName / namespace），其中 token 就是 code-server 的随机密码。" +
      "**仅 WebIDE 类型**且作业必须 Running；后端会进容器读 ~/.config/code-server/config.yaml 并缓存到作业注解。" +
      "返回内容含**敏感凭据**，不要写入日志、不要提交到仓库。",
    suffix: "/secret",
    method: "GET",
    readOnly: true,
    format: (data) =>
      ["⚠️ 以下含敏感凭据（WebIDE 登录密码），只在本地使用，不要写进文档/仓库。", defaultFormat(data)].join("\n"),
  }),

  /* ---------------- 日志（只读，三步链路） ---------------- */
  {
    name: "crater_jobs_logs",
    group: "jobs",
    title: "作业容器日志（尾部 N 行）",
    description:
      "拉取作业某个 Pod 的容器日志尾部。vcjobs 下**没有** /logs 路由，这里按真实链路自己走三步：作业 Pod 列表 → 容器列表 → 容器日志接口，" +
      "并把后端返回的 base64 解码成文本；调用前先用你自己的作业列表校验该作业确实属于你，不会读别人的 Pod。" +
      "注意：只能读**正在运行或尚未回收**的作业，作业结束且 Pod 被删时拿不到日志，应改用 crater_jobs_events 或详情里的 terminatedStates。",
    method: "GET",
    path: "/api/v1/namespaces/:namespace/pods/:name/containers/:container/log",
    scope: "self",
    readOnly: true,
    input: {
      jobName: z.string().min(1).describe(JOBNAME_HINT),
      container: z
        .string()
        .optional()
        .describe(
          "容器名；不填时按作业类型自动取（WebIDE=webide、Jupyter=jupyter、custom=custom），" +
            "分布式作业会自动查 Pod 的容器列表取第一个，也可以用本参数显式指定角色名（如 worker）",
        ),
      tailLines: z.number().int().min(1).max(2000).optional().describe("返回最后多少行，默认 200，最大 2000"),
      podIndex: z.number().int().min(0).optional().describe("多 Pod 作业取第几个 Pod（从 0 开始，顺序同 crater_jobs_pods），默认 0"),
    },
    run: async (args, ctx) => {
      const { jobName, jobType } = await resolveJob(ctx, args.jobName);

      const pods =
        (await ctx.client.request<PodDetailItem[] | null>({
          method: "GET",
          path: `/api/v1/vcjobs/${encodeURIComponent(jobName)}/pods`,
        })) ?? [];
      if (!Array.isArray(pods) || pods.length === 0) {
        throw new GuardError(
          `作业 ${jobName} 当前没有任何 Pod：可能还在排队（Prequeue/Pending）、或已结束且 Pod 已被回收。` +
            `请先 crater_jobs_get 看状态、crater_jobs_events 看事件。`,
        );
      }

      const podIndex = asInt(args.podIndex) ?? 0;
      const pod = pods[podIndex];
      if (!pod?.name || !pod.namespace) {
        throw new GuardError(
          `podIndex=${podIndex} 越界：作业 ${jobName} 当前只有 ${pods.length} 个 Pod（下标从 0 开始）。` +
            `可用 crater_jobs_pods 查看顺序。`,
        );
      }

      let container = asString(args.container) ?? DEFAULT_CONTAINER_BY_TYPE[jobType ?? ""];
      if (!container) {
        const resp = await ctx.client.request<{ containers?: { name?: string }[] } | null>({
          method: "GET",
          path: `/api/v1/namespaces/${encodeURIComponent(pod.namespace)}/pods/${encodeURIComponent(pod.name)}/containers`,
        });
        const names = (resp?.containers ?? []).map((c) => asString(c?.name)).filter((n): n is string => !!n);
        const first = names[0];
        if (!first) {
          throw new GuardError(
            `没能从 Pod ${pod.name} 拿到容器列表，请显式传 container 参数` +
              `（WebIDE=webide、Jupyter=jupyter、custom=custom、分布式作业=角色名如 worker）。`,
          );
        }
        container = first;
      }

      const tailLines = asInt(args.tailLines) ?? 200;
      const raw = await ctx.client.request<unknown>({
        method: "GET",
        path:
          `/api/v1/namespaces/${encodeURIComponent(pod.namespace)}/pods/${encodeURIComponent(pod.name)}` +
          `/containers/${encodeURIComponent(container)}/log`,
        query: { tailLines },
      });

      return {
        jobName,
        podName: pod.name,
        namespace: pod.namespace,
        podPhase: pod.phase ?? null,
        node: pod.nodename ?? null,
        container,
        tailLines,
        logs: decodeLogPayload(raw),
      };
    },
    format: (data) => {
      const d = data as {
        jobName?: string;
        podName?: string;
        namespace?: string;
        container?: string;
        tailLines?: number;
        podPhase?: string | null;
        logs?: string;
      };
      const head =
        `# job=${d.jobName ?? "?"} pod=${d.podName ?? "?"} ns=${d.namespace ?? "?"} ` +
        `container=${d.container ?? "?"} phase=${d.podPhase ?? "?"} 最后 ${d.tailLines ?? "?"} 行`;
      const body = d.logs && d.logs.length ? d.logs : "（日志为空：作业可能刚启动，或该容器还没输出；稍后重试或换 podIndex）";
      return `${head}\n${body}`;
    },
  },

  /* ---------------- 操作类（写） ---------------- */
  jobByNameSpec({
    name: "crater_jobs_stop",
    title: "停止 / 删除作业",
    description:
      "删除作业（DELETE /api/v1/vcjobs/:name）：运行中的作业会被终止、Pod 被回收，**不可恢复**——这也是「停止作业」的唯一入口（后端没有单独的 stop 接口）。" +
      "删除前后端会先结算计费；非管理员只能删自己的作业。执行前建议先用 crater_jobs_get 确认 jobName，避免删错。",
    suffix: "",
    method: "DELETE",
    readOnly: false,
    destructive: true,
    format: (data, args) =>
      [
        `已请求删除作业 ${String(args.jobName ?? "")}。稍后用 crater_jobs_list / crater_jobs_get 确认是否已变为 Deleted / Terminated。`,
        defaultFormat(data),
      ].join("\n"),
  }),
  jobByNameSpec({
    name: "crater_jobs_set_alert",
    title: "开关作业邮件提醒",
    description:
      "切换该作业的「结束邮件提醒」开关（PUT /api/v1/vcjobs/:name/alert）。注意它**没有目标值参数、是取反**：连续调两次等于没改。" +
      "发信要求你的邮箱已验证（GET /api/v1/users/email/verified），可用 crater_profile_verify_email 完成验证。",
    suffix: "/alert",
    method: "PUT",
    readOnly: false,
    format: (data, args) =>
      [
        `已切换作业 ${String(args.jobName ?? "")} 的邮件提醒状态（本次是取反操作，再调一次会切回去）。`,
        defaultFormat(data),
      ].join("\n"),
  }),
  jobByNameSpec({
    name: "crater_jobs_ssh",
    title: "为作业开启 SSH 并取连接信息",
    description:
      "为该作业的 Pod 启动 sshd 并建 NodePort Service，返回节点 IP 与端口（可 `ssh -p <port> <你的用户名>@<ip>`）。" +
      "要求作业 **Running**，且镜像里带 sshd 服务（否则报 ServiceSshdNotFound）；首次调用会在容器内创建 sshd 用户并重启服务，属写操作。" +
      "注意端口是**节点级暴露**的，用完请及时删除作业或在平台回收。",
    suffix: "/ssh",
    method: "POST",
    readOnly: false,
    format: (data) =>
      ["⚠️ 已在节点上暴露 SSH 端口，连接信息如下（用完记得回收）：", defaultFormat(data)].join("\n"),
  }),
  jobByNameSpec({
    name: "crater_jobs_snapshot",
    title: "把作业容器打包成镜像",
    description:
      "对运行中的单 Pod 作业做快照（nerdctl commit），把当前容器状态打包成一张新镜像并返回镜像地址，后续可用它提交新作业。" +
      "硬性要求：作业只有 1 个节点、1 个 Pod、1 个容器且 Pod 处于 Running；还需要镜像构建权限（被 ban ImageBuild 会 403）。" +
      "这是**耗时较久**的异步操作（要推送 Harbor），期间不要重复调用。",
    suffix: "/snapshot",
    method: "POST",
    readOnly: false,
    format: (data) =>
      [
        "快照已提交（后端异步打包镜像，可能需数分钟）。返回的镜像地址可直接用于后续创建作业；进度可看 crater_images_kaniko_list。",
        defaultFormat(data),
      ].join("\n"),
  }),

  /* ---------------- 提交前资源预检（无副作用） ---------------- */
  {
    name: "crater_jobs_resource_limit_check",
    group: "jobs",
    title: "提交前资源限额干跑检查",
    description:
      "把「我打算申请的资源配置」发给后端做一次限额预检（POST /api/v1/context/resource-limit-check），返回会不会超出当前账号/队列限额。" +
      "只检查、不会真的提交作业，是 crater_jobs_create_* 之前最省事的防坑动作。" +
      "注意：它只校验限额与配额，**不校验镜像是否存在、存储配额、余额**，那几项仍是创建时的独立校验。",
    method: "POST",
    path: "/api/v1/context/resource-limit-check",
    scope: "self",
    // 虽然是 POST，但后端只读不写（纯预检、无副作用），因此按只读工具暴露：
    // 这样在 CRATER_READ_ONLY=true 时也能用，且 MCP 客户端不会向人类索要写确认。
    readOnly: true,
    input: {
      requestedResources: resourceSchema.describe(
        "本次想申请的资源（map<string,string>），键与创建作业的 resource 完全一致：cpu / memory / nvidia.com/gpu 等",
      ),
    },
    body: ["requestedResources"],
  },

  /* ---------------- 作业模板（只读） ---------------- */
  {
    name: "crater_jobs_templates",
    group: "jobs",
    title: "作业模板列表",
    description:
      "列出平台上的作业模板（id / 名称 / 描述 / 文档 / 模板体 / 创建者），用于创建作业时填 `template` 字段，或参考别人的参数。" +
      "注意：该接口后端**不按归属过滤**（SQL 只有 `WHERE ID IS NOT NULL`），会返回他人私有模板——只读参考、不要外传。" +
      "线上返回 null 表示当前没有任何模板。",
    method: "GET",
    path: "/api/v1/jobtemplate/list",
    scope: "self",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_jobs_template_get",
    group: "jobs",
    title: "作业模板详情",
    description:
      "按数字 id 取单个作业模板详情（含模板体 template，通常是 YAML/JSON，可直接参考或改写成 crater_jobs_create_* 的入参）。" +
      "id 来自 crater_jobs_templates；id 不存在时后端返回「Failed to get job template」。",
    method: "GET",
    path: "/api/v1/jobtemplate/:id",
    scope: "self",
    readOnly: true,
    input: { id: z.number().int().min(1).describe("作业模板 ID（crater_jobs_templates 返回的 id）") },
    pathParams: ["id"],
  },
];
