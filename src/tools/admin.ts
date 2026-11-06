/**
 * 组：admin —— 管理端（用户 / 账号(项目) / 资源 / 节点 / 系统配置 / 队列配额 / 运维 / 审批 / GPU 分析 / 全量作业视图）
 * 对应接口：docs/api-inventory.md §2.3、§2.4、§2.10~§2.16、§2.21~§2.24、§3.6；存在性以 docs/verified-routes.md 为准。
 *
 * 三个必须知道的全局事实（写在这里避免每条描述重复）：
 *
 * 1. 本组全部工具 scope = "admin"：`CRATER_ALLOW_ADMIN=false` 时整组不注册；
 *    注册了但当前用户 rolePlatform != 3（admin）时，调用会被 src/scope.ts 直接拒绝。
 *    后端 admin 路由同样要求 token 里 `rolePlatform == 3`（middleware/jwt.go:93-102）。
 *
 * 2. 管理端接口的 **写请求** 每次都会回库校验角色/访问模式（middleware/jwt.go:52-85），
 *    所以「刚改过角色/刚被移出账号」的旧 token 会立刻写失败（401），但读请求仍按旧快照放行。
 *
 * 3. 作业类参数用两个名字：`jobName` 是 k8s 名（如 `vsc-crater-admin-261104-c774f`，用于所有
 *    `/vcjobs/:name/**` 与运维清理接口），`name` 是用户填的显示名（可能中文/重名）。
 *    本组凡是「作业名」参数一律要求 jobName。
 */
import { z } from "zod";
import type { CraterClient } from "../client.js";
import type { ToolSpec } from "../registry.js";

// ---------------------------------------------------------------------------
// 通用片段
// ---------------------------------------------------------------------------

/** 平台角色：1=guest 2=user 3=admin */
const ROLE_TEXT: Record<number, string> = { 1: "guest", 2: "user", 3: "admin" };

/** 账号内访问模式：1=NA 2=RO 3=RW 4=AO */
const ACCESS_TEXT: Record<number, string> = { 1: "NA", 2: "ReadOnly", 3: "ReadWrite", 4: "AdminOnly" };

/** 账号内角色（后端要求"数字字符串"）：1=guest 2=user 3=admin */
const accountRole = z
  .enum(["1", "2", "3"])
  .describe('账号内角色（注意是"数字字符串"）：1=guest 2=user 3=admin，如 "3"');

/** 账号内访问模式（后端要求"数字字符串"）：2=RO 3=RW 4=AO */
const accountAccessMode = z
  .enum(["2", "3", "4"])
  .describe('账号内访问模式（"数字字符串"）：2=只读 3=读写 4=仅管理员，如 "3"');

/** Volcano 资源配额：资源名 → k8s 数量字符串 */
const resourceQuota = z
  .record(z.string(), z.string())
  .optional()
  .describe('资源配额，资源名→k8s 数量字符串，如 {"cpu":"8","memory":"32Gi","nvidia.com/gpu":"1"}；不传则沿用/不设');

function asRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** 从 admin/users 列表行里取 attributes（昵称/邮箱/导师等都藏在它里面） */
function attrOf(row: Record<string, unknown>): Record<string, unknown> {
  const a = row.attributes;
  return a && typeof a === "object" && !Array.isArray(a) ? { ...(a as Record<string, unknown>) } : {};
}

/** GET /api/v1/admin/users 后端不分页、不筛选，直接返回全量用户；这里统一取一次 */
async function fetchAllUsers(client: CraterClient): Promise<Record<string, unknown>[]> {
  return asRows(await client.request<unknown>({ method: "GET", path: "/api/v1/admin/users" }));
}

// ---------------------------------------------------------------------------
// A. 用户管理（/api/v1/admin/users/**）
// ---------------------------------------------------------------------------

export const specs: ToolSpec[] = [
  {
    name: "crater_admin_users_list",
    group: "admin",
    title: "全平台用户列表（可本地筛选分页）",
    description:
      "【影响面：全平台只读】列出平台所有用户（id/登录名/角色/状态/额外点数/是否被封禁/封禁能力项/资料）。" +
      "⚠️ 后端这个接口**不认分页和筛选参数**，永远返回全量；keyword/role/bannedOnly/page/pageSize 由 MCP 在本地过滤后再切片，" +
      "所以拿到的 total 是过滤后的条数。列出的是全平台用户，属于个人信息，不要无目的批量导出。",
    method: "GET",
    path: "/api/v1/admin/users",
    scope: "admin",
    readOnly: true,
    input: {
      keyword: z.string().optional().describe("按登录名/昵称/邮箱模糊匹配（本地过滤，不区分大小写）"),
      role: z.number().int().min(1).max(3).optional().describe("只看某平台角色：1=guest 2=user 3=admin"),
      bannedOnly: z.boolean().optional().describe("true 时只返回当前处于封禁状态的用户"),
      page: z.number().int().min(1).optional().describe("本地分页页码，从 1 开始（默认 1）"),
      pageSize: z.number().int().min(1).max(200).optional().describe("本地每页条数，默认 20，最大 200"),
    },
    run: async (args, ctx) => {
      const rows = await fetchAllUsers(ctx.client);
      const keyword = args.keyword ? String(args.keyword).toLowerCase() : undefined;
      const role = typeof args.role === "number" ? args.role : undefined;
      const bannedOnly = args.bannedOnly === true;

      let filtered = rows;
      if (keyword) {
        filtered = filtered.filter((row) => {
          const attrs = attrOf(row);
          const haystack = [row.name, attrs.nickname, attrs.email, row.id]
            .filter((v) => v !== undefined && v !== null)
            .join(" ")
            .toLowerCase();
          return haystack.includes(keyword);
        });
      }
      if (role !== undefined) filtered = filtered.filter((row) => row.role === role);
      if (bannedOnly) filtered = filtered.filter((row) => row.banned === true);

      const page = typeof args.page === "number" ? args.page : 1;
      const pageSize = typeof args.pageSize === "number" ? args.pageSize : 20;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize).map((row) => {
        const attrs = attrOf(row);
        return {
          id: row.id,
          name: row.name,
          nickname: attrs.nickname,
          email: attrs.email,
          role: row.role,
          roleName: typeof row.role === "number" ? ROLE_TEXT[row.role] : undefined,
          status: row.status,
          extraBalance: row.extraBalance,
          banned: row.banned,
          permanentBanned: row.permanentBanned,
          bannedTimestamp: row.bannedTimestamp,
          banRestrictions: row.banRestrictions,
          attributes: attrs,
        };
      });

      return {
        total: filtered.length,
        totalAll: rows.length,
        page,
        pageSize,
        hasMore: start + items.length < filtered.length,
        note: "后端接口不支持分页/筛选，此处为 MCP 本地过滤结果",
        items,
      };
    },
  },
  {
    name: "crater_admin_users_detail",
    group: "admin",
    title: "单个用户详情（管理员视角）",
    description:
      "【影响面：单个用户只读】按登录名取某个用户的资料（昵称/角色/导师/课题组/头像/余额等）。" +
      "Crater 管理端没有独立的 `GET /admin/users/:name`，这里用的是全平台通用的用户详情接口，" +
      "在本 MCP 中被限制为管理员才能调用。名字必须是**登录名**，昵称/显示名查不到。",
    method: "GET",
    path: "/api/v1/users/:name",
    scope: "admin",
    readOnly: true,
    input: {
      name: z.string().min(1).describe("目标用户的登录名（不是昵称，也不是中文显示名）"),
    },
    pathParams: ["name"],
  },
  {
    name: "crater_admin_users_baseinfo",
    group: "admin",
    title: "用户基础信息精简列表（name/昵称/空间）",
    description:
      "【影响面：全平台只读】一次性返回所有用户的精简信息：登录名、昵称、用户空间目录名。" +
      "适合在给账号加成员、按用户名查作业等场景里快速做「登录名 ↔ 昵称」的对照；" +
      "它不含 id，需要 id（如账号成员接口的 uid）时请用 crater_admin_users_list。",
    method: "GET",
    path: "/api/v1/admin/users/baseinfo",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_users_ban",
    group: "admin",
    title: "封禁 / 解封用户（能力项）",
    description:
      "【影响面：单个用户，写；不可逆点在于「踢下线」】封禁或解封某个用户，banned=true 封、false 解。" +
      "⚠️ **不传 banRestrictions 等于只记一个封禁状态、任何能力都不限制**（后端按零值处理，五张能力旗标全 false 就什么都不拦）；" +
      "要真正把人挡在平台外必须显式传 banRestrictions.platformAccess=true——该旗标由 JWT 中间件检查，" +
      "会让该用户**立刻**无法访问任何 /api/v1 接口（页面与 CLI 一起被踢）。" +
      "时长由 isPermanent / days+hours+minutes 决定（都为 0 且非永久会被后端拒绝）；reason 最长 500 字。解封：banned=false，其余不用传。",
    method: "PUT",
    path: "/api/v1/admin/users/:name/ban",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      name: z.string().min(1).describe("目标用户的登录名"),
      banned: z.boolean().describe("必填：true=封禁，false=解封"),
      isPermanent: z.boolean().optional().describe("永久封禁（true 时忽略 days/hours/minutes）"),
      days: z.number().int().min(0).optional().describe("封禁天数（非负）"),
      hours: z.number().int().min(0).optional().describe("封禁小时数（非负）"),
      minutes: z.number().int().min(0).optional().describe("封禁分钟数（非负）"),
      banRestrictions: z
        .object({
          platformAccess: z.boolean().optional().describe("禁止登录/访问平台（中间件级，最狠的一项，会让用户立刻被踢下线）"),
          jobSubmission: z.boolean().optional().describe("禁止提交作业"),
          imageBuild: z.boolean().optional().describe("禁止构建镜像"),
          modelDownload: z.boolean().optional().describe("禁止下载模型"),
          datasetDownload: z.boolean().optional().describe("禁止下载数据集"),
        })
        .optional()
        .describe("逐项能力限制；⚠️ 整个字段不传 = 五项全不限制（封了个寂寞），要拦人请显式传 true"),
      reason: z.string().max(500).optional().describe("封禁原因（留档，后端最长 500 字符）"),
    },
    pathParams: ["name"],
    body: "all",
  },
  {
    name: "crater_admin_users_set_role",
    group: "admin",
    title: "改用户平台角色",
    description:
      "【影响面：单个用户，写，可逆】把某用户设为 guest(1)/user(2)/admin(3)。" +
      "⚠️ 改成 admin 等于交出整台平台的运维权限（可删用户/改配置/清作业）；改成 guest 后该用户失去提交作业等基础能力。" +
      "改完提示用户重新登录：旧 token 里的角色快照会让其**写**请求立刻 401（读请求仍暂时可用）。",
    method: "PUT",
    path: "/api/v1/admin/users/:name/role",
    scope: "admin",
    readOnly: false,
    input: {
      name: z.string().min(1).describe("目标用户的登录名"),
      role: z.number().int().min(1).max(3).describe("新角色：1=guest 2=user 3=admin"),
    },
    pathParams: ["name"],
    body: "all",
  },
  {
    name: "crater_admin_users_update_attributes",
    group: "admin",
    title: "改他人资料（先读后写，避免清空）",
    description:
      "【影响面：单个用户，写，可逆】修改别的用户的资料（昵称/邮箱/电话/导师/课题组/头像/过期时间）。" +
      "后端是**整体覆盖写**：没传的字段会被清空，所以本工具会先读出该用户现有 attributes，再把你要改的字段覆盖上去，" +
      "其余字段原样回传（ID/UID/GID 也一并保留）。昵称会同步为该用户的展示名。",
    method: "PUT",
    path: "/api/v1/admin/users/:name/attributes",
    scope: "admin",
    readOnly: false,
    input: {
      name: z.string().min(1).describe("目标用户的登录名"),
      nickname: z.string().optional().describe("昵称（会同步成展示名）"),
      email: z.string().optional().describe("邮箱"),
      phone: z.string().optional().describe("电话"),
      teacher: z.string().optional().describe("导师/老师"),
      group: z.string().optional().describe("课题组"),
      avatar: z.string().optional().describe("头像地址"),
      expiredAt: z.string().optional().describe("过期时间（ISO 时间字符串，如 2027-01-01T00:00:00+08:00）"),
    },
    pathParams: ["name"],
    run: async (args, ctx) => {
      const name = String(args.name);
      const users = await fetchAllUsers(ctx.client);
      const target = users.find((row) => row.name === name);
      if (!target) {
        throw new Error(`用户 ${name} 不存在；请先用 crater_admin_users_list / crater_admin_users_baseinfo 确认登录名`);
      }
      const body = attrOf(target);
      for (const key of ["nickname", "email", "phone", "teacher", "group", "avatar", "expiredAt"]) {
        const value = args[key];
        if (value !== undefined && value !== "") body[key] = value;
      }
      const response = await ctx.client.request({
        method: "PUT",
        path: `/api/v1/admin/users/${encodeURIComponent(name)}/attributes`,
        body,
      });
      return { ok: true, sent: body, response };
    },
  },
  {
    name: "crater_admin_users_adjust_balance",
    group: "admin",
    title: "调整用户额外点数（可正可负）",
    description:
      "【影响面：单个用户余额，写，可逆（反向 delta 即可复原）】按增量调整用户的额外点数 extraBalance，" +
      "delta 为正=增加、为负=扣减，后端带行锁不会并发串账。" +
      "仅在计费（billing）功能开启时有意义；⚠️ 点数就是钱：操作前建议先用 crater_admin_users_list 确认当前余额，" +
      "并在 reason 里写清楚依据（会留档）。",
    method: "POST",
    path: "/api/v1/admin/users/:name/billing/extra-balance",
    scope: "admin",
    readOnly: false,
    input: {
      name: z.string().min(1).describe("目标用户的登录名"),
      delta: z.number().describe("点数增量：正数增加、负数扣减，支持小数（如 100、-12.5）"),
      reason: z.string().optional().describe("调整原因（留档，建议必填）"),
    },
    pathParams: ["name"],
    body: "all",
  },

  // -------------------------------------------------------------------------
  // B. 账号（项目）管理（/api/v1/admin/accounts/**）
  // -------------------------------------------------------------------------
  {
    name: "crater_admin_accounts_list",
    group: "admin",
    title: "账号（项目）列表",
    description:
      "【影响面：全平台只读】列出平台所有账号（项目），含 id/登录名/昵称/空间/配额等信息。" +
      "账号是 Crater 里的资源与权限边界（原 queue），几乎所有账号级操作都要先拿到这里的 id（aid）。",
    method: "GET",
    path: "/api/v1/admin/accounts",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_accounts_get",
    group: "admin",
    title: "账号（项目）详情",
    description: "【影响面：单个账号只读】按数字 id 取账号详情（昵称/空间/配额/管理员/过期时间等）。",
    method: "GET",
    path: "/api/v1/admin/accounts/:aid",
    scope: "admin",
    readOnly: true,
    input: {
      aid: z.number().int().min(1).describe("账号 id（不是账号名；账号名/id 对照见 crater_admin_accounts_list）"),
    },
    pathParams: ["aid"],
  },
  {
    name: "crater_admin_accounts_quota",
    group: "admin",
    title: "账号 Volcano 配额与已分配",
    description:
      "【影响面：单个账号只读】返回该账号的 Volcano 配额（guaranteed/deserved/capability）与已分配用量，" +
      "用于判断资源是否紧张。注意这里读的是账号级配额，用户级资源限制在 queue-quotas 里。",
    method: "GET",
    path: "/api/v1/admin/accounts/:aid/quota",
    scope: "admin",
    readOnly: true,
    input: {
      aid: z.number().int().min(1).describe("账号 id"),
    },
    pathParams: ["aid"],
  },
  {
    name: "crater_admin_accounts_members",
    group: "admin",
    title: "账号成员列表",
    description:
      "【影响面：单个账号只读】列出该账号内的成员及其账号内角色(role)与访问模式(accessmode)、个人配额。" +
      "注意返回里的 role/accessmode 是**数字字符串**（如 \"3\"），与 crater_admin_accounts_member_update 的入参一致。",
    method: "GET",
    path: "/api/v1/admin/accounts/userIn/:aid",
    scope: "admin",
    readOnly: true,
    input: {
      aid: z.number().int().min(1).describe("账号 id"),
    },
    pathParams: ["aid"],
  },
  {
    name: "crater_admin_accounts_member_add",
    group: "admin",
    title: "把用户加入账号",
    description:
      "【影响面：单账号成员关系，写，可逆（可再移除）】把某个用户（uid，数字 id）加入账号（aid），并指定账号内角色与访问模式。" +
      "role/accessmode 必须是**数字字符串**（role: \"1\"|\"2\"|\"3\"；accessmode: \"2\" 只读 / \"3\" 读写 / \"4\" 仅管理员）。" +
      "前置：用 crater_admin_users_list 查 uid、crater_admin_accounts_list 查 aid；重复加入会报错。给了 \"3\"/\"4\" 等于放权，请核对。",
    method: "POST",
    path: "/api/v1/admin/accounts/add/:aid/:uid",
    scope: "admin",
    readOnly: false,
    input: {
      aid: z.number().int().min(1).describe("账号 id"),
      uid: z.number().int().min(1).describe("用户 id（数字 id，不是登录名）"),
      role: accountRole,
      accessmode: accountAccessMode,
      quota: resourceQuota,
    },
    pathParams: ["aid", "uid"],
    body: "all",
  },
  {
    name: "crater_admin_accounts_member_update",
    group: "admin",
    title: "改账号成员的角色/访问模式/配额",
    description:
      "【影响面：单账号单成员，写，可逆】全量更新某成员在账号内的角色、访问模式与个人配额（三个字段都必须给）。" +
      "⚠️ 改成 \"2\"（只读）会让该用户在该账号下立刻丧失一切写能力；改成 \"4\" 等于把账号管理权交给对方。",
    method: "POST",
    path: "/api/v1/admin/accounts/update/:aid/:uid",
    scope: "admin",
    readOnly: false,
    input: {
      aid: z.number().int().min(1).describe("账号 id"),
      uid: z.number().int().min(1).describe("用户 id"),
      role: accountRole,
      accessmode: accountAccessMode,
      quota: resourceQuota,
    },
    pathParams: ["aid", "uid"],
    body: "all",
  },
  {
    name: "crater_admin_accounts_member_remove",
    group: "admin",
    title: "把用户移出账号",
    description:
      "【影响面：单账号单成员，写，难逆】删除用户与账号的成员关系。" +
      "该用户在该账号下的作业/文件随之不可见（资源与数据仍留在账号空间里），重新加入需要管理员再次操作。" +
      "⚠️ 若对方正在该账号下运行作业，作业不会被自动停止；被移除后其旧 token 的写请求会立刻 401。",
    method: "DELETE",
    path: "/api/v1/admin/accounts/:aid/:uid",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      aid: z.number().int().min(1).describe("账号 id"),
      uid: z.number().int().min(1).describe("用户 id"),
    },
    pathParams: ["aid", "uid"],
  },
  {
    name: "crater_admin_accounts_billing_config",
    group: "admin",
    title: "账号计费发放配置（读）",
    description:
      "【影响面：单账号只读】读取账号的计费发放配置：每期发放点数 issueAmount、发放周期 issuePeriodMinutes，" +
      "以及生效值/下一次发放时间。计费功能关闭时该接口会报 409（billing feature is disabled）。",
    method: "GET",
    path: "/api/v1/admin/accounts/:aid/billing/config",
    scope: "admin",
    readOnly: true,
    input: {
      aid: z.number().int().min(1).describe("账号 id"),
    },
    pathParams: ["aid"],
  },
  {
    name: "crater_admin_accounts_billing_config_update",
    group: "admin",
    title: "账号计费发放配置（写）",
    description:
      "【影响面：单账号全体成员的发放额度，写，可逆】改该账号的每期发放点数与发放周期。" +
      "issueAmount 是点数（支持小数）、issuePeriodMinutes 是周期分钟数（≥0，0 通常表示不自动发放）。" +
      "⚠️ 影响该账号下每个人的可用点数，改错会让大批用户余额异常；不传的字段保持原值（后端是增量语义）。",
    method: "PUT",
    path: "/api/v1/admin/accounts/:aid/billing/config",
    scope: "admin",
    readOnly: false,
    input: {
      aid: z.number().int().min(1).describe("账号 id"),
      issueAmount: z.number().optional().describe("每期发放点数（可小数）"),
      issuePeriodMinutes: z.number().int().min(0).optional().describe("发放周期（分钟），0 表示不按周期发放"),
    },
    pathParams: ["aid"],
    body: "all",
  },
  {
    name: "crater_admin_accounts_billing_members",
    group: "admin",
    title: "账号成员计费明细",
    description:
      "【影响面：单账号只读】列出该账号每个成员的计费明细（本期免费余额、额外点数、发放额度覆盖值等）。" +
      "适合排查「某人为什么余额异常」。计费关闭时返回 409。",
    method: "GET",
    path: "/api/v1/admin/accounts/:aid/billing/members",
    scope: "admin",
    readOnly: true,
    input: {
      aid: z.number().int().min(1).describe("账号 id"),
    },
    pathParams: ["aid"],
  },
  {
    name: "crater_admin_accounts_billing_reset",
    group: "admin",
    title: "重置账号计费余额",
    description:
      "【影响面：单账号全体成员，写，数据不可恢复】把该账号的计费余额按后端逻辑重新结算/重置（本期免费点数），" +
      "会直接改写该账号下所有成员的余额数字。计费功能关闭时报错。" +
      "⚠️ 这是「重置」不是「补发」：重置前的余额数字无从回滚，操作前请先 crater_admin_accounts_billing_members 留底。",
    method: "POST",
    path: "/api/v1/admin/accounts/:aid/billing/reset",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      aid: z.number().int().min(1).describe("账号 id"),
    },
    pathParams: ["aid"],
  },

  // -------------------------------------------------------------------------
  // C. 资源配置（/api/v1/admin/resources/**）
  // 注意：资源列表用 crater_resources_list（GET /api/v1/resources），管理端没有裸集合路由。
  // -------------------------------------------------------------------------
  {
    name: "crater_admin_resources_vgpu_list",
    group: "admin",
    title: "查 GPU↔vGPU 关联（管理端）",
    description:
      "【影响面：单资源只读】列出某个 GPU 资源已关联的 vGPU 资源及其切分参数（关联记录 id、min/max、描述）。" +
      "要改/删关联时先用它拿 vgpuId（那是**关联记录 id**，不是资源 id）。资源 id 可用 crater_resources_list 查。",
    method: "GET",
    path: "/api/v1/admin/resources/:id/vgpu",
    scope: "admin",
    readOnly: true,
    input: {
      id: z.number().int().min(1).describe("GPU 资源的数字 id"),
    },
    pathParams: ["id"],
  },
  {
    name: "crater_admin_resources_vgpu_link",
    group: "admin",
    title: "新增 GPU↔vGPU 关联",
    description:
      "【影响面：单资源模型，写，可逆（可解除）】给 GPU 资源挂一个 vGPU 资源，让 GPU 支持切分。" +
      "vgpuResourceId 是 vGPU 那个资源条目的 id（先 crater_resources_list 找）；min/max 是切分档位约束，min>max 会被后端拒绝。" +
      "⚠️ 影响调度与计费口径：配错会让该型号 GPU 无法按预期切分出小卡。",
    method: "POST",
    path: "/api/v1/admin/resources/:id/vgpu",
    scope: "admin",
    readOnly: false,
    input: {
      id: z.number().int().min(1).describe("GPU 资源 id"),
      vgpuResourceId: z.number().int().min(1).describe("要关联的 vGPU 资源 id"),
      min: z.number().int().optional().describe("最小切分档位（可选）"),
      max: z.number().int().optional().describe("最大切分档位（可选，须 >= min）"),
      description: z.string().optional().describe("备注"),
    },
    pathParams: ["id"],
    body: "all",
  },
  {
    name: "crater_admin_resources_vgpu_update",
    group: "admin",
    title: "改 GPU↔vGPU 关联参数",
    description:
      "【影响面：单资源模型，写，可逆】调整已存在的 GPU↔vGPU 关联的 min/max/描述。" +
      "vgpuId 是**关联记录 id**（从 crater_admin_resources_vgpu_list 取），不是资源 id。只传要改的字段。",
    method: "PUT",
    path: "/api/v1/admin/resources/:id/vgpu/:vgpuId",
    scope: "admin",
    readOnly: false,
    input: {
      id: z.number().int().min(1).describe("GPU 资源 id"),
      vgpuId: z.number().int().min(1).describe("关联记录 id（来自 vgpu_list）"),
      vgpuResourceId: z.number().int().min(1).optional().describe("改指向的 vGPU 资源 id（一般不需要动）"),
      min: z.number().int().optional().describe("最小切分档位"),
      max: z.number().int().optional().describe("最大切分档位"),
      description: z.string().optional().describe("备注"),
    },
    pathParams: ["id", "vgpuId"],
    body: "all",
  },
  {
    name: "crater_admin_resources_vgpu_unlink",
    group: "admin",
    title: "解除 GPU↔vGPU 关联",
    description:
      "【影响面：单资源模型，写，删除类】删除 GPU 与 vGPU 的关联。" +
      "⚠️ 解除后该型号 GPU 不再支持对应切分：已在跑的 vGPU 作业不受影响，但新的 vGPU 申请会被调度拒绝或按整卡计费。",
    method: "DELETE",
    path: "/api/v1/admin/resources/:id/vgpu/:vgpuId",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      id: z.number().int().min(1).describe("GPU 资源 id"),
      vgpuId: z.number().int().min(1).describe("关联记录 id（来自 vgpu_list）"),
    },
    pathParams: ["id", "vgpuId"],
  },
  {
    name: "crater_admin_resources_networks_list",
    group: "admin",
    title: "查 GPU↔RDMA 网络关联（管理端）",
    description:
      "【影响面：单资源只读】列出某个 GPU 资源已关联的 RDMA/网络资源，用于确认多机训练的高速网络通路。",
    method: "GET",
    path: "/api/v1/admin/resources/:id/networks",
    scope: "admin",
    readOnly: true,
    input: {
      id: z.number().int().min(1).describe("GPU 资源 id"),
    },
    pathParams: ["id"],
  },
  {
    name: "crater_admin_resources_networks_link",
    group: "admin",
    title: "关联 GPU↔RDMA 网络",
    description:
      "【影响面：单资源模型，写，可逆（可解除）】把 RDMA 网络资源挂到某个 GPU 资源上（rdmaId 是 RDMA 资源条目的 id）。" +
      "⚠️ 影响分布式作业的网络可用性判断：关联错误会让多机作业拿不到 RDMA 或调度失败。",
    method: "POST",
    path: "/api/v1/admin/resources/:id/networks",
    scope: "admin",
    readOnly: false,
    input: {
      id: z.number().int().min(1).describe("GPU 资源 id"),
      rdmaId: z.number().int().min(1).describe("要关联的 RDMA 资源 id"),
    },
    pathParams: ["id"],
    body: "all",
  },
  {
    name: "crater_admin_resources_networks_unlink",
    group: "admin",
    title: "解除 GPU↔RDMA 网络关联",
    description:
      "【影响面：单资源模型，写，删除类】删除 GPU 与 RDMA 网络的关联。" +
      "⚠️ 解绑后依赖该通路的分布式训练可能无法再被调度到高速网络，已在跑的作业不受影响。",
    method: "DELETE",
    path: "/api/v1/admin/resources/:id/networks/:networkId",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      id: z.number().int().min(1).describe("GPU 资源 id"),
      networkId: z.number().int().min(1).describe("RDMA 资源 id"),
    },
    pathParams: ["id", "networkId"],
  },
  {
    name: "crater_admin_resources_unit_price",
    group: "admin",
    title: "设置资源计费单价",
    description:
      "【影响面：全平台计费口径，写，可逆】设置某个资源的计费单价（点数/单位时间）。" +
      "⚠️ 这是全平台价格：改动会影响之后所有作业的扣费，历史账单不重算；unitPrice 传 0 等于免费，" +
      "建议先用 crater_resources_prices 看现有单价再改。计费功能未开启时后端可能拒绝。",
    method: "PUT",
    path: "/api/v1/admin/resources/:id/billing/unit-price",
    scope: "admin",
    readOnly: false,
    input: {
      id: z.number().int().min(1).describe("资源 id"),
      unitPrice: z.number().describe("单价（点数，支持小数；0 表示不计费）"),
    },
    pathParams: ["id"],
    body: "all",
  },
  {
    name: "crater_admin_resources_sync",
    group: "admin",
    title: "从集群同步资源清单",
    description:
      "【影响面：全平台资源清单，写，部分不可逆】按集群当前节点实际情况重建资源表：新出现的资源会被创建、" +
      "数量变化的会更新、**集群上已不存在的资源记录会被删除**。" +
      "⚠️ 删除会连带影响资源列表展示、标签/单价等人工维护的属性，以及依赖该资源的作业配置可见性；" +
      "在集群侧网络抖动/节点暂时 NotReady 时调用，可能把仍需要的资源条目删掉。无参数，调用前请确认集群状态正常。",
    method: "POST",
    path: "/api/v1/admin/resources/sync",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {},
    body: "none",
  },

  // -------------------------------------------------------------------------
  // D. 节点管理（/api/v1/admin/nodes/**）
  // -------------------------------------------------------------------------
  {
    name: "crater_admin_nodes_list",
    group: "admin",
    title: "节点列表（管理员视角）",
    description:
      "【影响面：全平台节点只读】列出所有节点的角色/架构/状态/资源与使用率，是节点类操作的第一步（拿节点名）。" +
      "节点名就是 k8s 节点名（如 gpu004），后续 label/taint/drain 都用它。",
    method: "GET",
    path: "/api/v1/admin/nodes",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_nodes_detail",
    group: "admin",
    title: "节点详情（管理员排查用）",
    description:
      "【影响面：单节点只读】按节点名取节点详情（含该节点上的 Pod 概况），用于排查调度失败/资源占用。" +
      "管理端没有独立的 `/admin/nodes/:name` 详情路由，这里用通用节点详情接口，并在本 MCP 中限制为管理员调用。",
    method: "GET",
    path: "/api/v1/nodes/:name",
    scope: "admin",
    readOnly: true,
    input: {
      name: z.string().min(1).describe("k8s 节点名，如 gpu004"),
    },
    pathParams: ["name"],
  },
  {
    name: "crater_admin_nodes_marks",
    group: "admin",
    title: "节点标签/注解/污点汇总",
    description:
      "【影响面：单节点只读】一次性返回该节点当前的 labels、annotations、taints。改/删标签或污点前建议先看这里，避免误删关键调度标记。",
    method: "GET",
    path: "/api/v1/admin/nodes/:name/mark",
    scope: "admin",
    readOnly: true,
    input: {
      name: z.string().min(1).describe("k8s 节点名"),
    },
    pathParams: ["name"],
  },
  {
    name: "crater_admin_nodes_label_add",
    group: "admin",
    title: "给节点打标签",
    description:
      "【影响面：单节点调度属性，写，可逆】新增或覆盖一个节点 label（key/value）。" +
      "⚠️ label 常被作业的节点选择器（selectors）引用：改掉关键标签会让匹配它的作业无法调度到该节点。",
    method: "POST",
    path: "/api/v1/admin/nodes/:name/label",
    scope: "admin",
    readOnly: false,
    input: {
      name: z.string().min(1).describe("k8s 节点名"),
      key: z.string().min(1).describe("标签键，如 gpu-type / node-pool"),
      value: z.string().describe("标签值"),
    },
    pathParams: ["name"],
    body: "all",
  },
  {
    name: "crater_admin_nodes_label_delete",
    group: "admin",
    title: "删除节点标签",
    description:
      "【影响面：单节点调度属性，写，删除类】按 key/value 删除节点 label。" +
      "⚠️ 删掉调度依赖的标签会让相关作业长期 Pending；value 需与现存值一致，删前先 crater_admin_nodes_marks 确认。",
    method: "DELETE",
    path: "/api/v1/admin/nodes/:name/label",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      name: z.string().min(1).describe("k8s 节点名"),
      key: z.string().min(1).describe("要删除的标签键"),
      value: z.string().describe("该标签当前的值（需与现存值一致）"),
    },
    pathParams: ["name"],
    body: "all",
  },
  {
    name: "crater_admin_nodes_annotation_add",
    group: "admin",
    title: "给节点打注解",
    description:
      "【影响面：单节点元数据，写，可逆】新增或覆盖一个节点 annotation（key/value）。" +
      "注解通常不影响调度，但可能被某些控制器/告警规则读取，建议 key 加团队前缀。",
    method: "POST",
    path: "/api/v1/admin/nodes/:name/annotation",
    scope: "admin",
    readOnly: false,
    input: {
      name: z.string().min(1).describe("k8s 节点名"),
      key: z.string().min(1).describe("注解键"),
      value: z.string().describe("注解值"),
    },
    pathParams: ["name"],
    body: "all",
  },
  {
    name: "crater_admin_nodes_annotation_delete",
    group: "admin",
    title: "删除节点注解",
    description: "【影响面：单节点元数据，写，删除类】按 key/value 删除节点 annotation；删前先 crater_admin_nodes_marks 确认。",
    method: "DELETE",
    path: "/api/v1/admin/nodes/:name/annotation",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      name: z.string().min(1).describe("k8s 节点名"),
      key: z.string().min(1).describe("要删除的注解键"),
      value: z.string().describe("该注解当前的值"),
    },
    pathParams: ["name"],
    body: "all",
  },
  {
    name: "crater_admin_nodes_taint_add",
    group: "admin",
    title: "给节点打污点",
    description:
      "【影响面：单节点调度，写，可逆】给节点加一个 taint（key/value/effect）。" +
      "effect 取值：NoSchedule=不再调度新 Pod、PreferNoSchedule=尽量不调度、NoExecute=**连已运行的 Pod 也会被驱逐**。" +
      "⚠️ 用 NoExecute 等同于小范围排水；没有对应 toleration 的用户作业会立刻被赶走或被挡在门外。",
    method: "POST",
    path: "/api/v1/admin/nodes/:name/taint",
    scope: "admin",
    readOnly: false,
    input: {
      name: z.string().min(1).describe("k8s 节点名"),
      key: z.string().min(1).describe("污点键"),
      value: z.string().describe("污点值"),
      effect: z.enum(["NoSchedule", "PreferNoSchedule", "NoExecute"]).describe("污点效果；NoExecute 会驱逐已运行 Pod"),
      reason: z.string().optional().describe("操作原因（留档用）"),
    },
    pathParams: ["name"],
    body: "all",
  },
  {
    name: "crater_admin_nodes_taint_delete",
    group: "admin",
    title: "删除节点污点",
    description:
      "【影响面：单节点调度，写，删除类】按 key/value 删除节点 taint，等于放宽该节点的调度限制。" +
      "⚠️ 删掉隔离类污点后，原本被挡住的高占用作业可能涌入该节点；删前先 crater_admin_nodes_marks 确认。",
    method: "DELETE",
    path: "/api/v1/admin/nodes/:name/taint",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      name: z.string().min(1).describe("k8s 节点名"),
      key: z.string().min(1).describe("要删除的污点键"),
      value: z.string().describe("该污点当前的值"),
      effect: z.string().optional().describe("该污点当前的 effect（若后端按 key 匹配可省略）"),
      reason: z.string().optional().describe("操作原因（留档用）"),
    },
    pathParams: ["name"],
    body: "all",
  },
  {
    name: "crater_admin_nodes_drain",
    group: "admin",
    title: "排水节点（驱逐其上作业）",
    description:
      "【影响面：单节点上所有作业，写，不可逆（被驱逐的作业不会自动恢复）】把节点标记为不可调度并驱逐其上的 Pod。" +
      "⚠️ **会驱逐该节点上正在运行的作业**：这些作业会被终止（用户需重新提交），正在跑的交互式会话/训练进度会丢失。" +
      "⚠️ 该接口**没有对应的 uncordon/取消排水** 路由：排水后要让节点恢复可调度，需要在集群侧（kubectl uncordon）或其他管理入口处理。" +
      "调用前请先用 crater_admin_nodes_pods 确认节点上有哪些作业，并提前通知用户。",
    method: "POST",
    path: "/api/v1/admin/nodes/:name/drain",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      name: z.string().min(1).describe("k8s 节点名"),
    },
    pathParams: ["name"],
    body: "none",
  },
  {
    name: "crater_admin_nodes_pods",
    group: "admin",
    title: "节点上的 Pod 列表（管理员）",
    description:
      "【影响面：单节点只读】列出该节点上的 Pod（管理员视角，字段比用户版更多），含所属作业、命名空间、资源、状态。" +
      "排水/打污点前用它评估影响面；返回里的 Pod 名与 namespace 可用于 crater_admin_nodes_pod_resources 在线调资源。",
    method: "GET",
    path: "/api/v1/admin/nodes/:name/pods",
    scope: "admin",
    readOnly: true,
    input: {
      name: z.string().min(1).describe("k8s 节点名"),
    },
    pathParams: ["name"],
  },
  {
    name: "crater_admin_nodes_pod_resources",
    group: "admin",
    title: "在线调整 Pod 资源",
    description:
      "【影响面：单个运行中的作业 Pod，写，可逆（改回原值即可）】直接修改运行中 Pod 的 resources（cpu/memory 等）。" +
      "⚠️ 这是绕过作业模板的在线变更：改小可能导致容器 OOM/被限流，改大可能让节点超卖；" +
      "后端只允许对「作业 Pod」操作，且会校验调用者对该作业的权限。namespace 一般是作业所在命名空间（如 jobs）。" +
      "resources 必须是完整的 k8s 资源清单（如 {\"cpu\":\"4\",\"memory\":\"8Gi\"}），未列出的资源键保持原值由后端决定。",
    method: "PUT",
    path: "/api/v1/admin/namespaces/:namespace/pods/:name/resources",
    scope: "admin",
    readOnly: false,
    input: {
      namespace: z.string().min(1).describe("Pod 所在命名空间，如 jobs"),
      name: z.string().min(1).describe("Pod 名（不是作业名；可从 crater_admin_nodes_pods 或作业详情里取）"),
      resources: z
        .record(z.string(), z.string())
        .describe('要写入的资源配置，如 {"cpu":"4","memory":"8Gi"}（k8s 数量字符串）'),
    },
    pathParams: ["namespace", "name"],
    body: "all",
  },

  // -------------------------------------------------------------------------
  // E. 系统配置（/api/v1/admin/system-config/**）
  // -------------------------------------------------------------------------
  {
    name: "crater_admin_system_billing_get",
    group: "admin",
    title: "计费配置状态（管理员视角）",
    description:
      "【影响面：全平台只读】读取计费总开关与参数：功能开关 featureEnabled、是否生效 active、运行中结算开关与周期、" +
      "作业免费分钟、默认发放点数/周期、按账号覆盖开关，以及 cron 状态。改配置前先读它拿现状。",
    method: "GET",
    path: "/api/v1/admin/system-config/billing",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_system_billing_update",
    group: "admin",
    title: "修改计费配置（全平台）",
    description:
      "【影响面：全平台所有用户的扣费/发放，写，可逆（改回原值）】修改计费开关与参数，只传要改的字段（后端按指针增量更新）。" +
      "⚠️ 关掉 featureEnabled/runningSettlementEnabled 会立即停止扣费；改 defaultIssueAmount/Period 会影响所有人之后的发放；" +
      "开启计费前请确认资源单价已配置（crater_admin_resources_unit_price）与账号发放配置，否则用户余额会瞬间归零/无法提交作业。",
    method: "PUT",
    path: "/api/v1/admin/system-config/billing",
    scope: "admin",
    readOnly: false,
    input: {
      featureEnabled: z.boolean().optional().describe("计费功能总开关"),
      active: z.boolean().optional().describe("计费是否实际生效（feature 开启后还需此开关）"),
      runningSettlementEnabled: z.boolean().optional().describe("运行中作业按周期扣费开关"),
      runningSettlementIntervalMinutes: z.number().int().optional().describe("运行中结算周期（分钟）"),
      jobFreeMinutes: z.number().int().optional().describe("每次作业的免费分钟数"),
      defaultIssueAmount: z.number().optional().describe("默认每期发放点数（可小数）"),
      defaultIssuePeriodMinutes: z.number().int().optional().describe("默认发放周期（分钟）"),
      accountIssueAmountOverrideEnabled: z.boolean().optional().describe("允许账号自定义发放额度"),
      accountIssuePeriodOverrideEnabled: z.boolean().optional().describe("允许账号自定义发放周期"),
    },
    body: "all",
  },
  {
    name: "crater_admin_system_llm_get",
    group: "admin",
    title: "读 LLM 配置（key 已脱敏）",
    description:
      "【影响面：全平台只读】读取平台 LLM 配置（baseUrl/modelName/apiKey 已脱敏为 ********）。" +
      "改之前先读它，回写时把 apiKey 原样传回 ******** 即可保留旧密钥。",
    method: "GET",
    path: "/api/v1/admin/system-config/llm",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_system_llm_update",
    group: "admin",
    title: "写 LLM 配置",
    description:
      "【影响面：全平台 AI 功能（GPU 分析等），写，可逆（改回原值）】更新 LLM 的 baseUrl/modelName/apiKey。" +
      "apiKey 传 `********` 表示**保留旧密钥**（后端特判）；baseUrl 与 modelName 每次都必须给。" +
      "validate=true 会让后端立即试连一次，失败则整体回滚并报 409。⚠️ 配错会导致分析类功能全平台不可用。",
    method: "PUT",
    path: "/api/v1/admin/system-config/llm",
    scope: "admin",
    readOnly: false,
    input: {
      baseUrl: z.string().min(1).describe("OpenAI 兼容接口地址，如 http://172.16.16.110:3002/v1"),
      modelName: z.string().min(1).describe("模型名，如 qwen2.5-72b-instruct"),
      apiKey: z.string().optional().describe("API Key；传 ******** 表示保留旧值"),
      validate: z.boolean().optional().describe("true=写入前校验连通性（失败则拒绝写入）"),
    },
    body: "all",
  },
  {
    name: "crater_admin_system_pod_bandwidth_get",
    group: "admin",
    title: "读 Pod 带宽限制配置",
    description: "【影响面：全平台只读】读取 Pod 带宽限制开关与三类带宽值（模型下载/作业入口/作业出口）。",
    method: "GET",
    path: "/api/v1/admin/system-config/pod-bandwidth",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_system_pod_bandwidth_update",
    group: "admin",
    title: "写 Pod 带宽限制配置",
    description:
      "【影响面：全平台所有新 Pod 的网络限速，写，可逆】设置 Pod 带宽限制。四个字段后端都**必填**，" +
      "带宽值是 k8s 数量字符串（如 \"1G\"、\"500M\"）。⚠️ 限得太低会让模型下载/推理服务超时；" +
      "只对之后创建的 Pod 生效，已运行的 Pod 不变。改前先 crater_admin_system_pod_bandwidth_get 拿现值。",
    method: "PUT",
    path: "/api/v1/admin/system-config/pod-bandwidth",
    scope: "admin",
    readOnly: false,
    input: {
      enabled: z.boolean().describe("是否启用 Pod 带宽限制"),
      modelDownloadBandwidth: z.string().min(1).describe("模型下载带宽，如 1G"),
      jobIngressBandwidth: z.string().min(1).describe("作业入口带宽，如 1G"),
      jobEgressBandwidth: z.string().min(1).describe("作业出口带宽，如 1G"),
    },
    body: "all",
  },
  {
    name: "crater_admin_system_model_download_limit_get",
    group: "admin",
    title: "读模型下载限额（含白名单）",
    description:
      "【影响面：全平台只读】读取模型下载限额配置：开关、最大并发、统计窗口小时数、窗口内最多成功下载次数，以及白名单用户 id 列表。",
    method: "GET",
    path: "/api/v1/admin/system-config/model-download-limit",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_system_model_download_limit_update",
    group: "admin",
    title: "写模型下载限额",
    description:
      "【影响面：全平台用户的模型下载能力，写，可逆】设置模型下载限额。四个数值字段后端都**必填且必须 > 0**，" +
      "whitelistUserIds 是豁免该限制的用户 id 列表（整表覆盖，不传等于清空白名单）。" +
      "⚠️ 把 maxSuccessfulDownloads 设小会大面积卡住用户下载；改前先 get 拿现值，避免把白名单洗掉。",
    method: "PUT",
    path: "/api/v1/admin/system-config/model-download-limit",
    scope: "admin",
    readOnly: false,
    input: {
      enabled: z.boolean().describe("是否启用模型下载限额"),
      maxConcurrent: z.number().int().min(1).describe("全局最大并发下载数（>0）"),
      windowHours: z.number().int().min(1).describe("统计窗口小时数（>0）"),
      maxSuccessfulDownloads: z.number().int().min(1).describe("窗口内每人最多成功下载次数（>0）"),
      whitelistUserIds: z.array(z.number().int()).optional().describe("豁免白名单用户 id（整表覆盖；不传=清空）"),
    },
    body: "all",
  },
  {
    name: "crater_admin_system_gpu_analysis_get",
    group: "admin",
    title: "读 GPU 分析功能开关",
    description: "【影响面：全平台只读】读取 GPU 利用率分析（占卡检测）功能的总开关状态。",
    method: "GET",
    path: "/api/v1/admin/system-config/gpu-analysis",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_system_gpu_analysis_update",
    group: "admin",
    title: "开关 GPU 分析功能",
    description:
      "【影响面：全平台，写，可逆】开启/关闭 GPU 分析功能。" +
      "⚠️ 关闭后相关巡检 cronjob 无法被启用（后端会拒绝开启对应 cron），已产生的分析记录保留；" +
      "开启后需要 LLM 配置可用，否则分析任务会持续失败。",
    method: "PUT",
    path: "/api/v1/admin/system-config/gpu-analysis",
    scope: "admin",
    readOnly: false,
    input: {
      enable: z.boolean().describe("true=开启 GPU 分析，false=关闭"),
    },
    body: "all",
  },
  {
    name: "crater_admin_system_billing_grant_all",
    group: "admin",
    title: "给全平台所有用户发点数",
    description:
      "【影响面：**全平台每一个用户**，写，难逆】给所有未被删除的用户统一增加额外点数 delta（后端要求 > 0，不能扣减）。" +
      "⚠️ 这是一次性群发：人数多、总额大，且没有「撤销」接口（只能逐个用户用 crater_admin_users_adjust_balance 反向扣回）。" +
      "调用前务必确认 delta 含义（点数，不是金额）与 reason 会留档；计费关闭时该接口可能报错。",
    method: "POST",
    path: "/api/v1/admin/system-config/billing/extra-balance-all",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      delta: z.number().describe("每人增加的点数，必须 > 0（支持小数）"),
      reason: z.string().optional().describe("发放原因（留档，建议必填）"),
    },
    body: "all",
  },
  {
    name: "crater_admin_system_billing_reset_all",
    group: "admin",
    title: "重置全平台计费余额",
    description:
      "【影响面：**全平台所有账号与用户**，写，数据不可恢复】触发一次全平台余额重置：按后端逻辑重新结算每个账号/成员的" +
      "本期免费余额，并返回受影响的账号数/成员数与时间戳。" +
      "⚠️ 会一次性改写所有人的余额数字，无法回滚；误调用等于全平台账单被重置。计费功能关闭时会直接报错。" +
      "执行前请先 crater_admin_accounts_billing_members 抽样留底，并确认当前就是发放周期边界。",
    method: "POST",
    path: "/api/v1/admin/system-config/billing/reset-all",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {},
    body: "none",
  },

  // -------------------------------------------------------------------------
  // F. 队列配额 / 运维 / 审批 / GPU 分析 / 全量作业视图
  // -------------------------------------------------------------------------
  {
    name: "crater_admin_queue_quotas_list",
    group: "admin",
    title: "队列/用户资源限制列表",
    description:
      "【影响面：全平台只读】列出队列配额配置项（id/名称/资源限制 map）。这些配额在调度器侧限制单用户可用资源上限，" +
      "与账号自身的 Volcano 配额（crater_admin_accounts_quota）是两层不同的东西。",
    method: "GET",
    path: "/api/v1/admin/queue-quotas",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_queue_quotas_create",
    group: "admin",
    title: "新建队列配额",
    description:
      "【影响面：命中该配额的账号/用户，写，可逆（可删）】新建一条队列配额配置：name 为配置名，quota 为资源名→数量字符串。" +
      "⚠️ 配额调小会让正在排队的作业无法被调度；名称冲突会返回 409，建前先 list 一下。",
    method: "POST",
    path: "/api/v1/admin/queue-quotas",
    scope: "admin",
    readOnly: false,
    input: {
      name: z.string().min(1).describe("配额配置名（唯一）"),
      quota: z
        .record(z.string(), z.string())
        .describe('资源限制，如 {"cpu":"32","memory":"128Gi","nvidia.com/gpu":"4"}'),
    },
    body: "all",
  },
  {
    name: "crater_admin_queue_quotas_update",
    group: "admin",
    title: "更新队列配额",
    description:
      "【影响面：命中该配额的账号/用户，写，可逆】按 id 更新一条队列配额（name + 整份 quota 覆盖写）。" +
      "⚠️ quota 是整体覆盖：漏掉的资源键会变成不限制/默认，改前请先 crater_admin_queue_quotas_list 拿全量再改。",
    method: "PUT",
    path: "/api/v1/admin/queue-quotas/:id",
    scope: "admin",
    readOnly: false,
    input: {
      id: z.number().int().min(1).describe("配额配置 id（来自 list）"),
      name: z.string().min(1).describe("配额配置名"),
      quota: z.record(z.string(), z.string()).describe("完整的资源限制 map（整体覆盖）"),
    },
    pathParams: ["id"],
    body: "all",
  },
  {
    name: "crater_admin_queue_quotas_delete",
    group: "admin",
    title: "删除队列配额",
    description:
      "【影响面：命中该配额的账号/用户，写，删除类】删除一条队列配额配置。" +
      "⚠️ 删除后相关用户不再受该配额限制（可能瞬间申请到大量资源），也可能回落到默认策略；删前确认它没有在被使用。",
    method: "DELETE",
    path: "/api/v1/admin/queue-quotas/:id",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      id: z.number().int().min(1).describe("配额配置 id"),
    },
    pathParams: ["id"],
  },
  {
    name: "crater_admin_ops_cronjob_configs",
    group: "admin",
    title: "巡检 cronjob 配置列表",
    description:
      "【影响面：全平台只读】列出所有巡检/清理定时任务（清理类、计费循环、GPU 分析巡检等）的配置：name/type/spec/status/config。" +
      "看「现在有哪些自动任务、是否 suspended」就调它；改配置用 crater_admin_ops_cronjob_update。",
    method: "GET",
    path: "/api/v1/admin/operations/cronjob",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_ops_cronjob_update",
    group: "admin",
    title: "改巡检 cronjob 配置",
    description:
      "【影响面：全平台自动化，写，可逆（改回原值）】按 name 更新一个 cronjob 的 type/spec/status/config（只传要改的字段）。" +
      "status 取值：running/idle/suspended/unknown；spec 是 cron 表达式。⚠️ 把清理类任务设成 suspended 等于停掉自动回收，" +
      "集群可能被占满；把计费循环改成 running 前请确认计费开关状态（后端有校验门）。",
    method: "PUT",
    path: "/api/v1/admin/operations/cronjob",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      name: z.string().min(1).describe("cronjob 配置名（来自 configs 列表）"),
      type: z.enum(["cleaner_function", "patrol_function"]).optional().describe("任务类型"),
      spec: z.string().optional().describe("cron 表达式，如 0 */1 * * *"),
      status: z.enum(["running", "suspended", "idle", "unknown"]).optional().describe("启停状态"),
      config: z.record(z.string(), z.unknown()).optional().describe("任务配置对象（按 name 不同，先看 configs 里的现有值）"),
    },
    body: "all",
  },
  {
    name: "crater_admin_ops_cronjob_status",
    group: "admin",
    title: "查 cronjob 运行状态",
    description:
      "【影响面：全平台只读】按名字批量查 cronjob 的当前状态与调度 entry id。不传 name 等于查全部。" +
      "排查「自动清理为什么没跑」时先用它看 status 是否为 suspended。",
    method: "POST",
    path: "/api/v1/admin/operations/cronjob/config/status",
    scope: "admin",
    readOnly: true,
    input: {
      name: z.array(z.string()).optional().describe("cronjob 配置名列表；不传=全部"),
    },
    body: "all",
  },
  {
    name: "crater_admin_ops_cronjob_records",
    group: "admin",
    title: "查巡检执行记录",
    description:
      "【影响面：全平台只读】分页查巡检/清理任务的执行记录，可按任务名、时间范围、状态过滤。" +
      "时间用 RFC3339 字符串（如 2026-11-01T00:00:00+08:00）。属于「谁在什么时候清理了什么」的追溯依据。",
    method: "POST",
    path: "/api/v1/admin/operations/cronjob/record/list",
    scope: "admin",
    readOnly: true,
    input: {
      name: z.array(z.string()).optional().describe("任务名列表（不传=全部）"),
      startTime: z.string().optional().describe("起始时间，RFC3339"),
      endTime: z.string().optional().describe("结束时间，RFC3339"),
      status: z.string().optional().describe("按状态过滤（如 success/failed，视后端记录值）"),
    },
    body: "all",
  },
  {
    name: "crater_admin_ops_clean_low_gpu",
    group: "admin",
    title: "立即回收低 GPU 利用率作业",
    description:
      "【影响面：全平台所有作业，写，不可逆】立刻执行一次「低 GPU 利用率作业回收」：把 GPU 利用率持续低于阈值的作业停止/回收。" +
      "⚠️ 该操作**不会**给用户确认机会，被判定为低利用率的作业会被直接处理；timeRange 是观察窗口（分钟），" +
      "util 是利用率阈值（百分比），waitTime 是告警等待时间。误用会批量杀掉用户正在跑的训练。" +
      "建议先在白名单（crater_admin_ops_whitelist）里排除重要作业，并先看 crater_admin_jobs_all 确认现状。",
    method: "POST",
    path: "/api/v1/admin/operations/clean/clean-low-gpu-usage-job",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      timeRange: z.number().int().describe("必填：观察窗口（分钟），如 30"),
      waitTime: z.number().int().optional().describe("告警等待时间（分钟），可选"),
      util: z.number().int().optional().describe("GPU 利用率阈值（百分比），可选"),
    },
    body: "all",
  },
  {
    name: "crater_admin_ops_clean_long_running",
    group: "admin",
    title: "立即处理超长运行作业",
    description:
      "【影响面：全平台所有作业，写，不可逆】立刻执行一次「超长运行作业处理」：把运行时长超过阈值的作业清理/停止。" +
      "⚠️ batchDays 是批处理类作业的天数阈值、interactiveDays 是交互式作业（Jupyter/WebIDE）的天数阈值，不传则用后端默认。" +
      "误用会批量打断长期训练；执行前请确认没有正在收敛的关键任务。",
    method: "POST",
    path: "/api/v1/admin/operations/clean/clean-long-running-job",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      batchDays: z.number().int().optional().describe("批处理作业的时长阈值（天）"),
      interactiveDays: z.number().int().optional().describe("交互式作业的时长阈值（天）"),
    },
    body: "all",
  },
  {
    name: "crater_admin_ops_clean_waiting_jupyter",
    group: "admin",
    title: "清理长期排队的 Jupyter 作业",
    description:
      "【影响面：全平台排队中的交互式作业，写，不可逆】立刻执行一次「长期排队 Jupyter 作业清理」：" +
      "把排队超过 waitMinitues 分钟的 Jupyter 作业取消掉（释放排队名额）。" +
      "⚠️ 单位是**分钟**（后端字段名拼写就是 waitMinitues）；取消后用户需重新提交，交互式环境里的临时内容会丢失。",
    method: "POST",
    path: "/api/v1/admin/operations/clean/clean-waiting-jupyter-job",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      waitMinitues: z.number().int().min(1).describe("必填：排队超过多少分钟就清理"),
      jobTypes: z.array(z.string()).optional().describe("限定作业类型（如 jupyter/webide）；不传由后端默认"),
    },
    body: "all",
  },
  {
    name: "crater_admin_ops_clean_waiting_custom",
    group: "admin",
    title: "清理长期排队的自定义作业",
    description:
      "【影响面：全平台排队中的自定义/训练作业，写，不可逆】立刻执行一次「长期排队自定义作业清理」：" +
      "把排队超过 waitMinitues 分钟的作业取消掉。⚠️ 单位是分钟；会打断用户排队中的训练任务，取消不可恢复。",
    method: "POST",
    path: "/api/v1/admin/operations/clean/clean-waiting-custom-job",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      waitMinitues: z.number().int().min(1).describe("必填：排队超过多少分钟就清理"),
      jobTypes: z.array(z.string()).optional().describe("限定作业类型（如 custom/pytorch/tensorflow）；不传由后端默认"),
    },
    body: "all",
  },
  {
    name: "crater_admin_ops_add_locktime",
    group: "admin",
    title: "给作业加锁定时间",
    description:
      "【影响面：单个作业，写，可逆（可清除）】给某个作业设置/延长锁定时间：锁定期内该作业不会被低利用率/超时清理任务回收。" +
      "isPermanent=true 表示永久锁定（请谨慎，等于永久豁免清理）；否则 days/hours/minutes 至少有一个 > 0。" +
      "name 必须是 **jobName**（k8s 名，如 vsc-crater-admin-261104-c774f），不是显示名。",
    method: "PUT",
    path: "/api/v1/admin/operations/add/locktime",
    scope: "admin",
    readOnly: false,
    input: {
      name: z.string().min(1).describe("作业的 jobName（k8s 名，不是显示名）"),
      isPermanent: z.boolean().optional().describe("永久锁定（true 时忽略时长）"),
      days: z.number().int().min(0).optional().describe("锁定天数"),
      hours: z.number().int().min(0).optional().describe("锁定小时数"),
      minutes: z.number().int().min(0).optional().describe("锁定分钟数"),
    },
    body: "all",
  },
  {
    name: "crater_admin_ops_clear_locktime",
    group: "admin",
    title: "清除作业锁定时间",
    description:
      "【影响面：单个作业，写，可逆（可再加锁）】清除某作业的锁定时间，使其重新受低利用率/超时清理策略约束。" +
      "name 必须是 jobName（k8s 名）。清除后若该作业利用率确实很低，下一轮清理可能把它回收。",
    method: "PUT",
    path: "/api/v1/admin/operations/clear/locktime",
    scope: "admin",
    readOnly: false,
    input: {
      name: z.string().min(1).describe("作业的 jobName（k8s 名，不是显示名）"),
    },
    body: "all",
  },
  {
    name: "crater_admin_ops_whitelist",
    group: "admin",
    title: "运维白名单（不被清理的作业/用户）",
    description:
      "【影响面：全平台只读】读取运维白名单：哪些作业/用户不会被自动清理。手工执行清理类操作前先看它，避免误杀白名单对象。",
    method: "GET",
    path: "/api/v1/admin/operations/whitelist",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_operation_logs",
    group: "admin",
    title: "操作审计日志",
    description:
      "【影响面：全平台只读】分页查管理端操作审计日志（操作人、类型、目标、结果、时间），可按人/目标/关键字/时间过滤。" +
      "用于追溯「谁改了什么」。注意分页参数名是 page 与 **limit**（不是 pageSize），时间是 RFC3339/标准时间字符串。",
    method: "GET",
    path: "/api/v1/admin/operation-logs",
    scope: "admin",
    readOnly: true,
    input: {
      page: z.number().int().min(1).optional().describe("页码，从 1 开始（默认 1）"),
      limit: z.number().int().min(1).max(200).optional().describe("每页条数（默认 10）"),
      operation_type: z.string().optional().describe("按操作类型过滤"),
      operator: z.string().optional().describe("按操作人（登录名）过滤"),
      target: z.string().optional().describe("按操作目标过滤（如节点名/用户名/作业名）"),
      search: z.string().optional().describe("关键字模糊搜索"),
      start_time: z.string().optional().describe("起始时间"),
      end_time: z.string().optional().describe("结束时间"),
    },
    query: ["page", "limit", "operation_type", "operator", "target", "search", "start_time", "end_time"],
  },
  {
    name: "crater_admin_approvals_list",
    group: "admin",
    title: "全部审批工单",
    description:
      "【影响面：全平台只读】列出所有审批工单（延长作业时长、数据集申请等），按创建时间倒序，含创建人/审批人/状态/内容。" +
      "后端无分页参数，一次性返回全量；单条详情用 crater_admin_approvals_get。",
    method: "GET",
    path: "/api/v1/admin/approvalorder",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_approvals_get",
    group: "admin",
    title: "审批工单详情",
    description: "【影响面：单工单只读】按工单 id 取详情（类型/状态/申请内容/理由/审批备注/创建人与审批人）。",
    method: "GET",
    path: "/api/v1/admin/approvalorder/:id",
    scope: "admin",
    readOnly: true,
    input: {
      id: z.number().int().min(1).describe("工单 id"),
    },
    pathParams: ["id"],
  },
  {
    name: "crater_admin_approvals_review",
    group: "admin",
    title: "审核审批工单",
    description:
      "【影响面：单个工单（可能牵动作业时长/数据集访问），写，可逆性取决于类型】通过/拒绝/取消一个工单。" +
      "status 只能是 Approved / Rejected / Canceled；**Rejected 必须带 reviewNotes**（后端强制）。" +
      "⚠️ 批准延长作业时长的工单会实际延长用户作业，拒绝则相当于驳回诉求；只能审核状态为 Pending 的工单。",
    method: "PUT",
    path: "/api/v1/admin/approvalorder/:id/review",
    scope: "admin",
    readOnly: false,
    input: {
      id: z.number().int().min(1).describe("工单 id"),
      status: z.enum(["Approved", "Rejected", "Canceled"]).describe("审核结果"),
      reviewNotes: z.string().optional().describe("审批备注（Rejected 时必填）"),
    },
    pathParams: ["id"],
    body: "all",
  },
  {
    name: "crater_admin_gpu_analysis_list",
    group: "admin",
    title: "GPU 分析记录列表",
    description:
      "【影响面：全平台只读】列出 GPU 利用率分析记录（关联作业名、评分、审核状态、涉及资源/节点等），按评分倒序。" +
      "用来找「疑似占卡不干活」的作业；审核/停机分别用 crater_admin_gpu_analysis_review 与 crater_admin_gpu_analysis_confirm_stop。",
    method: "GET",
    path: "/api/v1/admin/gpu-analysis",
    scope: "admin",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_admin_gpu_analysis_review",
    group: "admin",
    title: "审核 GPU 分析结论",
    description:
      "【影响面：单条分析记录，写，可逆（可再改）】把分析记录标记为「已确认占卡」(2) 或「已忽略」(3)。" +
      "⚠️ 只是标记结论，**不会**停止作业；要真正停作业用 crater_admin_gpu_analysis_confirm_stop。id 是分析记录 id，不是作业名。",
    method: "PUT",
    path: "/api/v1/admin/gpu-analysis/:id/review",
    scope: "admin",
    readOnly: false,
    input: {
      id: z.number().int().min(1).describe("分析记录 id"),
      reviewStatus: z.union([z.literal(2), z.literal(3)]).describe("2=确认占卡（Confirmed），3=忽略（Ignored）"),
    },
    pathParams: ["id"],
    body: "all",
  },
  {
    name: "crater_admin_gpu_analysis_confirm_stop",
    group: "admin",
    title: "确认并停止问题作业",
    description:
      "【影响面：单个用户作业，写，不可逆】确认某条分析结论并**立即删除对应作业**（作业被强制停止，用户需重新提交）。" +
      "id 是分析记录 id（不是作业名），后端会按记录里的 jobName 停作业，并把记录标记为已确认。" +
      "⚠️ 高风险：这是「替用户杀作业」，执行前请确认记录确实指向占卡/异常作业，并尽量先通知用户。",
    method: "POST",
    path: "/api/v1/admin/gpu-analysis/:id/confirm-stop",
    scope: "admin",
    readOnly: false,
    destructive: true,
    input: {
      id: z.number().int().min(1).describe("分析记录 id（来自 gpu_analysis_list）"),
    },
    pathParams: ["id"],
    body: "none",
  },
  {
    name: "crater_admin_gpu_analysis_trigger_all",
    group: "admin",
    title: "对全部运行中作业触发 GPU 分析",
    description:
      "【影响面：全平台运行中的作业，写，可逆（只产生分析记录）】把符合条件的运行中作业批量加入后台 GPU 分析队列，" +
      "接口立即返回排队数量，分析异步进行。⚠️ 会消耗 LLM 配额与集群指标查询资源，短时间内重复调用意义不大；" +
      "需要先在系统配置里开启 GPU 分析功能（crater_admin_system_gpu_analysis_update），否则任务会失败。",
    method: "POST",
    path: "/api/v1/admin/gpu-analysis/trigger/all-jobs",
    scope: "admin",
    readOnly: false,
    input: {},
    body: "none",
  },
  {
    name: "crater_admin_jobs_all",
    group: "admin",
    title: "全平台作业列表（宽接口）",
    description:
      "【影响面：全平台只读，含他人作业】列出所有用户的作业（这是后端不按调用者过滤的宽接口，只允许管理员用）。" +
      "默认只回最近若干天，用 days=-1 表示不按天数截断；page_size 上限 200（注意参数名是 page_size）。" +
      "返回项里同时有 `name`（用户填的显示名，可能中文/重名）与 `jobName`（k8s 名）：**所有按作业名操作的接口都要传 jobName**。",
    method: "GET",
    path: "/api/v1/vcjobs/all",
    scope: "admin",
    readOnly: true,
    input: {
      page: z.number().int().min(1).optional().describe("页码，从 1 开始（默认 1）"),
      page_size: z.number().int().min(1).max(200).optional().describe("每页条数，默认 10，最大 200"),
      sort: z.string().optional().describe("排序表达式，如 createdAt:desc"),
      search: z.string().optional().describe("关键字搜索（≤128 字符）"),
      days: z.number().int().optional().describe("统计天数，-1=不限时间"),
      job_type: z.string().optional().describe("按作业类型过滤（一次一个，如 jupyter/webide/custom）"),
      status: z.string().optional().describe("按作业状态过滤（一次一个，如 Running/Pending/Completed）"),
      node: z.string().optional().describe("按节点名过滤"),
    },
    query: ["page", "page_size", "sort", "search", "days", "job_type", "status", "node"],
  },
  {
    name: "crater_admin_jobs_by_user",
    group: "admin",
    title: "指定用户的作业列表（宽接口）",
    description:
      "【影响面：任意用户只读】列出某个用户的作业（后端不校验归属，只允许管理员用），参数与分页同 crater_admin_jobs_all。" +
      "username 必须是**登录名**（不是昵称）。注意返回项里的 `jobName` 才是后续所有作业接口要用的名字。",
    method: "GET",
    path: "/api/v1/vcjobs/user/:username",
    scope: "admin",
    readOnly: true,
    input: {
      username: z.string().min(1).describe("目标用户的登录名（不是昵称）"),
      page: z.number().int().min(1).optional().describe("页码，从 1 开始（默认 1）"),
      page_size: z.number().int().min(1).max(200).optional().describe("每页条数，默认 10，最大 200"),
      sort: z.string().optional().describe("排序表达式"),
      search: z.string().optional().describe("关键字搜索"),
      days: z.number().int().optional().describe("统计天数，-1=不限时间"),
      job_type: z.string().optional().describe("按作业类型过滤（一次一个）"),
      status: z.string().optional().describe("按作业状态过滤（一次一个）"),
      node: z.string().optional().describe("按节点名过滤"),
    },
    pathParams: ["username"],
    query: ["page", "page_size", "sort", "search", "days", "job_type", "status", "node"],
  },
  {
    name: "crater_admin_statistics",
    group: "admin",
    title: "资源使用统计（可跨全集群）",
    description:
      "【影响面：全平台统计只读】按时间范围返回资源使用统计（核时/卡时/GiB·时）：totalUsage + 时间序列。" +
      "scope=cluster 是集群总量（仅管理员可查），account 需账号管理员，user 可查任意用户（targetID 填 user_id 或 account_id）。" +
      "⚠️ startTime/endTime/step/scope 都是必填，时间是 RFC3339（如 2026-11-01T00:00:00+08:00）。",
    method: "GET",
    path: "/api/v1/statistics",
    scope: "admin",
    readOnly: true,
    input: {
      startTime: z.string().min(1).describe("起始时间，RFC3339，如 2026-11-01T00:00:00+08:00"),
      endTime: z.string().min(1).describe("结束时间，RFC3339"),
      step: z.enum(["day", "week"]).describe("聚合粒度"),
      scope: z.enum(["user", "account", "cluster"]).describe("统计维度；cluster 仅管理员可用"),
      targetID: z.number().int().optional().describe("目标 id（scope=user 填 user_id，scope=account 填 account_id；cluster 忽略）"),
    },
    query: ["startTime", "endTime", "step", "scope", "targetID"],
  },
];
