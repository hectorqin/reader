package cool.cnb.reader.media

import androidx.media3.common.Player
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test

class QueueSessionPlayerTest {
    @Test fun sessionCommandsNeverBypassQueueIntent() {
        val rawCommands = mutableListOf<String>()
        val delegate = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { _, method, _ ->
            rawCommands.add(method.name)
            null
        } as Player
        val intents = mutableListOf<String>()
        val player = QueueSessionPlayer(delegate, { intents.add("resume") }, { intents.add("pause") }, { intents.add("stop") })
        player.play(); player.pause(); player.playWhenReady = true; player.playWhenReady = false; player.stop()
        assertEquals(listOf("resume", "pause", "resume", "pause", "stop"), intents)
        assertTrue(rawCommands.isEmpty())
    }
}
