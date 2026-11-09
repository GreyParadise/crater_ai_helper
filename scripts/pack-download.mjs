// 生成门户「MCP 接入指南」页面的下载包：把当前 HEAD 的仓库打成 zip
// （等同 GitHub 的 Code → Download ZIP），放到 frontend/public/downloads/，
// 文件名固定 crater-mcp.zip —— 页面链接不变，MCP 更新后重跑本脚本即可替换包体。
//
// 用法：node scripts/pack-download.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const downloads = path.resolve(root, "..", "_crater_src", "frontend", "public", "downloads");
fs.mkdirSync(downloads, { recursive: true });

const zipPath = path.join(downloads, "crater-mcp.zip");
fs.rmSync(zipPath, { force: true });

const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim();
const date = execFileSync("git", ["log", "-1", "--format=%cs"], { cwd: root }).toString().trim();
console.log(`→ 打包 HEAD=${head}（${date}）…`);

execFileSync(
  "git",
  ["archive", "--format=zip", "--prefix=crater-mcp/", "-o", zipPath, "HEAD"],
  { cwd: root, stdio: "inherit" }
);

const bytes = fs.statSync(zipPath).size;
const sha256 = createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
fs.writeFileSync(path.join(downloads, "crater-mcp.zip.sha256"), `${sha256}  crater-mcp.zip\n`);

console.log(`\n✅ ${zipPath}`);
console.log(`   ${(bytes / 1024).toFixed(0)} KB   sha256:${sha256.slice(0, 24)}…`);
console.log(`   页面链接：/downloads/crater-mcp.zip （固定不变，内容随本次提交更新）`);
