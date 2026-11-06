#!/usr/bin/env node
/**
 * 路由存在性核查器
 *
 * 从 docs/api-inventory.md 的表格里提取「方法 + 完整路径」，用真实账号逐条打一遍，
 * 判定该路由在当前部署上**是否真的存在**，产出 docs/verified-routes.md。
 *
 * 判定规则：
 *   GET  → 200/400/403/500 视为「存在」；404 且响应体是 "404 page not found" 视为「不存在」
 *   POST → 用空 body 打（binding 校验会先失败返回 400），400/403/409/422/500 = 存在；404 page not found = 不存在
 *   PUT / DELETE / PATCH → **不探测**（有副作用，比如 DELETE /vcjobs/:name 会真删），标为 SKIP
 *
 * 用法：
 *   node scripts/verify-routes.mjs                # 全量
 *   node scripts/verify-routes.mjs --only-get     # 只探 GET（最安全）
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const docPath = join(here, "..", "docs", "api-inventory.md");
const outPath = join(here, "..", "docs", "verified-routes.md");
const onlyGet = process.argv.includes("--only-get");

const baseUrl = (process.env.CRATER_BASE_URL ?? "").replace(/\/+$/, "");
const username = process.env.CRATER_USERNAME;
const password = process.env.CRATER_PASSWORD;
if (!baseUrl || !username || !password) {
  console.error("需要 CRATER_BASE_URL / CRATER_USERNAME / CRATER_PASSWORD");
  process.exit(1);
}

// ---------- 1. 解析清单 ----------
const md = await readFile(docPath, "utf8");
const rowRe = /^\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*`([^`]+)`\s*\|/gm;
const routes = [];
for (const m of md.matchAll(rowRe)) {
  const method = m[1];
  let path = m[2];
  if (!path.startsWith("/")) continue;
  if (path.includes("/internal/") || path.includes("/swagger/")) continue;
  routes.push({ method, path });
}
// 去重（同路径同方法可能在不同小节重复出现）
const seen = new Set();
const uniq = routes.filter((r) => {
  const k = `${r.method} ${r.path}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

// ---------- 2. 登录 + 取样例标识 ----------
const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ auth: "normal", username, password }),
});
const loginJson = await loginRes.json();
const token = loginJson?.data?.accessToken;
if (!token) throw new Error(`登录失败：${JSON.stringify(loginJson).slice(0, 200)}`);
const H = { Authorization: `Bearer ${token}`, Accept: "application/json, */*", "Content-Type": "application/json" };

let sampleJob = "crater-mcp-probe";
let samplePod = "crater-mcp-probe";
let sampleNs = "crater-workspace";
try {
  const r = await fetch(`${baseUrl}/api/v1/vcjobs/all?page=1&pageSize=10`, { headers: H });
  const j = await r.json();
  const items = j?.data?.items ?? [];
  const withPod = items.find((it) => Array.isArray(it.pods) && it.pods.length > 0) ?? items[0];
  if (withPod?.name) sampleJob = withPod.name;
  const p = withPod?.pods?.[0];
  if (p) {
    samplePod = p.name ?? p.podName ?? p.pod ?? samplePod;
    if (p.namespace) sampleNs = p.namespace;
  }
  if (withPod?.namespace) sampleNs = withPod.namespace;
} catch {
  /* 用默认占位 */
}

// 路径参数占位符替换：顺序很重要（先长后短）
const ENC = encodeURIComponent;
function materialize(path) {
  let p = path;
  p = p.replace(/\*path/g, "public");
  p = p.replace(/:username/g, ENC(username));
  p = p.replace(/:name/g, ENC(sampleJob));
  p = p.replace(/:pod/g, ENC(samplePod));
  p = p.replace(/:namespace/g, ENC(sampleNs));
  p = p.replace(/:queue/g, "q-3");
  p = p.replace(/:account/g, "q-3");
  p = p.replace(/:user/g, ENC(username));
  p = p.replace(/:container/g, "main");
  p = p.replace(/:type/g, "main");
  // 其余 :xxx 用 1 兜底
  p = p.replace(/:[A-Za-z_]+/g, "1");
  return p;
}

async function probe(route) {
  const url = `${baseUrl}${materialize(route.path)}`;
  try {
    const res = await fetch(url, {
      method: route.method,
      headers: H,
      body: route.method === "GET" ? undefined : "{}",
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    const isGin404 = res.status === 404 && /^404 page not found/.test(text.trim());
    return { status: res.status, exists: !isGin404, note: isGin404 ? "路由不存在" : text.slice(0, 80).replace(/\s+/g, " ") };
  } catch (err) {
    return { status: "ERR", exists: false, note: String(err?.message ?? err).slice(0, 60) };
  }
}

// ---------- 3. 逐条探测 ----------
const results = [];
for (const route of uniq) {
  if (route.method !== "GET" && (onlyGet || ["PUT", "DELETE", "PATCH"].includes(route.method))) {
    results.push({ ...route, status: "SKIP", exists: null, note: "有副作用，未探测" });
    continue;
  }
  const r = await probe(route);
  results.push({ ...route, ...r });
  const mark = r.exists === null ? "SKIP " : r.exists ? "存在 " : "缺失 ";
  console.log(`${mark} ${String(r.status).padEnd(5)} ${route.method.padEnd(6)} ${materialize(route.path)}`.padEnd(110) + r.note.slice(0, 40));
}

// ---------- 4. 输出 ----------
const total = results.length;
const exists = results.filter((r) => r.exists === true).length;
const missing = results.filter((r) => r.exists === false).length;
const skipped = results.filter((r) => r.exists === null).length;

const lines = [
  "# 路由存在性核查（实测）",
  "",
  `> 生成时间：${new Date().toISOString()}　目标：\`${baseUrl}\`　账号：\`${username}\``,
  `> 方法：从 \`api-inventory.md\` 提取全部路由，GET 直接打、POST 用空 body 打（binding 先失败，安全）、PUT/DELETE/PATCH 不探测。`,
  "",
  `**合计 ${total} 条：存在 ${exists}，缺失 ${missing}，未探测 ${skipped}**`,
  "",
  "> 「缺失」= 返回 gin 的 `404 page not found`，说明**当前部署**上没有这条路由（可能是源码分支与线上镜像版本不一致，或该路由被我 materialize 的参数掩盖）。",
  "",
  "## 缺失路由",
  "",
  "| Method | 路径 | 状态 |",
  "| --- | --- | --- |",
  ...results.filter((r) => r.exists === false).map((r) => `| ${r.method} | \`${r.path}\` | ${r.status} |`),
  "",
  "## 全部结果",
  "",
  "| Method | 路径 | 状态 | 存在 | 备注 |",
  "| --- | --- | --- | --- | --- |",
  ...results.map((r) => `| ${r.method} | \`${r.path}\` | ${r.status} | ${r.exists === null ? "—" : r.exists ? "✅" : "❌"} | ${r.note.replace(/\|/g, "\\|")} |`),
  "",
];
await writeFile(outPath, lines.join("\n"), "utf8");
console.log(`\n合计 ${total}：存在 ${exists}，缺失 ${missing}，未探测 ${skipped}`);
console.log(`已写入 ${outPath}`);
