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
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import androidx.media3.ui.PlayerView
import com.google.common.util.concurrent.ListenableFuture

/** A surface for the service-owned player. No URLs or credentials enter the activity intent. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MediaVideoActivity : AppCompatActivity() {
    private lateinit var root: LinearLayout
    private lateinit var view: PlayerView
    private lateinit var status: TextView
    private lateinit var previous: Button
    private lateinit var next: Button
    private lateinit var bar: LinearLayout
    private lateinit var pip: Button
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
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { target, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val inPip = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode
            if (inPip) target.setPadding(0, 0, 0, 0)
            else target.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }
        bar = LinearLayout(this)
        bar.addView(Button(this).apply { text = "返回"; setOnClickListener { finish() } })
        previous = Button(this).apply { text = "上一集"; setOnClickListener { move(MediaPlaybackService.PREVIOUS) } }
        next = Button(this).apply { text = "下一集"; setOnClickListener { move(MediaPlaybackService.NEXT) } }
        bar.addView(previous); bar.addView(next)
        bar.addView(Button(this).apply { text = "字幕"; setOnClickListener { listSubtitles(this) } })
        pip = Button(this).apply {
            text = "小窗"; contentDescription = "画中画"
            visibility = if (supportsPip()) View.VISIBLE else View.GONE
            setOnClickListener { openPip() }
        }
        bar.addView(pip)
        for (index in 0 until bar.childCount) (bar.getChildAt(index) as Button).apply {
            minWidth = 0; minimumWidth = 0
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        root.addView(bar)
        status = TextView(this).apply { setTextColor(Color.WHITE); text = "正在连接播放器…" }
        root.addView(status)
        view = PlayerView(this).apply { setShowSubtitleButton(true) }
        root.addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        ViewCompat.requestApplyInsets(root)
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
            }.onFailure { status.text = "无法连接播放器，请返回后重试。" }
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
        status.text = player.playerError?.let { "无法解码或读取资源，请返回选择其他版本。" }
            ?: player.sessionExtras.getString("mediaError") ?: player.mediaMetadata.title ?: "视频播放"
        previous.isEnabled = player.sessionExtras.getBoolean("canPrevious")
        next.isEnabled = player.sessionExtras.getBoolean("canNext")
        pip.isEnabled = player.playbackState == Player.STATE_READY || player.playbackState == Player.STATE_BUFFERING
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && supportsPip()) runCatching { setPictureInPictureParams(pipParams()) }
        if (player.isPlaying) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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
        bar.visibility = if (inPictureInPictureMode) View.GONE else View.VISIBLE
        status.visibility = if (inPictureInPictureMode) View.GONE else View.VISIBLE
        view.useController = !inPictureInPictureMode
        if (inPictureInPictureMode) view.hideController()
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
