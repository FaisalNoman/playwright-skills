#!/usr/bin/env bash
# Install playwright-skills into Claude Code, Codex CLI, or Cursor.
# Usage: ./install.sh [claude|codex|cursor]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS=(playwright-setup e2e-dashboard)
TARGET="${1:-}"

copy_skill_assets() {
  # $1 = destination root for skill folders
  local dest="$1"
  mkdir -p "$dest"
  for s in "${SKILLS[@]}"; do
    rm -rf "$dest/$s"
    cp -r "$REPO_DIR/plugins/$s/skills/$s" "$dest/$s"
  done
}

case "$TARGET" in
  claude)
    echo "Claude Code uses the native marketplace. Run inside Claude Code:"
    echo "  /plugin marketplace add FaisalNoman/playwright-skills"
    echo "  /plugin install playwright-setup@playwright-skills"
    echo "  /plugin install e2e-dashboard@playwright-skills"
    ;;
  codex)
    CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
    copy_skill_assets "$CODEX_HOME/playwright-skills"
    mkdir -p "$CODEX_HOME/prompts"
    cp "$REPO_DIR"/codex/prompts/*.md "$CODEX_HOME/prompts/"
    echo "Installed to $CODEX_HOME. Use slash commands: /playwright-setup  /e2e-dashboard"
    ;;
  cursor)
    # Project-local install. Run from your project root.
    copy_skill_assets "$PWD/.cursor/playwright-skills"
    mkdir -p "$PWD/.cursor/commands"
    cp "$REPO_DIR"/cursor/commands/*.md "$PWD/.cursor/commands/"
    echo "Installed to $PWD/.cursor. Use: /playwright-setup  /e2e-dashboard in Cursor."
    ;;
  *)
    echo "Usage: ./install.sh [claude|codex|cursor]"
    exit 1
    ;;
esac
