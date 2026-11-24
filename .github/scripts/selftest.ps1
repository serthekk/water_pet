# Runs the app's built-in self-test (from source) and fails if any check fails.
# Used by CI (ci.yml, on demand) and before every release (release.yml).
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PWD 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $exe)) { throw "Electron binary missing: $exe" }
New-Item -ItemType Directory -Force logs | Out-Null
Remove-Item logs\selftest-result.json -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $exe -ArgumentList '.', '--selftest' -PassThru
if (-not $p.WaitForExit(600000)) { $p.Kill(); throw 'Self-test timed out after 10 minutes' }
if (-not (Test-Path logs\selftest-result.json)) {
  Get-Content logs\debug.log -Tail 60 -ErrorAction SilentlyContinue
  throw "Self-test wrote no result (exit code $($p.ExitCode))"
}
$r = Get-Content logs\selftest-result.json -Raw | ConvertFrom-Json
$failed = @($r.results | Where-Object { -not $_.pass })
Write-Host "Self-test: $($r.results.Count - $failed.Count) / $($r.results.Count) passed (exit code $($p.ExitCode))"
foreach ($f in $failed) { Write-Host "::error::FAIL $($f.name) :: $($f.detail)" }
if ($failed.Count -gt 0) { exit 1 }
# all checks passed but the app crashed while quitting (e.g. an access violation): still a failure
if ($p.ExitCode -ne 0) { Write-Host "::error::The app exited with code $($p.ExitCode) after the self-test"; exit 1 }
