package cool.cnb.reader.media

import java.net.ServerSocket
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MediaProgressSyncTest {
    @Test fun lostResponseRetriesExactProgressBeforeSavingNewPosition() = responseRecovery(200)
    @Test fun rejectedAccessTokenResumesExactPendingProgressAfterReauthorization() = responseRecovery(401)
    private fun responseRecovery(firstStatus: Int) {
        val server = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
        server.soTimeout = 10000
        val calls = java.util.Collections.synchronizedList(mutableListOf<JSONObject>())
        val serverFailure = java.util.concurrent.atomic.AtomicReference<Throwable>()
        val serving = Thread {
            try {
                repeat(4) { index ->
                    server.accept().use { socket ->
                        socket.soTimeout = 10000
                        val reader = socket.getInputStream().bufferedReader()
                        reader.readLine()
                        var length = 0
                        var authorization = ""
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isEmpty()) break
                            if (line.startsWith("Content-Length:", ignoreCase = true)) length = line.substringAfter(':').trim().toInt()
                            if (line.startsWith("Authorization:", ignoreCase = true)) authorization = line.substringAfter(':').trim()
                        }
                        val chars = CharArray(length)
                        var received = 0
                        while (received < length) {
                            val count = reader.read(chars, received, length - received)
                            check(count > 0); received += count
                        }
                        calls.add(JSONObject(String(chars)))
                        assertEquals(if (index > 0 && firstStatus == 401) "Bearer refreshed" else "Bearer test-only", authorization)
                        // The server committed the first write, but its JSON response was truncated.
                        val response = when (index) {
                            0 -> "{"
                            1 -> "{\"revision\":8}"
                            2 -> "{\"revision\":9}"
                            else -> "{\"id\":\"next-session\"}"
                        }.toByteArray()
                        socket.getOutputStream().apply {
                            write("HTTP/1.1 ${if (index == 0) firstStatus else 200} Response\r\nContent-Length: ${response.size}\r\nConnection: close\r\n\r\n".toByteArray())
                            write(response); flush()
                        }
                    }
                }
            } catch (error: Throwable) { serverFailure.set(error) }
        }.apply { isDaemon = true; start() }
        val failures = mutableListOf<Boolean>(); var recovered = 0
        val sync = MediaProgressSync(onRecovered = { recovered++ }) { failures.add(it) }
        try {
            sync.configure(JSONObject().put("id", "session").put("revision", 7)
                .put("expiresAt", System.currentTimeMillis() + 21600000)
                .put("baseUrl", "http://127.0.0.1:${server.localPort}").put("userId", "user").put("accessToken", "test-only"))
            val firstDone = CountDownLatch(1)
            var first: Result<JSONObject>? = null
            sync.advance("session", 20.0, "next-part", completed = false) { first = it; firstDone.countDown() }
            assertTrue(firstDone.await(10, TimeUnit.SECONDS))
            assertTrue(first?.isFailure == true)
            if (firstStatus == 401) sync.reauthorize("http://127.0.0.1:${server.localPort}", "user", "refreshed")
            val retryDone = CountDownLatch(1)
            var retry: Result<JSONObject>? = null
            sync.advance("session", 40.0, "next-part", completed = false) { retry = it; retryDone.countDown() }
            assertTrue(retryDone.await(10, TimeUnit.SECONDS))
            serverFailure.get()?.let { throw AssertionError("test server failed", it) }
            assertTrue(retry?.isSuccess == true)
            assertEquals(4, calls.size)
            for (key in listOf("sequence", "revision", "position", "completed"))
                assertEquals(key, calls[0].get(key), calls[1].get(key))
            assertEquals(8, calls[2].getInt("revision"))
            assertEquals(calls[1].getInt("sequence") + 1, calls[2].getInt("sequence"))
            assertEquals(40.0, calls[2].getDouble("position"), 0.0)
            assertFalse(calls[0].getBoolean("completed")); assertFalse(calls[2].getBoolean("completed"))
            assertEquals("next-part", calls[3].getString("partId"))
            assertEquals(listOf(firstStatus == 401), failures); assertEquals(1, recovered)
        } finally { sync.close(); server.close(); serving.join(1000) }
    }

    @Test fun expiredSessionRenewsThenCompletesBeforeCreatingTheNextSession() {
        val server = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
        server.soTimeout = 10000
        val calls = java.util.Collections.synchronizedList(mutableListOf<Pair<String, JSONObject>>())
        val done = CountDownLatch(1)
        val serverFailure = java.util.concurrent.atomic.AtomicReference<Throwable>()
        val serving = Thread {
            try {
                repeat(3) {
                    server.accept().use { socket ->
                        socket.soTimeout = 10000
                        val reader = socket.getInputStream().bufferedReader()
                        val path = reader.readLine().split(' ')[1]
                        val headers = mutableMapOf<String, String>()
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isEmpty()) break
                            headers[line.substringBefore(':').lowercase()] = line.substringAfter(':').trim()
                        }
                        val bodyChars = CharArray(headers.getValue("content-length").toInt())
                        var received = 0
                        while (received < bodyChars.size) {
                            val count = reader.read(bodyChars, received, bodyChars.size-received)
                            check(count > 0); received += count
                        }
                        calls.add(path to JSONObject(String(bodyChars)))
                        assertEquals("Bearer test-only", headers["authorization"])
                        val response = when {
                            path.endsWith("/renew") -> JSONObject().put("expiresAt", System.currentTimeMillis()+21600000)
                            path.endsWith("/progress") -> JSONObject().put("revision", 8)
                            else -> JSONObject().put("id", "next-session")
                        }
                        val bytes = response.toString().toByteArray()
                        socket.getOutputStream().apply {
                            write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                            write(bytes); flush()
                        }
                    }
                }
            } catch (error: Throwable) { serverFailure.set(error); done.countDown() }
        }.apply { isDaemon = true; start() }
        val failures = mutableListOf<Boolean>()
        val sync = MediaProgressSync { failures.add(it) }
        try {
            sync.configure(JSONObject().put("id", "session").put("revision", 7).put("expiresAt", 0)
                .put("baseUrl", "http://127.0.0.1:${server.localPort}").put("accessToken", "test-only")
                .put("start", 5).put("end", 50))
            var next: JSONObject? = null
            var failure: Throwable? = null
            sync.advance("session", 65.0, "next-part") { result ->
                result.fold({ next = it }, { failure = it }); done.countDown()
            }
            assertTrue("background save completed", done.await(10, TimeUnit.SECONDS))
            serverFailure.get()?.let { throw AssertionError("test HTTP server failed", it) }
            failure?.let { throw AssertionError("native transition failed", it) }
            assertEquals(3, calls.size)
            assertTrue(calls[0].first.endsWith("/renew"))
            assertEquals(50.0, calls[1].second.getDouble("position"), 0.0)
            assertEquals(7, calls[1].second.getInt("revision"))
            assertTrue(calls[1].second.getBoolean("completed"))
            assertEquals("/api/v1/media/playback", calls[2].first)
            assertEquals("next-part", calls[2].second.getString("partId"))
            assertEquals("next-session", next?.getString("id"))
            assertTrue(failures.isEmpty())
        } finally { sync.close(); server.close(); serving.join(1000) }
    }
}
