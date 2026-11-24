# Makes sure node_modules/electron/dist holds the Electron binary for the installed
# electron package. Electron's own postinstall (install.js) quits before unzipping on
# recent Node versions (and newer npm may skip it), so: download with @electron/get
# (checksum-verified against electron's checksums.json, cached), unzip with PowerShell.
# Used by CI and by RELEASING.md for local setup. Safe to run again.
$ErrorActionPreference = 'Stop'
$pkg = Get-Content node_modules/electron/package.json -Raw | ConvertFrom-Json
$dist = Join-Path $PWD 'node_modules/electron/dist'
$versionFile = Join-Path $dist 'version'
if ((Test-Path (Join-Path $dist 'electron.exe')) -and (Test-Path $versionFile) -and ((Get-Content $versionFile -Raw).Trim().TrimStart('v') -eq $pkg.version)) {
  Write-Host "Electron $($pkg.version) already in place"
  exit 0
}
$zip = node -e @"
require('@electron/get').downloadArtifact({
  version: '$($pkg.version)', artifactName: 'electron', platform: 'win32', arch: 'x64',
  checksums: require('./node_modules/electron/checksums.json'),
}).then((p) => process.stdout.write(p), (e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
"@
if ($LASTEXITCODE -or -not $zip -or -not (Test-Path $zip)) { throw "Could not download Electron $($pkg.version)" }
Write-Host "Unpacking $zip"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $dist
[IO.File]::WriteAllText((Join-Path $PWD 'node_modules/electron/path.txt'), 'electron.exe')
Write-Host "Electron $((Get-Content $versionFile -Raw).Trim()) installed"
