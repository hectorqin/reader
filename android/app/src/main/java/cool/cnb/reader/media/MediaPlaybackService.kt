package cool.cnb.reader.media

import android.app.PendingIntent
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.os.Process
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.CommandButton
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import cool.cnb.reader.MainActivity
import org.json.JSONObject
import org.json.JSONArray

/** Playback belongs to the service, never to the lifetime of the reader WebView. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MediaPlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private lateinit var player: ExoPlayer
    private lateinit var progress: MediaProgressSync
    private val main = Handler(Looper.getMainLooper())
    private var sleepAt = 0L
        set(value) {
            field = value
            session?.let { current -> current.setSessionExtras(Bundle(current.sessionExtras).apply { putLong("sleepAt", value) }) }
        }
    private var endSeconds: Double? = null
    private var destroyed = false
    private var videoMode = false
    private lateinit var queue: PlaybackQueue
    private var accessContext: JSONObject? = null
    private lateinit var recoveryStore: MediaRecoveryStore
    private val recoveryWorker = java.util.concurrent.Executors.newSingleThreadExecutor()
    private var recoveryGeneration = 0L
    private var restoring = false
    private var subtitleFile: java.io.File? = null
    private var subtitleGeneration = 0L
    private var subtitlePendingLabel: String? = null
    private val tick = object : Runnable {
        override fun run() {
            if (sleepAt > 0 && System.currentTimeMillis() >= sleepAt) { queue.pause(); player.pause(); sleepAt = 0 }
            val position = positionSeconds()
            val complete = player.playbackState == Player.STATE_ENDED || endSeconds?.let { position >= it } == true
            if (complete) finishCurrent()
            else if (player.playbackState == Player.STATE_READY)
                player.currentMediaItem?.let { progress.save(it.mediaId, position, complete) }
            main.postDelayed(this, 5000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        recoveryStore = MediaRecoveryStore(this)
        java.io.File(cacheDir, "media-subtitles").listFiles()?.filter { it.isFile && it.name.startsWith("sidecar-") && it.extension == "vtt" }?.forEach { it.delete() }
        player = ExoPlayer.Builder(this).build().apply {
            setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            setHandleAudioBecomingNoisy(true)
            setWakeMode(C.WAKE_MODE_NETWORK)
        }
        progress = MediaProgressSync(onRecovered = { main.post {
            if (!destroyed) session?.let { current -> current.setSessionExtras(Bundle(current.sessionExtras).apply { remove("mediaError") }) }
        } }) { terminal -> main.post {
            if (destroyed) return@post
            if (terminal) { queue.pause(); player.pause() }
            session?.let { current -> current.setSessionExtras(Bundle(current.sessionExtras).apply { putLong("sleepAt", sleepAt); putString("mediaError", if (terminal) "播放权限失效或会话被接管，请重新播放。" else "进度暂未同步，将继续重试。") }) }
        } }
        queue = PlaybackQueue(
            { id, position, next, completed, done -> progress.advance(id, position, next, completed) { result -> main.post { if (!destroyed) done(result) } } },
            { plan, entry, index, play -> startItem(plan, entry.title, index, play) },
            { player.pause(); session?.let { current -> current.setSessionExtras(Bundle(current.sessionExtras).apply { putLong("sleepAt", sleepAt); putString("mediaError", "切换失败。可重试上一首/下一首，或点击继续当前内容。") }) } },
            { publishQueueState() },
        )
        MediaAudioCoordinator.pauseMedia = { queue.pause(); player.pause() }
        val launch = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val sessionPlayer = QueueSessionPlayer(player, { resumePlayback() }, { pausePlayback() }, { stopPlayback() })
        session = MediaSession.Builder(this, sessionPlayer).setSessionActivity(launch).setCallback(object : MediaSession.Callback {
            override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
                val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                if (controller.uid == Process.myUid()) commands.add(SessionCommand(CONFIGURE, Bundle.EMPTY)).add(SessionCommand(SLEEP, Bundle.EMPTY)).add(SessionCommand(CONTROL, Bundle.EMPTY)).add(SessionCommand(RECONNECT, Bundle.EMPTY)).add(SessionCommand(SUBTITLES, Bundle.EMPTY))
                if (controller.uid == Process.myUid() || session.isMediaNotificationController(controller))
                    commands.add(SessionCommand(PREVIOUS, Bundle.EMPTY)).add(SessionCommand(NEXT, Bundle.EMPTY))
                return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands.build()).build()
            }
            override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo, command: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
                if (command.customAction == PREVIOUS || command.customAction == NEXT) {
                    if (controller.uid != Process.myUid() && !session.isMediaNotificationController(controller))
                        return Futures.immediateFuture(SessionResult(androidx.media3.session.SessionError.ERROR_PERMISSION_DENIED))
                    val moved = moveQueue(if (command.customAction == PREVIOUS) -1 else 1)
                    return Futures.immediateFuture(SessionResult(if (moved) SessionResult.RESULT_SUCCESS else androidx.media3.session.SessionError.ERROR_INVALID_STATE))
                }
                if (controller.uid != Process.myUid()) return Futures.immediateFuture(SessionResult(androidx.media3.session.SessionError.ERROR_PERMISSION_DENIED))
                if (command.customAction == SUBTITLES) return loadSubtitle(args)
                return try {
                    when (command.customAction) {
                        CONFIGURE -> {
                            recoveryGeneration++; restoring = false
                            val plan = JSONObject(args.getString("plan") ?: "")
                            accessContext = JSONObject().put("userId", plan.getString("userId"))
                                .put("baseUrl", plan.getString("baseUrl").trimEnd('/')).put("accessToken", plan.getString("accessToken"))
                            val entries = plan.getJSONArray("queue")
                            val items = (0 until entries.length()).map { index -> entries.getJSONObject(index).let { QueueEntry(it.getString("partId"), it.getString("title")) } }
                            val index = plan.getInt("queueIndex")
                            queue.configure(items, index, plan.getString("id"))
                            videoMode = plan.optBoolean("video", false)
                            startItem(plan, items[index].title, index, true)
                        }
                        CONTROL -> when (args.getString("action")) {
                            "editQueue" -> {
                                require(queue.edit(args.getString("sessionId") ?: "", args.getLong("revision", -1), args.getInt("index", -1), args.getInt("direction", 2)))
                                persistRecovery()
                            }
                            "selectQueue" -> {
                                val item = player.currentMediaItem ?: throw IllegalArgumentException()
                                require(args.getString("sessionId") == item.mediaId)
                                require(args.getLong("revision", -1) == queue.revision)
                                val target = args.getInt("index", -1)
                                require(!queue.isAdvancing && target in queue.snapshot.indices && target != queue.currentIndex)
                                player.pause(); queue.select(item.mediaId, positionSeconds(), target)
                            }
                            "previous", "next" -> {
                                val direction = if (args.getString("action") == "previous") -1 else 1
                                moveQueue(direction)
                            }
                            "pause" -> pausePlayback()
                            "resume" -> resumePlayback()
                            "stop" -> stopPlayback()
                        }
                        RECONNECT -> {
                            val identity = player.currentMediaItem?.mediaMetadata?.extras
                            val userId = args.getString("userId") ?: ""
                            val baseUrl = args.getString("baseUrl") ?: ""
                            val token = args.getString("accessToken") ?: ""
                            require(token.length in 1..16000 && userId.isNotEmpty())
                            if (identity != null && (identity.getString("userId") != userId || identity.getString("baseUrl") != baseUrl)) {
                                stopPlayback()
                            } else {
                                accessContext?.let { previous ->
                                    if (previous.optString("userId") != userId || previous.optString("baseUrl") != baseUrl) stopPlayback()
                                }
                                accessContext = JSONObject().put("userId", userId).put("baseUrl", baseUrl).put("accessToken", token)
                                if (identity == null) restoreRecovery(accessContext!!)
                                else progress.reauthorize(baseUrl, userId, token)
                            }
                        }
                        SLEEP -> { val minutes = args.getDouble("minutes"); require(minutes.isFinite() && minutes in 0.0..1440.0); sleepAt = if (minutes > 0) System.currentTimeMillis() + (minutes * 60000).toLong() else 0 }
                        else -> return Futures.immediateFuture(SessionResult(androidx.media3.session.SessionError.ERROR_NOT_SUPPORTED))
                    }
                    Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                } catch (_: Exception) { Futures.immediateFuture(SessionResult(androidx.media3.session.SessionError.ERROR_BAD_VALUE)) }
            }
        }).build()
        publishQueueState()
        player.addListener(object : Player.Listener {
            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                val label = subtitlePendingLabel ?: return
                for (group in tracks.groups) for (index in 0 until group.length) {
                    if (group.type == C.TRACK_TYPE_TEXT && group.getTrackFormat(index).label == label) {
                        subtitlePendingLabel = null
                        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                            .setOverrideForType(androidx.media3.common.TrackSelectionOverride(group.mediaTrackGroup, index)).build()
                        return
                    }
                }
            }
            override fun onPlaybackParametersChanged(parameters: androidx.media3.common.PlaybackParameters) { persistRecovery() }
            override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_ENDED) finishCurrent() }
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (playWhenReady) queue.resume() else queue.pause()
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) MediaAudioCoordinator.stopSpeech?.invoke()
                if (!isPlaying && (player.playbackState == Player.STATE_READY || player.playbackState == Player.STATE_ENDED))
                    player.currentMediaItem?.let { if (player.playbackState != Player.STATE_ENDED) progress.save(it.mediaId, positionSeconds(), false) }
            }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) { if (mediaItem == null) { queue.clear(); progress.clear(); endSeconds = null; sleepAt = 0 } }
        })
        main.post(tick)
    }

    private fun finishCurrent() {
        val item = player.currentMediaItem ?: return
        if (!queue.ended(item.mediaId, positionSeconds()))
            progress.save(item.mediaId, positionSeconds(), true)
    }

    private fun pausePlayback() { queue.pause(); player.pause() }
    private fun resumePlayback() {
        if (queue.resume()) {
            if (player.playbackState == Player.STATE_ENDED) finishCurrent() else player.play()
        }
    }
    private fun stopPlayback() {
        clearSubtitle()
        recoveryGeneration++; restoring = false
        recoveryWorker.execute { recoveryStore.clear() }
        saveFinalProgress()
        queue.clear(); player.pause(); player.stop(); player.clearMediaItems(); progress.clear(); accessContext = null
    }

    private fun persistRecovery() {
        if (destroyed || restoring || queue.isAdvancing || queue.snapshot.isEmpty()) return
        val extras = player.currentMediaItem?.mediaMetadata?.extras ?: return
        val value = runCatching {
            MediaRecoverySnapshot.create(JSONObject().put("userId", extras.getString("userId"))
                .put("id", player.currentMediaItem!!.mediaId)
                .put("baseUrl", extras.getString("baseUrl")).put("queueId", extras.getString("queueId")),
                queue.snapshot, queue.currentIndex, videoMode, player.playbackParameters.speed)
        }.getOrNull() ?: return
        recoveryWorker.execute { recoveryStore.write(value) }
    }

    private fun clearSubtitle() {
        subtitleGeneration++
        subtitlePendingLabel = null
        subtitleFile?.delete(); subtitleFile = null
    }

    private fun loadSubtitle(args: Bundle): ListenableFuture<SessionResult> {
        val item = player.currentMediaItem
        if (!videoMode || item == null || args.getString("sessionId") != item.mediaId)
            return Futures.immediateFuture(SessionResult(androidx.media3.session.SessionError.ERROR_INVALID_STATE))
        val id = args.getString("subtitleId")
        val epoch = ++subtitleGeneration
        val future = com.google.common.util.concurrent.SettableFuture.create<SessionResult>()
        if (id == "") {
            val position = player.currentPosition; val playing = player.playWhenReady
            player.setMediaItem(item.buildUpon().setSubtitleConfigurations(emptyList()).build(), position)
            player.prepare(); player.playWhenReady = playing
            clearSubtitle()
            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
            future.set(SessionResult(SessionResult.RESULT_SUCCESS)); return future
        }
        progress.subtitle(item.mediaId, id) { result ->
            var temporary: java.io.File? = null
            val prepared = result.mapCatching { value ->
                if (id != null) {
                    val text = value.getString("webvtt"); require(text.startsWith("WEBVTT") && text.toByteArray(Charsets.UTF_8).size <= 2 * 1024 * 1024)
                    val directory = java.io.File(cacheDir, "media-subtitles").apply { mkdirs() }
                    temporary = java.io.File.createTempFile("sidecar-", ".vtt", directory).also { it.writeText(text, Charsets.UTF_8) }
                }
                value
            }
            main.post {
                if (destroyed || epoch != subtitleGeneration || player.currentMediaItem?.mediaId != item.mediaId) {
                    temporary?.delete(); future.set(SessionResult(androidx.media3.session.SessionError.ERROR_INVALID_STATE)); return@post
                }
                prepared.fold(onSuccess = { value ->
                    if (id == null) future.set(SessionResult(SessionResult.RESULT_SUCCESS, Bundle().apply { putString("items", value.getJSONArray("items").toString()) }))
                    else {
                        runCatching {
                            val previousFile = subtitleFile
                            subtitleFile = temporary
                            subtitlePendingLabel = "服务器字幕 · $id"
                            val config = MediaItem.SubtitleConfiguration.Builder(android.net.Uri.fromFile(temporary))
                                .setMimeType(androidx.media3.common.MimeTypes.TEXT_VTT).setLabel(subtitlePendingLabel)
                                .setLanguage("und").setSelectionFlags(C.SELECTION_FLAG_DEFAULT).build()
                            val position = player.currentPosition; val playing = player.playWhenReady
                            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT)
                                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setPreferredTextLanguage("und").setSelectUndeterminedTextLanguage(true).build()
                            player.setMediaItem(item.buildUpon().setSubtitleConfigurations(listOf(config)).build(), position)
                            player.prepare(); player.playWhenReady = playing; previousFile?.delete()
                        }.fold(onSuccess = { future.set(SessionResult(SessionResult.RESULT_SUCCESS)) }, onFailure = {
                            temporary?.delete(); future.set(SessionResult(androidx.media3.session.SessionError.ERROR_UNKNOWN))
                        })
                    }
                }, onFailure = { temporary?.delete(); future.set(SessionResult(androidx.media3.session.SessionError.ERROR_UNKNOWN)) })
            }
        }
        return future
    }

    private fun restoreRecovery(credentials: JSONObject) {
        if (restoring) return
        restoring = true
        val epoch = ++recoveryGeneration
        recoveryWorker.execute {
            val saved = recoveryStore.read()
            val matches = saved != null && saved.optString("userId") == credentials.optString("userId") && saved.optString("baseUrl") == credentials.optString("baseUrl")
            if (!matches) recoveryStore.clear()
            main.post {
                if (destroyed || epoch != recoveryGeneration) return@post
                if (!matches) { restoring = false; return@post }
                progress.restore(saved, credentials) { result -> main.post {
                    if (destroyed || epoch != recoveryGeneration) return@post
                    restoring = false
                    result.mapCatching { plan ->
                        val entries = plan.getJSONArray("queue")
                        val items = (0 until entries.length()).map { entries.getJSONObject(it).let { entry -> QueueEntry(entry.getString("partId"), entry.getString("title")) } }
                        val index = plan.getInt("queueIndex")
                        queue.configure(items, index, plan.getString("id")); queue.pause()
                        videoMode = saved.optBoolean("video")
                        player.setPlaybackSpeed(saved.getDouble("speed").toFloat())
                        startItem(plan, items[index].title, index, false)
                    }.onFailure {
                        session?.let { current -> current.setSessionExtras(Bundle(current.sessionExtras).apply { putString("mediaError", "未能恢复播放，请检查登录与连接后重新打开影音。") }) }
                    }
                } }
            }
        }
    }
    private fun saveFinalProgress() {
        if (player.playbackState == Player.STATE_READY || player.playbackState == Player.STATE_ENDED)
            player.currentMediaItem?.let { progress.finish(it.mediaId, positionSeconds(), player.playbackState == Player.STATE_ENDED) }
    }

    private fun publishQueueState() {
        session?.let { current ->
            val buttons = listOf(
                CommandButton.Builder(CommandButton.ICON_PREVIOUS).setDisplayName("上一首 / 章")
                    .setSessionCommand(SessionCommand(PREVIOUS, Bundle.EMPTY)).setEnabled(queue.canPrevious)
                    .setSlots(CommandButton.SLOT_BACK).build(),
                CommandButton.Builder(CommandButton.ICON_NEXT).setDisplayName("下一首 / 章")
                    .setSessionCommand(SessionCommand(NEXT, Bundle.EMPTY)).setEnabled(queue.canNext)
                    .setSlots(CommandButton.SLOT_FORWARD).build(),
            )
            current.setCustomLayout(buttons)
            current.setMediaButtonPreferences(buttons)
            current.setSessionExtras(Bundle(current.sessionExtras).apply {
            putBoolean("canPrevious", queue.canPrevious); putBoolean("canNext", queue.canNext)
            putBoolean("queueSwitching", queue.isAdvancing)
            putLong("queueRevision", queue.revision); putInt("queueIndex", queue.currentIndex)
            putString("currentQueue", JSONArray().apply { queue.snapshot.forEach { put(JSONObject().put("title", it.title.take(64)).put("partId", it.partId)) } }.toString())
        }) }
    }

    private fun moveQueue(direction: Int): Boolean {
        if (!(if (direction < 0) queue.canPrevious else queue.canNext)) return false
        val item = player.currentMediaItem ?: return false
        player.pause()
        return queue.move(item.mediaId, positionSeconds(), direction)
    }

    private fun positionSeconds() = player.currentPosition / 1000.0 + (player.currentMediaItem?.mediaMetadata?.extras?.getDouble("start") ?: 0.0)

    private fun startItem(plan: JSONObject, title: String, index: Int, play: Boolean) {
        clearSubtitle()
        accessContext?.let { latest ->
            if (latest.optString("userId") == plan.optString("userId") && latest.optString("baseUrl") == plan.getString("baseUrl").trimEnd('/'))
                plan.put("accessToken", latest.getString("accessToken"))
        }
        val relative = plan.getString("streamUrl")
        require(relative.startsWith("/api/v1/media/streams/") && !relative.contains("#"))
        endSeconds = if (plan.isNull("end")) null else plan.getDouble("end")
        val start = plan.optDouble("start", 0.0)
        val destination = if (videoMode) MediaVideoActivity::class.java else MainActivity::class.java
        session?.setSessionActivity(PendingIntent.getActivity(this, if (videoMode) 1 else 0,
            Intent(this, destination), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        progress.configure(plan); session?.setSessionExtras(Bundle().apply { putLong("sleepAt", sleepAt) }); publishQueueState()
        val extras = Bundle().apply {
            putBoolean("video", videoMode)
            putString("queueId", plan.optString("queueId")); putInt("queueIndex", index)
            putString("userId", plan.optString("userId")); putString("baseUrl", plan.getString("baseUrl").trimEnd('/'))
            putString("itemId", plan.optString("itemId")); putString("partId", plan.getString("partId")); putDouble("start", plan.optDouble("start", 0.0))
            endSeconds?.let { putDouble("end", it) }
        }
        val builder = MediaItem.Builder().setMediaId(plan.getString("id")).setUri(plan.getString("baseUrl").trimEnd('/') + relative)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setExtras(extras).build())
        val clip = MediaItem.ClippingConfiguration.Builder().setStartPositionMs((start * 1000).toLong())
        endSeconds?.let { clip.setEndPositionMs((it * 1000).toLong()) }
        builder.setClippingConfiguration(clip.build())
        val speed = player.playbackParameters.speed
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO).clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setPreferredTextLanguage(null).setSelectUndeterminedTextLanguage(false).build()
        player.setMediaItem(builder.build(), ((plan.getDouble("position") - start).coerceAtLeast(0.0) * 1000).toLong())
        player.prepare(); player.setPlaybackSpeed(speed); player.playWhenReady = play
        persistRecovery()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        if ((!player.playWhenReady || player.playbackState == Player.STATE_ENDED) && !queue.isAdvancing) { stopPlayback(); stopSelf() }
    }

    override fun onDestroy() {
        persistRecovery()
        destroyed = true
        clearSubtitle()
        queue.clear()
        MediaAudioCoordinator.pauseMedia = null
        main.removeCallbacks(tick)
        saveFinalProgress()
        session?.release(); session = null
        player.release()
        progress.close()
        recoveryWorker.shutdown()
        super.onDestroy()
    }
    companion object { const val SUBTITLES = "reader.media.subtitles"; const val CONFIGURE = "reader.media.configure"; const val SLEEP = "reader.media.sleep"; const val CONTROL = "reader.media.control"; const val RECONNECT = "reader.media.reconnect"; const val PREVIOUS = "reader.media.previous"; const val NEXT = "reader.media.next" }
}
