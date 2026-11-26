# Sleep Calculator (Android APK)

Packages the web app as a sideloadable Android app. The website stays the single
source of truth: the APK is one WebView showing a copy of the same files that
GitHub Pages serves, so there is no second UI to keep in sync.

Same approach as Alek Weather's `android/` folder, including its self-updater,
minus everything this app doesn't need (notifications, the native launch screen).

## How it works

- **`MainActivity.kt`** is one WebView, served by a `WebViewAssetLoader` at
  `https://appassets.androidplatform.net/`. A real https origin rather than
  `file://` keeps localStorage working like on the website.
- **`js/app.js` knows it's in the app** by that hostname. It hides the
  "Download APK" row, hides "Install app", and skips the service worker (the
  APK already has every file, and a cache would serve stale ones after an update).
- **Theme:** a light framework theme by day and a dark one at night. With
  targetSdk 34 the WebView reports `prefers-color-scheme` from it, which the
  page's "System" setting reads. The page tints the status and navigation bars
  through `window.AndroidBars.setBars` whenever its theme changes.
- **Back** asks the page first (`window.handleBack`), which closes Settings if
  it's open; otherwise back leaves the app.
- **Updates:** Settings shows "Check for updates" inside the app only. It asks
  the GitHub Releases API for the latest release (`window.AndroidUpdate.check`),
  compares its tag (`v1.2` reads as `1.2`) with the installed `versionName`, and
  on Update downloads that release's `.apk` and opens the system installer.
  The first time, Android asks to allow installs from Sleep Calculator. Results
  reach the page as `sleepupdate` / `sleepupdateprogress` events.

## Build

Uses the toolchain under `~/android-tools` that Alek Weather already uses
(JDK 17, Gradle 8.7, Android SDK platform/build-tools 34). See Alek Weather's
`android/README.md` for how to rebuild it from scratch.

```
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1 -Release
```

Copies the site's files into `app/src/main/assets` (gitignored) and assembles a
signed release. Output: `SleepCalculator.apk` in the repo root. Drop `-Release`
for a debug build (`SleepCalculator-debug.apk`).

`-Release` needs `android/keystore.properties` (gitignored) with `storeFile`,
`storePassword`, `keyAlias` and `keyPassword`. It uses the same keystore as
Alek Weather.

## Releasing

1. Bump `versionName` and `versionCode` in `app/build.gradle` (1.2 is
   versionCode 12, like Alek Weather), and the "Version" line in the Settings
   footer in `index.html`.
2. Build with `-Release`.
3. Create a GitHub release tagged `v<versionName>` (e.g. `v1.2`) and upload the
   file as exactly `SleepCalculator.apk`. The site's Download APK button links to
   `releases/latest/download/SleepCalculator.apk`, so it always gets the newest
   one, and the in-app updater reads the tag to decide whether it's newer. Keep
   the tag a plain number: a suffix like `-beta` reads as an older version.

Every release must be signed with the same key, or Android refuses to install
it over the previous version.
