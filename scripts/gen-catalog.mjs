#!/usr/bin/env node
/**
 * 从编译产物生成工具目录文档：docs/tool-catalog.md
 * 用法：npm run build && node scripts/gen-catalog.mjs
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist", "tools", "index.js");
const out = join(here, "..", "docs", "tool-catalog.md");

const mod = await import(`file://${dist.replace(/\\/g, "/")}?t=${Date.now()}`);
const specs = mod.allSpecs;

const SCOPE_LABEL = {
  public: "公开（免登录）",
  self: "仅本人",
  account: "账号内",
  admin: "管理员",
};

const byGroup = new Map();
for (const s of specs) {
  const arr = byGroup.get(s.group) ?? [];
  arr.push(s);
  byGroup.set(s.group, arr);
}

const destructive = specs.filter((s) => s.destructive);
const writes = specs.filter((s) => !s.readOnly);

const lines = [
  "# Crater MCP 工具目录",
  "",
  `> 自动生成（\`scripts/gen-catalog.mjs\`），共 **${specs.length}** 个工具：只读 ${specs.length - writes.length} 个，写 ${writes.length} 个（其中 destructive ${destructive.length} 个）。`,
  "> 每个工具都以调用者的 Crater JWT 身份请求后端，权限与网页端一致。",
  "",
  "## 总览",
  "",
  "| 域 | 工具数 | 写操作 | 说明 |",
  "| --- | --- | --- | --- |",
];

const GROUP_DESC = {
  auth: "登录、注册、身份确认、切换账号（项目）、token 续期",
  profile: "资料完善、邮箱验证、账单摘要、配额占用",
  jobs: "课程作业：创建（WebIDE/Jupyter/PyTorch/TF/自定义）、查询、日志、启停、入口凭据",
  images: "镜像构建（kaniko/Dockerfile/envd）、查询、共享、删除",
  files: "文件管理：列目录、上传、下载、删除、移动、建目录、用量",
  resources: "资源型号、节点、单价、上下文与资源预检（只读）",
  datasets: "数据集创建、更新、删除、分享、成员",
  admin: "管理端：用户、账号、资源、节点、系统配置、队列配额、运维、审批、GPU 分析",
  cli: "官方 crater CLI 透传（只读 / 写两档，含模型下载、审批工单、Pod 诊断、兼容性检查）",
};

for (const [group, arr] of byGroup) {
  lines.push(
    `| \`${group}\` | ${arr.length} | ${arr.filter((s) => !s.readOnly).length} | ${GROUP_DESC[group] ?? ""} |`,
  );
}

lines.push("", "## destructive 工具（客户端应要求人类确认）", "", "| 工具 | 接口 | 说明 |", "| --- | --- | --- |");
for (const s of destructive) {
  lines.push(`| \`${s.name}\` | \`${s.method} ${s.path}\` | ${s.title} |`);
}

for (const [group, arr] of byGroup) {
  lines.push("", `## ${group}`, "", "| 工具 | 方法 | 路径 | 作用域 | 读/写 | 说明 |", "| --- | --- | --- | --- | --- | --- |");
  for (const s of arr) {
    const rw = s.readOnly ? "只读" : s.destructive ? "**写（destructive）**" : "写";
    const desc = s.description.replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 160);
    lines.push(`| \`${s.name}\` | ${s.method} | \`${s.path}\` | ${SCOPE_LABEL[s.scope] ?? s.scope} | ${rw} | ${desc} |`);
  }
  lines.push("", "<details><summary>参数与完整描述</summary>", "");
  for (const s of arr) {
    lines.push(`### \`${s.name}\` — ${s.title}`, "", `- 接口：\`${s.method} ${s.path}\`` + (s.target === "storage" ? "（storage-server）" : ""));
    lines.push(`- 作用域：${SCOPE_LABEL[s.scope] ?? s.scope}；${s.readOnly ? "只读" : "写操作"}${s.destructive ? "（destructive）" : ""}`);
    lines.push("", "```text", s.description, "```", "");
    if (s.input && Object.keys(s.input).length) {
      lines.push("| 参数 | 说明 |", "| --- | --- |");
      for (const [k, v] of Object.entries(s.input)) {
        const anyV = v;
        const d = anyV?.description ?? (anyV?._def?.description ?? "");
        const opt = anyV?.isOptional?.() ? "（可选）" : "";
        lines.push(`| \`${k}\`${opt} | ${String(d).replace(/\|/g, "\\|") || "—"} |`);
      }
      lines.push("");
    } else {
      lines.push("_无参数_", "");
    }
  }
  lines.push("</details>", "");
}

await writeFile(out, lines.join("\n"), "utf8");
console.log(`已生成 ${out}：${specs.length} 个工具（${byGroup.size} 个域，destructive ${destructive.length} 个）`);
