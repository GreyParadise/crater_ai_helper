/**
 * 组：images（附加）—— Harbor 镜像仓库访问凭据
 *
 * 背景：平台给每个用户在 Harbor 建独立项目 `user-<用户名>`，密码由后端
 * `POST /api/v1/images/credential` 生成。**该接口每调用一次就会删除并重建 Harbor 用户**
 * ——即旧密码立即失效（前端「重置密码」按的就是这个）。所以：
 *   - 它是 destructive 操作，不能随手调；
 *   - 但没有它，agent 在 push/pull 私有镜像时会卡住（无凭据、或凭据早已遗忘）。
 *
 * 本组件把它做成「自动获取 + 失效自愈」：
 *   1. 本地缓存 `~/.crater-mcp/harbor.json`（0600），首次调用后不再反复轮换；
 *   2. 用 Harbor 的 token 端点做一次 basic-auth 探活：
 *        200 → 缓存有效（直接复用，不轮换）
 *        401/403 → 确实失效 → 自动轮换一次
 *        网络错误/未知 → **不轮换**（宁可用可能过期的密码，也不破坏用户已有的 docker 登录）
 *   3. `crater_images_harbor_login` 直接在本机执行 `docker login --password-stdin`，
 *      密码只走 stdin，**不进入对话上下文**。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ToolContext, ToolSpec } from "../registry.js";

const CACHE_DIR = path.join(os.homedir(), ".crater-mcp");
const CACHE_FILE = path.join(CACHE_DIR, "harbor.json");
const LOGIN_SCRIPT = path.join(CACHE_DIR, "docker-login.sh");

interface HarborCache {
  registry: string;
  project: string;
  username: string;
  password: string;
  rotatedAt: string;
}

interface Credential {
  registry: string;
  project: string;
  username: string;
  password: string;
  rotated: boolean;
  source: "cache" | "server";
  reason?: string;
  warning?: string;
}

function readCache(): HarborCache | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as HarborCache;
    return parsed?.password ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(cache: HarborCache): string {
  fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(CACHE_FILE, 0o600);
  } catch {
    /* Windows 上 chmod 可能无效，忽略 */
  }
  return CACHE_FILE;
}

/** Harbor 的 registry 地址（形如 https://172.16.16.126:30013） */
async function getRegistry(ctx: ToolContext): Promise<string> {
  const data = (await ctx.client.request({ method: "GET", path: "/api/v1/images/harbor" })) as { ip?: string };
  const ip = (data?.ip ?? "").trim();
  if (!ip) throw new Error("后端没有返回 Harbor 地址（/api/v1/images/harbor 的 ip 为空）");
  return ip.replace(/\/+$/, "");
}

/**
 * 用 Harbor 的 token 端点验证凭据是否仍然有效。
 * 返回 true=有效 / false=确定失效(401) / undefined=无法判断（网络或自签证书问题）
 */
function probeCredential(registry: string, project: string, username: string, password: string): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    if (!registry.startsWith("https://")) {
      resolve(undefined);
      return;
    }
    const auth = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    // 必须用"需要身份"的接口：/service/token 对公开项目会匿名签发 token，
    // 错误密码也返回 200，会让"失效检测"永远判成功。
    // /api/v2.0/users/current：有效 200、无效 401（项目名只在失败提示里用）。
    void project;
    const url = new URL(`${registry}/api/v2.0/users/current`);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
        timeout: 8000,
        // Harbor 用集群内自签证书；这里只是探活，不做信任链校验
        rejectUnauthorized: false,
      },
      (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(true);
        else if (res.statusCode === 401 || res.statusCode === 403) resolve(false);
        else resolve(undefined);
      }
    );
    req.on("error", () => resolve(undefined));
    req.on("timeout", () => {
      req.destroy();
      resolve(undefined);
    });
    req.end();
  });
}

async function ensureCredential(
  ctx: ToolContext,
  opts: { forceRotate?: boolean } = {}
): Promise<Credential> {
  const username = ctx.client.username;
  if (!username) throw new Error("当前没有登录用户，无法获取 Harbor 凭据（先调 crater_auth_login）");
  const registry = await getRegistry(ctx);
  const project = `user-${username}`;
  const cache = readCache();

  if (!opts.forceRotate && cache && cache.registry === registry && cache.username === username) {
    const valid = await probeCredential(registry, project, cache.username, cache.password);
    if (valid === true) {
      return { ...cache, rotated: false, source: "cache" };
    }
    if (valid === undefined) {
      return {
        ...cache,
        rotated: false,
        source: "cache",
        warning:
          "无法连到 Harbor 验证密码是否仍有效（自签证书/DNS/网络），已沿用本地缓存的凭据。" +
          "若 docker push 报 401，再调用本工具并传 forceRotate=true 轮换。",
      };
    }
    // valid === false → 确实失效，走下面的轮换
    const rotated = await rotate(ctx, registry, project, username);
    return { ...rotated, reason: "本地缓存的密码已被判定失效（Harbor 返回 401），已自动轮换" };
  }

  const rotated = await rotate(ctx, registry, project, username);
  if (opts.forceRotate) return { ...rotated, reason: "按请求强制轮换" };
  if (cache) return { ...rotated, reason: "缓存与当前账号不匹配（换了账号），已重新生成" };
  return { ...rotated, reason: "本机首次使用，已生成凭据" };
}

async function rotate(
  ctx: ToolContext,
  registry: string,
  project: string,
  username: string
): Promise<Credential> {
  const data = (await ctx.client.request({ method: "POST", path: "/api/v1/images/credential" })) as {
    name?: string;
    password?: string;
  };
  const password = (data?.password ?? "").trim();
  if (!password) throw new Error("后端没有返回 Harbor 密码（/api/v1/images/credential 的 password 为空）");
  const name = (data?.name ?? username).trim() || username;
  const cache: HarborCache = {
    registry,
    project,
    username: name,
    password,
    rotatedAt: new Date().toISOString(),
  };
  const cachePath = writeCache(cache);
  return { ...cache, registry, project, username: name, password, rotated: true, source: "server", reason: `缓存写入 ${cachePath}` };
}

const mask = (pw: string) => (pw.length <= 4 ? "****" : `${pw.slice(0, 2)}${"*".repeat(Math.max(4, pw.length - 4))}${pw.slice(-2)}`);

function dockerAvailable(): boolean {
  const r = spawnSync("docker", ["version", "--format", "{{.Client.Version}}"], { encoding: "utf8", timeout: 15000 });
  return r.status === 0;
}

export const specs: ToolSpec[] = [
  {
    name: "crater_images_harbor_credential",
    group: "images",
    title: "获取我的 Harbor 镜像仓库凭据（自动生成 / 失效自愈）",
    description:
      "返回我的私有 Harbor 项目 `user-<我的用户名>` 的访问凭据，用于 docker push / pull 私有镜像。" +
      "**会自动判断并自愈**：本地有缓存且 Harbor 验证通过 → 直接复用（不轮换）；缓存失效（401）→ 自动轮换一次；" +
      "本机首次使用 → 生成一套并把原文缓存到 ~/.crater-mcp/harbor.json（0600）。" +
      "⚠️ 轮换会让**所有旧密码立即失效**（包括你其他机器上已登录的 docker），所以默认只在必要时轮换；" +
      "forceRotate=true 才强制重置（等同网页端「重置密码」）。" +
      "默认只返回打码后的密码；需要明文（例如手工贴到其他地方）才传 revealPassword=true。" +
      "更好做法是直接用 crater_images_harbor_login：它在本机执行 docker login，密码不进对话。",
    method: "POST",
    path: "/api/v1/images/credential",
    scope: "self",
    readOnly: false,
    destructive: true,
    input: {
      forceRotate: z
        .boolean()
        .optional()
        .describe("true=强制轮换密码（旧密码立即失效，其他机器需重新登录）；默认 false 只在缓存缺失或已失效时轮换"),
      revealPassword: z
        .boolean()
        .optional()
        .describe("true=返回明文密码（会写进对话上下文，慎用）；默认返回打码"),
    },
    body: "none",
    run: async (args, ctx: ToolContext) => {
      const cred = await ensureCredential(ctx, { forceRotate: args.forceRotate === true });
      const reveal = args.revealPassword === true;
      return {
        registry: cred.registry,
        host: cred.registry.replace(/^https?:\/\//, ""),
        project: cred.project,
        username: cred.username,
        password: reveal ? cred.password : mask(cred.password),
        passwordMasked: !reveal,
        rotated: cred.rotated,
        source: cred.source,
        reason: cred.reason,
        warning: cred.warning,
        cacheFile: CACHE_FILE,
        next: reveal
          ? `docker login ${cred.registry.replace(/^https?:\/\//, "")} -u ${cred.username}（密码用上面这串）`
          : `docker login ${cred.registry.replace(/^https?:\/\//, "")} -u ${cred.username} —— 建议直接调 crater_images_harbor_login，由本机完成登录、密码不落对话`,
      };
    },
  },
  {
    name: "crater_images_harbor_login",
    group: "images",
    title: "在本机登录 Harbor（自动取凭据，密码不进对话）",
    description:
      "在自己的机器上执行 `docker login <Harbor>`，凭据由平台自动获取（必要时自动轮换），**密码只通过 stdin 传给 docker，不写入对话**。" +
      "适用场景：要 docker push 自建镜像、或 docker pull 私有镜像（匿名拉取会 401）时，先调它一次。" +
      "幂等：已登录且凭据有效时不会轮换密码。若镜像仓库用自签证书导致报 x509，返回里会给出把 CA 放进 /etc/docker/certs.d 的做法。",
    method: "POST",
    path: "/api/v1/images/credential",
    scope: "self",
    readOnly: false,
    input: {
      forceRotate: z.boolean().optional().describe("true=先轮换密码再登录（旧密码失效）"),
    },
    body: "none",
    run: async (args, ctx: ToolContext) => {
      const cred = await ensureCredential(ctx, { forceRotate: args.forceRotate === true });
      const host = cred.registry.replace(/^https?:\/\//, "");

      if (!dockerAvailable()) {
        fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
        fs.writeFileSync(
          LOGIN_SCRIPT,
          `#!/bin/sh\n# 由 crater-mcp 生成：登录 Harbor（密码从本地缓存读，不写进命令历史）\n` +
            `PW=$(node -e "process.stdout.write(require('${CACHE_FILE.replace(/\\/g, "/")}').password)")\n` +
            `echo "$PW" | docker login ${host} -u ${cred.username} --password-stdin\n`,
          { mode: 0o700 }
        );
        return {
          ok: false,
          dockerAvailable: false,
          registry: cred.registry,
          project: cred.project,
          username: cred.username,
          script: LOGIN_SCRIPT,
          hint:
            "本机没有可用的 docker CLI，因此没有自动登录。凭据已缓存在 " +
            `${CACHE_FILE}（0600）；在有 docker 的机器上执行上面 script，或直接跑 ` +
            `docker login ${host} -u ${cred.username}（密码见 crater_images_harbor_credential）。`,
          rotated: cred.rotated,
        };
      }

      const r = spawnSync("docker", ["login", host, "-u", cred.username, "--password-stdin"], {
        input: `${cred.password}\n`,
        encoding: "utf8",
        timeout: 60000,
      });
      const stderr = (r.stderr ?? "").trim();
      const stdout = (r.stdout ?? "").trim();
      let hint: string | undefined;
      if (r.status !== 0 && /x509|certificate signed by unknown authority/i.test(stderr + stdout)) {
        hint =
          "Harbor 用的是自签证书。把集群 CA 放到 /etc/docker/certs.d/" +
          `${host}/ca.crt（目录名必须与 host 完全一致），或在 /etc/docker/daemon.json 里加 ` +
          `"insecure-registries": ["${host}"] 后重启 docker。`;
      } else if (r.status !== 0 && /401|unauthorized|denied/i.test(stderr + stdout)) {
        hint = "认证被拒：可能是密码刚被别处轮换。再调一次本工具并传 forceRotate=true。";
      }

      return {
        ok: r.status === 0,
        registry: cred.registry,
        host,
        project: cred.project,
        username: cred.username,
        rotated: cred.rotated,
        output: (stdout || stderr).slice(-400),
        hint,
      };
    },
  },
];
