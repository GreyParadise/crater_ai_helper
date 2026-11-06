/**
 * 组：files —— 文件管理（真正的文件读写走独立进程 storage-server 的 /api/ss/*，不在 /api/v1/files）
 * 对应接口：docs/api-inventory.md §2.31 / §3.5；线上可用性已按 docs/verified-routes.md 与实测校正。
 *
 * 线上事实（2026-11-06 实测，.126 面板）：
 * - GET    /api/ss/files[/<逻辑路径>]        列目录（只读视图）
 * - GET    /api/ss/rwfiles[/<逻辑路径>]      列目录（只含「有写权限」的空间；带路径时若无写权限直接 401）
 * - GET    /api/ss/admin/files[/<逻辑路径>]  管理员全量列目录（RolePlatform==3）
 * - GET    /api/ss/download/<逻辑路径>       下载，裸字节
 * - PUT    /api/ss/<逻辑路径>                WebDAV 写入（**线上没有 POST /api/ss/upload，实测 404**）
 * - MKCOL  /api/ss/<逻辑路径>                建目录（只能一级；父目录必须已存在，否则 409）
 * - POST   /api/ss/move/<逻辑路径>           移动/重命名，body {"dst": "..."}（目标已存在会失败，不覆盖）
 * - DELETE /api/ss/delete/<逻辑路径>         删除（后端 RemoveAll 语义：目录整棵递归删除，且幂等）
 * - GET    /api/ss/userspace | /queuespace   空间路径（**仅平台管理员可用**，file.go GetUserSpace/GetAccountSpace）
 * - GET    /api/ss/dataset/:id[/<路径>]      数据集目录浏览
 * - GET    /api/ss/usage                     各空间用量（{space:{usedBytes,totalFiles,capacityGb}}）
 * - 主后端 /api/v1/storage/{capabilities,my-quota,dirsize/*} 线上全部 404 → 未封装；只有 /api/v1/storage/verify 存在。
 *
 * 逻辑路径（space）语义：`*path` 的第一段就是空间根（dao/model/const.go）：
 *   user = 我的个人空间根（/crater/users/<我的 space>）、account = 当前账号共享空间根、public = 公共空间根、
 *   admin-user / admin-account / admin-public = 管理端视图（仅 RolePlatform==3）。
 * 权限由 token 按空间根推导（storage/file.go GetPermission）：user 恒为 ReadWrite；account 取账号内访问模式
 * （RO 时写操作被后端 401 拒绝）；public 取公共访问模式。
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { encodePath } from "../client.js";
import { GuardError } from "../errors.js";
import { Z, type ToolContext, type ToolSpec } from "../registry.js";

type Args = Record<string, unknown>;

/** 逻辑路径第一段允许的取值（dao/model/const.go:121-126） */
const USER_ROOTS = ["user", "public", "account"] as const;
const ADMIN_ROOTS = ["user", "public", "account", "admin-user", "admin-account", "admin-public"] as const;

/** 访问模式（dao/model/const.go:31-35） */
const ACCESS_NAME: Record<number, string> = { 1: "NA", 2: "ReadOnly", 3: "ReadWrite", 4: "AdminOnly" };
/** 文件权限（dao/model/const.go:106-118） */
const PERMISSION_NAME: Record<number, string> = { 1: "NotAllowed", 2: "ReadOnly", 3: "ReadWrite" };

const BASE_FILES = "/api/ss/files";
const BASE_RWFILES = "/api/ss/rwfiles";
const BASE_ADMIN_FILES = "/api/ss/admin/files";

/** 单次列举最多收集的条目数（防深度递归把上下文撑爆） */
const MAX_LIST_ENTRIES = 2000;
/** 上传/下载单文件默认上限：整文件会进内存，超了先让 agent 显式确认 */
const DEFAULT_MAX_TRANSFER_BYTES = 512 * 1024 * 1024;

const SPACE_NOTE =
  "逻辑路径第一段就是空间：user=我的个人空间（如 user/exp1/data.csv）、account=当前账号共享空间、" +
  "public=公共空间（如 public/datasets/xxx）；不要拼 /crater、用户名或 ?space= 之类的 query（后端没有这个参数）。";

// ---------------------------------------------------------------- 通用小工具

function formatBytes(n: number | null | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 ? String(value) : value.toFixed(2)} ${units[i] ?? "B"}`;
}

/** 归一化逻辑路径：统一分隔符、去掉首尾 /、拒绝 . 与 .. 段 */
function normalizeLogicalPath(raw: unknown, field: string): string {
  const s = String(raw ?? "").trim();
  if (s.includes("\0")) throw new GuardError(`${field} 含有非法字符（NUL）`);
  const segs = s
    .replace(/\\/g, "/")
    .split("/")
    .filter((x) => x.length > 0);
  if (segs.some((x) => x === "." || x === "..")) {
    throw new GuardError(`${field} 不允许包含 "." 或 ".." 段：${s}。逻辑路径请写空间内的正常相对路径。`);
  }
  return segs.join("/");
}

/** 校验第一段是合法空间根（后端对未知第一段一律 NotAllowed，这里提前给可读原因） */
function assertSpaceRoot(logicalPath: string, field: string, roots: readonly string[]): void {
  const root = logicalPath.split("/")[0] ?? "";
  if (!roots.includes(root)) {
    throw new GuardError(
      `${field} 的第一段必须是空间根（${roots.join(" / ")}），收到的是「${root || "(空)"}」。` +
        `例如 user/exp1/data.csv、account/shared/notes.md、public/datasets/xxx。`,
    );
  }
}

/** 写操作的目标必须精确到空间内的条目，不能是空间根本身 */
function assertWritableTarget(logicalPath: string, field: string): void {
  assertSpaceRoot(logicalPath, field, ADMIN_ROOTS);
  if (logicalPath.split("/").length < 2) {
    throw new GuardError(`${field} 不能只给空间根（${logicalPath}）：写操作必须带上具体的文件/目录名。`);
  }
}

interface RawEntry {
  name?: unknown;
  size?: unknown;
  isdir?: unknown;
  modifytime?: unknown;
  sys?: unknown;
}

interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  sizeText: string | null;
  modifyTime: string | null;
}

function toEntry(raw: RawEntry, parent: string): Entry {
  const name = typeof raw.name === "string" ? raw.name : "";
  const isDir = raw.isdir === true;
  const size = typeof raw.size === "number" && raw.size >= 0 ? raw.size : null;
  return {
    name,
    path: parent ? `${parent}/${name}` : name,
    isDir,
    size: isDir ? null : size,
    sizeText: isDir ? null : formatBytes(size),
    modifyTime: typeof raw.modifytime === "string" ? raw.modifytime : null,
  };
}

/** 列一层目录（返回后端原始条目结构） */
async function getListing(ctx: ToolContext, base: string, logicalPath: string): Promise<RawEntry[]> {
  const url = logicalPath ? `${base}/${encodePath(logicalPath)}` : base;
  const data = await ctx.client.request<RawEntry[] | null>({ method: "GET", path: url, target: "storage" });
  return Array.isArray(data) ? data : [];
}

/** 探测远端某个逻辑路径：列父目录比对名字（不需要额外接口） */
async function statRemote(
  ctx: ToolContext,
  logicalPath: string,
): Promise<{ exists: boolean; isDir: boolean; size: number | null }> {
  const segs = logicalPath.split("/");
  const name = segs.pop() ?? "";
  const parent = segs.join("/");
  const listing = await getListing(ctx, BASE_FILES, parent);
  const hit = listing.find((e) => typeof e.name === "string" && e.name === name);
  if (!hit) return { exists: false, isDir: false, size: null };
  return {
    exists: true,
    isDir: hit.isdir === true,
    size: typeof hit.size === "number" && hit.size >= 0 ? hit.size : null,
  };
}

/** 按深度递归收集条目（不吞错：子目录失败记进 warnings） */
async function collectEntries(
  ctx: ToolContext,
  base: string,
  logicalPath: string,
  depthLeft: number,
  out: Entry[],
  warnings: string[],
  roots: readonly string[],
): Promise<void> {
  const raw = await getListing(ctx, base, logicalPath);
  for (const item of raw) {
    const entry = toEntry(item, logicalPath);
    if (!entry.name) continue;
    out.push(entry);
    if (!entry.isDir || depthLeft <= 0) continue;
    if (out.length >= MAX_LIST_ENTRIES) {
      warnings.push(`已达单次列举上限 ${MAX_LIST_ENTRIES} 条，停止继续展开子目录（可调小 depth 或指定更深的 path）`);
      return;
    }
    try {
      // 子目录一定仍以同一空间根开头；异常条目降级成 warning，不打断整次列举
      assertSpaceRoot(entry.path, "子目录路径", roots);
      await collectEntries(ctx, base, entry.path, depthLeft - 1, out, warnings, roots);
    } catch (err) {
      warnings.push(`${entry.path}：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; total: number; hasMore: boolean } {
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return { items: slice, total: items.length, hasMore: start + slice.length < items.length };
}

/** 由 token 推导各空间权限（后端没有逐条 ACL，权限只看空间根） */
function spacePermissions(ctx: ToolContext): Record<string, unknown> {
  const info = ctx.client.info;
  return {
    user: "ReadWrite",
    account: (info.accessMode !== undefined ? ACCESS_NAME[info.accessMode] : undefined) ?? "未知",
    public: (info.publicAccessMode !== undefined ? ACCESS_NAME[info.publicAccessMode] : undefined) ?? "未知",
    platformRole: info.rolePlatform,
    accountName: info.accountName,
    note: "后端按空间根推导权限（storage/file.go GetPermission）：user 恒为 ReadWrite；account 取你在账号内的访问模式（ReadOnly 时写操作会被 401 拒绝）；public 取公共访问模式。",
  };
}

// ---------------------------------------------------------------- 本地路径沙箱

/** 断言 target 在 root 之内（root/target 都应是绝对且已解析的路径） */
function assertInsideRoot(root: string, target: string, field: string): void {
  const rel = path.relative(root, target);
  const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (!inside) {
    throw new GuardError(
      `${field} 必须位于 CRATER_WORK_DIR（${root}）之内，收到的是「${target}」。` +
        `这是安全限制：agent 只能读写 MCP 自己的落地目录，不能碰系统任意文件。` +
        `请把文件放到该目录下（用相对路径，如 "data/x.csv"）再上传/下载。`,
    );
  }
}

/**
 * 找到 target 已存在的最深祖先做 realpath，再把不存在的尾段拼回去。
 * 用途：目录本身还不存在时也能检测「沿途某个符号链接是否指向 workDir 之外」。
 */
async function realpathNearest(target: string): Promise<string> {
  const tail: string[] = [];
  let cur = target;
  for (;;) {
    try {
      const real = await fs.realpath(cur);
      const reversed = [...tail].reverse();
      return reversed.length ? path.join(real, ...reversed) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return target;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * 把用户给的本地路径解析成绝对路径，并保证它在 ctx.config.workDir 之内。
 * 两道检查：
 *  1) `path.resolve` 归一化（吃掉 `..`、绝对路径、多余的 /）后做 `path.relative` 前缀检查 —— 挡住遍历与绝对路径逃逸；
 *  2) 对「已存在的最近祖先」做 `fs.realpath` 后再比一次 —— 挡住符号链接逃逸（workDir 内放一个软链指向 C:\Windows 之类）。
 */
async function resolveLocalPath(workDir: string, raw: unknown, field: string): Promise<string> {
  const input = String(raw ?? "").trim();
  if (!input) throw new GuardError(`${field} 不能为空`);
  if (input.includes("\0")) throw new GuardError(`${field} 含有非法字符（NUL）`);

  const root = path.resolve(workDir);
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root);

  // 1) resolve + relative 前缀检查
  const abs = path.resolve(root, input);
  assertInsideRoot(root, abs, field);

  // 2) 符号链接逃逸检查
  const realAbs = await realpathNearest(abs);
  assertInsideRoot(realRoot, realAbs, field);

  return abs;
}

// ---------------------------------------------------------------- 共用实现

const listInput = {
  path: z
    .string()
    .optional()
    .describe(
      "逻辑路径；留空=根（只列出 user / account / public 等空间根）。例：user、user/exp1、public/datasets、" +
        "admin-user/xxx（仅管理员客户端可用）。",
    ),
  depth: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe("递归展开层数：0=只列这一层（默认），1=再展开直接子目录，最大 5。目录很多时慎用"),
  nameContains: z.string().optional().describe("按文件名子串过滤（MCP 本地过滤，区分大小写不敏感）"),
  dirsOnly: z.boolean().optional().describe("true=只返回目录"),
  page: Z.page,
  pageSize: Z.pageSize,
};

async function runList(args: Args, ctx: ToolContext, base: string): Promise<unknown> {
  const roots = base === BASE_ADMIN_FILES ? ADMIN_ROOTS : USER_ROOTS;
  const logical = normalizeLogicalPath(args.path, "path");
  if (logical) assertSpaceRoot(logical, "path", roots);

  const depthRaw = Number(args.depth ?? 0);
  const depth = Number.isFinite(depthRaw) ? Math.min(Math.max(Math.trunc(depthRaw), 0), 5) : 0;

  const warnings: string[] = [];
  const collected: Entry[] = [];
  await collectEntries(ctx, base, logical, depth, collected, warnings, roots);

  let entries = collected;
  const contains = typeof args.nameContains === "string" ? args.nameContains.trim().toLowerCase() : "";
  if (contains) entries = entries.filter((e) => e.name.toLowerCase().includes(contains));
  if (args.dirsOnly === true) entries = entries.filter((e) => e.isDir);
  entries = [...entries].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));

  const page = Number(args.page ?? 1) > 0 ? Math.trunc(Number(args.page ?? 1)) : 1;
  const pageSize = Number(args.pageSize ?? 100) > 0 ? Math.trunc(Number(args.pageSize ?? 100)) : 100;
  const pageResult = paginate(entries, page, pageSize);

  return {
    endpoint: logical ? `${base}/${logical}` : base,
    path: logical || "/",
    depth,
    permissions: spacePermissions(ctx),
    total: pageResult.total,
    page,
    pageSize,
    hasMore: pageResult.hasMore,
    entries: pageResult.items,
    ...(pageResult.total === 0
      ? {
          hint:
            "可能是空目录、路径不存在，或者你传的是「文件」——列目录接口对单个文件只返回空数组（用 crater_files_download 下载文件）。" +
            "另外 base=rwfiles 时只能列你有写权限的空间。",
        }
      : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

// ---------------------------------------------------------------- 工具定义

export const specs: ToolSpec[] = [
  {
    name: "crater_files_my_space",
    group: "files",
    title: "我的用户空间路径",
    description:
      "查我自己的个人空间入口，并给出可直接使用的逻辑路径示例。" +
      "注意：后端 GET /api/ss/userspace 只对平台管理员开放（storage/file.go GetUserSpace 里 RolePlatform!=admin 直接报错），" +
      "非管理员会拿到 available=false + 提示——此时直接用 crater_files_list 传 path=\"user\" 浏览自己的空间即可。",
    method: "GET",
    path: "/api/ss/userspace",
    target: "storage",
    scope: "self",
    readOnly: true,
    input: {},
    run: async (_args, ctx) => {
      const info = ctx.client.info;
      const base = {
        logicalRoot: "user",
        logicalPathExamples: ["user", "user/<子目录>", "user/<子目录>/<文件>"],
        username: info.username,
        accountName: info.accountName,
        permissions: spacePermissions(ctx),
        note: SPACE_NOTE,
      };
      try {
        const list = await ctx.client.request<Array<{ username?: string; space?: string }> | null>({
          method: "GET",
          path: "/api/ss/userspace",
          target: "storage",
        });
        const all = Array.isArray(list) ? list : [];
        return {
          ...base,
          available: true,
          source: "GET /api/ss/userspace（后端要求 RolePlatform==3）",
          myUserSpace: all.find((u) => u?.username === info.username) ?? null,
          allUserSpaces: all,
        };
      } catch (err) {
        return {
          ...base,
          available: false,
          source: "fallback（/api/ss/userspace 仅平台管理员可用）",
          myUserSpace: null,
          allUserSpaces: null,
          userspaceError: err instanceof Error ? err.message : String(err),
          hint:
            '非管理员无法读 /api/ss/userspace。你的空间入口就是逻辑路径 "user"：请用 crater_files_list(path="user") 浏览，' +
            "crater_files_permission 能看到后端签发的 rootPath 与 permission。",
        };
      }
    },
  },
  {
    name: "crater_files_account_space",
    group: "files",
    title: "当前账号空间路径",
    description:
      "查当前账号（Crater 里叫 queue/项目，如 q-3）的共享空间入口。" +
      "注意：GET /api/ss/queuespace 同样只对平台管理员开放，非管理员会拿到 available=false；" +
      "普通用户直接用逻辑路径 account（如 account/shared/data.csv），写权限取决于你在账号内的访问模式。",
    method: "GET",
    path: "/api/ss/queuespace",
    target: "storage",
    scope: "account",
    readOnly: true,
    input: {},
    run: async (_args, ctx) => {
      const info = ctx.client.info;
      const base = {
        logicalRoot: "account",
        logicalPathExamples: ["account", "account/<子目录>", "account/<子目录>/<文件>"],
        accountName: info.accountName,
        accessMode: info.accessMode !== undefined ? ACCESS_NAME[info.accessMode] : undefined,
        permissions: spacePermissions(ctx),
        note: SPACE_NOTE,
      };
      try {
        const list = await ctx.client.request<Array<{ queuename?: string; space?: string }> | null>({
          method: "GET",
          path: "/api/ss/queuespace",
          target: "storage",
        });
        const all = Array.isArray(list) ? list : [];
        return {
          ...base,
          available: true,
          source: "GET /api/ss/queuespace（后端要求 RolePlatform==3）",
          myAccountSpace: all.find((a) => a?.queuename === info.accountName) ?? null,
          allAccountSpaces: all,
        };
      } catch (err) {
        return {
          ...base,
          available: false,
          source: "fallback（/api/ss/queuespace 仅平台管理员可用）",
          myAccountSpace: null,
          allAccountSpaces: null,
          queuespaceError: err instanceof Error ? err.message : String(err),
          hint:
            '你的账号空间入口就是逻辑路径 "account"：用 crater_files_list(path="account") 浏览。' +
            "若 accessMode 是 ReadOnly，写操作会被后端 401 拒绝，需要账号管理员调整访问模式。",
        };
      }
    },
  },
  {
    name: "crater_files_list",
    group: "files",
    title: "列目录（含空间权限提示）",
    description:
      "列某个空间目录的内容，条目含 name/path/isDir/size/modifyTime，并附带按空间根推导的读写权限。" +
      "默认只列一层，可用 depth 递归展开、page/pageSize 分页；rw=true 走 /api/ss/rwfiles（只列你有写权限的空间）。" +
      "注意：路径要写逻辑路径（user/… 或 account/… 或 public/…），指向单个文件时后端只返回空数组。",
    method: "GET",
    path: "/api/ss/files/*path",
    target: "storage",
    scope: "self",
    readOnly: true,
    input: {
      rw: z
        .boolean()
        .optional()
        .describe("true=改用 /api/ss/rwfiles（只返回你可写的空间；带路径时若无写权限后端直接 401）。默认 false"),
      ...listInput,
    },
    run: async (args, ctx) => runList(args, ctx, args.rw === true ? BASE_RWFILES : BASE_FILES),
  },
  {
    name: "crater_files_admin_list",
    group: "files",
    title: "管理员：列任意空间目录",
    description:
      "管理员视角列目录（GET /api/ss/admin/files），根上能同时看到 user / account / public，" +
      "并可用 admin-user/<space>、admin-account/<space>、admin-public 进入别人的空间。" +
      "需要平台管理员（RolePlatform==3），非管理员会被后端 401 拒绝。",
    method: "GET",
    path: "/api/ss/admin/files/*path",
    target: "storage",
    scope: "admin",
    readOnly: true,
    input: listInput,
    run: async (args, ctx) => runList(args, ctx, BASE_ADMIN_FILES),
  },
  {
    name: "crater_files_download",
    group: "files",
    title: "下载文件到本机工作目录",
    description:
      "把远端逻辑路径的文件下载到 MCP 所在机器的 CRATER_WORK_DIR 之内，返回落地绝对路径与字节数（不回传二进制内容）。" +
      "本地路径必须是相对 CRATER_WORK_DIR 的相对路径或该目录内的绝对路径，越界（..、符号链接指向外部）会被直接拒绝；" +
      "文件会整体读进内存，默认上限 512MiB，超过请显式调大 maxBytes 或改用作业/rsync。",
    method: "GET",
    path: "/api/ss/download/*path",
    target: "storage",
    scope: "self",
    readOnly: true,
    input: {
      path: z.string().min(1).describe("远端逻辑路径，如 user/exp1/result.csv"),
      localPath: z
        .string()
        .optional()
        .describe("落地路径（相对 CRATER_WORK_DIR）；不填则用远端文件名放在 CRATER_WORK_DIR 根下。禁止绝对路径逃逸或 .."),
      overwrite: z.boolean().optional().describe("本地已存在同名文件时是否覆盖，默认 false（存在则报错，不静默覆盖）"),
      maxBytes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("允许的最大字节数，默认 536870912（512MiB）；超出会在下载前报错"),
    },
    run: async (args, ctx) => {
      const remote = normalizeLogicalPath(args.path, "path");
      assertSpaceRoot(remote, "path", ADMIN_ROOTS);
      if (remote.split("/").length < 2) {
        throw new GuardError(`path 不能只给空间根（${remote}）：下载必须指定具体文件，例如 user/exp1/data.csv。`);
      }

      const maxBytes = Number(args.maxBytes ?? DEFAULT_MAX_TRANSFER_BYTES);
      const stat = await statRemote(ctx, remote);
      if (stat.isDir) {
        throw new GuardError(`${remote} 是目录，不能下载。请用 crater_files_list 挑具体文件，或先用 depth 递归查看内容。`);
      }
      if (stat.size !== null && stat.size > maxBytes) {
        throw new GuardError(
          `远端文件 ${formatBytes(stat.size)}（${stat.size} 字节）超过本次上限 ${formatBytes(maxBytes)}。` +
            `如确需下载请显式调大 maxBytes；超大文件更建议在作业里直接读挂载盘或用 rsync。`,
        );
      }

      const suggestedName = remote.split("/").pop() ?? "download.bin";
      const localInput = args.localPath === undefined || args.localPath === "" ? suggestedName : args.localPath;
      const abs = await resolveLocalPath(ctx.config.workDir, localInput, "localPath");

      const existsAlready = await fs.stat(abs).then(() => true).catch(() => false);
      if (existsAlready && args.overwrite !== true) {
        throw new GuardError(`本地已存在 ${abs}；如需覆盖请传 overwrite=true。`);
      }

      await fs.mkdir(path.dirname(abs), { recursive: true });
      const { bytes, contentType, filename } = await ctx.client.downloadFile(remote);
      if (bytes.byteLength > maxBytes) {
        throw new GuardError(
          `实际下载体积 ${bytes.byteLength} 字节超过上限 ${maxBytes}，已放弃落盘（可用 maxBytes 调大后重试）。`,
        );
      }
      await fs.writeFile(abs, bytes);

      return {
        ok: true,
        remotePath: remote,
        localPath: abs,
        localPathRelativeToWorkDir: path.relative(path.resolve(ctx.config.workDir), abs),
        bytes: bytes.byteLength,
        sizeText: formatBytes(bytes.byteLength),
        contentType: contentType ?? null,
        remoteSuggestedName: filename ?? null,
        note: "文件已落盘到 MCP 所在机器；agent 只能访问 CRATER_WORK_DIR 之内的文件。",
      };
    },
  },
  {
    name: "crater_files_upload",
    group: "files",
    title: "上传本机文件到空间",
    description:
      "把 CRATER_WORK_DIR 之内的本地文件按裸字节写入远端逻辑路径（线上走 WebDAV PUT /api/ss/<路径>，因为 POST /api/ss/upload 在该镜像上 404）。" +
      "overwrite=false（默认）时若远端已存在会报 409 而不是静默覆盖；父目录必须已存在，需要先 crater_files_mkdir。" +
      "只读账号（accessMode=ReadOnly）写 account/public 会被后端 401 拒绝，user 空间恒可写。",
    method: "PUT",
    path: "/api/ss/*path",
    target: "storage",
    scope: "self",
    readOnly: false,
    input: {
      localPath: z.string().min(1).describe("本地文件路径（相对 CRATER_WORK_DIR，或该目录内的绝对路径）；越界会被拒绝"),
      path: z.string().min(1).describe("远端逻辑路径，如 user/exp1/data.csv；不能只给空间根（父目录不存在时会自动逐级创建）"),
      overwrite: z.boolean().optional().describe("远端已存在时是否覆盖，默认 false（存在则报 409）"),
      maxBytes: z.number().int().positive().optional().describe("允许上传的最大字节数，默认 536870912（512MiB）"),
    },
    run: async (args, ctx) => {
      const remote = normalizeLogicalPath(args.path, "path");
      assertWritableTarget(remote, "path");

      const abs = await resolveLocalPath(ctx.config.workDir, args.localPath, "localPath");
      const st = await fs.stat(abs).catch(() => null);
      if (!st) {
        throw new GuardError(
          `本地文件不存在：${abs}。本工具只能上传 CRATER_WORK_DIR（${path.resolve(ctx.config.workDir)}）之内的文件。`,
        );
      }
      if (!st.isFile()) {
        throw new GuardError(`${abs} 不是普通文件（目录请用 crater_files_mkdir 建，文件需逐个上传）。`);
      }
      const maxBytes = Number(args.maxBytes ?? DEFAULT_MAX_TRANSFER_BYTES);
      if (st.size > maxBytes) {
        throw new GuardError(
          `本地文件 ${formatBytes(st.size)}（${st.size} 字节）超过本次上限 ${formatBytes(maxBytes)}；如确需上传请显式调大 maxBytes。`,
        );
      }

      // 自动逐级补齐父目录：MKCOL 只能建一级，这里从空间根往下依次建
      const segments = remote.split("/");
      const created: string[] = [];
      for (let i = 2; i < segments.length; i++) {
        const dir = segments.slice(0, i).join("/");
        const st2 = await statRemote(ctx, dir).catch(() => null);
        if (st2?.exists) continue;
        try {
          await ctx.client.mkdir(dir);
          created.push(dir);
        } catch {
          /* 并发/已存在等情况忽略，交给后面的 PUT 报真实错误 */
        }
      }

      const buf = await fs.readFile(abs);
      const overwrite = args.overwrite === true;
      const response = await ctx.client.uploadFile(remote, buf, overwrite);
      const after = await statRemote(ctx, remote).catch(() => null);

      return {
        ok: true,
        localPath: abs,
        localPathRelativeToWorkDir: path.relative(path.resolve(ctx.config.workDir), abs),
        remotePath: remote,
        bytes: buf.byteLength,
        sizeText: formatBytes(buf.byteLength),
        overwrite,
        autoCreatedDirs: created,
        remoteSize: after?.size ?? null,
        response: response ?? null,
      };
    },
  },
  {
    name: "crater_files_mkdir",
    group: "files",
    title: "新建目录（单级）",
    description:
      "用 WebDAV MKCOL 在空间里建一个目录；只能建一级——父目录必须已存在，否则后端返回 409（directory parent is unavailable），" +
      "需要多级就按层级依次调用或先把父级建好。目标已存在时直接返回 alreadyExists，不改动现有内容。",
    method: "MKCOL",
    path: "/api/ss/*path",
    target: "storage",
    scope: "self",
    readOnly: false,
    input: {
      path: z.string().min(1).describe("要创建的逻辑目录路径，如 user/exp1/checkpoints（父目录 user/exp1 必须已存在）"),
    },
    run: async (args, ctx) => {
      const remote = normalizeLogicalPath(args.path, "path");
      assertWritableTarget(remote, "path");

      const existing = await statRemote(ctx, remote).catch(() => null);
      if (existing?.exists) {
        return {
          ok: true,
          path: remote,
          created: false,
          alreadyExists: true,
          isDir: existing.isDir,
          note: "目标已存在，未做任何改动（MKCOL 对已存在路径返回 409，这里提前短路）。",
        };
      }

      const response = await ctx.client.mkdir(remote);
      return {
        ok: true,
        path: remote,
        created: true,
        method: "MKCOL /api/ss/<逻辑路径>",
        response: response ?? null,
        note: "MKCOL 只能建一级：父目录必须已存在（否则后端 409 directory parent is unavailable）。",
      };
    },
  },
  {
    name: "crater_files_delete",
    group: "files",
    title: "删除文件或目录（不可恢复）",
    description:
      "调用 DELETE /api/ss/delete/<逻辑路径>，后端是 RemoveAll 语义：目录会连整棵子树一起删除，且对不存在的路径也返回成功（幂等）。" +
      "因为危险，删目录时必须显式传 recursive=true；无法确认目标类型时也要求 recursive=true。删除没有回收站，不可恢复。",
    method: "DELETE",
    path: "/api/ss/delete/*path",
    target: "storage",
    scope: "self",
    readOnly: false,
    destructive: true,
    input: {
      path: z.string().min(1).describe("要删除的逻辑路径，如 user/exp1/old.log"),
      recursive: z
        .boolean()
        .optional()
        .describe("删除目录（或无法确认类型）时必须显式传 true；只删单个文件可以不传"),
    },
    run: async (args, ctx) => {
      const remote = normalizeLogicalPath(args.path, "path");
      assertWritableTarget(remote, "path");

      let stat: { exists: boolean; isDir: boolean; size: number | null } | null = null;
      try {
        stat = await statRemote(ctx, remote);
      } catch {
        stat = null;
      }

      if (stat === null && args.recursive !== true) {
        throw new GuardError(
          `无法确认 ${remote} 是文件还是目录（列父目录失败）。为避免误删整棵目录，请先用 crater_files_list 确认，` +
            `或显式传 recursive=true 表示你接受递归删除。`,
        );
      }
      if (stat?.isDir === true && args.recursive !== true) {
        throw new GuardError(
          `${remote} 是目录：DELETE /api/ss/delete 会把它连同所有子内容一起删除且不可恢复。` +
            `确认后请传 recursive=true 再调用。`,
        );
      }

      if (stat !== null && !stat.exists) {
        return {
          ok: true,
          path: remote,
          existed: false,
          note: "后端删除是幂等的：该路径本来就不存在，调用后仍是「不存在」状态。",
        };
      }

      const response = await ctx.client.removeFile(remote);
      return {
        ok: true,
        path: remote,
        existed: true,
        wasDir: stat?.isDir ?? null,
        response: response ?? null,
        note: "删除走后端 RemoveAll，没有回收站接口，不可恢复。",
      };
    },
  },
  {
    name: "crater_files_move",
    group: "files",
    title: "移动/重命名",
    description:
      "POST /api/ss/move/<源逻辑路径>，body {dst}，用于重命名或在空间间移动。源与目标都必须有写权限（ReadWrite），" +
      "目标已存在时后端会直接报错（移动不覆盖），目标父目录不存在时后端会自动创建。" +
      "标记 destructive 是保守做法：源路径上的原内容会被移走/消失，操作不可撤销。",
    method: "POST",
    path: "/api/ss/move/*path",
    target: "storage",
    scope: "self",
    readOnly: false,
    destructive: true,
    input: {
      path: z.string().min(1).describe("源逻辑路径，如 user/exp1/old-name.txt"),
      dst: z.string().min(1).describe("目标逻辑路径（含新名字），如 user/exp1/new-name.txt"),
    },
    run: async (args, ctx) => {
      const from = normalizeLogicalPath(args.path, "path");
      const to = normalizeLogicalPath(args.dst, "dst");
      assertWritableTarget(from, "path");
      assertWritableTarget(to, "dst");
      if (from === to) throw new GuardError("path 与 dst 相同，没有可移动的内容。");
      if (to.startsWith(`${from}/`)) throw new GuardError("dst 不能位于源路径内部（后端同样拒绝这种移动）。");

      const srcStat = await statRemote(ctx, from).catch(() => null);
      if (srcStat && !srcStat.exists) {
        throw new GuardError(`源路径不存在：${from}。请先用 crater_files_list 确认准确路径。`);
      }
      const dstStat = await statRemote(ctx, to).catch(() => null);
      if (dstStat?.exists) {
        throw new GuardError(
          `目标已存在：${to}（后端 move 不覆盖）。请换一个目标名，或先 crater_files_delete 再移动。`,
        );
      }

      const response = await ctx.client.moveFile(from, to);
      return {
        ok: true,
        from,
        to,
        wasDir: srcStat?.isDir ?? null,
        crossSpace: from.split("/")[0] !== to.split("/")[0],
        response: response ?? null,
        note: "移动后源路径不再存在；目标父目录缺失时后端会自动创建。",
      };
    },
  },
  {
    name: "crater_files_dataset_browse",
    group: "files",
    title: "浏览数据集目录",
    description:
      "按数据集 ID 浏览其存储目录（GET /api/ss/dataset/:id[/<相对路径>]），需要该数据集已共享给你或你是管理员，" +
      "否则后端返回「This dataset does not exist or you do not have permission」。数据集 ID 从 dataset 组工具拿，" +
      "单个文件型数据集会直接返回该文件本身。",
    method: "GET",
    path: "/api/ss/dataset/:id/*path",
    target: "storage",
    scope: "self",
    readOnly: true,
    input: {
      datasetId: z.number().int().positive().describe("数据集 ID"),
      path: z.string().optional().describe("数据集内的相对路径，留空=数据集根"),
      page: Z.page,
      pageSize: Z.pageSize,
    },
    run: async (args, ctx) => {
      const id = Number(args.datasetId);
      if (!Number.isInteger(id) || id <= 0) throw new GuardError("datasetId 必须是正整数。");
      const sub = normalizeLogicalPath(args.path, "path");

      const url = sub ? `/api/ss/dataset/${id}/${encodePath(sub)}` : `/api/ss/dataset/${id}`;
      const data = await ctx.client.request<RawEntry[] | null>({ method: "GET", path: url, target: "storage" });
      const raw = Array.isArray(data) ? data : [];
      const entries = raw.map((e) => toEntry(e, sub)).sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));

      const page = Number(args.page ?? 1) > 0 ? Math.trunc(Number(args.page ?? 1)) : 1;
      const pageSize = Number(args.pageSize ?? 100) > 0 ? Math.trunc(Number(args.pageSize ?? 100)) : 100;
      const pageResult = paginate(entries, page, pageSize);

      return {
        datasetId: id,
        path: sub || "/",
        endpoint: url,
        total: pageResult.total,
        page,
        pageSize,
        hasMore: pageResult.hasMore,
        entries: pageResult.items,
      };
    },
  },
  {
    name: "crater_files_usage",
    group: "files",
    title: "各空间存储用量",
    description:
      "读 storage-server 的 GET /api/ss/usage，返回每个空间（public / account / user…）的已用字节、文件数与容量。" +
      "注意主后端的 /api/v1/storage/my-quota 与 dirsize 在当前部署上都是 404，所以配额/用量只能看这个接口。",
    method: "GET",
    path: "/api/ss/usage",
    target: "storage",
    scope: "self",
    readOnly: true,
    input: {},
    run: async (_args, ctx) => {
      const raw = await ctx.client.request<unknown>({ method: "GET", path: "/api/ss/usage", target: "storage" });
      const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
      const spaces = record
        ? Object.entries(record).map(([space, value]) => {
            const v = (value ?? {}) as Record<string, unknown>;
            const used = typeof v.usedBytes === "number" ? v.usedBytes : null;
            return {
              space,
              usedBytes: used,
              usedText: formatBytes(used),
              totalFiles: typeof v.totalFiles === "number" ? v.totalFiles : null,
              capacityGb: typeof v.capacityGb === "number" ? v.capacityGb : null,
            };
          })
        : [];
      return {
        spaces,
        raw,
        note: "用量按空间统计；容量来自后端配置的配额，0 或 null 表示未设配额/不可读。",
      };
    },
  },
  {
    name: "crater_files_permission",
    group: "files",
    title: "后端给我的存储权限",
    description:
      "读主后端 GET /api/v1/storage/verify，返回 storage-server token 对应的 {userId, rootPath, permission}，" +
      "permission 1=NotAllowed 2=ReadOnly 3=ReadWrite，rootPath 是当前账号空间的实体名（不是逻辑路径）。" +
      "写操作被 401/403 拒绝时用它先排查自己是 RO 还是 NA。",
    method: "GET",
    path: "/api/v1/storage/verify",
    scope: "self",
    readOnly: true,
    input: {},
    run: async (_args, ctx) => {
      const data = await ctx.client.request<{ userId?: number; rootPath?: string; permission?: number } | null>({
        method: "GET",
        path: "/api/v1/storage/verify",
      });
      const permission = typeof data?.permission === "number" ? data.permission : undefined;
      return {
        ...(data ?? {}),
        permissionName: permission !== undefined ? PERMISSION_NAME[permission] ?? null : null,
        sessionAccessMode: ctx.client.info.accessMode,
        sessionAccessModeName:
          ctx.client.info.accessMode !== undefined ? ACCESS_NAME[ctx.client.info.accessMode] : undefined,
        note: "rootPath 是账号空间的实体名（如 q-3），文件工具里用逻辑路径（user / account / public）即可，不需要它。",
      };
    },
  },
];
