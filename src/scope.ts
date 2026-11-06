/**
 * 作用域守卫 —— MCP 的「第四道闸」
 *
 * 后端本身有四道闸（JWT / 封禁 / 非 GET 回库校验 / handler 内 UserID 过滤），
 * 但 `docs/api-inventory.md` §4.2-D 指出一批 **Protected 但不校验归属** 的接口，
 * 它们会把「别人的数据」甚至「集群任意 Pod 的 shell」暴露给任何已登录用户。
 *
 * 本文件的作用：在 MCP 这一层显式封掉/收窄这些接口，保证「AI 只在账号用户权限内动作」。
 */
import type { CraterClient } from "./client.js";
import type { CraterConfig } from "./config.js";
import { GuardError } from "./errors.js";
import type { RequestMethod } from "./client.js";

interface LooseRule {
  name: string;
  test: (method: RequestMethod, path: string) => boolean;
  reason: string;
}

/**
 * 「比预期更宽松」的接口清单。非管理员调用时直接拒绝（除非用户显式关掉 CRATER_ENFORCE_SELF_SCOPE）。
 */
const LOOSE_RULES: LooseRule[] = [
  {
    name: "vcjobs-all",
    test: (m, p) => m === "GET" && /^\/api\/v1\/vcjobs\/(all|billing\/all)(\/|$)/.test(p),
    reason: "GET /api/v1/vcjobs/all 会列出全平台作业（后端不按调用者过滤）",
  },
  {
    name: "vcjobs-by-user",
    test: (m, p) => m === "GET" && /^\/api\/v1\/vcjobs\/user\//.test(p),
    reason: "GET /api/v1/vcjobs/user/:username 可枚举任意用户作业（resolveJobUserScope 不校验调用者）",
  },
  {
    name: "aijobs-all",
    test: (m, p) => m === "GET" && /^\/api\/v1\/aijobs\/all(\/|$)/.test(p),
    reason: "GET /api/v1/aijobs/all 走 ListAll()，跨账号可见",
  },
  {
    name: "statistics-broad",
    test: (m, p) => m === "GET" && /^\/api\/v1\/statistics(\/|$)/.test(p),
    reason: "GET /api/v1/statistics 支持跨用户统计（scope 参数），非管理员只能用自己维度的子集",
  },
  {
    name: "nodes-mutate",
    test: (m, p) => m === "PUT" && /^\/api\/v1\/nodes\//.test(p),
    reason: "PUT /api/v1/nodes/:name 能改节点调度状态，后端却只挂在 Protected 档",
  },
  {
    name: "namespace-ops",
    // 例外：容器日志读取（GET .../containers/:c/log）是「看自己作业日志」的唯一真实路径
    // （线上没有 /api/v1/vcjobs/:name/logs）。该路径由 crater_jobs_logs 工具自己校验
    // 「pod 属于调用者的作业」后才调用，见 src/tools/jobs.ts 的 run 实现。
    // 终端（terminal）、pod 列表、ingress/nodeport 等仍然一律封死。
    test: (_m, p) =>
      /^\/api\/v1\/namespaces\//.test(p) &&
      !/^\/api\/v1\/namespaces\/[^/]+\/pods\/[^/]+\/containers\/[^/]+\/log$/.test(p),
    reason: "namespaces/** 暴露 Pod 级操作（含 terminal 终端与任意 Pod 日志），后端源码留有「未校验 pod 权限」的 TODO",
  },
  {
    name: "dataset-detail",
    test: (m, p) => m === "GET" && /^\/api\/v1\/dataset\/detail\//.test(p),
    reason: "GET /api/v1/dataset/detail/:id 只按 ID 查，不校验归属",
  },
];

export interface GuardInput {
  client: CraterClient;
  config: CraterConfig;
  toolName: string;
  method: RequestMethod;
  path: string;
  scope: "public" | "self" | "account" | "admin";
  readOnly: boolean;
}

export function enforceGuards(input: GuardInput): void {
  const { client, config, toolName, method, path, scope, readOnly } = input;

  // 1) 全局只读闸
  if (config.readOnly && !readOnly) {
    throw new GuardError(
      `当前 MCP 处于只读模式（CRATER_READ_ONLY=true），工具 ${toolName} 属于写操作，已拒绝。` +
        `如需执行，请在你的 MCP 配置里把 CRATER_READ_ONLY 改为 false 后重启。`,
    );
  }

  // 2) 管理端闸：admin 组工具非管理员一律拒绝
  if (scope === "admin" && !client.isAdmin) {
    throw new GuardError(
      `工具 ${toolName} 属于管理端接口（/api/v1/admin/**），当前登录用户 ${client.username ?? "(未知)"} ` +
        `平台角色不是管理员（rolePlatform=${client.info.rolePlatform ?? "?"}），已拒绝。`,
    );
  }

  // 3) 宽接口闸：非管理员不得触达「后端不做归属校验」的接口
  if (config.enforceSelfScope && !client.isAdmin) {
    for (const rule of LOOSE_RULES) {
      if (rule.test(method, path)) {
        throw new GuardError(
          `工具 ${toolName} 命中了后端的「宽接口」：${rule.reason}。\n` +
            `为避免越权，非管理员在下不会调用该接口。请改用只返回你自己数据的替代工具` +
            `（例如 jobs_list 只列自己的作业）。若你确实是管理员，请用管理员账号登录；` +
            `如需临时放开，可设置 CRATER_ENFORCE_SELF_SCOPE=false。`,
        );
      }
    }
  }
}

/** 账号内只读时禁止写操作（后端 RO 会 403，这里提前给出可读原因） */
export function assertWritableAccount(client: CraterClient, toolName: string): void {
  const am = client.info.accessMode;
  // 1=NA 2=RO 3=RW 4=AO；只拦截明确的 RO
  if (am === 2) {
    throw new GuardError(
      `当前账号（${client.accountName ?? "?"}）里的访问模式是只读（ReadOnly），工具 ${toolName} 无法写入。` +
        `请联系账号管理员调整你的访问模式。`,
    );
  }
}

/** 是否允许使用「全平台」类查询工具的提示文案 */
export const SCOPE_NOTE =
  "所有工具都以当前登录用户的 JWT 身份调用 Crater，权限与你在网页端完全一致；" +
  "MCP 不会、也不能绕过 Crater 的鉴权。";
