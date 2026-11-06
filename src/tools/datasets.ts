/**
 * 组：datasets —— 数据集元数据（列表 / 详情 / 创建 / 更新 / 删除 / 分享 / 成员清单）
 * 对应接口：docs/api-inventory.md §2.9（Protected 档 13 条；admin 档 5 条不在本组）
 *
 * 权限事实（§4.2-B / §4.3 末条）：
 *   - 写操作（create 除外的 update/delete/share/cancelshare）后端先验 `dataset.user_id == token.UserID`
 *     → **只有创建者**能改/分享；delete 额外允许平台管理员（dataset.go:773 有 RoleAdmin 分支），
 *       而 share/cancelshare 的 Protected 版本对管理员也照样要求 owner（dataset.go:398,491,578,676）。
 *   - 可见性 = `user_dataset.user_id = me` ∪ `account_dataset.account_id ∈ {默认账号 1, 当前账号}`（dataset.go:159-182）。
 *
 * 安全约束（§4.2-D）：
 *   - `GET /api/v1/dataset/detail/:datasetId` 只按 ID 查、**不校验归属**（dataset.go:209-225），本组**不封装**它。
 *     本组的「取详情」= `GET /api/v1/dataset/mydataset` 后按 id/name 精确命中，命中不了就报错，
 *     所以永远不会读到「我没被共享」的数据集。
 *   - `:datasetId/usersIn|usersNotIn|queuesIn|queuesNotIn` 这 4 条后端同样只校验数据集存在（dataset.go:920-1095），
 *     这里也统一先做一次可见性前置校验再调用。
 *
 * 不归本组：数据集目录里的文件浏览/上传/下载 = files 组的 `GET /api/ss/dataset/:id[/ *path]`（crater_files_dataset_browse）。
 */
import { z } from "zod";
import { GuardError } from "../errors.js";
import type { ToolContext, ToolSpec } from "../registry.js";

const MYDATASET = "/api/v1/dataset/mydataset";

/** mydataset 返回的 DatasetResp（dataset.go:113-142）里本组用到的字段 */
interface DatasetExtra {
  tag?: string[];
  tags?: string[];
  weburl?: string | null;
  editable?: boolean;
}

interface DatasetItem {
  id?: number;
  name?: string;
  url?: string;
  describe?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  mountCount?: number;
  sizeBytes?: number;
  downloadCount?: number;
  extra?: DatasetExtra;
  userInfo?: { username?: string; nickname?: string };
}

interface Selector {
  id?: number;
  name?: string;
}

function asList(data: unknown): DatasetItem[] {
  return Array.isArray(data) ? (data as DatasetItem[]) : [];
}

/** 我可见的数据集（唯一的元数据入口） */
async function listVisible(ctx: ToolContext): Promise<DatasetItem[]> {
  const data = await ctx.client.request<unknown>({ method: "GET", path: MYDATASET });
  return asList(data);
}

function ownerOf(ds: DatasetItem): string | undefined {
  return ds.userInfo?.username;
}

function isOwner(ds: DatasetItem, ctx: ToolContext): boolean {
  const me = ctx.client.info.username;
  return !!me && ownerOf(ds) === me;
}

/** ExtraContent 的 json tag 是 "tag"（dao/model/dataset.go:16），"tags" 只是兜底 */
function tagsOf(ds: DatasetItem): string[] {
  const extra = ds.extra ?? {};
  const t = extra.tag ?? extra.tags;
  return Array.isArray(t) ? t : [];
}

function pickSelector(args: Record<string, unknown>, toolName: string): Selector {
  const id = typeof args.id === "number" ? args.id : undefined;
  const rawName = typeof args.name === "string" ? args.name.trim() : "";
  if (id === undefined && !rawName) {
    throw new GuardError(
      `${toolName}：请至少提供 id 或 name 之一来指定数据集。` +
        `不知道 ID 就先调 crater_datasets_mine 列出你能看到的数据集。`,
    );
  }
  return { id, name: rawName || undefined };
}

function selectOne(items: DatasetItem[], sel: Selector, toolName: string): DatasetItem {
  const hits = items.filter(
    (d) => (sel.id === undefined || d.id === sel.id) && (sel.name === undefined || d.name === sel.name),
  );
  const wanted = [sel.id !== undefined ? `id=${sel.id}` : "", sel.name ? `name=${sel.name}` : ""].filter(Boolean).join(" 且 ");
  if (hits.length === 0) {
    throw new GuardError(
      `${toolName}：在你的可见范围里找不到 ${wanted} 的数据集。\n` +
        `两种可能：① 它存在但没共享给你/你的账号（Crater 的可见性 = 直接共享给你的 ∪ 共享给你所在账号的）；` +
        `② 名字或 ID 打错了。请先调 crater_datasets_mine 核对。\n` +
        `（本 MCP 故意不封装 GET /api/v1/dataset/detail/:id —— 那个接口不校验归属，会把别人的数据集元信息漏给任意登录用户。）`,
    );
  }
  if (hits.length > 1) {
    throw new GuardError(
      `${toolName}：按 name=${sel.name} 命中 ${hits.length} 条同名数据集（Crater 允许同名），请改用 id 精确指定。`,
    );
  }
  return hits[0] as DatasetItem;
}

/** 只在我可见的集合里查（读操作） */
async function resolveVisible(ctx: ToolContext, sel: Selector, toolName: string): Promise<DatasetItem> {
  return selectOne(await listVisible(ctx), sel, toolName);
}

/** 改/删：创建者或平台管理员（后端 dataset.go:773,861 允许 admin） */
function requireOwnerOrAdmin(ctx: ToolContext, ds: DatasetItem, toolName: string): void {
  if (ctx.client.isAdmin) return;
  if (!isOwner(ds, ctx)) {
    throw new GuardError(
      `${toolName}：只有数据集创建者能修改/删除它。当前登录是 ${ctx.client.info.username ?? "(未知)"}，` +
        `创建者是 ${ownerOf(ds) ?? "(未知)"}（数据集「${ds.name}」id=${ds.id}）。`,
    );
  }
}

/** 分享/取消分享：后端 Protected 版本严格只认创建者，连平台管理员都不行 */
function requireStrictOwner(ctx: ToolContext, ds: DatasetItem, toolName: string): void {
  if (!isOwner(ds, ctx)) {
    throw new GuardError(
      `${toolName}：只有数据集创建者能分享/取消分享。当前登录是 ${ctx.client.info.username ?? "(未知)"}，` +
        `创建者是 ${ownerOf(ds) ?? "(未知)"}（数据集「${ds.name}」id=${ds.id}）。\n` +
        `注意：POST /api/v1/dataset/share/* 的 Protected 版本即使对平台管理员也要求 owner（dataset.go:398）；` +
        `管理员改他人数据集的分享关系要用 admin 组的 /api/v1/admin/dataset/share/*。`,
    );
  }
}

function brief(ds: DatasetItem, ctx: ToolContext): Record<string, unknown> {
  const describe = (ds.describe ?? "").trim();
  return {
    id: ds.id,
    name: ds.name,
    type: ds.type ?? "dataset",
    owned: isOwner(ds, ctx),
    owner: ownerOf(ds),
    storagePath: ds.url,
    describe: describe.length > 200 ? `${describe.slice(0, 200)}…` : describe,
    tags: tagsOf(ds),
    sizeBytes: ds.sizeBytes ?? 0,
    mountCount: ds.mountCount ?? 0,
    updatedAt: ds.updatedAt,
  };
}

/** 逻辑存储路径前缀校验：后端 redirectDatasetURL 只接受 public/ account/ user/（dataset.go:344-367） */
function normalizeStorageUrl(raw: string, toolName: string): string {
  const cleaned = raw.trim().replace(/^\/+/, "");
  if (!cleaned) throw new GuardError(`${toolName}：url 不能为空。`);
  const ok = /^(public|account|user)(\/|$)/.test(cleaned);
  if (!ok) {
    throw new GuardError(
      `${toolName}：url 必须是存储逻辑路径，且以 user/（我的空间）、account/（当前账号空间）或 public/（公共只读）开头，` +
        `例如 user/datasets/coco2017。后端会把前缀重写成物理路径；其他写法会直接报 "dataset url err"。\n` +
        `你给的是：${raw}`,
    );
  }
  return cleaned;
}

const selectorShape = {
  id: z.number().int().min(1).optional().describe("数据集 ID（来自 crater_datasets_mine；与 name 至少给一个）"),
  name: z.string().min(1).optional().describe("数据集名（与 id 至少给一个；同名多条时请改用 id）"),
};

const TYPE_ENUM = z
  .enum(["dataset", "model", "sharefile"])
  .describe("条目类型：dataset=数据集 model=模型 sharefile=共享文件（后端默认 dataset）");

/** members 系列共用的前置：先保证该数据集在我的可见范围内 */
async function membersOf(
  ctx: ToolContext,
  datasetId: number,
  kind: "usersIn" | "usersNotIn" | "queuesIn" | "queuesNotIn",
  toolName: string,
): Promise<unknown> {
  const ds = await resolveVisible(ctx, { id: datasetId }, toolName);
  const data = await ctx.client.request<unknown>({
    method: "GET",
    path: `/api/v1/dataset/${encodeURIComponent(String(ds.id))}/${kind}`,
  });
  return {
    dataset: { id: ds.id, name: ds.name, owned: isOwner(ds, ctx), owner: ownerOf(ds) },
    kind,
    count: Array.isArray(data) ? data.length : 0,
    items: Array.isArray(data) ? data : [],
  };
}

const membersInput = (what: string) => ({
  datasetId: z.number().int().min(1).describe(`数据集 ID（就是 crater_datasets_mine 里的 id），查${what}`),
});

export const specs: ToolSpec[] = [
  // ---------------------------------------------------------------- 读
  {
    name: "crater_datasets_mine",
    group: "datasets",
    title: "我的数据集列表",
    description:
      "列出当前身份**可见**的数据集：我创建的 + 直接共享给我的 + 共享给我所在账号（含默认账号）的。" +
      "本组其它工具要的 id 都从这里取。返回已裁剪成关键字段，可用 keyword/type/ownedOnly 在本地过滤。" +
      "注意：同名数据集是允许的（靠 id 区分），改/删前请确认 owned=true。",
    method: "GET",
    path: MYDATASET,
    scope: "account",
    readOnly: true,
    input: {
      keyword: z.string().optional().describe("按名字/描述做不区分大小写的子串过滤"),
      type: TYPE_ENUM.optional(),
      ownedOnly: z.boolean().optional().describe("true=只返回我创建的（即我拥有改/删/分享权的那部分）"),
    },
    run: async (args, ctx) => {
      const items = await listVisible(ctx);
      const kw = typeof args.keyword === "string" ? args.keyword.trim().toLowerCase() : "";
      const type = typeof args.type === "string" ? args.type : undefined;
      const ownedOnly = args.ownedOnly === true;
      const filtered = items.filter((d) => {
        if (type && (d.type ?? "dataset") !== type) return false;
        if (ownedOnly && !isOwner(d, ctx)) return false;
        if (kw) {
          const hay = `${d.name ?? ""} ${d.describe ?? ""}`.toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      });
      return {
        totalVisible: items.length,
        returned: filtered.length,
        items: filtered.map((d) => brief(d, ctx)),
      };
    },
  },
  {
    name: "crater_datasets_get",
    group: "datasets",
    title: "数据集详情（仅限你可见的）",
    description:
      "按 id 或 name 取数据集详情：存储路径、描述、标签、类型、容量、挂载数、创建者、是否可编辑。" +
      "它**不**调用 GET /api/v1/dataset/detail/:id（那个接口只按 ID 查、不校验归属，本 MCP 不暴露它），" +
      "而是在「我的可见集合」里精确命中，命中不了就报错，所以不可能读到没共享给你的数据集。" +
      "浏览/下载里面的文件请用 files 组的 crater_files_dataset_browse（数据集下载要求账号未被封禁 DatasetDownload 能力，否则 storage-server 返回 403）。",
    method: "GET",
    path: MYDATASET,
    scope: "account",
    readOnly: true,
    input: { ...selectorShape },
    run: async (args, ctx) => {
      const ds = await resolveVisible(ctx, pickSelector(args, "crater_datasets_get"), "crater_datasets_get");
      const extra = ds.extra ?? {};
      return {
        ...brief(ds, ctx),
        editable: extra.editable === true,
        weburl: extra.weburl ?? null,
        downloadCount: ds.downloadCount ?? 0,
        createdAt: ds.createdAt,
        canEditThisTool: isOwner(ds, ctx) || ctx.client.isAdmin,
        note:
          "数据集只是元数据，指向存储里的一个目录；浏览/下载目录内容用 crater_files_dataset_browse（files 组）。" +
          "只有创建者能改/分享/删除。",
      };
    },
  },
  {
    name: "crater_datasets_shared_users",
    group: "datasets",
    title: "数据集已共享给哪些用户",
    description:
      "列出该数据集已共享的用户（GET /:datasetId/usersIn，isowner=true 的那条就是创建者）。" +
      "先会校验数据集在你可见范围内，避免拿任意 ID 探别人的共享关系。" +
      "用于回答「谁能看这个数据集」，也可用来挑出要取消分享的 userID（配合 crater_datasets_unshare_user）。",
    method: "GET",
    path: "/api/v1/dataset/:datasetId/usersIn",
    scope: "account",
    readOnly: true,
    pathParams: ["datasetId"],
    input: membersInput("已共享用户"),
    run: async (args, ctx) =>
      membersOf(ctx, Number(args.datasetId), "usersIn", "crater_datasets_shared_users"),
  },
  {
    name: "crater_datasets_unshared_users",
    group: "datasets",
    title: "数据集可分享给哪些用户",
    description:
      "列出**还没有**被共享该数据集的活跃用户（GET /:datasetId/usersNotIn），即 crater_datasets_share_user 的候选名单；" +
      "先会校验数据集在你可见范围内。返回项里的 id 就是分享时要传的 userID。" +
      "提醒：接口返回的是用户属性对象（id 来自属性表），若某条缺 id，请让用户在网页端确认后再分享。",
    method: "GET",
    path: "/api/v1/dataset/:datasetId/usersNotIn",
    scope: "account",
    readOnly: true,
    pathParams: ["datasetId"],
    input: membersInput("未共享用户"),
    run: async (args, ctx) =>
      membersOf(ctx, Number(args.datasetId), "usersNotIn", "crater_datasets_unshared_users"),
  },
  {
    name: "crater_datasets_shared_queues",
    group: "datasets",
    title: "数据集已共享给哪些账号",
    description:
      "列出该数据集已共享的账号/队列（GET /:datasetId/queuesIn；这里的 id 是**账号 ID**，不是账号名）。" +
      "先会校验数据集在你可见范围内。" +
      "分享给账号 = 该账号全体成员都能看到，所以这份名单等于「整账号可见」的范围。",
    method: "GET",
    path: "/api/v1/dataset/:datasetId/queuesIn",
    scope: "account",
    readOnly: true,
    pathParams: ["datasetId"],
    input: membersInput("已共享账号"),
    run: async (args, ctx) =>
      membersOf(ctx, Number(args.datasetId), "queuesIn", "crater_datasets_shared_queues"),
  },
  {
    name: "crater_datasets_unshared_queues",
    group: "datasets",
    title: "数据集可分享给哪些账号",
    description:
      "列出**还没有**被共享该数据集的账号/队列（GET /:datasetId/queuesNotIn），即 crater_datasets_share_queue 的候选名单；" +
      "先会校验数据集在你可见范围内。返回的 id 就是要传给 queueIDs 的账号 ID。",
    method: "GET",
    path: "/api/v1/dataset/:datasetId/queuesNotIn",
    scope: "account",
    readOnly: true,
    pathParams: ["datasetId"],
    input: membersInput("未共享账号"),
    run: async (args, ctx) =>
      membersOf(ctx, Number(args.datasetId), "queuesNotIn", "crater_datasets_unshared_queues"),
  },

  // ---------------------------------------------------------------- 写
  {
    name: "crater_datasets_create",
    group: "datasets",
    title: "创建数据集",
    description:
      "登记一个新的数据集/模型条目（只是元数据，指向存储里已存在的一个目录）。" +
      "必填 name/describe/url；url 必须以 user/（我的空间）、account/（当前账号空间）或 public/（公共只读）开头，" +
      "建议先用 files 组的工具把目录建好、数据传完再登记。" +
      "坑：成功时后端只回一句字符串、不回新 id，需要再调 crater_datasets_mine 拿 id；ispublic=true 会把数据集塞进默认账号（等于全平台可见），别随便置 true。",
    method: "POST",
    path: "/api/v1/dataset/create",
    scope: "self",
    readOnly: false,
    input: {
      name: z.string().min(1).describe("数据集名（展示用，允许同名，靠 id 区分）"),
      url: z.string().min(1).describe("存储逻辑路径，必须 user/ 或 account/ 或 public/ 开头，例如 user/datasets/coco2017"),
      describe: z.string().min(1).describe("描述（必填，别传空）"),
      type: TYPE_ENUM.optional(),
      tags: z.array(z.string()).optional().describe("标签列表"),
      weburl: z.string().optional().describe("外部主页/来源链接（可选）"),
      editable: z.boolean().optional().describe("标记为「可编辑」（仅前端语义）"),
      ispublic: z.boolean().optional().describe("true=同时共享给默认账号（全平台可见），默认 false"),
    },
    run: async (args, ctx) => {
      const tool = "crater_datasets_create";
      const url = normalizeStorageUrl(String(args.url ?? ""), tool);
      const name = String(args.name ?? "").trim();
      if (!name) throw new GuardError(`${tool}：name 不能为空。`);
      const body: Record<string, unknown> = {
        name,
        url,
        describe: String(args.describe ?? ""),
      };
      if (args.type !== undefined) body.type = args.type;
      if (Array.isArray(args.tags)) body.tags = args.tags;
      if (args.weburl !== undefined) body.weburl = args.weburl;
      if (args.editable !== undefined) body.editable = args.editable;
      if (args.ispublic !== undefined) body.ispublic = args.ispublic;

      const res = await ctx.client.request({ method: "POST", path: "/api/v1/dataset/create", body });

      // 创建已成功，下面只是尽力回查新 id（失败不影响创建结果）
      let created: Record<string, unknown> = {};
      try {
        const same = (await listVisible(ctx))
          .filter((d) => d.name === name && isOwner(d, ctx))
          .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
        if (same.length) {
          created = {
            id: same[0]?.id,
            idNote: same.length > 1 ? `同名的自有数据集共 ${same.length} 条，这里给的是 ID 最大（最新）那条` : undefined,
          };
        } else {
          created = { idNote: "回查没找到，可能只是索引滞后；请调 crater_datasets_mine 确认" };
        }
      } catch {
        created = { idNote: "回查新 id 失败（不影响创建结果），请调 crater_datasets_mine" };
      }

      return { ok: true, sent: body, response: res, ...created };
    },
  },
  {
    name: "crater_datasets_update",
    group: "datasets",
    title: "更新数据集",
    description:
      "改数据集的 name / 描述 / url / 标签（只有创建者或平台管理员能改）。" +
      "接口本身要求 name/describe/url 全量必填，本工具会先用 crater_datasets_mine 的现值补齐你没传的字段，tags 是全量替换（不传则沿用原标签）；" +
      "type（dataset/model）和 ispublic 创建后改不了（后端 UpdateDatasetreq 没有这两个字段）。" +
      "url 前缀仍是 user/ account/ public/ 语义：传 user/... 这类逻辑路径会被重写成物理路径，传其它字符串则原样写入。",
    method: "POST",
    path: "/api/v1/dataset/update",
    scope: "self",
    readOnly: false,
    input: {
      datasetID: z.number().int().min(1).describe("要改的数据集 ID（来自 crater_datasets_mine）"),
      name: z.string().min(1).optional().describe("新名字；不传沿用原名"),
      describe: z.string().min(1).optional().describe("新描述；不传沿用原描述"),
      url: z.string().min(1).optional().describe("新存储路径；不传沿用原路径"),
      tags: z.array(z.string()).optional().describe("新的完整标签列表（全量替换）；不传沿用原标签"),
      weburl: z.string().optional().describe("外部链接；传空串表示不改"),
    },
    run: async (args, ctx) => {
      const tool = "crater_datasets_update";
      const datasetID = Number(args.datasetID);
      const ds = await resolveVisible(ctx, { id: datasetID }, tool);
      requireOwnerOrAdmin(ctx, ds, tool);

      const name = args.name !== undefined ? String(args.name).trim() : (ds.name ?? "");
      const describe = args.describe !== undefined ? String(args.describe) : (ds.describe ?? "");
      const url =
        args.url !== undefined ? normalizeStorageUrl(String(args.url), tool) : (ds.url ?? "");
      if (!name) throw new GuardError(`${tool}：name 不能为空。`);
      if (!describe) throw new GuardError(`${tool}：describe 不能为空（后端 binding:"required"），当前值也是空，请显式传一个描述。`);
      if (!url) throw new GuardError(`${tool}：url 不能为空（后端 binding:"required"）。`);

      const tags = Array.isArray(args.tags) ? (args.tags as string[]) : tagsOf(ds);
      const weburl = args.weburl !== undefined ? String(args.weburl) : ((ds.extra?.weburl ?? "") as string);

      const body: Record<string, unknown> = { datasetID, name, describe, url, tags, weburl };
      const res = await ctx.client.request({ method: "POST", path: "/api/v1/dataset/update", body });
      return { ok: true, datasetID, sent: body, response: res };
    },
  },
  {
    name: "crater_datasets_delete",
    group: "datasets",
    title: "删除数据集",
    description:
      "删除数据集条目，并连带清掉它的 user_dataset / account_dataset 共享关系（只有创建者或平台管理员能删）。" +
      "**不会**删存储里的实际文件——目录还在，要清数据请再用 files 组删目录。" +
      "这是不可逆操作，删前建议先 crater_datasets_get 确认 id 和名字。",
    method: "DELETE",
    path: "/api/v1/dataset/delete/:id",
    scope: "self",
    readOnly: false,
    destructive: true,
    pathParams: ["id"],
    input: {
      id: z.number().int().min(1).describe("要删除的数据集 ID（来自 crater_datasets_mine）"),
    },
    run: async (args, ctx) => {
      const tool = "crater_datasets_delete";
      const ds = await resolveVisible(ctx, { id: Number(args.id) }, tool);
      requireOwnerOrAdmin(ctx, ds, tool);
      const res = await ctx.client.request({
        method: "DELETE",
        path: `/api/v1/dataset/delete/${encodeURIComponent(String(ds.id))}`,
      });
      return {
        ok: true,
        deleted: { id: ds.id, name: ds.name, storagePath: ds.url },
        response: res,
        note: `只删了元数据与共享关系，存储目录 ${ds.url ?? "(未知)"} 仍在；需要清空请用 files 组删除目录。`,
      };
    },
  },
  {
    name: "crater_datasets_share_user",
    group: "datasets",
    title: "把数据集分享给用户",
    description:
      "把数据集共享给一批用户（userIDs 是用户 ID，可从 crater_datasets_unshared_users 取）；只有创建者能分享。" +
      "分享后对方在 mydataset 里就能看到并可挂载/下载（下载还要求对方没被封禁 DatasetDownload 能力）。" +
      "坑：后端是逐个插入，遇到「该用户已共享过」会整体报错，但前面的已经生效——建议先用 crater_datasets_unshared_users 过滤出真正的候选再批量分享。",
    method: "POST",
    path: "/api/v1/dataset/share/user",
    scope: "self",
    readOnly: false,
    input: {
      datasetID: z.number().int().min(1).describe("数据集 ID（来自 crater_datasets_mine）"),
      userIDs: z
        .array(z.number().int().min(1))
        .min(1)
        .describe("要分享给的用户 ID 列表（来自 crater_datasets_unshared_users）"),
    },
    run: async (args, ctx) => {
      const tool = "crater_datasets_share_user";
      const ds = await resolveVisible(ctx, { id: Number(args.datasetID) }, tool);
      requireStrictOwner(ctx, ds, tool);
      const body = { datasetID: ds.id, userIDs: args.userIDs };
      const res = await ctx.client.request({ method: "POST", path: "/api/v1/dataset/share/user", body });
      return { ok: true, dataset: { id: ds.id, name: ds.name }, sent: body, response: res };
    },
  },
  {
    name: "crater_datasets_share_queue",
    group: "datasets",
    title: "把数据集分享给账号",
    description:
      "把数据集共享给整个账号/队列（queueIDs 是**账号 ID**，不是账号名，可从 crater_datasets_unshared_queues 取）；只有创建者能分享。" +
      "分享给账号 = 该账号**全体成员**都能看到并能挂载/下载这个数据集。" +
      "坑：同样逐个插入，遇到「该账号已共享」会整体报错且前面已生效，批量前先用 crater_datasets_unshared_queues 过滤。",
    method: "POST",
    path: "/api/v1/dataset/share/queue",
    scope: "self",
    readOnly: false,
    input: {
      datasetID: z.number().int().min(1).describe("数据集 ID（来自 crater_datasets_mine）"),
      queueIDs: z
        .array(z.number().int().min(1))
        .min(1)
        .describe("要分享给的账号/队列 ID 列表（来自 crater_datasets_unshared_queues）"),
    },
    run: async (args, ctx) => {
      const tool = "crater_datasets_share_queue";
      const ds = await resolveVisible(ctx, { id: Number(args.datasetID) }, tool);
      requireStrictOwner(ctx, ds, tool);
      const body = { datasetID: ds.id, queueIDs: args.queueIDs };
      const res = await ctx.client.request({ method: "POST", path: "/api/v1/dataset/share/queue", body });
      return { ok: true, dataset: { id: ds.id, name: ds.name }, sent: body, response: res };
    },
  },
  {
    name: "crater_datasets_unshare_user",
    group: "datasets",
    title: "取消对某个用户的分享",
    description:
      "取消该数据集对某个用户的共享（一次一个 userID，只有创建者能取消；可用 crater_datasets_shared_users 查当前名单）。" +
      "取消后对方的 mydataset 里就看不到它了；如果对方是通过账号共享看到它的，取消用户级分享并不会让他看不到。" +
      "注意：不能取消创建者自己（后端报 can't cancel share with creator），也不能取消本来就没共享的用户（报 user doesn't shared dataset）。",
    method: "POST",
    path: "/api/v1/dataset/cancelshare/user",
    scope: "self",
    readOnly: false,
    destructive: true,
    input: {
      datasetID: z.number().int().min(1).describe("数据集 ID（来自 crater_datasets_mine）"),
      userID: z.number().int().min(1).describe("要取消共享的用户 ID（来自 crater_datasets_shared_users）"),
    },
    run: async (args, ctx) => {
      const tool = "crater_datasets_unshare_user";
      const ds = await resolveVisible(ctx, { id: Number(args.datasetID) }, tool);
      requireStrictOwner(ctx, ds, tool);
      const body = { datasetID: ds.id, userID: Number(args.userID) };
      const res = await ctx.client.request({ method: "POST", path: "/api/v1/dataset/cancelshare/user", body });
      return { ok: true, dataset: { id: ds.id, name: ds.name }, sent: body, response: res };
    },
  },
  {
    name: "crater_datasets_unshare_queue",
    group: "datasets",
    title: "取消对某个账号的分享",
    description:
      "取消该数据集对某个账号/队列的共享（一次一个 queueID=账号 ID，只有创建者能取消；当前名单用 crater_datasets_shared_queues 查）。" +
      "取消后该账号的普通成员就不再通过账号维度看到它（若他们同时被单独共享过，仍然可见）。" +
      "未共享过的账号会报 the dataset was not shared with the queue。",
    method: "POST",
    path: "/api/v1/dataset/cancelshare/queue",
    scope: "self",
    readOnly: false,
    destructive: true,
    input: {
      datasetID: z.number().int().min(1).describe("数据集 ID（来自 crater_datasets_mine）"),
      queueID: z.number().int().min(1).describe("要取消共享的账号/队列 ID（来自 crater_datasets_shared_queues）"),
    },
    run: async (args, ctx) => {
      const tool = "crater_datasets_unshare_queue";
      const ds = await resolveVisible(ctx, { id: Number(args.datasetID) }, tool);
      requireStrictOwner(ctx, ds, tool);
      const body = { datasetID: ds.id, queueID: Number(args.queueID) };
      const res = await ctx.client.request({ method: "POST", path: "/api/v1/dataset/cancelshare/queue", body });
      return { ok: true, dataset: { id: ds.id, name: ds.name }, sent: body, response: res };
    },
  },
];
