/**
 * 工具注册器 —— 声明式定义 + 统一执行
 *
 * 一个 Crater 接口 ≈ 一条 ToolSpec。绝大多数工具走通用执行器（拼路径 / 透传 query / 组装 body），
 * 复杂场景（多步调用、二进制上传下载、本地文件读写）用 `run` 自定义实现。
 */
import { z } from "zod";
import type { CraterClient, RequestMethod } from "./client.js";
import { encodePath } from "./client.js";
import type { CraterConfig } from "./config.js";
import { CraterError, GuardError } from "./errors.js";
import { enforceGuards } from "./scope.js";

export type ToolScope = "public" | "self" | "account" | "admin";

export interface ToolContext {
  client: CraterClient;
  config: CraterConfig;
}

export interface ToolSpec {
  /** MCP 工具名：crater_<group>_<action>，只用小写字母/数字/下划线 */
  name: string;
  group: string;
  title: string;
  description: string;
  method: RequestMethod;
  /** 完整路径，可含 :param 与 *path 占位 */
  path: string;
  target?: "main" | "storage";
  scope: ToolScope;
  readOnly: boolean;
  destructive?: boolean;
  /** zod raw shape，用于向 agent 暴露参数 schema */
  input?: z.ZodRawShape;
  /** input 中哪些键用于替换路径占位符（顺序与占位符无关，按名字匹配） */
  pathParams?: string[];
  /** input 中哪些键作为 query 透传 */
  query?: string[];
  /** input 中哪些键作为 JSON body；"all" = 除 path/query 外的全部；"none" = 不带 body */
  body?: "all" | "none" | string[];
  /** 自定义实现，覆盖通用执行器 */
  run?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  /** 把后端返回裁剪成给 agent 的文本（默认 JSON 美化） */
  format?: (data: unknown, args: Record<string, unknown>) => string;
}

function fillPath(template: string, args: Record<string, unknown>, pathParams: string[]): string {
  let out = template;
  for (const key of pathParams) {
    const value = args[key];
    if (value === undefined || value === null || value === "") {
      throw new GuardError(`缺少路径参数 ${key}（工具 ${template}）`);
    }
    const str = String(value);
    const encoded = template.includes("*") && str.includes("/") ? encodePath(str) : encodeURIComponent(str);
    out = out.replace(new RegExp(`[:*]${key}\\b`), encoded);
  }
  if (/[:*][A-Za-z_]/.test(out)) {
    throw new GuardError(`路径模板未完全替换：${out}（可用参数：${pathParams.join(", ")}）`);
  }
  return out;
}

function buildQuery(args: Record<string, unknown>, keys: string[] | undefined): Record<string, string | number | boolean> | undefined {
  if (!keys?.length) return undefined;
  const q: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    const v = args[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      q[key] = v;
    } else if (Array.isArray(v)) {
      q[key] = v.join(",");
    } else {
      q[key] = JSON.stringify(v);
    }
  }
  return Object.keys(q).length ? q : undefined;
}

function buildBody(args: Record<string, unknown>, spec: ToolSpec): unknown {
  if (spec.body === "none" || spec.body === undefined) return undefined;
  const reserved = new Set<string>([...(spec.pathParams ?? []), ...(spec.query ?? [])]);
  if (spec.body === "all") {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (reserved.has(k)) continue;
      if (v === undefined) continue;
      body[k] = v;
    }
    return body;
  }
  const body: Record<string, unknown> = {};
  for (const key of spec.body) {
    const v = args[key];
    if (v === undefined) continue;
    body[key] = v;
  }
  return body;
}

export async function executeTool(spec: ToolSpec, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  enforceGuards({
    client: ctx.client,
    config: ctx.config,
    toolName: spec.name,
    method: spec.method,
    path: spec.path,
    scope: spec.scope,
    readOnly: spec.readOnly,
  });

  if (spec.run) return spec.run(args, ctx);

  const path = fillPath(spec.path, args, spec.pathParams ?? []);
  const query = buildQuery(args, spec.query);
  const body = buildBody(args, spec);
  return ctx.client.request({
    method: spec.method,
    path,
    query,
    body,
    target: spec.target ?? "main",
  });
}

export function defaultFormat(data: unknown): string {
  if (data === null || data === undefined) return "（后端返回空内容）";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/** 统一的错误 → 文本转换，保证 agent 拿到可读原因而不是堆栈 */
export function toErrorText(err: unknown, spec?: ToolSpec): string {
  if (err instanceof CraterError) return err.toToolError();
  if (err instanceof GuardError) return err.message;
  if (err instanceof Error) {
    return `${spec ? `工具 ${spec.name} ` : ""}执行失败：${err.message}`;
  }
  return `执行失败：${String(err)}`;
}

/** 常用 zod 片段，保证各工具组风格一致 */
export const Z = {
  /** 作业名/镜像名/用户名等精确标识 */
  name: (what: string) => z.string().min(1).describe(what),
  page: z.number().int().min(1).optional().describe("分页页码，从 1 开始"),
  pageSize: z.number().int().min(1).max(200).optional().describe("每页条数，最大 200"),
  optionalBool: z.boolean().optional(),
} as const;
