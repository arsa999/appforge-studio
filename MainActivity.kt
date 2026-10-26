package com.appforge.template

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import android.net.Uri

/**
 * Starter only. A production build worker must inject a validated start URL
 * or bundle local web assets. Do not expose a JavaScript bridge to remote sites.
 */
class MainActivity : Activity() {
    companion object { const val DEFAULT_URL = "https://example.com" }
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true // Make configurable per project.
        webView.settings.domStorageEnabled = true
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri: Uri = request.url
                val allowed = uri.scheme == "https" && uri.host == Uri.parse(DEFAULT_URL).host
                if (!allowed) {
                    Toast.makeText(this@MainActivity, "External navigation blocked", Toast.LENGTH_SHORT).show()
                }
                return !allowed
            }
        }
        setContentView(webView)
        webView.loadUrl(DEFAULT_URL) // Replace through trusted build configuration.
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }
}
