# watch_bridge.ps1
# Watches BRIDGE.md for changes made by Cowork and alerts you to switch to Claude Code.
# Works with Claude Code inside the Claude desktop app (no CLI install needed).
#
# USAGE:
#   1. Open a PowerShell terminal in the project folder
#   2. Run: .\scripts\watch_bridge.ps1
#   3. Leave it running while you work in Cowork
#
# When Cowork writes a new task to BRIDGE.md, the terminal will beep and
# show a prompt to switch to Claude Code in the desktop app.
# Tell CC: "Check BRIDGE.md for pending tasks."

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

        # Alert the user to switch to Claude Code in the desktop app
        # (Claude Code CLI is not required — this works with CC inside the desktop app)
        [console]::beep(800, 200)
        [console]::beep(800, 200)
        Write-Host ""
        Write-Host "  *** ACTION NEEDED ***" -ForegroundColor White -BackgroundColor DarkMagenta
        Write-Host "  Switch to Claude Code in the Claude desktop app." -ForegroundColor Cyan
        Write-Host "  Tell it: 'Check BRIDGE.md for pending tasks.'" -ForegroundColor Cyan
        Write-Host "  (CC will read BRIDGE.md, implement the task, and push to GitHub.)" -ForegroundColor Gray
        Write-Host ""
    }
}
