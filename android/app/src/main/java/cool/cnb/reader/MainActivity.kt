package cool.cnb.reader

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import android.widget.FrameLayout
import cool.cnb.reader.bridge.ConnectivityMonitor
import cool.cnb.reader.bridge.ReaderBridge
import cool.cnb.reader.web.WebHost

/**
 * The only activity.
 *
 * The shell is thin by design: it hosts the shared web client, exposes a small
 * bridge for the things a WebView cannot do, and handles the back gesture. Every
 * feature that is not one of those three lives in the web layer, because that is
 * what keeps the Android and browser clients from diverging.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var connectivity: ConnectivityMonitor
    private var host: WebHost? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        connectivity = ConnectivityMonitor(this)

        val root = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            // Transparent background: the activity window already shows the paper
            // colour, so anything else would flash on every page transition.
            setBackgroundColor(Color.TRANSPARENT)
            // A long-press on text is how the reader selects a passage; the
            // platform's own context menu is the wrong affordance for that and
            // covers the text being selected.
            isLongClickable = true
            isHapticFeedbackEnabled = true
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        root.addView(webView)
        setContentView(root)

        applyInsets(root)

        host = WebHost(this, webView).apply {
            install(ReaderBridge(this@MainActivity, webView, connectivity))
        }

        // Back should walk the reader's own history (shelf → book → shelf) rather
        // than exiting the app, and only leave when there is nothing left.
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            },
        )
    }

    /**
     * Keeps the WebView clear of the status bar, the navigation bar and the
     * on-screen keyboard.
     *
     * Without this the reader's footer sits under the gesture bar, which is
     * infuriating on a phone with no physical buttons: the last line of a page is
     * permanently covered. `adjustResize` in the manifest is not sufficient on
     * its own from API 30 onwards.
     */
    private fun applyInsets(root: FrameLayout) {
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }

    override fun onPause() {
        super.onPause()
        // Ask the web layer to flush its outbox before the process can be frozen.
        // This is the hook that makes "read, then immediately switch apps" not
        // lose the last few pages: the reader's own debounce would never fire.
        webView.evaluateJavascript("window.__readerFlush && window.__readerFlush()", null)
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        host?.destroy()
        connectivity.close()
        // Detaching the WebView explicitly: leaving it in the hierarchy leaks the
        // whole renderer process across a configuration change.
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }
}
