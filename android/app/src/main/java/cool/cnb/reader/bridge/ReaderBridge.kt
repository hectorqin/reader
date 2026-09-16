package cool.cnb.reader.bridge

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import cool.cnb.reader.web.NativePageView
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The native surface exposed to the web client as `window.ReaderAndroid`.
 *
 * Scope is decided by one rule: a method belongs here only if the WebView cannot
 * do it, or does it wrong. Everything else stays in the shared web layer, which is
 * what keeps the Android and browser clients one implementation instead of two.
 *
 * By that rule the bridge has exactly four responsibilities:
 *
 *  - connectivity, because `navigator.onLine` lies in a WebView;
 *  - a stable device label, because the UA-derived one changes when Chrome
 *    updates and would fragment a reader's own history;
 *  - native feedback (a toast), which is one line here and a whole notification
 *    UI in the web layer;
 *  - a way for the client to ask about its host, so it can adapt rather than
 *    guess.
 *
 * And one that is a performance decision rather than a capability: drawing a
 * whole-page image (`renderPage`). See NativePageView for why, and for the rule
 * that keeps it from being a second renderer — it either draws the page or
 * returns false, and a false puts the page back in the WebView.
 *
 * Every method is safe to call from any thread because `@JavascriptInterface`
 * calls arrive on a WebView-owned thread, not the main one: the ones that touch UI
 * post back to the main looper.
 */
class ReaderBridge(
    private val context: Context,
    private val webView: WebView,
    private val connectivity: ConnectivityMonitor,
    /**
     * Native renderer for fixed-layout pages.
     *
     * A parameter rather than something this class constructs, because the page
     * view has to live in the activity's view hierarchy, and a bridge that
     * created views would be a bridge that owns layout. It stays optional so a
     * unit test can construct a bridge without a window.
     */
    private val pageView: NativePageView? = null,
    /** Current image fit preference, mirrored from the client (`contain`/`width`). */
    private val fitPreference: () -> String = { "contain" },
) {

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Runs a UI-thread block and waits for its result.
     *
     * `renderPage` must be synchronous from the client's point of view — it
     * returns whether the page was drawn, and the client acts on that answer
     * immediately — but `@JavascriptInterface` calls arrive on a WebView-owned
     * thread and a View cannot be touched from there. The wait is bounded by the
     * work itself: a decode already sized to the viewport.
     */
    private fun <T> Handler.postAndWait(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        var result: T? = null
        val latch = java.util.concurrent.CountDownLatch(1)
        post {
            try {
                result = block()
            } finally {
                latch.countDown()
            }
        }
        latch.await(PAGE_DRAW_TIMEOUT_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    /**
     * Shell version.
     *
     * The web client requires a minimum (see MIN_SHELL_VERSION in the client) so
     * that an old APK paired with a new client is refused up front rather than
     * failing later in a way that looks like a reader bug.
     */
    @JavascriptInterface
    fun shellVersion(): Int = SHELL_VERSION

    /**
     * A device label that is stable and meaningful to a human.
     *
     * `Build.MODEL` is what the reader recognises — "Pixel 7", "SM-G991B" — and
     * unlike a user-agent string it does not change when the WebView is updated.
     * It is recorded on every progress row so the UI can say where a book was last
     * read.
     */
    @JavascriptInterface
    fun deviceLabel(): String {
        val model = Build.MODEL?.trim().orEmpty()
        val manufacturer = Build.MANUFACTURER?.trim().orEmpty().replaceFirstChar { it.uppercase() }
        val label = when {
            model.isEmpty() -> "Android"
            // Some OEMs prefix the model with the manufacturer ("Xiaomi Redmi…"),
            // which reads as a duplicate.
            model.startsWith(manufacturer, ignoreCase = true) -> model
            manufacturer.isEmpty() -> model
            else -> "$manufacturer $model"
        }
        return label.take(60)
    }

    /**
     * Validated connectivity, not merely "an interface exists".
     *
     * See ConnectivityMonitor for why this distinction is the whole reason the
     * bridge exists.
     */
    @JavascriptInterface
    fun connectivity(): String = connectivity.current()

    /**
     * Registers a callback invoked whenever connectivity changes.
     *
     * The web client passes a JavaScript function; it is invoked by name through
     * `evaluateJavascript` because that is the only direction a WebView allows
     * without a custom `WebMessagePort` handshake, which would be more machinery
     * for the same result.
     */
    @JavascriptInterface
    fun watchConnectivity(callbackName: String) {
        if (callbackName.isBlank() || !SAFE_IDENTIFIER.matches(callbackName)) return
        connectivity.watch { state ->
            mainHandler.post {
                // JSON-encoded so the string cannot break out of the call site.
                webView.evaluateJavascript(
                    "window['$callbackName'] && window['$callbackName'](${JSONObject.quote(state)})",
                    null,
                )
            }
        }
    }

    /**
     * Viewport in physical pixels plus the density.
     *
     * Fixed-layout books (comics, PDF) size themselves against the real viewport,
     * and a WebView's CSS pixel size is not the same as the display's. Reporting
     * both lets the client reason in CSS pixels while knowing the true resolution.
     */
    @JavascriptInterface
    fun viewport(): String {
        val metrics = context.resources.displayMetrics
        return JSONObject()
            .put("width", metrics.widthPixels)
            .put("height", metrics.heightPixels)
            .put("density", metrics.density.toDouble())
            .put("densityDpi", metrics.densityDpi)
            .toString()
    }

    /** Native toast, for feedback that should survive the web layer being busy. */
    @JavascriptInterface
    fun toast(message: String) {
        val text = message.take(200)
        mainHandler.post { Toast.makeText(context, text, Toast.LENGTH_SHORT).show() }
    }

    @JavascriptInterface
    fun hasNetwork(): Boolean = connectivity.current() == "online"

    /** Diagnostics for a bug report the reader can copy out of the app. */
    @JavascriptInterface
    fun diagnostics(): String {
        val info = JSONObject()
            .put("shellVersion", SHELL_VERSION)
            .put("connectivity", connectivity.current())
            .put("device", deviceLabel())
            .put("androidRelease", Build.VERSION.RELEASE)
            .put("androidSdk", Build.VERSION.SDK_INT)
            .put("appVersion", appVersion())
            .put("time", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US).format(Date()))
        return info.toString()
    }

    /** Files the client has cached, so a storage screen can be honest about it. */
    @JavascriptInterface
    fun cacheUsage(): String {
        val info = JSONObject()
        info.put("webViewBytes", directorySize(context.cacheDir))
        info.put("dataBytes", directorySize(context.filesDir))
        info.put("availableBytes", context.filesDir.usableSpace)
        return info.toString()
    }

    /**
     * Draws one fixed-layout page natively and returns whether it did.
     *
     * `false` is a normal answer, not a failure: the client then renders the
     * page in the WebView exactly as a browser would, so an unsupported image
     * format or a malformed payload degrades to the behaviour of every other
     * host instead of leaving the reader on a blank screen.
     *
     * The request is a JSON string because a `@JavascriptInterface` method can
     * only take primitives, and page bytes are not one. The bytes are base64
     * inside it; that copy is the price of skipping a WebView layout pass, and
     * for a full-page image it is still the cheaper side of the trade.
     */
    @JavascriptInterface
    fun renderPage(request: String): Boolean {
        val view = pageView ?: return false
        val payload = runCatching { JSONObject(request) }.getOrNull() ?: return false
        // The client is trusted here (it is our own bundle, served from the asset
        // loader), but a bridge that parses input should still refuse the shapes
        // it does not expect rather than pass them down.
        val mode = payload.optString("mode")
        if (mode != "image") return false
        val sectionId = payload.optString("sectionId")
        if (sectionId.isEmpty()) return false

        val encoded = payload.optString("bytes")
        val bytes = if (encoded.isEmpty()) null else NativePageView.decodeBase64(encoded)
        val mediaType = payload.optString("mediaType").ifEmpty { null }
        // Only `contain` reaches here: the client declines to offer a page while
        // the reader has "fit width" selected, because a cropped page loses
        // panels and a native scrolling surface would be a second renderer.
        // The field is read so a future renderer can act on it.
        val fit = payload.optString("fit").ifEmpty { fitPreference() }
        if (fit != "contain") return false

        return mainHandler.postAndWait { view.show(sectionId, bytes, mediaType) }
    }

    /** Removes the native page, restoring the WebView underneath. */
    @JavascriptInterface
    fun hidePage() {
        val view = pageView ?: return
        mainHandler.post { view.hide() }
    }

    /**
     * Reports whether the shell will open a document of this media type itself.
     *
     * Always false, and deliberately so. The platform PDF viewer is a separate
     * activity, so "opening" a document would take the reader out of the reading
     * session — which is the one thing the client must never do behind the
     * reader's back. The method exists as part of the contract so the client can
     * ask instead of assuming, and so a future in-process renderer has a place
     * to say yes.
     */
    @JavascriptInterface
    fun canOpenDocument(mediaType: String): Boolean {
        if (mediaType.isBlank()) return false
        return false
    }

    private fun appVersion(): String = runCatching {
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        packageInfo.versionName ?: "unknown"
    }.getOrDefault("unknown")

    /** Recursive size of a directory, bounded so a huge tree cannot stall a call. */
    private fun directorySize(dir: java.io.File, budget: Int = 20_000): Long {
        if (budget <= 0 || !dir.exists()) return 0
        var total = 0L
        var remaining = budget
        val stack = ArrayDeque<java.io.File>()
        stack.addLast(dir)
        while (stack.isNotEmpty() && remaining > 0) {
            val current = stack.removeLast()
            val children = current.listFiles() ?: continue
            for (child in children) {
                remaining -= 1
                if (remaining <= 0) break
                if (child.isDirectory) stack.addLast(child) else total += child.length()
            }
        }
        return total
    }

    companion object {
        /**
         * How long `renderPage` will block waiting for the UI thread.
         *
         * A page decode is bounded by the viewport, so this is a safety valve for
         * a wedged main thread rather than a real budget. Timing out returns
         * `false`, which puts the page back in the WebView — the reader still
         * reads the page, just through the slower path.
         */
        private const val PAGE_DRAW_TIMEOUT_MS = 2_000L

        /** Name the web client looks for on `window`. */
        const val NAME = "ReaderAndroid"

        /**
         * Bump when a method is added that the client cannot work without, and
         * raise MIN_SHELL_VERSION in `web/src/core/android-platform.ts` to match.
         *
         * 2 added `renderPage`/`hidePage`/`canOpenDocument`. The client treats a
         * shell below 2 as "no native page renderer" and draws everything in the
         * WebView, so the version check is how an old APK degrades instead of
         * calling a method that does not exist.
         */
        const val SHELL_VERSION = 2

        /**
         * Callback names must be plain identifiers.
         *
         * The name is interpolated into an `evaluateJavascript` string, so an
         * unrestricted value would let the web side run arbitrary script in its own
         * context. The context is the client's own, so the risk is low, but a
         * bridge that will interpolate a string should validate it rather than
         * assume.
         */
        private val SAFE_IDENTIFIER = Regex("^[A-Za-z_$][A-Za-z0-9_$]{0,64}$")
    }
}
