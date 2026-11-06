/**
 * 极简 .env 加载器（零依赖）。
 *
 * 为什么需要：MCP 服务是被 agent 客户端以子进程拉起的，很多人不方便在每个客户端的
 * 配置里逐条写 env；把凭证放一个 .env 文件更省事，且不会被提交（.gitignore 已忽略）。
 *
 * 查找顺序（找到第一个就用）：
 *   1. 环境变量 CRATER_ENV_FILE 指定的文件
 *   2. 当前工作目录下的 .env
 *   3. 本包根目录（dist/..）下的 .env
 *
 * 规则：只填充「进程里还没有定义」的键，绝不覆盖客户端显式传入的环境变量。
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");

export function loadEnvFile(): string | null {
  const candidates: string[] = [];
  const explicit = (process.env.CRATER_ENV_FILE ?? "").trim();
  if (explicit) candidates.push(resolve(explicit));
  candidates.push(resolve(process.cwd(), ".env"));
  candidates.push(join(packageRoot, ".env"));

  const file = candidates.find((p) => existsSync(p));
  if (!file) return null;

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return file;
}
