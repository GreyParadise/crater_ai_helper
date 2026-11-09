/**
 * 组：feedback —— 平台问题反馈（Agent 遇到平台故障时自动向管理员汇报的通道）
 *
 * 对应后端（自研，2026-11 新增）：
 *   - `POST /api/v1/feedback`        提交反馈（任何已登录用户）
 *   - `GET  /api/v1/feedback/mine`   我提交的反馈（含管理员回复）
 *   - `GET/PUT /api/v1/admin/feedback` 管理员侧（不在本组，属 admin 档）
 *   实现在 backend/internal/handler/feedback.go，表 model.Feedback（feedbacks）。
 *
 * 定位：这是给 agent 用的「故障上报」通道，不是给用户发牢骚的入口（那是网页端 /portal/more/feedback）。
 * 设计要点：
 *   1. `auto: true` 时标题自动加 `[Agent 自动汇报]` 前缀，管理员可按前缀过滤；
 *   2. 客户端侧去重：同一故障签名（类型+标题+正文前 120 字）30 分钟内只提交一次，避免 agent 死循环刷屏；
 *   3. 频率上限：每小时最多 6 条，超了直接拒绝并提示合并上报；
 *   4. **提交前脱敏**：password / token / secret / Authorization / JWT 形态的串会被替换成 ***，
 *      避免把凭据写进反馈库（反馈内容是会被管理员看到的）。
 */
import { z } from "zod";
import type { ToolContext, ToolSpec } from "../registry.js";

const FEEDBACK = "/api/v1/feedback";
const FEEDBACK_MINE = "/api/v1/feedback/mine";

/** 去重与限流状态（进程内，随 MCP 实例生命周期） */
const DEDUP_WINDOW_MS = 30 * 60 * 1000;
const HOURLY_LIMIT = 6;
const submitted = new Map<string, number>(); // signature -> ts
const history: number[] = []; // 提交时间戳

/** 提交前脱敏：凭据不进反馈库 */
function redact(text: string): string {
  return text
    .replace(/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, "<JWT-已脱敏>")
    .replace(/\b(password|passwd|pwd|token|secret|apikey|api_key|authorization)\b(\s*[:=]\s*)(\S+)/gi, "$1$2***")
    .replace(/\bBearer\s+\S+/gi, "Bearer ***");
}

function signature(category: string, title: string, content: string): string {
  return `${category}::${title.trim()}::${content.trim().slice(0, 120)}`;
}

export const specs: ToolSpec[] = [
  {
    name: "crater_feedback_submit",
    group: "feedback",
    title: "向管理员提交平台故障反馈",
    description:
      "当你确认是**平台侧故障**（不是自己参数写错）时提交一条反馈给管理员，例如：接口 5xx / 网关 502 / 长时间超时、" +
      "作业卡在 Pending 而节点与配额都正常、镜像构建异常失败、文件系统 403 而权限看起来正常、页面数据明显与集群不符。" +
      "**不要**用它提交：用户参数错误、配额不足、权限不足、自己想问的功能用法（那些直接告诉用户即可）。" +
      "auto=true 时标题会自动加「[Agent 自动汇报]」前缀；同一故障 30 分钟内只报一次，每小时最多 6 条；" +
      "内容会自动脱敏（password/token/JWT 等替换成 ***）。提交后请把反馈编号告诉用户，并继续给出可行的替代方案或绕过方式。",
    method: "POST",
    path: FEEDBACK,
    scope: "self",
    readOnly: false,
    input: {
      category: z
        .enum(["bug", "feature", "question", "other"])
        .describe("反馈类型：平台故障用 bug；能力缺失/改进建议用 feature；用法疑问用 question；其它用 other"),
      title: z.string().min(4).max(110).describe("一句话说明现象，例如：镜像构建接口返回 502"),
      content: z
        .string()
        .min(10)
        .max(3800)
        .describe(
          "详细描述，建议包含：① 触发操作与工具名 ② 报错原文（HTTP 状态码/错误码/关键信息）" +
            " ③ 涉及对象（作业名 jobName、镜像名、文件路径） ④ 发生时间 ⑤ 已做过的排查 ⑥ 期望行为"
        ),
      contact: z.string().max(180).optional().describe("可选：方便回访的联系方式"),
      auto: z.boolean().optional().describe("是否由 agent 自动上报（true 时标题自动加 [Agent 自动汇报] 前缀）"),
      pageUrl: z.string().max(400).optional().describe("可选：相关页面路径，例如 /portal/jobs/detail"),
    },
    body: "none",
    run: async (args, ctx: ToolContext) => {
      const category = String(args.category ?? "bug");
      const auto = args.auto === true;
      const titleBase = String(args.title ?? "").trim();
      const title = auto ? `[Agent 自动汇报] ${titleBase}`.slice(0, 110) : titleBase.slice(0, 110);
      const content = redact(String(args.content ?? "").trim());

      // 去重：30 分钟内同一签名只报一次
      const sig = signature(category, titleBase, content);
      const now = Date.now();
      const last = submitted.get(sig);
      if (last && now - last < DEDUP_WINDOW_MS) {
        const mins = Math.ceil((DEDUP_WINDOW_MS - (now - last)) / 60000);
        return {
          skipped: true,
          reason: `同一故障在 30 分钟内已上报过（约 ${mins} 分钟后可再次上报），本次未重复提交，避免刷屏。`,
        };
      }

      // 限流：每小时 6 条
      while (history.length && now - (history[0] ?? 0) > 60 * 60 * 1000) history.shift();
      if (history.length >= HOURLY_LIMIT) {
        return {
          skipped: true,
          reason: `本小时内已提交 ${history.length} 条反馈（上限 ${HOURLY_LIMIT}），请先把多个问题合并成一条再报，或直接联系管理员。`,
        };
      }

      const body: Record<string, unknown> = { category, title, content };
      if (args.contact) body.contact = String(args.contact).slice(0, 180);
      if (args.pageUrl) body.pageUrl = String(args.pageUrl).slice(0, 400);

      const created = await ctx.client.request({ method: "POST", path: FEEDBACK, body });
      submitted.set(sig, now);
      history.push(now);

      const rec = created as { id?: number; title?: string; status?: string };
      return {
        submitted: true,
        id: rec?.id,
        title: rec?.title ?? title,
        status: rec?.status ?? "open",
        hint: `已向管理员提交反馈 #${rec?.id ?? "?"}（状态：待处理）。管理员的回复会出现在 crater_feedback_mine 里；` +
          "请同步告诉用户反馈编号，并继续给出可行的替代做法。",
      };
    },
  },
  {
    name: "crater_feedback_mine",
    group: "feedback",
    title: "查看我提交过的反馈与管理员回复",
    description:
      "列出当前用户提交过的反馈（最近 100 条），包含状态（open 待处理 / in_progress 处理中 / closed 已处理）与管理员回复。" +
      "适用于：上报故障后想确认是否已被处理；用户问「上次那个问题怎么样了」；上报前检查是否已经报过同一问题。",
    method: "GET",
    path: FEEDBACK_MINE,
    scope: "self",
    readOnly: true,
    input: {
      onlyUnresolved: z
        .boolean()
        .optional()
        .describe("true 时只返回未处理/处理中的反馈（status != closed）"),
    },
    body: "none",
    run: async (args, ctx: ToolContext) => {
      const data = await ctx.client.request({ method: "GET", path: FEEDBACK_MINE });
      const list = Array.isArray(data) ? data : [];
      const onlyUnresolved = args.onlyUnresolved === true;
      const rows = (list as Array<Record<string, unknown>>)
        .filter((x) => (onlyUnresolved ? x.status !== "closed" : true))
        .map((x) => ({
          id: x.id,
          category: x.category,
          title: x.title,
          status: x.status,
          createdAt: x.createdAt,
          adminReply: x.adminReply || undefined,
          repliedAt: x.repliedAt || undefined,
        }));
      return { total: rows.length, items: rows };
    },
  },
];
