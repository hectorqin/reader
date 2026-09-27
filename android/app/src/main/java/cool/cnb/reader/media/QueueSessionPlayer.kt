package cool.cnb.reader.media

import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player

/** Session controllers must use queue intent, including while a network transition is pending. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class QueueSessionPlayer(
    player: Player,
    private val resumeQueue: () -> Unit,
    private val pauseQueue: () -> Unit,
    private val stopQueue: () -> Unit,
) : ForwardingPlayer(player) {
    override fun play() = resumeQueue()
    override fun pause() = pauseQueue()
    override fun setPlayWhenReady(playWhenReady: Boolean) {
        if (playWhenReady) resumeQueue() else pauseQueue()
    }
    override fun stop() = stopQueue()
}
