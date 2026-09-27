package cool.cnb.reader.media

import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

class MediaLiveServerTest {
    @Test fun realServerAcceptsBackgroundProgressWithoutValidAccessTokenAndRevokesStreams() {
        val repo = System.getenv("MEDIA_NATIVE_REPO")
        assumeTrue("Set MEDIA_NATIVE_REPO for real server integration", !repo.isNullOrBlank())
        val server = ProcessBuilder("node", "--import", "./node_modules/tsx/dist/loader.mjs", "tools/media-native-fixture.ts")
            .directory(File(repo!!, "server")).redirectError(ProcessBuilder.Redirect.INHERIT).start()
        val reader = Executors.newSingleThreadExecutor()
        val failure = AtomicReference<Throwable>()
        val sync = MediaProgressSync { failure.set(AssertionError("sync failure: $it")) }
        try {
            val plan = JSONObject(reader.submit<String> { server.inputStream.bufferedReader().readLine() }.get(20, TimeUnit.SECONDS))
            val first = plan.getString("partId")
            val second = plan.getJSONArray("queue").getJSONObject(1).getString("partId")
            fun advance(id: String, part: String): JSONObject {
                val done = CountDownLatch(1); var result: Result<JSONObject>? = null
                sync.advance(id, 12.0, part, completed = false) { result = it; done.countDown() }
                assertTrue(done.await(15, TimeUnit.SECONDS))
                failure.get()?.let { throw AssertionError("native writer failed", it) }
                return result!!.getOrThrow()
            }
            sync.configure(plan)
            val next = advance(plan.getString("id"), second)
            assertEquals(43, next.getString("backgroundToken").length)
            next.put("accessToken", "deliberately-invalid-login-token")
            sync.configure(next)
            fun subtitle(id: String?): JSONObject {
                val done = CountDownLatch(1);var result:Result<JSONObject>?=null
                sync.subtitle(next.getString("id"),id){result=it;done.countDown()}
                assertTrue(done.await(15,TimeUnit.SECONDS));return result!!.getOrThrow()
            }
            val subtitleList=subtitle(null).getJSONArray("items")
            assertEquals(1,subtitleList.length())
            assertTrue(subtitle(subtitleList.getJSONObject(0).getString("id")).getString("webvtt").contains("原生字幕联调"))
            val returned = advance(next.getString("id"), first)
            assertEquals(first, returned.getString("partId"))
            fun status(path: String): Int {
                val connection = URI(plan.getString("baseUrl") + path).toURL().openConnection() as HttpURLConnection
                try { connection.connectTimeout=3000;connection.readTimeout=3000;return connection.responseCode } finally { connection.disconnect() }
            }
            assertEquals(200, status(returned.getString("streamUrl")))
            sync.configure(returned)
            fun progress(): JSONObject {
                val connection = URI(plan.getString("baseUrl") + "/api/v1/media/parts/$first/progress").toURL().openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout=3000;connection.readTimeout=3000
                    connection.setRequestProperty("Authorization", "Bearer " + plan.getString("accessToken"))
                    return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                } finally { connection.disconnect() }
            }
            sync.save(returned.getString("id"), 15.0, false)
            val savedUntil=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
            while(progress().getDouble("position")<15.0&&System.nanoTime()<savedUntil)Thread.sleep(25)
            assertEquals(15.0,progress().getDouble("position"),0.0)
            sync.finish(returned.getString("id"),19.25,false)
            // Service clear callbacks must not invalidate the already queued final snapshot.
            sync.clear()
            val until = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            var code = status(returned.getString("streamUrl"))
            while(code != 401 && System.nanoTime() < until) { Thread.sleep(25);code=status(returned.getString("streamUrl")) }
            assertEquals(401, code)
            assertEquals(19.25,progress().getDouble("position"),0.0);assertFalse(progress().getBoolean("completed"))
            // Simulate losing all writer memory, keeping only the credential-free snapshot.
            val snapshot = MediaRecoverySnapshot.create(returned, listOf(QueueEntry(first,"first"),QueueEntry(second,"second")),0,false,1.25f)
            val restoredWriter = MediaProgressSync { }
            try {
                val done = CountDownLatch(1); var restored: Result<JSONObject>? = null
                restoredWriter.restore(JSONObject(snapshot.toString()),plan) { restored=it;done.countDown() }
                assertTrue(done.await(15,TimeUnit.SECONDS))
                val recovered=restored!!.getOrThrow()
                assertNotEquals(returned.getString("id"),recovered.getString("id"))
                assertEquals(19.25,recovered.getDouble("position"),0.0)
                assertEquals(2,recovered.getJSONArray("queue").length())
                val staleDone=CountDownLatch(1);var stale:Result<JSONObject>?=null
                restoredWriter.restore(snapshot,plan){stale=it;staleDone.countDown()}
                assertTrue(staleDone.await(15,TimeUnit.SECONDS));assertTrue(stale!!.isFailure)
            } finally { restoredWriter.close() }
        } finally {
            sync.close();reader.shutdownNow()
            runCatching { server.outputStream.write(10);server.outputStream.flush() }
            if(!server.waitFor(5, TimeUnit.SECONDS))server.destroyForcibly()
        }
    }
}
