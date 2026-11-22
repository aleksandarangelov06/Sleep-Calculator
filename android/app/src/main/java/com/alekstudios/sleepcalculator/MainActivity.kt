package com.alekstudios.sleepcalculator

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

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
    }

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
        web.destroy()
        super.onDestroy()
    }
}
