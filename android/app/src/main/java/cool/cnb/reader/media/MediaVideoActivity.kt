package cool.cnb.reader.media

import android.content.ComponentName
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Build
import android.util.Rational
import android.view.View
import android.os.Bundle
import android.graphics.Color
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.TextView
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup.LayoutParams
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.ui.DefaultTimeBar
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import androidx.media3.ui.PlayerView
import com.google.common.util.concurrent.ListenableFuture

/** A surface for the service-owned player. No URLs or credentials enter the activity intent. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MediaVideoActivity : AppCompatActivity() {
    private lateinit var root: FrameLayout
    private lateinit var view: PlayerView
    private lateinit var status: TextView
    private lateinit var previous: Button
    private lateinit var next: Button
    private lateinit var bar: LinearLayout
    private lateinit var pip: Button
    private lateinit var chrome: LinearLayout
    private lateinit var problem: LinearLayout
    private lateinit var problemText: TextView
    private lateinit var title: TextView
    private var playbackError = false
    private var controlsVisible = true
    private var controller: MediaController? = null
    private var pending: ListenableFuture<MediaController>? = null
    private val subtitleRequests = SubtitleRequestGate()
    private var subtitleDialog: AlertDialog? = null
    private var subtitleSession: String? = null
    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) { update() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(8, 12, 9))
            clipToPadding = false
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { target, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val inPip = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode
            if (inPip) target.setPadding(0, 0, 0, 0)
            else target.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }
        view = PlayerView(this).apply {
            setShowSubtitleButton(true)
            setShowPreviousButton(false)
            setShowNextButton(false)
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            setControllerShowTimeoutMs(3500)
            setShutterBackgroundColor(Color.rgb(6, 8, 6))
        }
        root.addView(view, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        chrome = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(8), 0, dp(16))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xF2111913.toInt(), 0x00111913))
        }
        val heading = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), 0, dp(12), 0) }
        heading.addView(actionButton("‹", "返回") { finish() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        title = TextView(this).apply {
            text = "视频播放"; textSize = 16f; setTextColor(Color.WHITE)
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(12), 0, dp(12), 0)
        }
        heading.addView(title, LinearLayout.LayoutParams(0, dp(48), 1f))
        chrome.addView(heading)
        bar = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, dp(10), 0)
        }
        previous = actionButton("上一集", "上一集") { move(MediaPlaybackService.PREVIOUS) }
        next = actionButton("下一集", "下一集") { move(MediaPlaybackService.NEXT) }
        bar.addView(previous); bar.addView(next)
        bar.addView(actionButton("字幕", "字幕") { listSubtitles(it as Button) })
        pip = actionButton("小窗", "画中画") { openPip() }.apply {
            visibility = if (supportsPip()) View.VISIBLE else View.GONE
        }
        bar.addView(pip)
        for (index in 0 until bar.childCount) (bar.getChildAt(index) as Button).apply {
            minWidth = 0; minimumWidth = 0
            layoutParams = LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, dp(48)).apply {
                marginStart = dp(3); marginEnd = dp(3)
            }
        }
        chrome.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(bar) })
        status = TextView(this).apply {
            setTextColor(Color.rgb(205, 218, 204))
            textSize = 14f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            gravity = Gravity.CENTER_VERTICAL
            text = "正在连接播放器…"
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(18), 0, dp(18), 0)
        }
        chrome.addView(status, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        root.addView(chrome, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.TOP))
        problemText = TextView(this).apply { textSize = 14f; setTextColor(0xFFD0DACE.toInt()); gravity = Gravity.CENTER; setPadding(0, dp(12), 0, dp(20)) }
        problem = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(24), dp(20), dp(24), dp(20))
            background = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setColor(0xF21E291F.toInt()) }
            addView(TextView(this@MediaVideoActivity).apply { text = "暂时无法播放"; textSize = 20f; setTextColor(Color.WHITE) })
            addView(problemText)
            addView(actionButton("返回选择其他版本", "返回选择其他播放版本") { finish() }, LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, dp(48)))
            visibility = View.GONE
        }
        root.addView(problem, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER).apply { leftMargin = dp(24); rightMargin = dp(24) })
        view.findViewById<DefaultTimeBar>(androidx.media3.ui.R.id.exo_progress)?.apply {
            setPlayedColor(0xFFB6C99A.toInt()); setScrubberColor(0xFFB6C99A.toInt())
            setBufferedColor(0xFF61705A.toInt()); setUnplayedColor(0xFF303D2C.toInt())
        }
        view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility ->
            controlsVisible = visibility == View.VISIBLE
            updateChrome()
        })
        view.setFullscreenButtonClickListener { fullscreen ->
            requestedOrientation = if (fullscreen) android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        setContentView(root)
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        ViewCompat.requestApplyInsets(root)
    }

    private fun updateChrome() {
        val inPip = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode
        chrome.visibility = if (!inPip && (controlsVisible || playbackError)) View.VISIBLE else View.GONE
        problem.visibility = if (!inPip && playbackError) View.VISIBLE else View.GONE
        WindowCompat.getInsetsController(window, root).apply {
            if (inPip || (!controlsVisible && !playbackError)) hide(WindowInsetsCompat.Type.systemBars())
            else show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + 0.5f).toInt()

    private fun actionButton(label: String, description: String, click: (View) -> Unit): Button = Button(this).apply {
        text = label
        contentDescription = description
        textSize = if (label.length == 1) 27f else 12f
        setTextColor(ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()), intArrayOf(0xFF6D786B.toInt(), 0xFFE6EDE2.toInt())))
        setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL))
        gravity = Gravity.CENTER
        minHeight = 0
        setPadding(dp(12), 0, dp(12), 0)
        background = GradientDrawable().apply {
            cornerRadius = dp(9).toFloat()
            setColor(Color.rgb(35, 48, 38))
        }
        backgroundTintList = ColorStateList(arrayOf(intArrayOf(android.R.attr.state_enabled), intArrayOf(-android.R.attr.state_enabled)), intArrayOf(Color.rgb(49, 69, 51), Color.rgb(31, 36, 32)))
        setOnClickListener(click)
    }

    override fun onStart() {
        super.onStart()
        val future = MediaController.Builder(this, SessionToken(this, ComponentName(this, MediaPlaybackService::class.java))).buildAsync()
        pending = future
        future.addListener({
            if (pending !== future) return@addListener
            runCatching {
                controller = future.get().also { it.addListener(listener); view.player = it }
                update()
            }.onFailure { showProblem("无法连接播放器，请返回后重试。") }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun update() {
        val player = controller ?: return
        val currentSession = player.currentMediaItem?.mediaId
        subtitleRequests.observeSession(currentSession)
        if (subtitleSession != currentSession) {
            subtitleDialog?.dismiss(); subtitleDialog = null
            subtitleSession = currentSession
        }
        if (player.currentMediaItem?.mediaMetadata?.extras?.getBoolean("video") != true) { finish(); return }
        title.text = player.mediaMetadata.title ?: "视频播放"
        val error = player.playerError?.let { "无法解码或读取资源，请返回选择其他版本。" }
            ?: player.sessionExtras.getString("mediaError")?.takeIf { it.isNotBlank() }
        showProblem(error)
        status.text = if (player.playbackState == Player.STATE_BUFFERING) "正在缓冲…" else ""
        previous.isEnabled = player.sessionExtras.getBoolean("canPrevious")
        next.isEnabled = player.sessionExtras.getBoolean("canNext")
        pip.isEnabled = player.playbackState == Player.STATE_READY || player.playbackState == Player.STATE_BUFFERING
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && supportsPip()) runCatching { setPictureInPictureParams(pipParams()) }
        if (player.isPlaying) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun showProblem(message: String?) {
        playbackError = message != null
        problemText.text = message.orEmpty()
        view.useController = !playbackError && !(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode)
        updateChrome()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        view.setFullscreenButtonState(newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE)
        ViewCompat.requestApplyInsets(root)
    }

    private fun supportsPip(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.O)
    private fun pipParams(): PictureInPictureParams {
        val size = controller?.videoSize
        val (width, height) = VideoPipPolicy.ratio(size?.width ?: 0, size?.height ?: 0, size?.pixelWidthHeightRatio ?: 1f)
        return PictureInPictureParams.Builder().apply {
            setAspectRatio(Rational(width, height))
            val bounds = Rect()
            if (view.getGlobalVisibleRect(bounds) && !bounds.isEmpty) setSourceRectHint(bounds)
            // Entry is explicit; returning to reading must not open an unsolicited video window.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setAutoEnterEnabled(false)
        }.build()
    }

    private fun openPip() {
        if (!supportsPip() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O || isInPictureInPictureMode) return
        val player = controller ?: return
        if (!pip.isEnabled || player.currentMediaItem?.mediaMetadata?.extras?.getBoolean("video") != true) return
        if (runCatching { enterPictureInPictureMode(pipParams()) }.getOrDefault(false).not()) {
            status.text = "无法进入画中画，请检查系统中的画中画权限。"
        }
    }

    override fun onPictureInPictureModeChanged(inPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(inPictureInPictureMode, newConfig)
        view.useController = !inPictureInPictureMode && !playbackError
        if (inPictureInPictureMode) view.hideController()
        else if (!playbackError) view.showController()
        updateChrome()
        ViewCompat.requestApplyInsets(root)
    }

    private fun move(action: String) {
        controller?.sendCustomCommand(SessionCommand(action, Bundle.EMPTY), Bundle.EMPTY)
    }

    private fun listSubtitles(button: Button) {
        val player = controller ?: return
        val id = player.currentMediaItem?.mediaId ?: return
        val ticket = subtitleRequests.begin(id)
        button.isEnabled = false
        val request = player.sendCustomCommand(SessionCommand(MediaPlaybackService.SUBTITLES, Bundle.EMPTY), Bundle().apply { putString("sessionId", id) })
        request.addListener({
            button.isEnabled = true
            if (isFinishing || isDestroyed || controller !== player || !subtitleRequests.accepts(ticket, player.currentMediaItem?.mediaId)) return@addListener
            runCatching {
                val result = request.get(); check(result.resultCode == androidx.media3.session.SessionResult.RESULT_SUCCESS)
                val items = org.json.JSONArray(result.extras.getString("items", "[]"))
                val labels = arrayOf("关闭字幕") + (0 until items.length()).map { items.getJSONObject(it).optString("label", "字幕") }.toTypedArray()
                subtitleDialog?.dismiss()
                subtitleDialog = AlertDialog.Builder(this).setTitle("服务器字幕").setItems(labels) { _, index ->
                    if (isFinishing || isDestroyed || controller !== player || !subtitleRequests.accepts(ticket, player.currentMediaItem?.mediaId)) return@setItems
                    val selection = subtitleRequests.begin(id)
                    val chosen = if (index == 0) "" else items.getJSONObject(index - 1).getString("id")
                    val loading = player.sendCustomCommand(SessionCommand(MediaPlaybackService.SUBTITLES, Bundle.EMPTY), Bundle().apply { putString("sessionId", id); putString("subtitleId", chosen) })
                    status.text = "正在载入字幕…"
                    loading.addListener({
                        if (!isFinishing && !isDestroyed && controller === player && subtitleRequests.accepts(selection, player.currentMediaItem?.mediaId)) {
                            if (runCatching { loading.get().resultCode }.getOrNull() == androidx.media3.session.SessionResult.RESULT_SUCCESS) update()
                            else status.text = "字幕载入失败，可重新选择重试。"
                        }
                    }, ContextCompat.getMainExecutor(this))
                }.setNegativeButton("取消", null).show()
            }.onFailure { status.text = "字幕列表读取失败，请稍后重试。" }
        }, ContextCompat.getMainExecutor(this))
    }

    override fun onStop() {
        subtitleRequests.invalidate()
        subtitleDialog?.dismiss(); subtitleDialog = null; subtitleSession = null
        // The activity enters onPause while PiP remains visible, without onStop. Once hidden/dismissed,
        // onStop pauses playback so returning to reading/locking never leaves invisible video.
        if (!isChangingConfigurations && controller?.currentMediaItem?.mediaMetadata?.extras?.getBoolean("video") == true) controller?.pause()
        view.player = null
        controller?.removeListener(listener); controller = null
        pending?.let { MediaController.releaseFuture(it) }; pending = null
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onStop()
    }
}
