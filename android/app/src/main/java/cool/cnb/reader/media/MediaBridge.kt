package cool.cnb.reader.media

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.media3.common.Player
import androidx.media3.common.C
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.media3.session.SessionCommand
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import cool.cnb.reader.web.WebHost
import java.net.URI
import org.json.JSONObject
import org.json.JSONArray

/** Origin-scoped, main-frame-only command channel, separate from all reading bridges. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MediaBridge(private val context: Context, private val webView: WebView, private val beforePlay: () -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private var controller: MediaController? = null
    private var future: com.google.common.util.concurrent.ListenableFuture<MediaController>? = null
    private var reply: JavaScriptReplyProxy? = null
    private var disposed = false
    private var activeId = ""
    private var error = ""
    private var pendingCommand: JSONObject? = null
    private var publishedQueue: String? = null
    private var publishedQueueId: String? = null
    private var trackSnapshot = Tracks.EMPTY
    private var trackSession = ""
    private var tracksVersion = 0L
    private fun refreshTracks(player: MediaController) {
        val currentSession = player.currentMediaItem?.mediaId ?: ""
        if (trackSnapshot != player.currentTracks || trackSession != currentSession) {
            trackSnapshot = player.currentTracks; trackSession = currentSession; tracksVersion++
        }
    }
    private val tick = object : Runnable {
        override fun run() { publish(); if (!disposed) main.postDelayed(this, 1000) }
    }
    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) { publish() }
        override fun onPlayerError(exception: androidx.media3.common.PlaybackException) {
            error = "原生播放器无法播放此资源，请检查连接或格式。"; publish()
        }
    }

    fun install(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        WebViewCompat.addWebMessageListener(webView, "ReaderMedia", setOf(WebHost.ASSET_ORIGIN)) { _, message, _, isMainFrame, proxy ->
            if (!isMainFrame || disposed) return@addWebMessageListener
            reply = proxy
            if ((message.data?.length ?: 0) > 900000) return@addWebMessageListener
            val payload = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return@addWebMessageListener
            connect(payload)
        }
        main.post(tick)
        return true
    }

    private fun connect(payload: JSONObject) {
        if (payload.optString("action") in listOf("reconnect", "status")) publishedQueue = null
        controller?.let { command(it, payload); return }
        if (payload.optString("action") != "status" || pendingCommand == null) pendingCommand = payload
        if (future != null) return
        val pending = MediaController.Builder(context,
            SessionToken(context, ComponentName(context, MediaPlaybackService::class.java))).buildAsync()
        future = pending
        pending.addListener({
            if (disposed) return@addListener
            runCatching {
                val connected = pending.get(); controller = connected; future = null
                connected.addListener(listener)
                pendingCommand?.let { command(connected, it) }; pendingCommand = null
            }.onFailure { error = "无法连接后台播放器。"; publish() }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun command(player: MediaController, payload: JSONObject) {
        runCatching {
            when (payload.optString("action")) {
                "play" -> {
                    val url = payload.getString("url")
                    val uri = URI(url)
                    require(uri.scheme in listOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null)
                    require(uri.path.contains("/api/v1/media/streams/") && uri.fragment == null)
                    val id = payload.getString("sessionId"); require(id.length <= 100)
                    val position = payload.optDouble("position", 0.0)
                    require(position.isFinite() && position >= 0)
                    val plan = payload.getJSONObject("plan")
                    val base = plan.getString("baseUrl").trimEnd('/')
                    require(url.startsWith("$base/api/v1/media/streams/") && plan.getString("id") == id)
                    require(plan.getString("accessToken").length in 1..16000)
                    beforePlay()
                    val configured = player.sendCustomCommand(SessionCommand(MediaPlaybackService.CONFIGURE, Bundle.EMPTY), Bundle().apply { putString("plan", plan.toString()) })
                    configured.addListener({
                        if (!disposed && runCatching { configured.get().resultCode }.getOrNull() != androidx.media3.session.SessionResult.RESULT_SUCCESS) {
                            error = "无法开始后台队列播放。"; publish()
                        } else if (!disposed && activeId == id && plan.optBoolean("video", false)) {
                            context.startActivity(Intent(context, MediaVideoActivity::class.java))
                        }
                    }, ContextCompat.getMainExecutor(context))
                    activeId = id; error = ""
                }
                "showVideo" -> {
                    require(player.currentMediaItem?.mediaMetadata?.extras?.getBoolean("video") == true)
                    context.startActivity(Intent(context, MediaVideoActivity::class.java))
                }
                "pause", "resume", "stop", "previous", "next" -> {
                    val action = payload.getString("action")
                    if (action in listOf("resume", "previous", "next")) beforePlay()
                    if (action == "stop") activeId = ""
                    player.sendCustomCommand(SessionCommand(MediaPlaybackService.CONTROL, Bundle.EMPTY), Bundle().apply { putString("action", action) })
                }
                "selectQueue" -> {
                    require(payload.getString("sessionId") == player.currentMediaItem?.mediaId)
                    beforePlay()
                    player.sendCustomCommand(SessionCommand(MediaPlaybackService.CONTROL, Bundle.EMPTY), Bundle().apply {
                        putString("action", "selectQueue"); putString("sessionId", payload.getString("sessionId")); putInt("index", payload.getInt("index"))
                        putLong("revision", payload.optLong("revision", player.sessionExtras.getLong("queueRevision", -1)))
                    })
                }
                "editQueue" -> {
                    require(payload.getString("sessionId") == player.currentMediaItem?.mediaId)
                    val result = player.sendCustomCommand(SessionCommand(MediaPlaybackService.CONTROL, Bundle.EMPTY), Bundle().apply {
                        putString("action", "editQueue"); putString("sessionId", payload.getString("sessionId"))
                        putLong("revision", payload.getLong("revision")); putInt("index", payload.getInt("index")); putInt("direction", payload.getInt("direction"))
                    })
                    result.addListener({
                        if (runCatching { result.get().resultCode }.getOrNull() != androidx.media3.session.SessionResult.RESULT_SUCCESS) error = "播放列表已变化，请核对后重试。"
                        publishedQueue = null; publish()
                    }, ContextCompat.getMainExecutor(context))
                }
                "seek" -> { val seconds = payload.getDouble("position"); require(seconds.isFinite() && seconds >= 0)
                    val start = player.currentMediaItem?.mediaMetadata?.extras?.getDouble("start") ?: 0.0
                    player.seekTo(((seconds - start).coerceAtLeast(0.0) * 1000).toLong()) }
                "speed" -> { val speed = payload.getDouble("value"); require(speed.isFinite() && speed in 0.5..3.0); player.setPlaybackSpeed(speed.toFloat()) }
                "audioTrack" -> {
                    refreshTracks(player)
                    require(payload.getString("sessionId") == player.currentMediaItem?.mediaId)
                    require(payload.getLong("tracksVersion") == tracksVersion)
                    require(player.isCommandAvailable(Player.COMMAND_SET_TRACK_SELECTION_PARAMETERS))
                    val parts = payload.getString("id").split(':'); require(parts.size == 2)
                    val groupIndex = parts[0].toInt(); val trackIndex = parts[1].toInt()
                    val group = player.currentTracks.groups.getOrNull(groupIndex) ?: throw IllegalArgumentException()
                    require(group.type == C.TRACK_TYPE_AUDIO && trackIndex in 0 until group.length && group.isTrackSupported(trackIndex))
                    require(payload.getString("groupId") == group.mediaTrackGroup.id)
                    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)
                        .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, trackIndex)).build()
                    error = ""
                }
                "sleep" -> player.sendCustomCommand(SessionCommand(MediaPlaybackService.SLEEP, Bundle.EMPTY), Bundle().apply { putDouble("minutes", payload.getDouble("minutes")) })
                "reconnect" -> player.sendCustomCommand(SessionCommand(MediaPlaybackService.RECONNECT, Bundle.EMPTY), Bundle().apply {
                    putString("userId", payload.getString("userId")); putString("baseUrl", payload.getString("baseUrl")); putString("accessToken", payload.getString("accessToken"))
                })
                "status" -> Unit
                else -> throw IllegalArgumentException("Unknown media action")
            }
            publish()
        }.onFailure { error = if (payload.optString("action") == "audioTrack") "音轨已变化或设备不支持，请重新选择。" else "播放请求无效。"; publish() }
    }

    private fun publish() {
        if (disposed) return
        val player = controller ?: return
        val metadata = player.currentMediaItem?.mediaMetadata
        val extras = metadata?.extras
        refreshTracks(player)
        val audioTracks = JSONArray()
        if (player.isCommandAvailable(Player.COMMAND_SET_TRACK_SELECTION_PARAMETERS)) {
            player.currentTracks.groups.forEachIndexed { groupIndex, group ->
                if (group.type == C.TRACK_TYPE_AUDIO) for (trackIndex in 0 until group.length) {
                    val format = group.getTrackFormat(trackIndex)
                    audioTracks.put(JSONObject().put("id", "$groupIndex:$trackIndex").put("groupId", group.mediaTrackGroup.id)
                        .put("label", format.label ?: format.language ?: "音轨 ${audioTracks.length() + 1}")
                        .put("supported", group.isTrackSupported(trackIndex)).put("selected", group.isTrackSelected(trackIndex)))
                }
            }
        }
        val state = JSONObject().put("sessionId", player.currentMediaItem?.mediaId ?: activeId)
            .put("video", extras?.getBoolean("video") ?: false)
            .put("audioTracks", audioTracks)
            .put("tracksVersion", tracksVersion)
            .put("userId", extras?.getString("userId") ?: "").put("baseUrl", extras?.getString("baseUrl") ?: "")
            .put("queueId", extras?.getString("queueId") ?: "").put("queueIndex", player.sessionExtras.getInt("queueIndex", extras?.getInt("queueIndex") ?: 0))
            .put("queueRevision", player.sessionExtras.getLong("queueRevision", 0))
            .put("itemId", extras?.getString("itemId") ?: "")
            .put("title", metadata?.title?.toString() ?: "").put("partId", extras?.getString("partId") ?: "")
            .put("start", extras?.getDouble("start") ?: 0.0)
            .put("end", if (extras?.containsKey("end") == true) extras.getDouble("end") else JSONObject.NULL)
            .put("playing", player.isPlaying).put("paused", !player.playWhenReady || player.playbackState == Player.STATE_ENDED)
            .put("speed", player.playbackParameters.speed.toDouble())
            .put("sleepAt", player.sessionExtras.getLong("sleepAt", 0))
            .put("canPrevious", player.sessionExtras.getBoolean("canPrevious", false))
            .put("canNext", player.sessionExtras.getBoolean("canNext", false))
            .put("queueSwitching", player.sessionExtras.getBoolean("queueSwitching", false))
            .put("position", player.currentPosition / 1000.0 + (extras?.getDouble("start") ?: 0.0))
            // Media3 duration is relative to the clipped item, just like currentPosition.
            .put("duration", player.duration.takeIf { it >= 0 }?.div(1000.0) ?: JSONObject.NULL)
            .put("ended", player.playbackState == Player.STATE_ENDED).put("error", if (error.isNotEmpty()) error else player.sessionExtras.getString("mediaError", ""))
        val queueJson = player.sessionExtras.getString("currentQueue", "[]") ?: "[]"
        val queueId = extras?.getString("queueId") ?: ""
        if (queueJson != publishedQueue || queueId != publishedQueueId) state.put("currentQueue", JSONArray(queueJson))
        runCatching { reply?.let { it.postMessage(state.toString()); publishedQueue = queueJson; publishedQueueId = queueId } }
    }

    fun close() {
        disposed = true; main.removeCallbacks(tick)
        controller?.removeListener(listener); controller?.release(); controller = null
        future?.let { MediaController.releaseFuture(it) }; future = null
        WebViewCompat.removeWebMessageListener(webView, "ReaderMedia")
        reply = null
    }
}
