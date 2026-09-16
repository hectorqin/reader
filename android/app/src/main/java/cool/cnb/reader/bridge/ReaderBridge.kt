package cool.cnb.reader.bridge

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
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
 * Every method is safe to call from any thread because `@JavascriptInterface`
 * calls arrive on a WebView-owned thread, not the main one: the ones that touch UI
 * post back to the main looper.
 */
class ReaderBridge(
    private val context: Context,
    private val webView: WebView,
    private val connectivity: ConnectivityMonitor,
) {

    private val mainHandler = Handler(Looper.getMainLooper())

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
        /** Name the web client looks for on `window`. */
        const val NAME = "ReaderAndroid"

        /**
         * Bump when a method is added that the client cannot work without, and
         * raise MIN_SHELL_VERSION in `web/src/core/android-platform.ts` to match.
         */
        const val SHELL_VERSION = 1

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
