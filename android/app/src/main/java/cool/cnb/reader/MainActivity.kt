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
import cool.cnb.reader.bridge.SpeechBridge
import cool.cnb.reader.web.NativePageView
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
    private var pageView: NativePageView? = null
    /**
     * The platform speech engine, held so it can be shut down.
     *
     * `TextToSpeech` binds a service and holds the audio route; releasing it in
     * `onDestroy` is what stops a backgrounded app from continuing to speak.
     */
    private var speechBridge: SpeechBridge? = null

    /**
     * Current image-fit preference, pushed down by the web layer.
     *
     * The native page view needs it, and the setting lives in the client (it is a
     * per-device preference, see SettingsStore), so it is mirrored here rather
     * than duplicated. Default matches the client's default.
     */
    private var fitPreference: String = "contain"

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

        // The native page view sits above the WebView and is hidden until the
        // client asks for a page. Above, not below: it covers the empty flow the
        // web layer leaves behind when it hands a page over.
        val page = NativePageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        root.addView(page)
        pageView = page

        setContentView(root)

        applyInsets(root)

        host = WebHost(this, webView).apply {
            install(
                ReaderBridge(
                    this@MainActivity,
                    webView,
                    connectivity,
                    pageView = page,
                    fitPreference = { fitPreference },
                ),
            )
        }
        // The speech engine is a bound service and a speaker; it is released when
        // the activity goes away rather than left to the process's own cleanup,
        // which on Android can be much later — a reader who backgrounds the app
        // while listening should not be read to from the past.
        speechBridge = host?.speechBridge

        // Back should walk the reader's own history (shelf → book → shelf) rather
        // than exiting the app, and only leave when there is nothing left.
        //
        // This is worth spelling out because it used to be a lie that happened to
        // be harmless: the client had no routes at all, so `canGoBack()` was false
        // on every screen and Back left the app from the shelf. The client now
        // navigates by fragment (`#/book/<id>`, `#/library/<path>`), which the
        // WebView records as ordinary history entries — so the gesture means what
        // it says. A screen that *renames* itself (walking into a library folder)
        // uses `replaceState`, deliberately adding no entry: Back should leave the
        // manager, not retrace the walk folder by folder.
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
     * Releases the platform speech engine.
     *
     * `onDestroy` rather than `onStop`: a WebView page can survive a stop (the
     * reader comes back to the same chapter), and shutting the engine down there
     * would make the first sentence after returning fail. On destroy the page is
     * gone, so there is nothing left for the engine to speak.
     */
    override fun onDestroy() {
        speechBridge?.shutdown()
        super.onDestroy()
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
        pageView?.hide()
        // Detaching the WebView explicitly: leaving it in the hierarchy leaks the
        // whole renderer process across a configuration change.
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }
}
