#!/usr/bin/env node
/**
 * 冒烟测试（真机）
 *
 * 用法：
 *   node scripts/smoke.mjs                # 全量：协议握手 + 只读工具接线 + 只读闸
 *   node scripts/smoke.mjs --quick        # 只跑无参数只读工具
 *
 * 环境变量与 MCP 本身一致（CRATER_BASE_URL / CRATER_USERNAME / CRATER_PASSWORD ...）
 *
 * 判定逻辑：
 *   - 只读工具返回内容           → PASS
 *   - 后端返回 400/403/404 等业务错 → WIRE（说明路径与字段确实打通了，只是参数不够/无权）
 *   - 连接失败 / 工具不存在 / 崩溃  → FAIL
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "dist", "index.js");
const quick = process.argv.includes("--quick");

/** 这些工具不需要参数，应当稳定返回数据 */
const NO_ARG_READ = [
  "crater_auth_whoami",
  "crater_auth_mode",
  "crater_profile_get",
  "crater_profile_accounts",
  "crater_profile_quota",
  "crater_profile_billing_summary",
];

function baseEnv(extra = {}) {
  return { ...process.env, ...extra };
}

async function connect(extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: baseEnv(extraEnv),
    stderr: "pipe",
  });
  const client = new Client({ name: "crater-mcp-smoke", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function classify(text) {
  if (/只读模式|GuardError|管理端接口|宽接口/.test(text)) return "GUARD";
  // MCP 层参数校验失败 = 该工具确实需要入参，属于预期的「接线正常」
  if (/-32602|Input validation error/.test(text)) return "ARGS";
  const m = text.match(/HTTP (\d{3})/);
  if (m) return `HTTP ${m[1]}`;
  return "PASS";
}

async function callTool(client, name, args = {}) {
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    if (res.isError) return { status: classify(text), text };
    return { status: "PASS", text };
  } catch (err) {
    return { status: "FAIL", text: String(err?.message ?? err) };
  }
}

function printRow(name, r, maxLen = 110) {
  const text = (r.text ?? "").replace(/\s+/g, " ").slice(0, maxLen);
  console.log(`  ${r.status.padEnd(8)} ${name.padEnd(38)} ${text}`);
}

async function main() {
  console.log("=== 0. 连接（stdio 握手） ===");
  let client;
  try {
    client = await connect();
    const info = client.getServerVersion?.();
    console.log(`  已连接：${info?.name ?? "?"} v${info?.version ?? "?"}`);
  } catch (err) {
    console.error(`  FAIL 无法连接：${err?.message ?? err}`);
    process.exit(1);
  }

  console.log("\n=== 1. 工具清单 ===");
  const listed = await client.listTools();
  const tools = listed.tools ?? [];
  const groups = new Map();
  for (const t of tools) {
    const g = t.name.split("_")[1] ?? "other";
    groups.set(g, [...(groups.get(g) ?? []), t.name]);
  }
  for (const [g, names] of groups) console.log(`  ${g.padEnd(10)} ${String(names.length).padStart(3)} 个`);
  console.log(`  合计 ${tools.length} 个工具`);

  console.log("\n=== 2. 无参数只读工具 ===");
  let fails = 0;
  for (const name of NO_ARG_READ) {
    if (!tools.some((t) => t.name === name)) {
      console.log(`  SKIP     ${name}（本版本未提供）`);
      continue;
    }
    const r = await callTool(client, name);
    printRow(name, r);
    if (r.status === "FAIL") fails++;
  }

  if (!quick) {
    console.log("\n=== 3. 全量只读工具接线（空参数调用，期望 PASS 或 400/404/403 类业务错） ===");
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    for (const name of readOnly) {
      if (NO_ARG_READ.includes(name)) continue;
      const r = await callTool(client, name);
      printRow(name, r, 90);
      if (r.status === "FAIL") fails++;
    }

    console.log("\n=== 4. 只读闸（CRATER_READ_ONLY=true 时必须拦下写操作） ===");
    const roClient = await connect({ CRATER_READ_ONLY: "true" });
    const roTools = (await roClient.listTools()).tools ?? [];
    const writeTool = roTools.find((t) => t.annotations?.readOnlyHint === false && t.name.startsWith("crater_profile"));
    if (!writeTool) {
      console.log("  SKIP 未找到可用于测试的写工具");
    } else {
      const r = await callTool(roClient, writeTool.name, { nickname: "smoke" });
      printRow(writeTool.name, r);
      if (r.status !== "GUARD") {
        console.log("  FAIL 预期被只读闸拦下，但未拦下");
        fails++;
      }
    }

    console.log("\n=== 5. 会话身份 ===");
    const who = await callTool(client, "crater_auth_whoami");
    try {
      const data = JSON.parse(who.text);
      console.log(`  用户：${data.session?.username}（id=${data.session?.userId}, role=${data.session?.rolePlatformName}）`);
      console.log(`  账号：${data.session?.accountName}  空间：${data.session?.space}`);
      console.log(`  MCP：base=${data.mcp?.baseUrl} 只读=${data.mcp?.readOnlyMode} admin工具=${data.mcp?.allowAdminTools}`);
    } catch {
      console.log(`  ${who.text.slice(0, 200)}`);
    }
    await roClient.close();
  }

  await client.close();
  console.log(`\n=== 结果：${fails === 0 ? "全部通过" : `${fails} 项失败`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`冒烟测试异常：${err?.stack ?? err}`);
  process.exit(1);
});
