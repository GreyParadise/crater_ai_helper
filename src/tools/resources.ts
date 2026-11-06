/**
 * 组：resources —— 资源型号 / 节点 / 统计 / 当前上下文（全部只读）
 * 对应接口：docs/api-inventory.md §2.10（resources）、§2.11（nodes）、§2.17（context）、§3.7（统计与上下文结构体）
 * 实测矩阵：docs/verified-routes.md（✅/❌）
 *
 * 设计约束（见 docs/tool-authoring.md §2、docs/mcp-design.md §5.1）：
 * 1. 不封装 `GET /api/v1/statistics`：它支持 scope=user/account/cluster 跨用户维度（§4.2-D），
 *    非管理员在 src/scope.ts 会被整条路径拦下；本组改用 context 系列（后端按 UserID+AccountID 过滤）。
 *    全平台维度统计如需暴露，只能标 scope="admin" 并放进 admin 组，不属于本组。
 * 2. 不封装 `/api/v1/namespaces/**`（Pod 终端 / 容器日志 / exec），也不封装 `PUT /api/v1/nodes/:name`（改节点调度状态）。
 * 3. 全部 readOnly: true；数据均为快照，用于「提交作业前判断资源够不够」。
 */
import { z } from "zod";
import type { ToolSpec } from "../registry.js";
import type { CraterClient } from "../client.js";

/** 后端 /api/v1/resources 返回项（handler/resource.go ResourceResp） */
interface ResourceItem {
  ID?: number;
  name?: string;
  label?: string;
  resourceType?: string;
  type?: string | null;
  amount?: number;
  amountSingleMax?: number;
  format?: string;
  vendorDomain?: string | null;
  priority?: number;
}

/** 节点列表项（pkg/crclient.NodeBriefInfo） */
interface NodeItem {
  name?: string;
  role?: string;
  status?: string;
  arch?: string;
  vendor?: string;
  allocatable?: Record<string, string>;
  used?: Record<string, string>;
  workloads?: number;
  gpuDriver?: string;
  address?: string;
}

/** 统一提示：所有本组数据都是快照 */
const SNAPSHOT_NOTE =
  "这些数字来自数据库 / Prometheus / kubelet 快照（秒级到分钟级延迟），只用于「提交作业前判断资源够不够」，实时余量与最终排队结果以调度器为准。";

/** 单个子请求失败时不拖垮整体：以 {ok,error} 形式显式透出，绝不伪装成功 */
type Settled<T> = { ok: true; data: T } | { ok: false; error: string };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, data: await p };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function valueOrError(s: Settled<unknown>): unknown {
  return s.ok ? s.data : { error: s.error };
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

async function getJson(client: CraterClient, path: string): Promise<unknown> {
  return client.request<unknown>({ method: "GET", path });
}

/** 资源 ID 是数据库自增主键（数字），不是资源名 */
const resourceIdShape = {
  id: z
    .coerce.number()
    .int()
    .min(1)
    .describe("资源 ID（数字主键，从 crater_resources_list 返回的 ID 字段取，不是资源名如 nvidia.com/v100）"),
};

export const specs: ToolSpec[] = [
  // ---------------- 资源型号 / 网络 / vGPU / 单价（§2.10） ----------------
  {
    name: "crater_resources_list",
    group: "resources",
    title: "资源型号与总量清单",
    description:
      "列出集群在册的资源型号：GPU（如 nvidia.com/v100）、vGPU、RDMA 网络、CPU、内存、hugepages 等，含总量 amount、单卡上限 amountSingleMax、标签 label 与数字 ID。" +
      "提交作业前先调它确认可申请的 accelerator 名字与规格；withVendorDomain=true 只看 GPU 类资源。" +
      SNAPSHOT_NOTE +
      "注意这里的 amount 是集群总量，不是当前空闲量——空闲情况请看 crater_stats_overview 或 crater_nodes_list。",
    method: "GET",
    path: "/api/v1/resources",
    scope: "account",
    readOnly: true,
    input: {
      withVendorDomain: z
        .boolean()
        .optional()
        .describe("是否只返回 GPU 类型资源（后端按 type=gpu 过滤，默认 false 返回全部资源）"),
    },
    query: ["withVendorDomain"],
  },
  {
    name: "crater_resources_networks",
    group: "resources",
    title: "GPU 关联的 RDMA 网络",
    description:
      "查某个 GPU 资源型号关联的 RDMA/RoCE 网络资源（多机分布式训练需要选对网络时用）。" +
      "id 必须是 crater_resources_list 里的数字 ID；资源不是 GPU 类型或未配置关联时后端返回空数组，不会报错。" +
      "关联关系是数据库里的配置快照（只有管理员改过才会变），用于提交多机作业前判断网络够不够、该选哪种互联。",
    method: "GET",
    path: "/api/v1/resources/:id/networks",
    scope: "account",
    readOnly: true,
    input: resourceIdShape,
    pathParams: ["id"],
  },
  {
    name: "crater_resources_vgpu",
    group: "resources",
    title: "GPU 切分 vGPU 配置",
    description:
      "查某个 GPU 资源型号能切分出的 vGPU 资源及其约束（vGPU 资源、最小/最大切分粒度），用于判断能否申请 1/4 卡之类的切分规格。" +
      "id 必须是 crater_resources_list 里的数字 ID；未配置 vGPU 时返回空数组。" +
      "切分配置是数据库快照（仅管理员可改），用于提交小规格作业前判断能申请多大切分的卡。",
    method: "GET",
    path: "/api/v1/resources/:id/vgpu",
    scope: "account",
    readOnly: true,
    input: resourceIdShape,
    pathParams: ["id"],
  },
  {
    name: "crater_resources_prices",
    group: "resources",
    title: "资源计费单价",
    description:
      "返回各资源的计费单价（每单位时间的点数）。只有平台开启计费且对用户可见时单价才非 0，否则全是 0（说明本部署不计费）。" +
      "用它估算一次作业的花费；自己还剩多少额度请看 crater_stats_mine 或 crater_profile_billing_summary。单价是快照，管理员改价后新作业立即按新价计。",
    method: "GET",
    path: "/api/v1/resources/billing/prices",
    scope: "account",
    readOnly: true,
    input: {},
  },

  // ---------------- 节点（§2.11） ----------------
  {
    name: "crater_nodes_list",
    group: "resources",
    title: "集群节点列表",
    description:
      "列出所有节点的角色（control-plane/worker）、状态、capacity/allocatable/used、在跑作业数（workloads）、GPU 驱动与地址。" +
      "用于提交前判断集群整体还有没有空闲卡、节点是否 Ready 或不可调度（Unschedulable）；单节点细节用 crater_nodes_get。" +
      SNAPSHOT_NOTE,
    method: "GET",
    path: "/api/v1/nodes",
    scope: "account",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_nodes_get",
    group: "resources",
    title: "节点详情",
    description:
      "返回单个节点的详细信息：capacity/allocatable/used、GPU 型号与数量、显存、GPU 架构与驱动、容器运行时、内核版本等。" +
      "节点名必须精确匹配，建议先用 crater_nodes_list 拿名字；名字写错后端返回 500『Node \"xxx\" not found』而不是空结果。" +
      SNAPSHOT_NOTE,
    method: "GET",
    path: "/api/v1/nodes/:name",
    scope: "account",
    readOnly: true,
    input: { name: z.string().min(1).describe("节点名，例如 gpu004（需与 crater_nodes_list 的 name 完全一致）") },
    pathParams: ["name"],
  },
  {
    name: "crater_nodes_gpu",
    group: "resources",
    title: "节点 GPU 明细",
    description:
      "列出某节点的 GPU 明细：每种 GPU 的资源名/型号/数量/显存/架构/驱动/CUDA，每张卡的利用率（gpuUtil）与关联作业（relateJobs）。" +
      "用于判断该节点是否还有整卡空闲；haveGPU=false 表示该节点没有 GPU（此时 gpuDevices 为空）。" +
      SNAPSHOT_NOTE,
    method: "GET",
    path: "/api/v1/nodes/:name/gpu",
    scope: "account",
    readOnly: true,
    input: { name: z.string().min(1).describe("节点名，需与 crater_nodes_list 的 name 完全一致") },
    pathParams: ["name"],
  },
  {
    name: "crater_nodes_pods",
    group: "resources",
    title: "节点上的 Pod 列表",
    description:
      "列出某节点上正在运行的 Pod（命名空间、状态、requests/limits、占用者用户名与账号、是否被锁定），用于看节点被谁占满、哪些 Pod 占着卡。" +
      "这是集群级只读视图，含他人 Pod 的基本信息，只用于容量判断；它不返回日志/终端（Pod 日志与 exec 属于本 MCP 明确不封装的 /api/v1/namespaces/**）。" +
      SNAPSHOT_NOTE,
    method: "GET",
    path: "/api/v1/nodes/:name/pods",
    scope: "account",
    readOnly: true,
    input: { name: z.string().min(1).describe("节点名，需与 crater_nodes_list 的 name 完全一致") },
    pathParams: ["name"],
  },

  // ---------------- 统计（§2.12 替代方案，§3.7） ----------------
  {
    name: "crater_stats_overview",
    group: "resources",
    title: "资源概览（够不够用）",
    description:
      "提交作业前的一次性概览：把资源型号清单、节点状态汇总（按状态计数 + 各类 GPU 的 allocatable 总量）与「我的用量」拼成一份快照，用来判断「还有没有卡、我还能不能用」。" +
      "它由 3 个只读接口拼成（/api/v1/resources、/api/v1/nodes、/api/v1/context/job-resource-summary），**不是** GET /api/v1/statistics——后者支持跨用户维度，非管理员会被 MCP 拦下。" +
      SNAPSHOT_NOTE +
      "某一个子接口失败时会在 errors 里说明，其余部分照常返回。",
    method: "GET",
    path: "/api/v1/nodes",
    scope: "account",
    readOnly: true,
    input: {},
    run: async (_args, ctx) => {
      const [resourcesRes, nodesRes, usageRes] = await Promise.all([
        settle(getJson(ctx.client, "/api/v1/resources")),
        settle(getJson(ctx.client, "/api/v1/nodes")),
        settle(getJson(ctx.client, "/api/v1/context/job-resource-summary")),
      ]);

      const nodes = asArray<NodeItem>(nodesRes.ok ? nodesRes.data : []);
      const resources = asArray<ResourceItem>(resourcesRes.ok ? resourcesRes.data : []);

      const byStatus: Record<string, number> = {};
      for (const node of nodes) {
        const status = typeof node.status === "string" && node.status ? node.status : "Unknown";
        byStatus[status] = (byStatus[status] ?? 0) + 1;
      }

      const gpuAllocatable: Record<string, number> = {};
      for (const node of nodes) {
        for (const [key, raw] of Object.entries(node.allocatable ?? {})) {
          if (!/gpu/i.test(key)) continue;
          const amount = Number.parseInt(String(raw), 10);
          if (Number.isFinite(amount)) gpuAllocatable[key] = (gpuAllocatable[key] ?? 0) + amount;
        }
      }

      const errors: string[] = [];
      if (!resourcesRes.ok) errors.push(`/api/v1/resources 失败：${resourcesRes.error}`);
      if (!nodesRes.ok) errors.push(`/api/v1/nodes 失败：${nodesRes.error}`);
      if (!usageRes.ok) errors.push(`/api/v1/context/job-resource-summary 失败：${usageRes.error}`);

      return {
        snapshotAt: new Date().toISOString(),
        note: SNAPSHOT_NOTE,
        clusterNodes: nodesRes.ok
          ? {
              total: nodes.length,
              byStatus,
              byRole: nodes.reduce<Record<string, number>>((acc, node) => {
                const role = typeof node.role === "string" && node.role ? node.role : "unknown";
                acc[role] = (acc[role] ?? 0) + 1;
                return acc;
              }, {}),
              gpuAllocatable,
            }
          : { error: nodesRes.error },
        resourceTypes: resourcesRes.ok
          ? resources.map((r) => ({
              id: r.ID,
              name: r.name,
              label: r.label,
              type: r.type ?? r.resourceType,
              amount: r.amount,
              amountSingleMax: r.amountSingleMax,
            }))
          : { error: resourcesRes.error },
        myUsage: valueOrError(usageRes),
        errors,
      };
    },
  },
  {
    name: "crater_stats_mine",
    group: "resources",
    title: "我的用量统计",
    description:
      "只看「我自己 + 当前账号」维度的用量统计：Volcano 配额与已用（context/quota）、运行/排队作业数与 CPU/内存/各加速器的 used/running/pending/limit（context/job-resource-summary）、计费余额（context/billing/summary）。" +
      "三个接口后端都按 UserID+AccountID 过滤，所以看不到任何他人数据——本组刻意不封装 GET /api/v1/statistics（它支持 scope=user 查任意用户 / scope=cluster 查全平台，非管理员会被 MCP 拦截）。" +
      SNAPSHOT_NOTE,
    method: "GET",
    path: "/api/v1/context/job-resource-summary",
    scope: "self",
    readOnly: true,
    input: {},
    run: async (_args, ctx) => {
      const [quotaRes, summaryRes, billingRes] = await Promise.all([
        settle(getJson(ctx.client, "/api/v1/context/quota")),
        settle(getJson(ctx.client, "/api/v1/context/job-resource-summary")),
        settle(getJson(ctx.client, "/api/v1/context/billing/summary")),
      ]);

      const errors: string[] = [];
      if (!quotaRes.ok) errors.push(`/api/v1/context/quota 失败：${quotaRes.error}`);
      if (!summaryRes.ok) errors.push(`/api/v1/context/job-resource-summary 失败：${summaryRes.error}`);
      if (!billingRes.ok) errors.push(`/api/v1/context/billing/summary 失败：${billingRes.error}`);

      return {
        dimension: "仅我自己（后端按当前用户的 UserID + 当前账号 AccountID 过滤）",
        snapshotAt: new Date().toISOString(),
        note: SNAPSHOT_NOTE,
        username: ctx.client.info.username,
        accountName: ctx.client.info.accountName,
        quota: valueOrError(quotaRes),
        jobResourceSummary: valueOrError(summaryRes),
        billing: valueOrError(billingRes),
        errors,
      };
    },
  },

  // ---------------- 当前上下文（§2.17） ----------------
  {
    name: "crater_context_attributes",
    group: "resources",
    title: "当前上下文属性",
    description:
      "返回当前上下文的属性：所属账号（队列）、平台角色、账号内角色、访问模式（RO/RW/AO）、存储空间前缀，以及我的资料字段（昵称、邮箱、电话、导师、课题组、头像、UID/GID）。" +
      "后端**没有** GET /api/v1/context/attributes（实测 404，属性只有 PUT），所以这里读的是 /api/auth/check 的 context/user；要修改资料请用 crater_profile_update（PUT 整体覆盖语义）。",
    method: "GET",
    path: "/api/auth/check",
    scope: "self",
    readOnly: true,
    input: {},
    run: async (_args, ctx) => {
      const check = await ctx.client.request<{ context?: unknown; user?: unknown } | null>({
        method: "GET",
        path: "/api/auth/check",
      });
      return {
        note:
          "读取自 /api/auth/check（后端无 GET /api/v1/context/attributes）。修改属性用 crater_profile_update，注意它是整体覆盖写。",
        context: check?.context ?? null,
        user: check?.user ?? null,
        session: {
          username: ctx.client.info.username,
          userId: ctx.client.info.userId,
          accountName: ctx.client.info.accountName,
          accountId: ctx.client.info.accountId,
          rolePlatform: ctx.client.info.rolePlatform,
          roleAccount: ctx.client.info.roleAccount,
          accessMode: ctx.client.info.accessMode,
          space: ctx.client.info.space,
        },
      };
    },
  },
  {
    name: "crater_context_prequeue",
    group: "resources",
    title: "排队预检开关状态",
    description:
      "返回排队预检（scheduler extender 的回填 / prequeue）开关状态，例如 backfillEnabled：用来判断当前集群是否接受排队作业、排队回填是否生效。" +
      "它只有开关信息，不含「我提这个规格会不会超限」的判定；后端没有 /admin/system-config/prequeue 之类的路由，某些旧部署上该端点会返回 404。" +
      SNAPSHOT_NOTE,
    method: "GET",
    path: "/api/v1/context/prequeue",
    scope: "self",
    readOnly: true,
    input: {},
  },
];
