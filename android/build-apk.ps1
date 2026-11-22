# Builds Sleep Calculator as an Android APK.
#
# The web app is the source of truth: this copies the site's files into the
# APK's assets and lets Gradle package them. MainActivity serves those assets
# over https://appassets.androidplatform.net/ via WebViewAssetLoader, so the
# APK runs exactly the same files as GitHub Pages. There is no web build step.
#
# Prereqs (already installed under ~/android-tools, shared with Alek Weather):
# JDK 17, Gradle 8.7, Android SDK platform 34 + build-tools 34.
#
#   powershell -ExecutionPolicy Bypass -File android\build-apk.ps1            # debug
#   powershell -ExecutionPolicy Bypass -File android\build-apk.ps1 -Release   # signed
#
# -Release needs android\keystore.properties (gitignored) pointing at the
# keystore outside the repo. Anything published publicly should be -Release:
# debug builds set android:debuggable="true".
#
# Keep this file pure ASCII. Windows PowerShell 5.1 reads a .ps1 with no BOM
# as ANSI, so one stray non-ASCII character breaks the parser.

param([switch]$Release)

$ErrorActionPreference = 'Stop'

$tools   = Join-Path $env:USERPROFILE 'android-tools'
$root    = Split-Path -Parent $PSScriptRoot          # the Sleep-Calculator repo
$android = $PSScriptRoot
$assets  = Join-Path $android 'app\src\main\assets'

# Any JDK 17.x will do (AGP 8.2.2 needs 17 and does not run on 21+), so find it
# by glob instead of pinning the patch version in its folder name.
$jdk = Get-ChildItem (Join-Path $tools 'jdk') -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue |
       Sort-Object Name | Select-Object -Last 1
if (-not $jdk) { throw "No JDK 17 under $tools\jdk - see android/README.md for the toolchain setup." }
$env:JAVA_HOME    = $jdk.FullName
$env:ANDROID_HOME = Join-Path $tools 'sdk'
$gradle           = Join-Path $tools 'gradle-8.7\bin\gradle.bat'

Write-Host '==> Copying web app into APK assets' -ForegroundColor Cyan
# Wipe first so files deleted from the site don't linger in the APK.
# sw.js is left out on purpose: the app skips the service worker (js/app.js).
if (Test-Path $assets) { Remove-Item -Recurse -Force $assets }
New-Item -ItemType Directory -Force -Path $assets | Out-Null
foreach ($item in @('index.html', 'manifest.webmanifest', 'css', 'js', 'fonts', 'images')) {
    Copy-Item -Recurse -Force (Join-Path $root $item) $assets
}

$variant = if ($Release) { 'Release' } else { 'Debug' }
$flavour = $variant.ToLower()

if ($Release -and -not (Test-Path (Join-Path $android 'keystore.properties'))) {
    throw 'keystore.properties missing; -Release would produce an unsigned APK.'
}

Write-Host "==> Assembling APK (gradle, $flavour)" -ForegroundColor Cyan
Push-Location $android
try {
    & $gradle --no-daemon ":app:assemble$variant"
    if ($LASTEXITCODE -ne 0) { throw "gradle assemble$variant failed ($LASTEXITCODE)" }
} finally { Pop-Location }

$apk = Join-Path $android "app\build\outputs\apk\$flavour\app-$flavour.apk"
# The release name must stay SleepCalculator.apk: the site's Download APK
# button links to releases/latest/download/SleepCalculator.apk.
$out = if ($Release) { Join-Path $root 'SleepCalculator.apk' }
       else { Join-Path $root 'SleepCalculator-debug.apk' }
Copy-Item -Force $apk $out

$size = [math]::Round((Get-Item $out).Length / 1MB, 2)
Write-Host ''
Write-Host "==> Done: $out ($size MB)" -ForegroundColor Green
