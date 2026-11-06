/**
 * 配置加载：全部来自环境变量，不落盘、不外发。
 * 详见 .env.example 与 docs/mcp-design.md §3
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CraterConfig {
  baseUrl: string;
  storageBaseUrl: string;
  username?: string;
  password?: string;
  accessToken?: string;
  refreshToken?: string;
  /** 登录后要切换到的账号名（Crater 的「项目」） */
  account?: string;
  readOnly: boolean;
  allowAdmin: boolean;
  enforceSelfScope: boolean;
  timeoutMs: number;
  transferTimeoutMs: number;
  workDir: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function int(v: string | undefined, dflt: number): number {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export interface LoadOptions {
  /** false 时允许缺 base/凭证（供 --list / --check 这类离线自检使用） */
  requireConnection?: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: LoadOptions = {}): CraterConfig {
  const requireConnection = opts.requireConnection !== false;
  const rawBase = (env.CRATER_BASE_URL ?? "").trim();
  if (!rawBase && requireConnection) {
    throw new ConfigError(
      "缺少 CRATER_BASE_URL。请设置为你所在环境的 Crater 面板地址，例如 http://172.16.16.140",
    );
  }
  const baseUrl = (rawBase || "http://127.0.0.1:8080").replace(/\/+$/, "");
  const storageBaseUrl = (env.CRATER_STORAGE_BASE_URL ?? "").trim().replace(/\/+$/, "") || baseUrl;

  const username = env.CRATER_USERNAME?.trim() || undefined;
  const password = env.CRATER_PASSWORD ?? undefined;
  const accessToken = env.CRATER_ACCESS_TOKEN?.trim() || undefined;
  const refreshToken = env.CRATER_REFRESH_TOKEN?.trim() || undefined;

  const hasPwd = Boolean(username && password);
  const hasToken = Boolean(accessToken || refreshToken);
  if (!hasPwd && !hasToken && requireConnection) {
    throw new ConfigError(
      "缺少身份凭证：请设置 CRATER_USERNAME + CRATER_PASSWORD（推荐），或 CRATER_ACCESS_TOKEN / CRATER_REFRESH_TOKEN",
    );
  }

  return {
    baseUrl,
    storageBaseUrl,
    username,
    password,
    accessToken,
    refreshToken,
    account: env.CRATER_ACCOUNT?.trim() || undefined,
    readOnly: bool(env.CRATER_READ_ONLY, false),
    allowAdmin: bool(env.CRATER_ALLOW_ADMIN, true),
    enforceSelfScope: bool(env.CRATER_ENFORCE_SELF_SCOPE, true),
    timeoutMs: int(env.CRATER_TIMEOUT_MS, 30_000),
    transferTimeoutMs: int(env.CRATER_TRANSFER_TIMEOUT_MS, 600_000),
    workDir: env.CRATER_WORK_DIR?.trim() || join(tmpdir(), "crater-mcp"),
  };
}
