#!/usr/bin/env node
/**
 * 端点探测器：用真实账号把一批候选 GET 路径打一遍，输出「真实存在 / 不存在」的地面真值。
 *
 * 用途：
 *   1. 复核 docs/api-inventory.md 的路径拼接是否与实际部署一致
 *   2. 新增工具前确认接口确实可用
 *
 * 用法：node scripts/probe.mjs             （从 CRATER_BASE_URL/USERNAME/PASSWORD 读配置）
 *       node scripts/probe.mjs --all       （额外探测 admin 与变更类路径，需要管理员账号）
 */
const args = new Set(process.argv.slice(2));
const ADMIN = args.has("--all");

const baseUrl = (process.env.CRATER_BASE_URL ?? "").replace(/\/+$/, "");
const username = process.env.CRATER_USERNAME;
const password = process.env.CRATER_PASSWORD;
if (!baseUrl || !username || !password) {
  console.error("需要 CRATER_BASE_URL / CRATER_USERNAME / CRATER_PASSWORD");
  process.exit(1);
}

const MAIN = [
  // auth / 用户
  "GET /api/auth/mode",
  "GET /api/auth/check",
  "GET /api/v1/users/email/verified",
  "GET /api/v1/users/ban",
  "GET /api/v1/context/attributes",
  "GET /api/v1/context/quota",
  "GET /api/v1/context/billing/summary",
  "GET /api/v1/context/job-resource-summary",
  "GET /api/v1/context/prequeue",
  // 账号
  "GET /api/v1/accounts",
  // 作业
  "GET /api/v1/vcjobs/list?page=1&pageSize=1",
  "GET /api/v1/vcjobs/all?page=1&pageSize=1",
  "GET /api/v1/vcjobs/user/crater-admin?page=1&pageSize=1",
  "GET /api/v1/jobtemplate/list",
  // 镜像
  "GET /api/v1/images/image",
  "GET /api/v1/images/cudabaseimage",
  "GET /api/v1/images/harbor",
  "GET /api/v1/images/quota",
  "GET /api/v1/images/arch",
  "GET /api/v1/images/account",
  // 资源 / 节点 / 统计
  "GET /api/v1/resources",
  "GET /api/v1/resources/billing/prices",
  "GET /api/v1/nodes",
  "GET /api/v1/statistics",
  // 数据集
  "GET /api/v1/dataset/mydataset?page=1&pageSize=1",
  // 存储配额
  "GET /api/v1/storage/my-quota",
  "GET /api/v1/storage/capabilities",
  // 模型下载
  "GET /api/v1/model-download/models/downloads?page=1&pageSize=1",
  // storage-server
  "GET /api/ss/userspace",
  "GET /api/ss/queuespace",
  "GET /api/ss/files",
  "GET /api/ss/rwfiles",
];

const ADMIN_PATHS = [
  "GET /api/v1/admin/users?page=1&pageSize=1",
  "GET /api/v1/admin/users/facets",
  "GET /api/v1/admin/accounts",
  "GET /api/v1/admin/resources",
  "GET /api/v1/admin/nodes",
  "GET /api/v1/admin/system-config/billing",
  "GET /api/v1/admin/system-config/llm",
  "GET /api/v1/admin/queue-quotas",
  "GET /api/v1/admin/operations/cronjob",
  "GET /api/v1/admin/approvalorder?page=1&pageSize=1",
  "GET /api/v1/admin/gpu-analysis",
  "GET /api/v1/admin/operation-logs?page=1&pageSize=1",
];

async function login() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth: "normal", username, password }),
  });
  const json = await res.json();
  if (!json?.data?.accessToken) throw new Error(`登录失败：${JSON.stringify(json).slice(0, 200)}`);
  return json.data.accessToken;
}

function summarize(body) {
  if (body === null || body === undefined) return "";
  if (typeof body !== "object") return String(body).slice(0, 80);
  const obj = body;
  // 常见外壳 {code,data}
  const data = "data" in obj ? obj.data : obj;
  if (Array.isArray(data)) return `array[${data.length}]`;
  if (data && typeof data === "object") {
    const keys = Object.keys(data);
    const pageKeys = ["items", "list", "records", "results", "total", "page", "pages", "itemsCount"];
    const hit = keys.filter((k) => pageKeys.includes(k));
    if (hit.length) {
      const inner = data.items ?? data.list ?? data.records ?? data.results;
      const n = Array.isArray(inner) ? inner.length : "?";
      return `page(items=${n}, ${hit.join(",")})`;
    }
    return `{${keys.slice(0, 6).join(",")}}`;
  }
  return String(data).slice(0, 60);
}

async function probe(token, spec) {
  const [method, path] = spec.split(" ");
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json, */*" },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const code = res.ok ? "OK " : `HTTP ${res.status}`;
    const detail = res.ok ? summarize(body) : String(body?.message ?? body?.msg ?? body ?? "").slice(0, 60);
    return { code, detail, ok: res.ok };
  } catch (err) {
    return { code: "ERR", detail: String(err?.message ?? err).slice(0, 60), ok: false };
  }
}

const token = await login();
console.log(`已登录 ${username} @ ${baseUrl}\n`);
const rows = [...MAIN, ...(ADMIN ? ADMIN_PATHS : [])];
const results = [];
for (const spec of rows) {
  const r = await probe(token, spec);
  results.push({ spec, ...r });
  console.log(`${r.code.padEnd(8)} ${spec.padEnd(58)} ${r.detail}`);
}
const okCount = results.filter((r) => r.ok).length;
console.log(`\n合计 ${results.length} 条：可用 ${okCount}，不可用 ${results.length - okCount}`);
