/**
 * 官方 crater CLI 桥接工具组（2 个工具，schema 极小）
 *
 * 为什么只有两个：CLI 有 100+ 子命令，全部包成独立工具会让 schema 从 0 涨回几万 token。
 * 这里用「一个字符串数组透传」的形态，把长尾能力以近乎零 token 成本接进来：
 *
 *   crater_cli_read  只读命令（默认可用）
 *   crater_cli_write 写命令（需 CRATER_ALLOW_CLI_WRITE=true）
 *
 * 安全边界在 src/cli.ts 的白名单与硬拒绝清单里，不依赖模型自觉。
 */
import { z } from "zod";
import type { ToolSpec } from "../registry.js";
import { GuardError } from "../errors.js";
import {
  CLI_READ_PREFIXES,
  CLI_WRITE_PREFIXES,
  resolveCliBinary,
  runCraterCli,
  summarizeCliResult,
  validateCliArgv,
} from "../cli.js";

const argsSchema = {
  args: z
    .array(z.string())
    .min(1)
    .describe(
      'crater 后面的参数数组，按段拆开，例如 ["job","ls","--page-size","5"]；不要带 "crater" 本身，也不要拼成一条字符串',
    ),
  timeoutMs: z.number().int().min(1000).max(600000).optional().describe("超时毫秒数，默认 60000；下载/构建类可调大"),
} as const;

async function run(args: Record<string, unknown>, ctx: { config: { cliPath: string; allowCliWrite: boolean } }) {
  const argv = validateCliArgv(args.args as string[], { allowWrite: ctx.config.allowCliWrite });
  const binary = resolveCliBinary(ctx.config.cliPath);
  const result = await runCraterCli({
    binary,
    argv,
    timeoutMs: args.timeoutMs as number | undefined,
  });
  if (!result.json && result.exitCode !== 0 && !result.stdout.trim() && !result.stderr.trim()) {
    throw new GuardError(`crater ${argv.join(" ")} 没有任何输出（exitCode=${result.exitCode}）`);
  }
  return summarizeCliResult(result);
}

export const specs: ToolSpec[] = [
  {
    name: "crater_cli_read",
    group: "cli",
    title: "执行官方 crater CLI 的只读命令",
    description:
      "把官方 `crater` CLI 当成透传通道，执行**只读**子命令，自动补 --json --no-interactive，返回结构化结果。" +
      "适合官方 CLI 独有、本 MCP 没有强类型工具的能力：模型/数据集下载任务（download ls|get|logs）、" +
      "审批工单（order ls|get|by-name）、Pod 诊断（pod containers|events|ingresses|logs|nodeports）、" +
      "CLI 与平台兼容性（compatibility -p <url>）、镜像构建记录（image build ls|get|template）、" +
      "镜像授权（image share ls|users|accounts）、CUDA 基础镜像与 Harbor 配额（image cuda ls / image quota get / image harbor info）。" +
      "禁止：任何写命令（用 crater_cli_write）、auth login/switch、job token|secret|ssh、" +
      "image harbor credential、file upload|download（沙箱外读写请走 crater_files_*）。" +
      "注意：本工具用的是**你本机 crater CLI 自己的登录态**，与本 MCP 的账号互相独立；" +
      "未登录请先在你自己的终端执行 crater auth login。:name 参数要传 jobName（vsc-...-abcde），不是中文显示名。",
    method: "CLI",
    path: "crater <read-only subcommand>",
    scope: "self",
    readOnly: true,
    input: argsSchema,
    run: run as unknown as ToolSpec["run"],
  },
  {
    name: "crater_cli_write",
    group: "cli",
    title: "执行官方 crater CLI 的写命令（需显式开启）",
    description:
      "透传官方 CLI 的**写**命令，只有设置 CRATER_ALLOW_CLI_WRITE=true 后才可用，且仍受白名单限制。" +
      "典型用途：下载任务（download model|dataset|create|pause|resume|retry|rm）、" +
      "审批工单（order submit|edit|cancel、admin order approve|reject）、" +
      "镜像构建（image build pip-apt|dockerfile|envd|remove、image share add|remove）、" +
      "管理员清理（admin job delete|lock|unlock|keep|clean）。" +
      "优先用本 MCP 的强类型工具（crater_jobs_create_*、crater_images_*）：它们有参数校验和更好的错误提示；" +
      "只有 CLI 独有或 CLI 更成熟的写操作再用本工具。执行前请确认目标对象，避免误删。",
    method: "CLI",
    path: "crater <write subcommand>",
    scope: "self",
    readOnly: false,
    destructive: true,
    input: argsSchema,
    run: run as unknown as ToolSpec["run"],
  },
];
