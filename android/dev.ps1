# WaterCat for Android: build, test and run from a terminal (Windows PowerShell).
#
#   .\dev.ps1 setup     check JDK / Android SDK / phone, write local.properties
#   .\dev.ps1 build     debug APK  -> app\build\outputs\apk\debug\app-debug.apk
#   .\dev.ps1 test      unit tests (sync, sprites, themes, sounds, ...)
#   .\dev.ps1 install   build + install on the connected phone / emulator
#   .\dev.ps1 run       install + start the app
#   .\dev.ps1 logs      the app's log (sound, sync, alarms); Ctrl+C to stop
#   .\dev.ps1 release   minified release APK -> app\build\outputs\apk\release\app-release.apk
#   .\dev.ps1 assets    re-convert the desktop assets (needs ffmpeg + node with playwright)
#
# A phone: Settings -> About phone -> tap "Build number" 7 times, then Developer options ->
# USB debugging (or Wireless debugging + "adb pair"). An emulator: Android Studio -> Device Manager.
param([Parameter(Position = 0)][string]$Task = 'help')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$App = 'com.serthekk.watercat'

function Find-Sdk {
    foreach ($p in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk")) {
        if ($p -and (Test-Path (Join-Path $p 'platform-tools'))) { return $p }
    }
    if (Test-Path 'local.properties') {
        $line = Get-Content 'local.properties' | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
        if ($line) { $p = ($line -replace '^sdk\.dir=', '') -replace '\\\\', '\' -replace '\\:', ':'; if (Test-Path $p) { return $p } }
    }
    return $null
}

function Adb {
    $sdk = Find-Sdk
    if (-not $sdk) { throw 'Android SDK not found. Install Android Studio (it brings the SDK), then run .\dev.ps1 setup' }
    return Join-Path $sdk 'platform-tools\adb.exe'
}

function Gradle([string[]]$Tasks) {
    & .\gradlew.bat @Tasks --console=plain
    if ($LASTEXITCODE -ne 0) { throw "gradle $($Tasks -join ' ') failed" }
}

function Need-Device {
    $adb = Adb
    $devices = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\tdevice$' }
    if (-not $devices) { throw 'No phone or emulator found. Connect a phone with USB debugging on, or start an emulator.' }
    return $adb
}

switch ($Task) {
    'setup' {
        $java = Get-Command java -ErrorAction SilentlyContinue
        if ($java) { & java -version 2>&1 | Select-Object -First 1 } else { Write-Host 'JDK: not found. Android Studio has one: set JAVA_HOME to "<Android Studio>\jbr", or install JDK 17+.' -ForegroundColor Yellow }
        $sdk = Find-Sdk
        if ($sdk) {
            "sdk.dir=$($sdk -replace '\\', '\\' -replace ':', '\:')" | Set-Content 'local.properties' -Encoding ascii
            Write-Host "Android SDK: $sdk (written to local.properties)"
            & (Adb) devices
        } else { Write-Host 'Android SDK: not found. Install Android Studio, open it once (it downloads the SDK), then run this again.' -ForegroundColor Yellow }
    }
    'build' { Gradle 'assembleDebug'; Write-Host 'APK: app\build\outputs\apk\debug\app-debug.apk' -ForegroundColor Green }
    'test' { Gradle 'testDebugUnitTest'; Write-Host 'Report: app\build\reports\tests\testDebugUnitTest\index.html' -ForegroundColor Green }
    'install' { $adb = Need-Device; Gradle 'installDebug' }
    'run' {
        $adb = Need-Device
        Gradle 'installDebug'
        & $adb shell monkey -p $App -c android.intent.category.LAUNCHER 1 | Out-Null
        Write-Host 'Started. .\dev.ps1 logs shows what it does.' -ForegroundColor Green
    }
    'logs' {
        $adb = Need-Device
        $procId = (& $adb shell pidof $App).Trim()
        if (-not $procId) { throw 'The app is not running (.\dev.ps1 run starts it).' }
        & $adb logcat --pid=$procId
    }
    'release' { Gradle 'assembleRelease'; Write-Host 'APK: app\build\outputs\apk\release\app-release.apk (signed with the debug key)' -ForegroundColor Green }
    'assets' { & python scripts\convert_assets.py; if ($LASTEXITCODE -ne 0) { throw 'convert_assets.py failed' } }
    default { Get-Content $PSCommandPath | Select-Object -Skip 1 -First 13 | ForEach-Object { $_ -replace '^# ?', '' } }
}
