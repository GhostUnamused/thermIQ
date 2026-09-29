#!/usr/bin/env sh
# macOS/Linux twin of install_claude_plugins.ps1 — installs this project's
# Claude Code plugins at user scope.
set -e
claude plugin marketplace add latent-spaces/brag
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install brag@brag --scope user
claude plugin install frontend-design@claude-plugins-official --scope user
claude plugin list
