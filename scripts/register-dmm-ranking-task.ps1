param(
  [string]$TaskName = "DMM Ranking Import",
  [string[]]$At = @("00:00", "12:00")
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Runner = Join-Path $ProjectRoot "scripts\run-dmm-ranking-import.ps1"
$Triggers = foreach ($Time in $At) {
  $RunAt = [DateTime]::ParseExact($Time, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
  New-ScheduledTaskTrigger -Daily -At $RunAt
}

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`""
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Triggers `
  -Settings $Settings `
  -Description "Import new review posts from the DMM doujin comic 24h ranking." `
  -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' at $($At -join ', ')."
