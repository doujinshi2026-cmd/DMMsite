$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogDir = Join-Path $ProjectRoot "logs"
$LogPath = Join-Path $LogDir "dmm-ranking-import.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Push-Location $ProjectRoot
try {
  $startedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$startedAt] dmm-ranking import start" | Tee-Object -FilePath $LogPath -Append

  & npm run dmm:import -- @args 2>&1 | Tee-Object -FilePath $LogPath -Append
  $exitCode = $LASTEXITCODE

  $finishedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$finishedAt] dmm-ranking import exit=$exitCode" | Tee-Object -FilePath $LogPath -Append
  exit $exitCode
}
finally {
  Pop-Location
}
