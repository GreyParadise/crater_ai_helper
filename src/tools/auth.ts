/**
 * 组：auth —— 登录 / 注册 / 身份确认 / 切换账号（项目）
 * 对应接口：docs/api-inventory.md §3.1
 */
import { z } from "zod";
import type { ToolSpec } from "../registry.js";

export const specs: ToolSpec[] = [
  {
    name: "crater_auth_whoami",
    group: "auth",
    title: "我是谁 / 当前身份与上下文",
    description:
      "返回当前 MCP 使用的 Crater 身份：用户 ID、用户名、平台角色、当前账号（项目）名、账号内角色与访问模式、" +
      "用户空间路径，以及后端版本。做任何写操作前建议先调用它确认身份与访问模式（只读模式会阻止写入）。",
    method: "GET",
    path: "/api/auth/check",
    scope: "public",
    readOnly: true,
    input: {},
    run: async (_args, ctx) => {
      const data = (await ctx.client.request({
        method: "GET",
        path: "/api/auth/check",
      })) as Record<string, unknown> | null;
      const ROLE: Record<number, string> = { 1: "guest", 2: "user", 3: "admin" };
      const ACCESS: Record<number, string> = { 1: "NA", 2: "ReadOnly", 3: "ReadWrite", 4: "AdminOnly" };
      const info = ctx.client.info;
      return {
        mcp: {
          baseUrl: ctx.config.baseUrl,
          readOnlyMode: ctx.config.readOnly,
          allowAdminTools: ctx.config.allowAdmin,
          enforceSelfScope: ctx.config.enforceSelfScope,
        },
        session: {
          username: info.username,
          userId: info.userId,
          accountName: info.accountName,
          accountId: info.accountId,
          rolePlatform: info.rolePlatform,
          rolePlatformName: info.rolePlatform ? ROLE[info.rolePlatform] : undefined,
          roleAccount: info.roleAccount,
          accessMode: info.accessMode,
          accessModeName: info.accessMode ? ACCESS[info.accessMode] : undefined,
          space: info.space,
          tokenExpiresAt: info.expiresAt?.toISOString(),
        },
        context: (data as { context?: unknown })?.context ?? null,
        user: (data as { user?: unknown })?.user ?? null,
        version: (data as { version?: unknown })?.version ?? null,
      };
    },
  },
  {
    name: "crater_auth_login",
    group: "auth",
    title: "登录（可指定账号，会切换本进程身份）",
    description:
      "用给定的用户名密码登录 Crater，并让后续所有工具调用都使用该身份。通常你不需要它——" +
      "MCP 启动时已用配置里的凭证自动登录；它主要用于『刚注册完的账号立刻登录』或临时切换身份。" +
      "注意：切换后这个 MCP 进程就不再代表原来的用户了。",
    method: "POST",
    path: "/api/auth/login",
    scope: "public",
    readOnly: false,
    input: {
      username: z.string().min(1).describe("Crater 登录名"),
      password: z.string().min(1).describe("Crater 密码（只在本地进程内使用，不会回显）"),
      account: z.string().optional().describe("登录后要切换到的账号（项目）名，如 q-3；不填用默认账号"),
    },
    run: async (args, ctx) => {
      const username = String(args.username);
      const password = String(args.password);
      await ctx.client.login({ username, password });
      const account = args.account ? String(args.account) : undefined;
      if (account) await ctx.client.switchAccount(account);
      const info = ctx.client.info;
      return {
        ok: true,
        username: info.username,
        accountName: info.accountName,
        rolePlatform: info.rolePlatform,
        accessMode: info.accessMode,
        space: info.space,
      };
    },
  },
  {
    name: "crater_auth_signup",
    group: "auth",
    title: "注册新用户",
    description:
      "调用 Crater 的开放注册接口创建账号。注意：是否允许注册由平台配置决定（关闭时返回 403），用户名重复返回 409。" +
      "注册成功**不会**自动登录，需要再调用 crater_auth_login。",
    method: "POST",
    path: "/api/auth/signup",
    scope: "public",
    readOnly: false,
    input: {
      username: z.string().min(1).describe("想要的登录名"),
      password: z.string().min(1).describe("密码"),
    },
    body: "all",
    format: () => "注册请求已提交成功。请调用 crater_auth_login 用新账号登录；新用户默认角色可能是 guest，需管理员升级为 user 才能提交作业。",
  },
  {
    name: "crater_auth_mode",
    group: "auth",
    title: "查询认证模式（是否开放注册 / 是否启用 LDAP）",
    description: "返回平台允许的认证方式与注册开关，用于判断能否自助注册、以及该用 normal 还是 ldap 登录。",
    method: "GET",
    path: "/api/auth/mode",
    scope: "public",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_auth_switch_account",
    group: "auth",
    title: "切换账号（项目）",
    description:
      "把当前会话切到你所属的另一个账号（Crater 里叫 queue/项目，例如 default、q-3）。" +
      "切换后后端会签发新 token，MCP 会自动换用新 token——这一步很重要，旧 token 里的账号权限是过期的。" +
      "只能切到自己有 user_account 记录的账号。",
    method: "POST",
    path: "/api/v1/auth/switch",
    scope: "self",
    readOnly: false,
    input: {
      account: z.string().min(1).describe("目标账号名（项目名）"),
    },
    run: async (args, ctx) => {
      await ctx.client.switchAccount(String(args.account));
      const info = ctx.client.info;
      return {
        ok: true,
        accountName: info.accountName,
        accountId: info.accountId,
        roleAccount: info.roleAccount,
        accessMode: info.accessMode,
        space: info.space,
      };
    },
  },
  {
    name: "crater_auth_refresh_token",
    group: "auth",
    title: "刷新当前 token",
    description:
      "用 refreshToken 换一对新 token（一般不需要手动调用：客户端在收到 401 时会自动 refresh，" +
      "refresh 失败再整轮重新登录）。当你在调试『写操作报 401』时可以用它手动续期。",
    method: "POST",
    path: "/api/auth/refresh",
    scope: "self",
    readOnly: false,
    input: {},
    run: async (_args, ctx) => {
      await ctx.client.refresh();
      return { ok: true, tokenExpiresAt: ctx.client.info.expiresAt?.toISOString() };
    },
  },
];
