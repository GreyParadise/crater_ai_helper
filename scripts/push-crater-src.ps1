# 把 Crater 源码（_crater_src）推到你的 GitHub
#
# 前置：在 GitHub 上先建一个**空的私有仓库**（不要勾选 README/gitignore/License），
#      名字例如 crater，然后在这里执行：
#         .\scripts\push-crater-src.ps1 -Repo crater
#      可加 -Branch main（默认 main）或 -DryRun 先看要推什么。
#
# 说明：本机 Git 已能用 SSH 认证为 GreyParadise（git@github.com），无需再配 token。
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Owner = "GreyParadise",
  [string]$Branch = "main",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$src = Join-Path (Split-Path -Parent $PSScriptRoot) "..\_crater_src" | Resolve-Path
Write-Host "源码目录：$src"

Push-Location $src
try {
  if (-not (Test-Path ".git")) { throw "该目录还不是 git 仓库，先执行 git init -b main 并提交" }

  $url = "git@github.com:$Owner/$Repo.git"
  Write-Host "目标仓库：$url（分支 $Branch）"

  # 检查远端是否存在（空仓库也能列出来，失败则说明仓库还没建）
  $env:GIT_SSH_COMMAND = "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10"
  $probe = git ls-remote $url 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "无法访问 $url —— 请先在 GitHub 上创建该空仓库（私有即可），或确认名字/权限。`n$probe"
  }

  if ($DryRun) {
    Write-Host "`n[dry-run] 将推送的提交："
    git log --oneline -5
    Write-Host "`n[dry-run] 将推送的文件数：$((git ls-files | Measure-Object).Count)"
    return
  }

  git remote remove origin 2>$null
  git remote add origin $url
  git push -u origin $Branch

  Write-Host "`n推送完成。可以在 GitHub 上查看：https://github.com/$Owner/$Repo"
  git log --oneline -3
}
finally {
  Pop-Location
}
