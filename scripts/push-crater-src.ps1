# Push the Crater source tree (_crater_src) to a GitHub repo over SSH.
#
# Precondition: create an EMPTY private repo on GitHub first (no README/gitignore/license),
# then run:
#     .\scripts\push-crater-src.ps1 -Repo crater_local
# Options: -Owner (default GreyParadise) -Branch (default main) -DryRun
#
# This machine's git already authenticates as GreyParadise via SSH, no token needed.
# NOTE: kept ASCII-only on purpose - Windows PowerShell 5.1 reads BOM-less files as ANSI
#       and would garble any non-ASCII characters in the script.
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Owner = "GreyParadise",
  [string]$Branch = "main",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$src = Join-Path (Split-Path -Parent $PSScriptRoot) "..\_crater_src" | Resolve-Path
Write-Host "source dir: $src"

Push-Location $src
try {
  if (-not (Test-Path ".git")) { throw "not a git repo yet: run 'git init -b main' and commit first" }

  $url = "git@github.com:$Owner/$Repo.git"
  Write-Host "remote: $url (branch $Branch)"
  $env:GIT_SSH_COMMAND = "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15"

  $probe = git ls-remote $url 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "cannot reach $url - create the empty repo on GitHub first, or check name/permissions.`n$probe"
  }

  if ($DryRun) {
    Write-Host ""
    Write-Host "[dry-run] commits to push:"
    git log --oneline -5
    Write-Host "[dry-run] tracked files: $((git ls-files | Measure-Object).Count)"
    return
  }

  git remote remove origin 2>$null
  git remote add origin $url
  git push -u origin $Branch

  Write-Host ""
  Write-Host "pushed. open: https://github.com/$Owner/$Repo"
  git log --oneline -3
}
finally {
  Pop-Location
}
