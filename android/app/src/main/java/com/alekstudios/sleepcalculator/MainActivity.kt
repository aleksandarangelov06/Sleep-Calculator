package com.alekstudios.sleepcalculator

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * Sleep Calculator as an Android app: one WebView showing the web app that
 * build-apk.ps1 copies into assets/. The website stays the single source of
 * truth; there is no second copy of the UI to keep in sync.
 *
 * The files are served by a WebViewAssetLoader on https://appassets.androidplatform.net/
 * rather than file://, so localStorage works like it does on the website. js/app.js
 * also checks that hostname to know it is inside the app: it hides the
 * "Download APK" row and skips the service worker.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    private companion object {
        const val DOMAIN = "appassets.androidplatform.net"
        const val START_URL = "https://$DOMAIN/index.html"

        /** GitHub Releases API for the sideload self-update (see [Updater]). */
        const val LATEST_RELEASE_URL =
            "https://api.github.com/repos/aleksandarangelov06/Sleep-Calculator/releases/latest"

        /** Every release APK is served from under here; nothing else is installed. */
        const val RELEASE_DOWNLOAD_PREFIX =
            "https://github.com/aleksandarangelov06/Sleep-Calculator/releases/download/"

        const val USER_AGENT = "SleepCalculator-Android"
    }

    /** Single worker for the update check/download so they never touch the UI thread. */
    private val updateIo = Executors.newSingleThreadExecutor()

    /**
     * The APK URL the last [Updater.check] found. [Updater.install] only accepts
     * this URL, so the page can't hand the installer anything that check didn't
     * get from the GitHub API itself. Written and read on [updateIo].
     */
    @Volatile private var offeredApkUrl: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val loader = WebViewAssetLoader.Builder()
            .setDomain(DOMAIN)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        // Paint the sky color, not white, for the moment before the page draws.
        web.setBackgroundColor(getColor(R.color.window_bg))
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.settings.apply {
            javaScriptEnabled = true
            // localStorage: theme, time format, minutes to fall asleep.
            domStorageEnabled = true
        }
        web.addJavascriptInterface(BarsBridge(), "AndroidBars")
        web.addJavascriptInterface(Updater(), "AndroidUpdate")

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            // Keep the app's own pages in the WebView; send anything else to the browser.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == DOMAIN) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: ActivityNotFoundException) {
                    // No browser installed: nothing sensible to do.
                }
                return true
            }
        }
        // A WebChromeClient is what makes confirm() show a dialog ("Delete data");
        // without one the WebView answers every dialog as if Cancel was tapped.
        web.webChromeClient = WebChromeClient()

        setContentView(web)

        // Match the bars to the system theme until the page reports its own
        // (the in-app theme setting can differ from the system's).
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        applyBars(getColor(R.color.bar_top), getColor(R.color.bar_bottom), dark = night)

        web.loadUrl(START_URL)
    }

    /**
     * Bound as `window.AndroidBars`. js/app.js calls setBars on every theme
     * change so the status and navigation bars match the top and bottom of the sky.
     */
    inner class BarsBridge {
        @JavascriptInterface
        fun setBars(top: String, bottom: String, dark: Boolean) {
            val topColor = parseColor(top) ?: return
            val bottomColor = parseColor(bottom) ?: return
            runOnUiThread { applyBars(topColor, bottomColor, dark) }
        }
    }

    private fun parseColor(hex: String): Int? =
        try { Color.parseColor(hex) } catch (_: IllegalArgumentException) { null }

    private fun applyBars(top: Int, bottom: Int, dark: Boolean) {
        window.statusBarColor = top
        window.navigationBarColor = bottom
        // Light backgrounds need dark icons, and the other way round.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (dark) 0 else mask, mask)
        } else {
            @Suppress("DEPRECATION")
            val light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            @Suppress("DEPRECATION")
            val flags = window.decorView.systemUiVisibility
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (dark) flags and light.inv() else flags or light
        }
    }

    /**
     * Back asks the page first (window.handleBack in js/app.js), which closes
     * Settings if it is open. Otherwise back leaves the app as usual.
     */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.handleBack && window.handleBack()) === true") { handled ->
            @Suppress("DEPRECATION")
            if (handled != "true") super.onBackPressed()
        }
    }

    override fun onDestroy() {
        updateIo.shutdownNow()
        web.destroy()
        super.onDestroy()
    }

    /* ---------- Self-updater (same design as Alek Weather) ---------- */

    /** Installed versionName, e.g. "1.1"; "" if it can't be read. */
    private fun installedVersion(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: ""
    } catch (_: PackageManager.NameNotFoundException) {
        ""
    }

    /**
     * Delivers an update result/progress object to the page as a DOM CustomEvent
     * (`sleepupdate` / `sleepupdateprogress`), which js/app.js listens for.
     */
    private fun emitUpdate(event: String, detailJson: String) {
        runOnUiThread {
            if (isDestroyed) return@runOnUiThread
            web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('$event', { detail: $detailJson }))",
                null,
            )
        }
    }

    /**
     * The sideload self-updater, bound as `window.AndroidUpdate` and used only
     * from Settings inside the app (js/app.js gates it on the appassets host).
     *
     * The app is sideloaded, not from Play, so it asks the GitHub Releases API
     * for the latest tag and, on request, downloads that release's APK and hands
     * it to the system package installer. The install is never silent: Android
     * shows its own confirm dialog, and refuses an APK signed with a different
     * key than the installed one. Nothing runs until the user taps Check.
     */
    inner class Updater {
        @JavascriptInterface
        fun currentVersion(): String = installedVersion()

        /** Compare the latest release tag with the installed version; report back. */
        @JavascriptInterface
        fun check() {
            updateIo.execute {
                try {
                    val release = JSONObject(httpGet(LATEST_RELEASE_URL))
                    val latest = release.optString("tag_name").removePrefix("v").trim()
                    val current = installedVersion()
                    val apkUrl = apkAssetUrl(release)
                        ?.takeIf { it.startsWith(RELEASE_DOWNLOAD_PREFIX) }
                    offeredApkUrl = apkUrl
                    val out = JSONObject()
                        .put("current", current)
                        .put("latest", latest)
                    if (apkUrl != null && isNewer(latest, current)) {
                        out.put("status", "available").put("url", apkUrl)
                    } else {
                        out.put("status", "current")
                    }
                    emitUpdate("sleepupdate", out.toString())
                } catch (e: Exception) {
                    emitUpdate("sleepupdate", errorJson(e))
                }
            }
        }

        /** Download the release APK that check() found and launch the system installer. */
        @JavascriptInterface
        fun install(url: String) {
            updateIo.execute {
                try {
                    // Only the release check() found, never an arbitrary URL from the page.
                    if (url != offeredApkUrl || !url.startsWith(RELEASE_DOWNLOAD_PREFIX)) {
                        throw IOException("Update URL not recognised; check for updates again")
                    }
                    // Android gates sideloaded installs behind a per-app toggle;
                    // send the user to grant it rather than failing silently.
                    if (!packageManager.canRequestPackageInstalls()) {
                        runOnUiThread {
                            startActivity(
                                Intent(
                                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:$packageName"),
                                ),
                            )
                        }
                        emitUpdate("sleepupdate", JSONObject().put("status", "permission").toString())
                        return@execute
                    }
                    val apk = downloadApk(url)
                    launchInstaller(apk)
                    emitUpdate("sleepupdate", JSONObject().put("status", "installing").toString())
                } catch (e: Exception) {
                    emitUpdate("sleepupdate", errorJson(e))
                }
            }
        }
    }

    private fun errorJson(e: Exception): String =
        JSONObject().put("status", "error").put("error", e.message ?: "Network error").toString()

    /** First .apk asset's browser_download_url, or null if the release has none. */
    private fun apkAssetUrl(release: JSONObject): String? {
        val assets = release.optJSONArray("assets") ?: return null
        for (i in 0 until assets.length()) {
            val asset = assets.optJSONObject(i) ?: continue
            if (asset.optString("name").endsWith(".apk", ignoreCase = true)) {
                return asset.optString("browser_download_url").ifEmpty { null }
            }
        }
        return null
    }

    /** Dotted numeric compare ("1.10" > "1.9"), tolerant of unequal segment counts. */
    private fun isNewer(latest: String, current: String): Boolean {
        if (latest.isEmpty()) return false
        if (current.isEmpty()) return true
        val a = latest.split(".")
        val b = current.split(".")
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrNull(i)?.toIntOrNull() ?: 0
            val y = b.getOrNull(i)?.toIntOrNull() ?: 0
            if (x != y) return x > y
        }
        return false
    }

    private fun httpGet(url: String): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15000
            readTimeout = 15000
            // GitHub rejects requests without a User-Agent; the Accept pins the API version.
            setRequestProperty("User-Agent", USER_AGENT)
            setRequestProperty("Accept", "application/vnd.github+json")
        }
        try {
            if (conn.responseCode !in 200..299) throw IOException("HTTP ${conn.responseCode}")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    /** Streams the release APK into cacheDir, emitting percent progress as it goes. */
    private fun downloadApk(url: String): File {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 30000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", USER_AGENT)
        }
        try {
            if (conn.responseCode !in 200..299) throw IOException("HTTP ${conn.responseCode}")
            val total = conn.contentLength.toLong()
            val out = File(cacheDir, "update.apk")
            var lastPct = -1
            conn.inputStream.use { input ->
                out.outputStream().use { sink ->
                    val buf = ByteArray(64 * 1024)
                    var read = input.read(buf)
                    var done = 0L
                    while (read >= 0) {
                        sink.write(buf, 0, read)
                        done += read
                        if (total > 0) {
                            val pct = (done * 100 / total).toInt()
                            if (pct != lastPct) {
                                lastPct = pct
                                emitUpdate("sleepupdateprogress", pct.toString())
                            }
                        }
                        read = input.read(buf)
                    }
                }
            }
            return out
        } finally {
            conn.disconnect()
        }
    }

    private fun launchInstaller(apk: File) {
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runOnUiThread { startActivity(intent) }
    }
}
