# Installs this project's Claude Code plugins on your own machine (user scope,
# so they work in every project, not just thermIQ).
# Run from any PowerShell window:  powershell -ExecutionPolicy Bypass -File scripts\install_claude_plugins.ps1
claude plugin marketplace add latent-spaces/brag
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install brag@brag --scope user
claude plugin install frontend-design@claude-plugins-official --scope user
claude plugin list
