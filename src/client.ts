/**
 * Crater HTTP 客户端
 *
 * 设计要点（依据 docs/api-inventory.md 的源码事实）：
 * 1. 认证只走 Crater 自己的 JWT：POST /api/auth/login → {accessToken, refreshToken, context, user}
 * 2. 非 GET 请求后端每次都会回库比对角色/访问模式（middleware/jwt.go:52-85），
 *    所以「token 过期」「权限快照过期」都会表现为 401 → 必须 refresh 失败后再整轮 login。
 * 3. /api/v1/auth/switch 是唯一豁免；切换账号后必须换用返回的新 token。
 * 4. 文件读写不在主后端，而在独立进程 storage-server 的 /api/ss/*（上传是「裸 body」不是 multipart）。
 */
import { ConfigError, loadConfig, type CraterConfig } from "./config.js";
import { CraterError, hintForStatus } from "./errors.js";

export type RawBody = Uint8Array | ArrayBuffer | string;
export type RequestMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  // WebDAV 方法（storage-server 的 /api/ss/*；线上实测 MKCOL / PUT / PROPFIND 可用）
  | "MKCOL"
  | "PROPFIND"
  | "PROPPATCH"
  | "OPTIONS";
export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;

export interface RequestOptions {
  method: RequestMethod;
  /** 必须以 / 开头的完整路径，例如 /api/v1/vcjobs/webide */
  path: string;
  query?: Record<string, QueryValue>;
  /** JSON body（与 rawBody 互斥） */
  body?: unknown;
  /** 原始 body（上传文件用） */
  rawBody?: RawBody;
  /** 发往主后端还是 storage-server；默认主后端 */
  target?: "main" | "storage";
  timeoutMs?: number;
}

export interface SessionInfo {
  userId?: number;
  username?: string;
  accountId?: number;
  accountName?: string;
  rolePlatform?: number;
  roleAccount?: number;
  accessMode?: number;
  publicAccessMode?: number;
  space?: string;
  expiresAt?: Date;
  /** 登录返回的原始 context/user，供 whoami 输出 */
  rawContext?: unknown;
  rawUser?: unknown;
}

interface JwtClaims {
  ui?: number;
  qi?: number;
  un?: string;
  qn?: string;
  rq?: number;
  rp?: number;
  am?: number;
  pa?: number;
  exp?: number;
}

const ROLE_ADMIN = 3;
const ROLE_USER = 2;

function decodeJwt(token: string): JwtClaims | undefined {
  const seg = token.split(".");
  if (seg.length < 2 || !seg[1]) return undefined;
  try {
    const json = Buffer.from(seg[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as JwtClaims;
  } catch {
    return undefined;
  }
}

function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      for (const item of v) usp.append(k, String(item));
    } else {
      usp.append(k, String(v));
    }
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

/** 拆掉后端统一响应外壳 {code, msg/message, data} */
function unwrapEnvelope(json: unknown): unknown {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    const hasData = "data" in obj;
    const hasEnvelopeMarker = "code" in obj || "msg" in obj || "message" in obj;
    if (hasData && hasEnvelopeMarker) {
      const code = obj.code;
      if (code !== undefined && code !== null && code !== 0 && code !== "0" && code !== 200) {
        throw new CraterError({
          message: String(obj.msg ?? obj.message ?? "后端返回非成功业务码"),
          status: typeof code === "number" ? code : 500,
          code: code as string | number,
          path: "",
          method: "",
          body: json,
        });
      }
      return obj.data;
    }
  }
  return json;
}

export class CraterClient {
  readonly config: CraterConfig;
  private accessToken?: string;
  private refreshToken?: string;
  private session: SessionInfo = {};
  private loginLock?: Promise<void>;
  private loggedIn = false;

  constructor(config?: CraterConfig) {
    this.config = config ?? loadConfig();
    this.accessToken = this.config.accessToken;
    this.refreshToken = this.config.refreshToken;
    if (this.accessToken) this.session = this.sessionFromToken(this.accessToken);
  }

  // ---------- 身份 ----------

  get info(): SessionInfo {
    return this.session;
  }

  get isAdmin(): boolean {
    return this.session.rolePlatform === ROLE_ADMIN;
  }

  get isUser(): boolean {
    const r = this.session.rolePlatform;
    return r === ROLE_ADMIN || r === ROLE_USER;
  }

  get username(): string | undefined {
    return this.session.username;
  }

  get accountName(): string | undefined {
    return this.session.accountName;
  }

  private sessionFromToken(token: string): SessionInfo {
    const c = decodeJwt(token);
    if (!c) return {};
    return {
      userId: c.ui,
      username: c.un,
      accountId: c.qi,
      accountName: c.qn,
      rolePlatform: c.rp,
      roleAccount: c.rq,
      accessMode: c.am,
      publicAccessMode: c.pa,
      expiresAt: c.exp ? new Date(c.exp * 1000) : undefined,
    };
  }

  async ensureSession(): Promise<void> {
    if (this.loggedIn && this.accessToken) return;
    if (this.accessToken) {
      // 外部直接塞进来的 token：先验证一次，顺便拿到 context
      try {
        await this.checkAuth();
        this.loggedIn = true;
        return;
      } catch {
        /* 落到下面正常登录 */
      }
    }
    await this.login();
  }

  /** GET /api/auth/check —— 校验 token 并刷新会话信息 */
  private async checkAuth(): Promise<void> {
    const data = (await this.send({
      method: "GET",
      path: "/api/auth/check",
      auth: true,
    })) as { context?: Record<string, unknown>; user?: Record<string, unknown> };
    this.mergeContext(data?.context, data?.user);
  }

  private mergeContext(context?: Record<string, unknown>, user?: Record<string, unknown>): void {
    if (context) {
      this.session = {
        ...this.session,
        accountName: (context.queue as string) ?? this.session.accountName,
        roleAccount: context.roleQueue as number | undefined,
        accessMode: context.accessQueue as number | undefined,
        publicAccessMode: context.accessPublic as number | undefined,
        space: context.space as string | undefined,
        rawContext: context,
      };
    }
    if (user) {
      this.session = {
        ...this.session,
        userId: (user.id as number) ?? this.session.userId,
        username: (user.name as string) ?? (user.username as string) ?? this.session.username,
        rawUser: user,
      };
    }
  }

  /**
   * 登录。creds 用于「工具里显式指定账号」的场景（例如先 signup 再 login），
   * 不传则用环境变量里的凭证。
   */
  async login(creds?: { username?: string; password?: string }): Promise<void> {
    if (!creds && this.loginLock) return this.loginLock;
    const username = creds?.username ?? this.config.username;
    const password = creds?.password ?? this.config.password;
    if (!username || !password) {
      throw new ConfigError("缺少 CRATER_USERNAME / CRATER_PASSWORD，无法在 token 失效后重新登录");
    }
    this.loginLock = (async () => {
      const data = (await this.send({
        method: "POST",
        path: "/api/auth/login",
        body: { auth: "normal", username, password },
        auth: false,
      })) as {
        accessToken: string;
        refreshToken: string;
        context?: Record<string, unknown>;
        user?: Record<string, unknown>;
      };
      if (!data?.accessToken) {
        throw new CraterError({
          message: "登录成功但响应里没有 accessToken（后端契约变化？）",
          status: 500,
          path: "/api/auth/login",
          method: "POST",
        });
      }
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.session = this.sessionFromToken(data.accessToken);
      this.mergeContext(data.context, data.user);
      this.loggedIn = true;

      if (!creds && this.config.account && this.config.account !== this.session.accountName) {
        await this.switchAccount(this.config.account);
      }
    })();
    try {
      await this.loginLock;
    } finally {
      this.loginLock = undefined;
    }
  }

  async refresh(): Promise<void> {
    if (!this.refreshToken) throw new ConfigError("没有 refreshToken，无法续期");
    const data = (await this.send({
      method: "POST",
      path: "/api/auth/refresh",
      body: { refreshToken: this.refreshToken },
      auth: false,
    })) as { accessToken: string; refreshToken: string };
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
    this.session = { ...this.session, ...this.sessionFromToken(data.accessToken) };
    this.loggedIn = true;
  }

  /** POST /api/v1/auth/switch —— 切到另一个账号（项目），必须换用新 token */
  async switchAccount(account: string): Promise<void> {
    const data = (await this.send({
      method: "POST",
      path: "/api/v1/auth/switch",
      body: { queue: account },
      auth: true,
    })) as { accessToken: string; refreshToken: string; context?: Record<string, unknown>; user?: Record<string, unknown> };
    if (data?.accessToken) {
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.session = this.sessionFromToken(data.accessToken);
      this.mergeContext(data.context, data.user);
    }
  }

  private async recoverAuth(): Promise<void> {
    if (this.refreshToken) {
      try {
        await this.refresh();
        return;
      } catch {
        /* 继续尝试整轮登录 */
      }
    }
    if (this.config.username && this.config.password) {
      this.loggedIn = false;
      await this.login();
      return;
    }
    throw new CraterError({
      message: "身份已失效，且没有可用于重新登录的凭证",
      status: 401,
      path: "",
      method: "",
      hint: "设置 CRATER_USERNAME/CRATER_PASSWORD，或更新 CRATER_ACCESS_TOKEN",
    });
  }

  // ---------- 请求 ----------

  private baseFor(target?: "main" | "storage"): string {
    return target === "storage" ? this.config.storageBaseUrl : this.config.baseUrl;
  }

  /** 底层发送；不做 401 自愈，供 login/refresh/check 使用 */
  private async send(opts: RequestOptions & { auth: boolean }): Promise<unknown> {
    const res = await this.fetchRaw(opts, opts.auth ? this.accessToken : undefined);
    return this.parseJson(res, opts);
  }

  private async fetchRaw(opts: RequestOptions, token?: string): Promise<Response> {
    const url = `${this.baseFor(opts.target)}${opts.path}${buildQuery(opts.query)}`;
    const headers: Record<string, string> = { Accept: "application/json, */*" };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: RawBody | undefined;
    if (opts.rawBody !== undefined) {
      body = opts.rawBody;
      headers["Content-Type"] = "application/octet-stream";
    } else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method,
        headers,
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.config.timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CraterError({
        message: `无法连接 Crater（${msg}）`,
        status: 0,
        path: opts.path,
        method: opts.method,
        hint: "检查 CRATER_BASE_URL 是否正确、网络/VPN 是否可达、面板是否在运行",
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      const obj = (parsed ?? {}) as Record<string, unknown>;
      const message = String(obj.msg ?? obj.message ?? text ?? res.statusText ?? "请求失败");
      throw new CraterError({
        message,
        status: res.status,
        path: opts.path,
        method: opts.method,
        code: (obj.code as string | number) ?? undefined,
        hint: hintForStatus(res.status, opts.method),
        body: parsed,
      });
    }
    return res;
  }

  private async parseJson(res: Response, opts: RequestOptions): Promise<unknown> {
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return text;
    }
    try {
      return unwrapEnvelope(json);
    } catch (e) {
      if (e instanceof CraterError) {
        throw new CraterError({
          message: e.message,
          status: e.status,
          code: e.code,
          path: opts.path,
          method: opts.method,
          body: json,
          hint: hintForStatus(e.status, opts.method),
        });
      }
      throw e;
    }
  }

  /** 带 401 自愈的 JSON 请求（业务工具都用这个） */
  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    await this.ensureSession();
    try {
      const res = await this.fetchRaw(opts, this.accessToken);
      return (await this.parseJson(res, opts)) as T;
    } catch (err) {
      if (err instanceof CraterError && err.status === 401) {
        await this.recoverAuth();
        const res = await this.fetchRaw(opts, this.accessToken);
        return (await this.parseJson(res, opts)) as T;
      }
      throw err;
    }
  }

  /** 返回二进制（下载文件用） */
  async requestBinary(opts: RequestOptions): Promise<{ bytes: Buffer; contentType?: string; filename?: string }> {
    await this.ensureSession();
    const doFetch = async () => this.fetchRaw({ ...opts, timeoutMs: opts.timeoutMs ?? this.config.transferTimeoutMs }, this.accessToken);
    let res: Response;
    try {
      res = await doFetch();
    } catch (err) {
      if (err instanceof CraterError && err.status === 401) {
        await this.recoverAuth();
        res = await doFetch();
      } else {
        throw err;
      }
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const cd = res.headers.get("content-disposition") ?? undefined;
    const m = cd?.match(/filename="?([^";]+)"?/i);
    return {
      bytes: buf,
      contentType: res.headers.get("content-type") ?? undefined,
      filename: m?.[1]?.split("/").pop(),
    };
  }

  // ---------- storage-server 专用便捷方法 ----------

  /**
   * 上传：WebDAV `PUT /api/ss/<逻辑路径>`，body 为裸字节。
   *
   * 线上实测结论（2026-11-06, .126）：
   * - `PUT /api/ss/user/x.txt` → 201 Created（可用）
   * - `POST /api/ss/upload/*path` → 404 page not found（该新接口在后端 main 分支有，但线上 storage-server 镜像未包含）
   * 所以这里必须走 WebDAV PUT。PUT 天然是覆盖写；overwrite=false 时先列父目录判断是否已存在。
   */
  async uploadFile(remotePath: string, data: Buffer | Uint8Array, overwrite = true): Promise<unknown> {
    const clean = remotePath.replace(/^\/+/, "");
    if (!overwrite && (await this.exists(clean))) {
      throw new CraterError({
        message: `远端已存在同名文件：${clean}`,
        status: 409,
        path: `/api/ss/${clean}`,
        method: "PUT",
        hint: "如需覆盖，请传 overwrite=true；或换一个目标路径",
      });
    }
    return this.request({
      method: "PUT",
      path: `/api/ss/${encodePath(clean)}`,
      rawBody: new Uint8Array(data),
      target: "storage",
      timeoutMs: this.config.transferTimeoutMs,
    });
  }

  /** 判断远端逻辑路径是否存在（列父目录比对名字） */
  async exists(remotePath: string): Promise<boolean> {
    const clean = remotePath.replace(/^\/+/, "");
    const parts = clean.split("/");
    const name = parts.pop() as string;
    const parent = parts.join("/");
    try {
      const listing = (await this.request({
        method: "GET",
        path: `/api/ss/files/${encodePath(parent)}`,
        target: "storage",
      })) as Array<{ name?: string }> | null;
      return Array.isArray(listing) && listing.some((e) => e?.name === name);
    } catch {
      return false;
    }
  }

  /** 下载：GET /api/ss/download/*path */
  async downloadFile(remotePath: string): Promise<{ bytes: Buffer; filename?: string; contentType?: string }> {
    return this.requestBinary({
      method: "GET",
      path: `/api/ss/download/${encodePath(remotePath)}`,
      target: "storage",
    });
  }

  /** 建目录：WebDAV `MKCOL /api/ss/<逻辑路径>`（线上实测 201 Created；父目录必须已存在，否则 409 Conflict） */
  async mkdir(remotePath: string): Promise<unknown> {
    return this.request({
      method: "MKCOL",
      path: `/api/ss/${encodePath(remotePath)}`,
      target: "storage",
    });
  }

  /** 移动/重命名：POST /api/ss/move/*path，body {dst} */
  async moveFile(fromPath: string, toPath: string): Promise<unknown> {
    return this.request({
      method: "POST",
      path: `/api/ss/move/${encodePath(fromPath)}`,
      body: { dst: toPath },
      target: "storage",
    });
  }

  /** 删除：DELETE /api/ss/delete/*path */
  async removeFile(remotePath: string): Promise<unknown> {
    return this.request({
      method: "DELETE",
      path: `/api/ss/delete/${encodePath(remotePath)}`,
      target: "storage",
    });
  }
}

/** 逻辑路径里的每一段单独编码，保留 / 分隔符 */
export function encodePath(p: string): string {
  const cleaned = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleaned) return "";
  return cleaned.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}

let singleton: CraterClient | undefined;

export function getClient(): CraterClient {
  singleton ??= new CraterClient();
  return singleton;
}
