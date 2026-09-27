package cool.cnb.reader.media

import java.net.ServerSocket
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class MediaBackgroundSyncTest {
    @Test fun backgroundGrantOwnsRenewalProgressAdvanceAndRevocation() = backgroundFlow(-1)
    @Test fun failedGrantCreationRetriesAfterReauthorization() = backgroundFlow(0)
    @Test fun lostBindingResponseRetriesWithoutRevokingTheLiveSession() = backgroundFlow(1)

    private fun backgroundFlow(failAt: Int) {
        val server = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1")); server.soTimeout = 10000
        val failure = AtomicReference<Throwable>()
        val revoked = CountDownLatch(1)
        val initialFailure = CountDownLatch(1)
        val token = "b".repeat(43)
        val paths = listOf("POST /api/v1/media/background-grants", "POST /api/v1/media/background/playback/session/renew",
            "PUT /api/v1/media/background/playback/session/progress", "POST /api/v1/media/background/playback",
            "PUT /api/v1/media/background/playback/next-session/progress", "POST /api/v1/media/background/playback",
            "DELETE /api/v1/media/background-grants/current")
        val serving = Thread {
            try {
                val attempts = paths.indices.flatMap { if (it == failAt) listOf(it to true, it to false) else listOf(it to false) }
                attempts.forEach { (index, shouldFail) -> server.accept().use { socket ->
                    socket.soTimeout = 10000
                    val reader = socket.getInputStream().bufferedReader()
                    assertEquals(paths[index], reader.readLine().substringBefore(" HTTP/"))
                    val headers = mutableMapOf<String, String>()
                    while (true) { val line = reader.readLine(); if (line.isNullOrEmpty()) break; headers[line.substringBefore(':').lowercase()] = line.substringAfter(':').trim() }
                    val body = CharArray(headers["content-length"]?.toInt() ?: 0)
                    var offset = 0
                    while (offset < body.size) { val count = reader.read(body, offset, body.size-offset); check(count > 0); offset += count }
                    if (index == 0) {
                        assertEquals("Bearer foreground-only", headers["authorization"])
                        assertEquals(listOf("a", "b"), JSONObject(String(body)).getJSONArray("partIds").let { (0 until it.length()).map(it::getString) })
                    } else { assertNull(headers["authorization"]); assertEquals(token, headers["x-media-background"]) }
                    if (index == 2) assertFalse(JSONObject(String(body)).getBoolean("completed"))
                    if (index == 3) assertEquals("b", JSONObject(String(body)).getString("partId"))
                    if (index == 4) {
                        assertEquals(23.0, JSONObject(String(body)).getDouble("position"), 0.0)
                        assertFalse(JSONObject(String(body)).getBoolean("completed"))
                    }
                    if (index == 6) assertNull(headers["content-type"])
                    val response = if (shouldFail) "{".toByteArray() else when (index) {
                        0 -> JSONObject().put("token", token).put("expiresAt", System.currentTimeMillis()+86400000)
                        1 -> JSONObject().put("expiresAt", System.currentTimeMillis()+21600000)
                        2, 4 -> JSONObject().put("revision", 8)
                        else -> JSONObject().put("id", "next-session").put("revision", 7).put("expiresAt", System.currentTimeMillis()+21600000)
                    }.toString().toByteArray()
                    socket.getOutputStream().apply {
                        if (index == 6) write("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n".toByteArray())
                        else { write("HTTP/1.1 ${if (shouldFail && index == 0) "401 Unauthorized" else "200 OK"}\r\nContent-Length: ${response.size}\r\nConnection: close\r\n\r\n".toByteArray()); write(response) }
                        flush()
                    }
                } }
            } catch (error: Throwable) { failure.set(error) } finally { revoked.countDown() }
        }.apply { isDaemon = true; start() }
        val sync = MediaProgressSync {
            if (failAt >= 0 && initialFailure.count > 0) initialFailure.countDown()
            else failure.set(AssertionError("unexpected sync failure: $it"))
        }
        try {
            sync.configure(JSONObject().put("id", "session").put("revision", 7).put("expiresAt", 0)
                .put("baseUrl", "http://127.0.0.1:${server.localPort}").put("accessToken", "foreground-only").put("userId", "user")
                .put("queue", JSONArray().put(JSONObject().put("partId", "a")).put(JSONObject().put("partId", "b"))))
            if (failAt >= 0) {
                assertTrue("initial authorization failure reported", initialFailure.await(10, TimeUnit.SECONDS))
                sync.reauthorize("http://127.0.0.1:${server.localPort}", "user", "foreground-only")
            }
            val done = CountDownLatch(1); var next: Result<JSONObject>? = null
            sync.advance("session", 12.0, "b", completed = false) { next = it; done.countDown() }
            assertTrue(done.await(10, TimeUnit.SECONDS)); assertTrue(next?.isSuccess == true)
            assertEquals(token, next!!.getOrThrow().getString("backgroundToken"))
            sync.configure(next!!.getOrThrow())
            sync.finish("session", 12.0, false)
            val continued = CountDownLatch(1); var continuedResult: Result<JSONObject>? = null
            sync.advance("next-session", 23.0, "a", completed = false) { continuedResult = it; continued.countDown() }
            assertTrue(continued.await(10, TimeUnit.SECONDS))
            assertTrue("late finish must preserve the new session", continuedResult?.isSuccess == true)
            sync.clear(); assertTrue(revoked.await(10, TimeUnit.SECONDS)); failure.get()?.let { throw AssertionError("HTTP test failed", it) }
        } finally { sync.close(); server.close(); serving.join(1000) }
    }
}
