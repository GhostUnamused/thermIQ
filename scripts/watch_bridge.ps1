# watch_bridge.ps1
# Watches BRIDGE.md for changes made by Cowork and auto-invokes Claude Code.
#
# USAGE:
#   1. Open a PowerShell terminal in the project folder
#   2. Run: .\scripts\watch_bridge.ps1
#   3. Leave it running in the background while you work in Cowork
#
# Every time Cowork saves a new task to BRIDGE.md, this script will
# automatically call Claude Code to read and implement the PENDING tasks.

$projectDir = Split-Path -Parent $PSScriptRoot
$bridgeFile  = Join-Path $projectDir "BRIDGE.md"

Write-Host ""
Write-Host "  ThermIQ Bridge Watcher" -ForegroundColor Cyan
Write-Host "  Watching: $bridgeFile" -ForegroundColor Gray
Write-Host "  Claude Code will auto-run when Cowork updates BRIDGE.md." -ForegroundColor Gray
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

# Set up FileSystemWatcher on the project directory, filter to BRIDGE.md
$watcher                  = New-Object System.IO.FileSystemWatcher($projectDir, "BRIDGE.md")
$watcher.NotifyFilter     = [System.IO.NotifyFilters]::LastWrite
$watcher.EnableRaisingEvents = $true

# Debounce: ignore repeated events within 3 seconds (editors fire multiple saves)
$lastFired = [datetime]::MinValue

while ($true) {
    $change = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::Changed, 2000)

    if (-not $change.TimedOut) {
        $now = [datetime]::Now
        if (($now - $lastFired).TotalSeconds -lt 3) {
            continue   # debounce
        }
        $lastFired = $now

        $timestamp = $now.ToString("HH:mm:ss")
        Write-Host "[$timestamp] BRIDGE.md updated by Cowork - invoking Claude Code..." -ForegroundColor Yellow

        # Move into the project directory so CC has the right context
        Push-Location $projectDir

        # Call Claude Code non-interactively with the bridge instruction
        # --dangerously-skip-permissions lets it run without prompts
        $prompt = "Read BRIDGE.md. Find every task marked [PENDING]. Implement each one in order. After completing each task, update its status in BRIDGE.md to [DONE] with a one-line summary of what you did, or [FAILED: reason] if it could not be completed. Then git add, commit, and push if any files were changed."

        claude --dangerously-skip-permissions $prompt

        Pop-Location

        Write-Host "[$timestamp] Claude Code finished. Watching for next update..." -ForegroundColor Green
        Write-Host ""
    }
}
