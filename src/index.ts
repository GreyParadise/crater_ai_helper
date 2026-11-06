#!/usr/bin/env node
/**
 * crater-mcp 入口
 *
 * 传输：stdio（每个用户在自己机器上跑，用他自己的 Crater 凭证）
 * 用法：
 *   node dist/index.js            # 作为 MCP server 运行（给 agent 用）
 *   node dist/index.js --list     # 打印工具清单（自检/生成文档）
 *   node dist/index.js --whoami   # 用当前配置登录并打印身份（排查配置）
 *   node dist/index.js --check    # 只做配置与工具校验，不联网
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CraterClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { defaultFormat, executeTool, toErrorText, type ToolContext } from "./registry.js";
import { allSpecs, summarize, validateSpecs } from "./tools/index.js";

const VERSION = "0.1.0";

function log(msg: string): void {
  // stdio 传输下 stdout 属于协议通道，日志必须走 stderr
  process.stderr.write(`[crater-mcp] ${msg}\n`);
}

async function main(): Promise<void> {
  const argv = new Set(process.argv.slice(2));

  const offline = argv.has("--list") || argv.has("--check");
  let config;
  try {
    config = loadConfig(process.env, { requireConnection: !offline });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`[crater-mcp] 配置错误：${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const problems = validateSpecs(allSpecs);
  if (problems.length) {
    process.stderr.write(`[crater-mcp] 工具定义有问题：\n  - ${problems.join("\n  - ")}\n`);
    if (argv.has("--check")) process.exit(1);
  }

  if (argv.has("--list")) {
    for (const g of summarize()) {
      process.stdout.write(`## ${g.group} (${g.count})\n`);
      for (const t of g.tools) {
        const spec = allSpecs.find((s) => s.name === t)!;
        process.stdout.write(`  ${t}  [${spec.method} ${spec.path}]  ${spec.readOnly ? "只读" : "写"} scope=${spec.scope}\n`);
      }
    }
    process.stdout.write(`\n合计 ${allSpecs.length} 个工具\n`);
    return;
  }

  if (argv.has("--check")) {
    process.stdout.write(
      `配置与工具校验通过：${allSpecs.length} 个工具（${summarize()
        .map((g) => `${g.group}:${g.count}`)
        .join(", ")}）\n`,
    );
    return;
  }

  const client = new CraterClient(config);
  const ctx: ToolContext = { client, config };

  if (argv.has("--whoami")) {
    try {
      await client.ensureSession();
      process.stdout.write(JSON.stringify({ ...client.info, baseUrl: config.baseUrl }, null, 2) + "\n");
    } catch (err) {
      process.stderr.write(`登录失败：${toErrorText(err)}\n`);
      process.exit(1);
    }
    return;
  }

  const server = new McpServer({ name: "crater-mcp", version: VERSION });

  let registered = 0;
  let skippedAdmin = 0;
  for (const spec of allSpecs) {
    if (spec.scope === "admin" && !config.allowAdmin) {
      skippedAdmin++;
      continue;
    }
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.input ?? {},
        annotations: {
          readOnlyHint: spec.readOnly,
          destructiveHint: spec.destructive ?? !spec.readOnly,
          idempotentHint: spec.method === "GET",
          openWorldHint: true,
        },
      },
      async (args: unknown) => {
        try {
          const data = await executeTool(spec, (args ?? {}) as Record<string, unknown>, ctx);
          const text = spec.format ? spec.format(data, (args ?? {}) as Record<string, unknown>) : defaultFormat(data);
          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          return { isError: true, content: [{ type: "text" as const, text: toErrorText(err, spec) }] };
        }
      },
    );
    registered++;
  }

  log(
    `v${VERSION} 就绪：注册 ${registered} 个工具` +
      (skippedAdmin ? `（因 CRATER_ALLOW_ADMIN=false 跳过 ${skippedAdmin} 个管理端工具）` : "") +
      `，base=${config.baseUrl}` +
      (config.readOnly ? "，**只读模式**" : ""),
  );

  // 预热登录（失败不阻塞启动，工具被调用时会再试并给出可读错误）
  try {
    await client.ensureSession();
    log(`已登录：${client.username ?? "?"} @ ${client.accountName ?? "默认账号"}（rolePlatform=${client.info.rolePlatform}）`);
  } catch (err) {
    log(`预热登录失败（工具调用时将重试）：${toErrorText(err)}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("stdio 传输已连接");
}

main().catch((err) => {
  process.stderr.write(`[crater-mcp] 致命错误：${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
