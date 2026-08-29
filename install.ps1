# Install playwright-skills into Claude Code, Codex CLI, or Cursor.
# Usage: ./install.ps1 [claude|codex|cursor]
param([Parameter(Mandatory=$true)][ValidateSet('claude','codex','cursor')][string]$Target)

$ErrorActionPreference = 'Stop'
$RepoDir = $PSScriptRoot
$Skills  = @('playwright-setup','e2e-dashboard','mobile-app-testing')

function Copy-SkillAssets($Dest) {
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  foreach ($s in $Skills) {
    $d = Join-Path $Dest $s
    if (Test-Path $d) { Remove-Item -Recurse -Force $d }
    Copy-Item -Recurse (Join-Path $RepoDir "plugins/$s/skills/$s") $d
  }
}

switch ($Target) {
  'claude' {
    Write-Host "Claude Code uses the native marketplace. Run inside Claude Code:"
    Write-Host "  /plugin marketplace add FaisalNoman/playwright-skills"
    Write-Host "  /plugin install playwright-setup@playwright-skills"
    Write-Host "  /plugin install e2e-dashboard@playwright-skills"
    Write-Host "  /plugin install mobile-app-testing@playwright-skills"
  }
  'codex' {
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
    Copy-SkillAssets (Join-Path $CodexHome 'playwright-skills')
    New-Item -ItemType Directory -Force -Path (Join-Path $CodexHome 'prompts') | Out-Null
    Copy-Item (Join-Path $RepoDir 'codex/prompts/*.md') (Join-Path $CodexHome 'prompts')
    Write-Host "Installed to $CodexHome. Use slash commands: /playwright-setup  /e2e-dashboard  /mobile-app-testing"
  }
  'cursor' {
    $Dot = Join-Path $PWD '.cursor'
    Copy-SkillAssets (Join-Path $Dot 'playwright-skills')
    New-Item -ItemType Directory -Force -Path (Join-Path $Dot 'commands') | Out-Null
    Copy-Item (Join-Path $RepoDir 'cursor/commands/*.md') (Join-Path $Dot 'commands')
    Write-Host "Installed to $Dot. Use: /playwright-setup  /e2e-dashboard  /mobile-app-testing in Cursor."
  }
}
