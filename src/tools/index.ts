/**
 * 工具总表：按业务域聚合。
 * 新增工具只需在对应文件里往 specs 数组追加一条 ToolSpec。
 */
import type { ToolSpec } from "../registry.js";
import { specs as auth } from "./auth.js";
import { specs as profile } from "./profile.js";
import { specs as jobs } from "./jobs.js";
import { specs as images } from "./images.js";
import { specs as files } from "./files.js";
import { specs as resources } from "./resources.js";
import { specs as datasets } from "./datasets.js";
import { specs as admin } from "./admin.js";
import { specs as cli } from "./cli.js";
import { specs as feedback } from "./feedback.js";

export interface GroupSummary {
  group: string;
  count: number;
  tools: string[];
}

export const allSpecs: ToolSpec[] = [...auth, ...profile, ...jobs, ...images, ...files, ...resources, ...datasets, ...admin, ...cli, ...feedback];

export function summarize(): GroupSummary[] {
  const byGroup = new Map<string, string[]>();
  for (const spec of allSpecs) {
    const list = byGroup.get(spec.group) ?? [];
    list.push(spec.name);
    byGroup.set(spec.group, list);
  }
  return [...byGroup.entries()].map(([group, tools]) => ({ group, count: tools.length, tools }));
}

/** 启动时校验：工具名唯一、命名规范 */
export function validateSpecs(specs: ToolSpec[] = allSpecs): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const s of specs) {
    if (seen.has(s.name)) problems.push(`工具名重复：${s.name}`);
    seen.add(s.name);
    if (!/^crater_[a-z0-9_]+$/.test(s.name)) problems.push(`工具名不合规（应 crater_<group>_<action>）：${s.name}`);
    if (!s.description || s.description.length < 10) problems.push(`工具 ${s.name} 缺少可用描述`);
    if (!s.input && !s.run) problems.push(`工具 ${s.name} 既没有 input 也没有自定义实现`);
  }
  return problems;
}

export type { ToolSpec };
