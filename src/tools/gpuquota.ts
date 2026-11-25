/**
 * GPU 治理相关 MCP 工具：卡时额度、白名单、清退预览。
 *
 * 与后端 `/api/v1/gpuquota/*` 与 `/api/v1/admin/gpuquota/*` 对应。
 * 申请类工具默认走既有工单接口（type = gpu-hours / gpu-whitelist），审批通过后自动发券或写白名单。
 */
import { z } from "zod";

import type { ToolSpec } from "../registry.js";

export const specs: ToolSpec[] = [
  /* ---------------- 查询（只读） ---------------- */
  {
    name: "crater_gpu_quota_me",
    group: "gpuquota",
    title: "我的 GPU 额度与标签",
    description:
      "查询当前账号的 GPU 准入状态：是否在白名单（含卡数/并发/有效期）、本周卡时余额" +
      "（免审自动发放 / 审批发放分开统计，含今日与本周免审剩余）、以及名下 GPU 作业的活跃度标签。\n\n" +
      "典型用法：创建 GPU 作业前先查余额；作业被拒（HTTP 400 卡时不足）后查明原因。\n" +
      "注意：卡时按「人 + 账户」维度统计，切换账户后余额会不同。",
    method: "GET",
    path: "/api/v1/gpuquota/me",
    scope: "self",
    readOnly: true,
  },
  {
    name: "crater_gpu_whitelist_ls",
    group: "gpuquota",
    title: "GPU 白名单列表（管理员）",
    description:
      "分页列出 GPU 白名单成员（仅平台管理员）。白名单用户不受卡时限制，但仍受单作业卡数上限与并发上限约束；" +
      "申报了「稳定服务」的作业永不清退。\n\n" +
      "status 可选 active / expired / revoked，不传为全部。",
    method: "GET",
    path: "/api/v1/admin/gpuquota/whitelists",
    scope: "admin",
    readOnly: true,
    input: {
      status: z.string().optional().describe("状态过滤：active / expired / revoked，不传为全部"),
      page: z.number().int().min(1).optional().describe("页码，默认 1"),
      pageSize: z.number().int().min(1).max(200).optional().describe("每页条数，默认 20"),
    },
    query: ["status", "page", "pageSize"],
    body: "none",
  },
  {
    name: "crater_gpu_reclaim_preview",
    group: "gpuquota",
    title: "GPU 清退干跑预览（管理员）",
    description:
      "只读预览：计算当前 GPU 水位（已分配 / 节点 capacity），并按三档规则给出建议动作与可清退候选清单。\n\n" +
      "**不会通知、不会停止任何作业**。用于上线真回收前的评估，或回答「现在资源够不够 / 谁会被清退」。\n" +
      "tier 取值：normal | warmup（接近阈值）| reclaim-first（达阈值且有候选）| queue-alert（达阈值但无候选）。",
    method: "GET",
    path: "/api/v1/admin/gpuquota/reclaim/preview",
    scope: "admin",
    readOnly: true,
  },

  /* ---------------- 申请（写，走工单） ---------------- */
  {
    name: "crater_gpu_hours_apply",
    group: "gpuquota",
    title: "申请 GPU 卡时额度",
    description:
      "提交一张「卡时额度」工单，审批通过后卡时自动入账（写入本周凭证）。\n\n" +
      "什么时候需要：免审额度用尽时才申请。免审额度 = 1 卡且单作业 ≤2 卡时，每日 ≤2、每周 ≤10 卡时。\n" +
      "卡数 ≥2 或单作业 >2 卡时、或日/周免审额度用满时，必须走本申请。",
    method: "POST",
    path: "/api/v1/approvalorder",
    scope: "self",
    readOnly: false,
    input: {
      hours: z.number().min(0.5).max(720).describe("申请卡时数（卡数 × 小时），最小 0.5"),
      reason: z.string().min(1).describe("申请原因/用途，例如「跑 3 天训练，预计 24 卡时」"),
    },
    body: "none",
    run: async (args, ctx) => {
      const hours = Number(args.hours ?? 0);
      const reason = String(args.reason ?? "申请本周 GPU 卡时额度");
      const payload = {
        name: `GPU 卡时申请 ${new Date().toISOString().slice(0, 10)}`,
        type: "gpu-hours",
        approvalorderTypeID: 0,
        approvalOrderReason: reason,
        approvalOrderExtensionHours: 0,
        gpuHours: hours,
      };
      return ctx.client.request({
        method: "POST",
        path: "/api/v1/approvalorder",
        body: payload,
      });
    },
  },
  {
    name: "crater_gpu_whitelist_apply",
    group: "gpuquota",
    title: "申请 GPU 白名单",
    description:
      "提交一张「GPU 白名单」工单，审批通过后自动写入白名单（自由使用、不受卡时限制）。\n\n" +
      "白名单面向内部开发者长期使用；长期低利用率（24h 平均 <5%）的作业仍会被打标与清退，除非申报了稳定服务。",
    method: "POST",
    path: "/api/v1/approvalorder",
    scope: "self",
    readOnly: false,
    input: {
      maxGPU: z.number().int().min(1).max(8).optional().describe("单作业卡数上限，默认 2"),
      maxConcurrent: z.number().int().min(1).max(50).optional().describe("并发 GPU 作业上限，默认 3"),
      days: z.number().int().min(1).max(365).optional().describe("有效期（天），默认 90"),
      stableService: z.boolean().optional().describe("是否含稳定服务（对外服务，永不清退）"),
      reason: z.string().min(1).describe("申请原因/用途"),
    },
    body: "none",
    run: async (args, ctx) => {
      const payload = {
        name: `GPU 白名单申请 ${new Date().toISOString().slice(0, 10)}`,
        type: "gpu-whitelist",
        approvalorderTypeID: 0,
        approvalOrderReason: String(args.reason ?? "申请 GPU 白名单"),
        approvalOrderExtensionHours: 0,
        gpuMaxCards: Number(args.maxGPU ?? 2),
        gpuMaxConcurrent: Number(args.maxConcurrent ?? 3),
        gpuDays: Number(args.days ?? 90),
        gpuStableService: Boolean(args.stableService ?? false),
      };
      return ctx.client.request({
        method: "POST",
        path: "/api/v1/approvalorder",
        body: payload,
      });
    },
  },
];
