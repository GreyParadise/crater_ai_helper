/**
 * Crater API 错误模型。
 *
 * 后端事实（见 docs/api-inventory.md §1.3）：
 * - 401 TokenInvalid / TokenExpired：token 失效或权限快照过期（非 GET 请求会回库比对角色，降权后旧 token 立即 401）
 * - 403：用户被封禁（RequireCapability 失败），或注册关闭
 * - 400：参数绑定失败；409：用户名已存在；404：资源不存在
 *
 * 因此 MCP 侧的处置策略是：401 → 先 refresh，再失败则整轮重新 login，然后重试一次。
 */
export class CraterError extends Error {
  readonly status: number;
  /** 后端业务错误码（若响应体里带 code 字段） */
  readonly code?: string | number;
  readonly path: string;
  readonly method: string;
  /** 给调用者（agent）的可执行建议 */
  readonly hint?: string;
  readonly body?: unknown;

  constructor(opts: {
    message: string;
    status: number;
    path: string;
    method: string;
    code?: string | number;
    hint?: string;
    body?: unknown;
  }) {
    super(opts.message);
    this.name = "CraterError";
    this.status = opts.status;
    this.code = opts.code;
    this.path = opts.path;
    this.method = opts.method;
    this.hint = opts.hint;
    this.body = opts.body;
  }

  toToolError(): string {
    const parts = [`${this.method} ${this.path} 失败（HTTP ${this.status}）：${this.message}`];
    if (this.code !== undefined) parts.push(`业务码：${this.code}`);
    if (this.hint) parts.push(`建议：${this.hint}`);
    return parts.join("\n");
  }
}

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

export function hintForStatus(status: number, method: string): string | undefined {
  switch (status) {
    case 400:
      return "请求参数不符合后端 binding 校验。检查必填项（字符串不能为空、数字不能为 0、布尔值需显式传）。";
    case 401:
      return "身份或权限快照失效。已自动尝试 refresh / 重新登录；若仍失败，请确认账号密码正确、且你在该账号（项目）里的访问模式未被改成只读。";
    case 403:
      return "账号被封禁或缺少该能力（JobSubmission / ImageBuild / ModelDownload / DatasetDownload），也可能是平台关闭了注册。联系管理员。";
    case 404:
      return "资源不存在，或路径里的名字写错（作业名/镜像名/用户名都是精确匹配）。";
    case 409:
      return "资源状态冲突（同名已存在、目录不可用、任务状态不允许等）。后端消息里通常写明具体原因，按它调整；传输类 409 常见于父目录不存在。";
    case 413:
      return "文件或请求体过大，超出平台限制。";
    case 422:
      return "参数语义不合法（服务端校验未通过）。";
    case 429:
      return "触发限流，稍后重试。";
    case 500:
    case 502:
    case 503:
      return `后端或集群侧出错（常见原因：路径/记录不存在、权限不足、k8s 资源状态异常）。` +
        `先看后端消息里的原文；${method === "GET" ? "若是 no such file / not found 类信息，先确认路径或资源是否已创建" : "写操作请先用查询工具确认最终状态，避免重复提交"}`;
    default:
      return undefined;
  }
}
