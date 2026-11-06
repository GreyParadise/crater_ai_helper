/**
 * 官方 crater CLI 桥接层
 *
 * 设计取舍：MCP 的「结构化工具」覆盖高频、需要强约束的操作；官方 CLI 覆盖长尾
 * （模型下载任务、审批工单、Pod 诊断、兼容性检查等）。把 CLI 当成一个「一参透传」
 * 通道接进来，既不用为每个新命令写 ToolSpec，也不吃 schema token。
 *
 * 三条硬规则：
 *   1. **不经 shell**：spawn(shell:false)，参数一个个传，杜绝命令注入。
 *   2. **白名单**：只有显式列出的「命令路径前缀」能跑；只读 / 写两套分开。
 *   3. **永不回传凭据**：`--password`/`--token` 以及 `job token|secret|ssh`、
 *      `image harbor credential`、`auth login` 一律拒绝，避免密钥进上下文。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { GuardError } from "./errors.js";

export interface CliRunResult {
  argv: string[];
  binary: string;
  exitCode: number;
  json: unknown;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** 只读命令路径前缀（argv 去掉 flags 后的前几段必须命中其中之一） */
export const CLI_READ_PREFIXES: string[][] = [
  ["account", "ls"],
  ["account", "current"],
  ["account", "get"],
  ["account", "members"],
  ["account", "users-out"],
  ["account", "billing"],
  ["auth", "ls"],
  ["billing", "status"],
  ["billing", "summary"],
  ["billing", "jobs"],
  ["billing", "job"],
  ["billing", "prices"],
  ["compatibility"],
  ["context", "quota"],
  ["context", "resources"],
  ["context", "billing"],
  ["dataset", "ls"],
  ["dataset", "get"],
  ["dataset", "users"],
  ["dataset", "users-out"],
  ["dataset", "queues"],
  ["dataset", "queues-out"],
  ["download", "ls"],
  ["download", "get"],
  ["download", "logs"],
  ["file", "ls"],
  ["image", "ls"],
  ["image", "cuda", "ls"],
  ["image", "build", "ls"],
  ["image", "build", "get"],
  ["image", "build", "template"],
  ["image", "build", "pod"],
  ["image", "quota", "get"],
  ["image", "share", "ls"],
  ["image", "share", "users"],
  ["image", "share", "accounts"],
  ["image", "harbor", "info"],
  ["image", "valid"],
  ["job", "ls"],
  ["job", "get"],
  ["job", "pods"],
  ["job", "events"],
  ["job", "yaml"],
  ["job", "template"],
  ["job", "logs"],
  ["model-download", "ls"],
  ["model-download", "get"],
  ["model-download", "logs"],
  ["node", "ls"],
  ["node", "get"],
  ["node", "gpu"],
  ["node", "pods"],
  ["order", "ls"],
  ["order", "get"],
  ["order", "by-name"],
  ["pod", "containers"],
  ["pod", "events"],
  ["pod", "ingresses"],
  ["pod", "logs"],
  ["pod", "nodeports"],
  ["resource", "ls"],
  ["resource", "networks"],
  ["resource", "prices"],
  ["resource", "vgpu"],
  ["template", "ls"],
  ["template", "get"],
  ["user", "get"],
  ["admin", "user", "ls"],
  ["admin", "user", "billing"],
  ["admin", "account", "ls"],
  ["admin", "account", "get"],
  ["admin", "account", "members"],
  ["admin", "account", "quota"],
  ["admin", "account", "users-out"],
  ["admin", "account", "billing"],
  ["admin", "job", "ls"],
  ["admin", "image", "ls"],
  ["admin", "image", "build-ls"],

  ["admin", "dataset", "ls"],
  ["admin", "resource", "vgpu"],
  ["admin", "resource", "networks"],
  ["admin", "queue-quotas"],
  ["admin", "cronjobs"],
  ["admin", "gpu-analyses"],
  ["admin", "system-config", "llm"],
  ["admin", "system-config", "gpu-analysis"],
  ["admin", "whitelist"],
  ["admin", "billing", "jobs"],
  ["admin", "billing", "status"],
  ["admin", "order", "ls"],
  ["admin", "order", "get"],
];

/** 写命令前缀（还需 CRATER_ALLOW_CLI_WRITE=true） */
export const CLI_WRITE_PREFIXES: string[][] = [
  ["download", "create"],
  ["download", "model"],
  ["download", "dataset"],
  ["download", "pause"],
  ["download", "resume"],
  ["download", "retry"],
  ["download", "rm"],
  ["order", "submit"],
  ["order", "edit"],
  ["order", "cancel"],
  ["job", "create"],
  ["job", "delete"],
  ["job", "alert"],
  ["job", "snapshot"],
  ["image", "build", "pip-apt"],
  ["image", "build", "dockerfile"],
  ["image", "build", "envd"],
  ["image", "build", "remove"],
  ["image", "share", "add"],
  ["image", "share", "remove"],
  ["image", "delete"],
  ["image", "upload"],
  ["image", "tags"],
  ["image", "type"],
  ["image", "arch"],
  ["image", "quota"],
  ["file", "mkdir"],
  ["file", "mv"],
  ["file", "rm"],
  ["admin", "job", "delete"],
  ["admin", "job", "lock"],
  ["admin", "job", "unlock"],
  ["admin", "job", "keep"],
  ["admin", "job", "clean"],
  ["admin", "image", "cuda", "add"],
  ["admin", "image", "cuda", "delete"],
  ["admin", "image", "delete-many"],
  ["admin", "image", "description"],
  ["admin", "image", "public"],
  ["admin", "image", "tags"],
  ["admin", "image", "type"],
  ["admin", "image", "arch"],

  ["admin", "order", "approve"],
  ["admin", "order", "reject"],
  ["admin", "order", "check"],
];

/**
 * 无论如何都不允许的前缀。
 * 理由分别是：凭据进上下文 / 绕过 CRATER_WORK_DIR 沙箱 / 改动本地 CLI 状态。
 */
const CLI_HARD_DENY: { prefix: string[]; why: string }[] = [
  { prefix: ["auth", "login"], why: "登录会写入凭据，且可能弹出交互提示；请在你的终端里执行一次 crater auth login" },
  { prefix: ["auth", "logout"], why: "会改动本地 CLI 登录状态" },
  { prefix: ["auth", "switch"], why: "会改动本地 CLI 登录状态（多环境切换请在终端做）" },
  { prefix: ["auth", "rm"], why: "会删除本地保存的凭据" },
  { prefix: ["job", "token"], why: "Jupyter token 属凭据，直接调用会把它写进对话上下文" },
  { prefix: ["job", "secret"], why: "WebIDE 密码属凭据；需要入口地址请用 crater_jobs_get_secret（本 MCP 已标注敏感）" },
  { prefix: ["job", "ssh"], why: "交互式 SSH 会话无法在 MCP 里使用" },
  { prefix: ["image", "harbor", "credential"], why: "返回 Harbor 明文账号密码" },
  { prefix: ["file", "upload"], why: "CLI 上传不受 CRATER_WORK_DIR 沙箱约束；请用 crater_files_upload" },
  { prefix: ["file", "download"], why: "CLI 下载不受 CRATER_WORK_DIR 沙箱约束；请用 crater_files_download" },
  { prefix: ["completion", "install"], why: "会修改本机 shell 配置" },
  { prefix: ["completion", "uninstall"], why: "会修改本机 shell 配置" },
  { prefix: ["config", "language"], why: "会修改本地 CLI 配置" },
];

/** 参数里出现这些 flag 直接拒绝（值会留在对话历史里） */
const FORBIDDEN_FLAGS = new Set(["--password", "--token", "--token-stdin"]);

function splitFlags(argv: string[]): { words: string[]; flags: string[] } {
  const words: string[] = [];
  const flags: string[] = [];
  for (const a of argv) {
    if (a.startsWith("-")) flags.push(a);
    else words.push(a);
  }
  return { words, flags };
}

/**
 * 变更动词兜底：只读白名单是「前缀匹配」，万一某个只读前缀下新增了写子命令
 * （例如 admin image cuda 后来加了 add/delete），这里能兜住。
 */
const MUTATING_VERBS = new Set([
  "add",
  "delete",
  "remove",
  "rm",
  "mv",
  "set",
  "update",
  "create",
  "upload",
  "approve",
  "reject",
  "cancel",
  "clean",
  "lock",
  "unlock",
  "keep",
  "snapshot",
  "alert",
  "edit",
  "submit",
  "pause",
  "resume",
  "retry",
  "build",
  "install",
  "uninstall",
  "switch",
  "login",
  "logout",
  "public",
]);

function matchesPrefix(words: string[], prefix: string[]): boolean {
  if (words.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (words[i] !== prefix[i]) return false;
  return true;
}

/** 校验 + 归一化 argv；不通过直接抛 GuardError（消息给 agent 看） */
export function validateCliArgv(raw: string[], opts: { allowWrite: boolean }): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new GuardError("args 不能为空，例如 [\"job\",\"ls\",\"--page-size\",\"5\"]");
  }
  const argv = raw.map((a) => String(a));
  for (const a of argv) {
    if (a.includes("\u0000") || /[\r\n]/.test(a)) {
      throw new GuardError("参数里不能包含换行或 NUL 字符");
    }
  }
  for (const a of argv) {
    const flag = a.split("=")[0] ?? a;
    if (FORBIDDEN_FLAGS.has(flag)) {
      throw new GuardError(
        `参数 ${flag} 会把凭据/敏感值写进对话上下文，MCP 一律不放行。` +
          `需要 token 时请用 --token-env <环境变量名>（CLI 自己从环境读，不进对话）。`,
      );
    }
  }

  const { words } = splitFlags(argv);
  for (const deny of CLI_HARD_DENY) {
    if (matchesPrefix(words, deny.prefix)) {
      throw new GuardError(`crater ${deny.prefix.join(" ")} 不允许通过 MCP 调用：${deny.why}`);
    }
  }

  // --help 一律放行：只打印用法、不触达 API，也让 agent 自己能探命令树
  if (argv.some((a) => a === "--help" || a === "-h" || a === "help")) return argv;

  const readHit = CLI_READ_PREFIXES.find((p) => matchesPrefix(words, p));
  if (readHit) {
    const next = words[readHit.length];
    if (next && MUTATING_VERBS.has(next)) {
      throw new GuardError(
        `crater ${words.join(" ")} 看起来是写操作（${next}），只读工具不放行。` +
          `请改用 crater_cli_write 并确认 CRATER_ALLOW_CLI_WRITE=true。`,
      );
    }
    return ensureJsonFlags(argv);
  }

  const writeHit = CLI_WRITE_PREFIXES.find((p) => matchesPrefix(words, p));
  if (writeHit) {
    if (opts.allowWrite) return ensureJsonFlags(argv);
    throw new GuardError(
      `crater ${words.join(" ")} 属于写操作，但 CRATER_ALLOW_CLI_WRITE 未开启（默认 false）。` +
        `只读命令可以直接跑；要放开写命令，请在 MCP 配置里设 CRATER_ALLOW_CLI_WRITE=true 后重启。` +
        `另外很多写操作已经有强类型工具（crater_jobs_*、crater_images_*、crater_files_*），优先用它们。`,
    );
  }

  throw new GuardError(
    `crater ${words.join(" ")} 不在本 MCP 的命令白名单里（可能命令拼错，或该命令尚未收录）。\n` +
      `先探路：传 args:["${words[0] ?? "<命令>"}","--help"] 看这个命令有哪些子命令。`,
  );
}

/** CLI 的所有命令都加 --json + --no-interactive，保证结构化、不卡在交互提示 */
function ensureJsonFlags(argv: string[]): string[] {
  const out = [...argv];
  if (!out.includes("--json")) out.push("--json");
  if (!out.includes("--no-interactive")) out.push("--no-interactive");
  return out;
}

/** 找可执行文件：CRATER_CLI_PATH 优先，其次 PATH 上的 crater(.exe) */
export function resolveCliBinary(configured: string): string {
  if (configured) {
    if (configured.includes("/") || configured.includes("\\") || existsSync(configured)) return configured;
    return configured;
  }
  return process.platform === "win32" ? "crater.exe" : "crater";
}

export interface RunCliOptions {
  binary: string;
  argv: string[];
  timeoutMs?: number;
  cwd?: string;
  maxBytes?: number;
}

export function runCraterCli(opts: RunCliOptions): Promise<CliRunResult> {
  const { binary, argv } = opts;
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 60_000, 1_000), 600_000);
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const started = Date.now();

  return new Promise<CliRunResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, argv, {
        shell: false,
        windowsHide: true,
        cwd: opts.cwd,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      reject(
        new GuardError(
          `无法启动 crater CLI（${binary}）：${(err as Error).message}\n` +
            `请先安装：npm install --global @raids-lab/crater-cli；或用 CRATER_CLI_PATH 指定可执行文件绝对路径。`,
        ),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;
    let killedBySize = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf8");
      if (stdout.length >= maxBytes && !killedBySize) {
        killedBySize = true;
        child.kill();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf8");
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new GuardError(
            `找不到 crater 可执行文件（${binary}）。\n` +
              `安装：npm install --global @raids-lab/crater-cli（Windows 官方标注为 experimental）\n` +
              `或在 MCP 配置里设置 CRATER_CLI_PATH 指向 crater.exe 的绝对路径。`,
          ),
        );
        return;
      }
      reject(new GuardError(`运行 crater CLI 失败：${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      let json: unknown = undefined;
      const trimmed = stdout.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          json = JSON.parse(trimmed);
        } catch {
          json = undefined;
        }
      }
      const notes: string[] = [];
      if (killedByTimeout) notes.push(`执行超过 ${timeoutMs}ms 已被终止（可传 timeoutMs 调大）`);
      if (killedBySize) notes.push(`输出超过 ${maxBytes} 字节被截断（可用 --page-size 降低输出量）`);
      resolve({
        argv,
        binary,
        exitCode: code ?? -1,
        json,
        stdout: notes.length ? `${stdout}\n[${notes.join("；")}]` : stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
  });
}

/** 把 CLI 结果压成给 agent 看的紧凑结构 */
export function summarizeCliResult(r: CliRunResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    command: `crater ${r.argv.join(" ")}`,
    exitCode: r.exitCode,
    ok: r.exitCode === 0,
    durationMs: r.durationMs,
  };
  if (r.json !== undefined) {
    out.data = r.json;
  } else if (r.stdout.trim()) {
    out.stdout = r.stdout.trim().slice(0, 20_000);
  }
  if (r.stderr.trim()) out.stderr = r.stderr.trim().slice(0, 4_000);

  const status = (r.json as { status?: string; code?: string; message?: string } | undefined) ?? {};
  if (status.code) {
    out.cliCode = status.code;
    if (status.code === "ERR_API_VERSION_MISMATCH") {
      out.hint =
        "该平台后端 API 版本低于 CLI 要求（crater compatibility 可看详情）。基础命令通常仍可用，" +
        "但新命令可能因契约差异失败；必要时降级 CLI 版本。";
    }
  }
  if (r.exitCode !== 0 && !out.hint) {
    out.hint =
      "CLI 返回非 0。先看 stderr/cliCode：认证类问题请在你自己的终端跑一次 crater auth login（MCP 不放行登录）；" +
      "作业/资源标识问题注意 :name 要传 jobName（如 vsc-...-abcde）而不是中文显示名。";
  }
  return out;
}
