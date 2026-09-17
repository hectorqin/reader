package cool.cnb.reader.web

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import cool.cnb.reader.BuildConfig
import cool.cnb.reader.bridge.ReaderBridge
import cool.cnb.reader.bridge.SpeechBridge

/**
 * Configures the WebView and serves the bundled client to it.
 *
 * The interesting decision here is the **origin**.
 *
 * The obvious way to load a bundled web app is `file:///android_asset/...`. That
 * does not work for this product: `fetch()` from a `file://` origin is treated as
 * an opaque cross-origin request, so every call to the reader server would be
 * blocked — and the usual workaround is to disable web security, which turns a
 * WebView into an open door.
 *
 * `WebViewAssetLoader` serves the same files from `https://appassets.androidplatform.net/`,
 * a proper secure origin. The client's fetches then go out as ordinary CORS
 * requests, which is exactly what the server's CORS policy is written for, and
 * `isSecureContext` is true so IndexedDB and other APIs behave the same as they
 * do in a browser. That one choice is what lets a single web bundle run unchanged
 * in both hosts.
 */
class WebHost(
    private val context: Context,
    private val webView: WebView,
) {

    private val assetLoader = WebViewAssetLoader.Builder()
        .setDomain(ASSET_HOST)
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    /**
     * Installs the bridge.
     *
     * The speech engine is registered as a *second* interface rather than reached
     * through the first one, and that is a platform constraint rather than a
     * preference: `@JavascriptInterface` exposes methods, not objects, so
     * `window.ReaderAndroid.speech` can only exist if `speech` is added with its
     * own name. The client promotes it back into the object shape it expects (see
     * `installAndroidBridge` in the web layer), so the contract in
     * `android-bridge.d.ts` — one nested object — is what the web layer sees
     * whether or not the shell is real.
     */
    /**
     * The platform speech engine, for the activity to release in `onDestroy`.
     *
     * Exposed rather than reached through `ReaderBridge` because the activity
     * holds the bridge anonymously — and because a bound service that is never
     * released is a leak the platform reports, not a convenience.
     */
    val speechBridge: SpeechBridge?
        get() = currentBridge?.speech()

    private var currentBridge: ReaderBridge? = null

    fun install(bridge: ReaderBridge) {
        configure()
        currentBridge = bridge
        webView.addJavascriptInterface(bridge, ReaderBridge.NAME)
        webView.addJavascriptInterface(bridge.speech(), ReaderBridge.SPEECH_NAME)
        webView.webViewClient = AssetClient()
        webView.webChromeClient = ChromeClient()
        webView.loadUrl(START_URL)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure() {
        val settings = webView.settings

        // The client is our own bundle served from a same-origin asset loader, not
        // an arbitrary page from the internet. JavaScript is the renderer here, so
        // enabling it is not a decision that has an alternative.
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true

        // A book is laid out as a document with a realistic viewport. Without
        // these two the WebView renders at a 980px desktop width and the reader
        // gets a zoomed-out page of unreadable text.
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        // The web layer already handles small screens in CSS, so the WebView must
        // not add its own zoom on top; the reader has an explicit text-size control
        // instead, which is the one that respects the book's typography.
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.textZoom = 100

        // The bundled client is https:// (asset loader) and the user's server is
        // usually http:// on the LAN. Blocking that combination would make the app
        // unable to reach the very server it exists for. The manifest has the full
        // reasoning for why cleartext is the right trade for this product.
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        // Let the HTTP cache do its job: book bodies are immutable per hash and
        // already carry an ETag.
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // Nothing in the client asks for any of these, and each is a capability
        // that exists only to be abused.
        settings.setGeolocationEnabled(false)
        settings.allowFileAccess = false
        settings.allowContentAccess = false

        if (BuildConfig.DEBUG) {
            // Debug only: a release build must not expose a remote debugging port
            // that any other app on the device can attach to.
            WebView.setWebContentsDebuggingEnabled(true)
        }
    }

    fun destroy() {
        webView.stopLoading()
        webView.clearHistory()
        webView.removeJavascriptInterface(ReaderBridge.NAME)
        webView.removeJavascriptInterface(ReaderBridge.SPEECH_NAME)
        // The interfaces are gone from the page, but the engine is a bound service
        // and outlives the page: the activity releases it in `onDestroy`.
        currentBridge = null
    }

    /**
     * Serves the bundled assets and keeps the reading session inside the app.
     *
     * A link out of a book is handed to the platform rather than followed: it
     * should open in the user's browser, not replace the reader with a web page
     * and lose the reading session.
     */
    private inner class AssetClient : WebViewClient() {
        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (isInternalUrl(url)) return false
            openExternally(url)
            return true
        }

        private fun openExternally(url: String) {
            runCatching {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            }.onFailure {
                // No browser installed, or the scheme is unsupported. Nothing to
                // do, and nothing worth interrupting the reader for.
                Log.d(TAG, "cannot open external url")
            }
        }
    }

    private inner class ChromeClient : WebChromeClient() {
        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            // Surface the client's console into logcat. Without this, debugging the
            // web layer on a device means attaching a remote debugger, which is not
            // a realistic ask for a self-hosting user filing a bug report.
            Log.d(TAG, "[web] ${message.message()} @${message.lineNumber()}")
            return true
        }
    }

    companion object {
        private const val TAG = "ReaderWeb"

        /**
         * A reserved domain that `WebViewAssetLoader` intercepts.
         *
         * Deliberately not resolvable on the public internet: if the interception
         * were ever bypassed, nothing would be fetched from a real host.
         */
        const val ASSET_HOST = "appassets.androidplatform.net"
        const val ASSET_ORIGIN = "https://$ASSET_HOST"
        private const val START_URL = "$ASSET_ORIGIN/assets/index.html"

        /** Address the client is loaded from, reported through the bridge. */
        fun assetOrigin(): String = ASSET_ORIGIN
    }
}

/**
 * URLs that must stay inside the WebView.
 *
 * The internal `reader-res:` scheme is how injected book content resolves its own
 * images and stylesheets out of the in-memory resource map; letting it be treated
 * as external would break every illustrated book.
 */
internal fun isInternalUrl(url: String): Boolean {
    val internalPrefixes = listOf(
        WebHost.ASSET_ORIGIN,
        "reader-res:",
        "blob:",
        "data:",
        "about:",
    )
    return internalPrefixes.any { url.startsWith(it) }
}
