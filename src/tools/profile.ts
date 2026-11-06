/**
 * 组：profile —— 用户信息完善 / 邮箱验证 / 封禁状态
 * 对应接口：docs/api-inventory.md §3.2
 *
 * 重要事实：Crater **没有** PUT /api/v1/users/:id。
 * 用户自助改资料走 PUT /api/v1/context/attributes（整体覆盖写，ID/UID/GID 被强制回填为旧值）。
 */
import { z } from "zod";
import type { ToolSpec } from "../registry.js";

const attributeShape = {
  nickname: z.string().optional().describe("昵称（不填则与登录名相同）"),
  email: z.string().optional().describe("邮箱"),
  phone: z.string().optional().describe("电话"),
  teacher: z.string().optional().describe("导师/老师"),
  group: z.string().optional().describe("课题组"),
  avatar: z.string().optional().describe("头像地址"),
};

export const specs: ToolSpec[] = [
  {
    name: "crater_profile_get",
    group: "profile",
    title: "查看我的资料",
    description: "返回当前登录用户的资料（昵称、邮箱、电话、导师、课题组等）以及邮箱是否已验证、是否被封禁。",
    method: "GET",
    path: "/api/auth/check",
    scope: "self",
    readOnly: true,
    input: {},
    run: async (_args, ctx) => {
      const check = (await ctx.client.request({ method: "GET", path: "/api/auth/check" })) as {
        user?: unknown;
        context?: unknown;
      } | null;
      const emailVerified = await ctx.client
        .request<unknown>({ method: "GET", path: "/api/v1/users/email/verified" })
        .catch((e) => ({ error: String(e) }));
      const ban = await ctx.client
        .request<unknown>({ method: "GET", path: "/api/v1/users/ban" })
        .catch((e) => ({ error: String(e) }));
      return { user: check?.user ?? null, context: check?.context ?? null, emailVerified, ban };
    },
  },
  {
    name: "crater_profile_update",
    group: "profile",
    title: "完善/修改我的资料",
    description:
      "整体覆盖写用户资料（Crater 的 PUT /api/v1/context/attributes）。**只传你想改的字段**，" +
      "未传的字段会被后端置空（这是整体覆盖语义），所以建议先 crater_profile_get 拿到现有值，" +
      "把要保留的字段一起回传。ID/UID/GID 由后端强制保持原值，改不了。",
    method: "PUT",
    path: "/api/v1/context/attributes",
    scope: "self",
    readOnly: false,
    input: attributeShape,
    run: async (args, ctx) => {
      // 先取旧值，实现「只传增量」的安全语义
      const check = (await ctx.client.request({ method: "GET", path: "/api/auth/check" })) as {
        user?: Record<string, unknown>;
      } | null;
      const old = (check?.user ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {
        id: old.id,
        name: old.name,
        nickname: old.nickname,
        email: old.email,
        phone: old.phone,
        teacher: old.teacher,
        group: old.group,
        avatar: old.avatar,
      };
      for (const key of Object.keys(attributeShape)) {
        const v = args[key];
        if (v !== undefined && v !== "") body[key] = v;
      }
      const res = await ctx.client.request({
        method: "PUT",
        path: "/api/v1/context/attributes",
        body,
      });
      return { ok: true, sent: body, response: res };
    },
  },
  {
    name: "crater_profile_send_email_code",
    group: "profile",
    title: "发送邮箱验证码",
    description:
      "给指定邮箱发 6 位验证码，用于证明邮箱归属。注意：验证码存在后端进程内存里（多副本不共享），" +
      "如果平台有多个后端副本而请求落到别的副本，验证可能失败——此时重试一次通常即可。",
    method: "POST",
    path: "/api/v1/context/email/code",
    scope: "self",
    readOnly: false,
    input: { email: z.string().email().describe("要验证的邮箱地址") },
    body: "all",
  },
  {
    name: "crater_profile_verify_email",
    group: "profile",
    title: "提交邮箱验证码",
    description:
      "提交邮箱 + 验证码完成验证。成功后只写入「已验证时间戳」，**不会**把邮箱写进资料表，" +
      "所以还需要调用 crater_profile_update 把 email 字段更新过去。",
    method: "POST",
    path: "/api/v1/context/email/update",
    scope: "self",
    readOnly: false,
    input: {
      email: z.string().email().describe("邮箱地址"),
      code: z.string().min(1).describe("收到的验证码"),
    },
    body: "all",
  },
  {
    name: "crater_profile_accounts",
    group: "profile",
    title: "我所属的账号（项目）列表",
    description: "列出当前用户加入的账号（项目），可用于挑选 crater_auth_switch_account 的目标。",
    method: "GET",
    path: "/api/v1/accounts",
    scope: "self",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_profile_billing_summary",
    group: "profile",
    title: "我的账单摘要",
    description: "返回当前账号下的账单/用量摘要（当前上下文维度）。",
    method: "GET",
    path: "/api/v1/context/billing/summary",
    scope: "self",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_profile_quota",
    group: "profile",
    title: "我的配额与已用资源",
    description: "返回当前账号/队列的配额、以及我当前占用的 GPU/CPU/内存汇总，便于在提交作业前判断能不能排上。",
    method: "GET",
    path: "/api/v1/context/job-resource-summary",
    scope: "self",
    readOnly: true,
    input: {},
  },
];
