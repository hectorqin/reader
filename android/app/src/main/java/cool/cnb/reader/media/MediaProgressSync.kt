package cool.cnb.reader.media

import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Executors
import org.json.JSONObject

/** A serial writer independent of WebView timers. Credentials stay in service memory only. */
class MediaProgressSync(private val onRecovered: () -> Unit = {}, private val onFailure: (Boolean) -> Unit) {
    private val worker = Executors.newSingleThreadExecutor()
    private val subtitleWorker = Executors.newSingleThreadExecutor()
    @Volatile private var generation = 0L
    @Volatile private var configuredSessionId: String? = null
    private var config: JSONObject? = null
    private var sequence = 0
    private var revision = 0L
    private var expiresAt = 0L
    private var lastPosition: Double? = null
    private var lastCompleted = false
    private var blocked = false
    private var retryAfter = 0L
    private var pendingProgress: JSONObject? = null
    @Volatile private var busy = false
    private var reportedFailure = false
    private var backgroundReady = false

    fun configure(value: JSONObject) {
        configuredSessionId = value.getString("id")
        val epoch = ++generation
        worker.execute {
            if (epoch != generation) return@execute
            val plan = JSONObject(value.toString())
            val old = config
            if (old != null && old.optString("backgroundToken") != plan.optString("backgroundToken")) revoke(old)
            config = plan; sequence = 0; revision = value.getLong("revision"); expiresAt = value.getLong("expiresAt")
            lastPosition = null; lastCompleted = false; blocked = false; retryAfter = 0L
            pendingProgress = null
            reportedFailure = false
            backgroundReady = !plan.has("queue") || plan.has("backgroundToken")
            try {
                if (!backgroundReady) prepareBackground(plan, epoch)
            } catch (_: Exception) {
                if (epoch == generation) { blocked = true; reportedFailure = true; onFailure(true) }
                // A lost renewal response may already have bound the session. Keep its
                // grant for an exact retry; revoking it would delete the live session.
                else revoke(plan)
            }
        }
    }

    private fun prepareBackground(plan: JSONObject, epoch: Long) {
        if (!plan.has("backgroundToken")) {
            val entries = plan.getJSONArray("queue")
            val ids = org.json.JSONArray()
            for (index in 0 until entries.length()) ids.put(entries.getJSONObject(index).getString("partId"))
            val grant = request(plan, "background-grants", "POST", JSONObject().put("partIds", ids))
            plan.put("backgroundToken", grant.getString("token")).put("backgroundExpiresAt", grant.getLong("expiresAt"))
        }
        check(epoch == generation)
        expiresAt = request(plan, "playback/${plan.getString("id")}/renew", "POST", JSONObject()).getLong("expiresAt")
        check(epoch == generation)
        backgroundReady = true
    }

    fun save(sessionId: String, position: Double, completed: Boolean) {
        if (busy || !position.isFinite() || position < 0) return
        busy = true
        val epoch = generation
        worker.execute {
            try {
                val plan = config ?: return@execute
                if (epoch != generation) return@execute
                if (blocked || System.currentTimeMillis() < retryAfter) return@execute
                if (plan.getString("id") != sessionId) return@execute
                saveNow(plan, position, completed)
                if (epoch == generation) recovered()
            } catch (error: Exception) {
                if (epoch == generation) {
                    blocked = error is Rejected && error.status in listOf(401, 403, 404, 409)
                    retryAfter = System.currentTimeMillis() + 30000
                    reportedFailure = true
                    onFailure(blocked)
                }
            } finally { busy = false }
        }
    }

    /** Queue transition shares the writer so completion is committed before the next session is created. */
    fun advance(sessionId: String, position: Double, nextPartId: String, completed: Boolean = true, callback: (Result<JSONObject>) -> Unit) {
        val epoch = generation
        worker.execute {
            val result = runCatching {
                check(epoch == generation && !blocked)
                val plan = checkNotNull(config)
                check(plan.getString("id") == sessionId)
                saveNow(plan, position, completed)
                check(epoch == generation)
                val next = request(plan, "playback", "POST", JSONObject().put("partId", nextPartId))
                check(epoch == generation)
                recovered()
                next.put("baseUrl", plan.getString("baseUrl")).put("accessToken", plan.getString("accessToken"))
                    .put("queueId", plan.optString("queueId"))
                    .put("userId", plan.optString("userId"))
                if (plan.has("backgroundToken")) next.put("backgroundToken", plan.getString("backgroundToken")).put("backgroundExpiresAt", plan.getLong("backgroundExpiresAt"))
                next
            }
            if (epoch == generation && result.isFailure) {
                val error = result.exceptionOrNull()
                blocked = blocked || error is Rejected && error.status in listOf(401, 403, 404, 409)
                reportedFailure = true
                onFailure(blocked)
            }
            callback(result)
        }
    }
    private fun recovered() {
        if (reportedFailure) { reportedFailure = false; onRecovered() }
    }

    private fun saveNow(plan: JSONObject, position: Double, completed: Boolean) {
        val id = plan.getString("id")
        if (expiresAt <= System.currentTimeMillis() + 120000)
            expiresAt = request(plan, "playback/$id/renew", "POST", JSONObject()).getLong("expiresAt")
        if (pendingProgress != null) commitPending(plan)
        val bounded = position.coerceAtLeast(plan.optDouble("start", 0.0)).let {
            if (plan.isNull("end")) it else it.coerceAtMost(plan.getDouble("end"))
        }
        if (bounded == lastPosition && completed == lastCompleted) return
        pendingProgress = JSONObject().put("sequence", sequence++).put("revision", revision)
            .put("position", bounded).put("completed", completed)
        commitPending(plan)
    }

    private fun commitPending(plan: JSONObject) {
        val payload = pendingProgress ?: return
        val result = request(plan, "playback/${plan.getString("id")}/progress", "PUT", payload)
        revision = result.getLong("revision")
        lastPosition = payload.getDouble("position"); lastCompleted = payload.getBoolean("completed"); retryAfter = 0L
        pendingProgress = null
    }

    fun reauthorize(baseUrl: String, userId: String, accessToken: String) {
        val epoch = generation
        worker.execute {
            val plan = config ?: return@execute
            if (epoch != generation) return@execute
            if (plan.optString("baseUrl").trimEnd('/') != baseUrl.trimEnd('/') || plan.optString("userId") != userId) return@execute
            plan.put("accessToken", accessToken)
            try {
                if (!backgroundReady) prepareBackground(plan, epoch)
                else if (plan.has("backgroundToken")) {
                    expiresAt = request(plan, "playback/${plan.getString("id")}/renew", "POST", JSONObject()).getLong("expiresAt")
                }
                if (epoch == generation) { blocked = false; retryAfter = 0L }
            } catch (_: Exception) {
                if (epoch == generation) { blocked = true; reportedFailure = true; onFailure(true) }
            }
        }
    }

    /** Use a fresh authenticated session and the server's latest position, never a saved ticket. */
    fun restore(snapshot: JSONObject, credentials: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        val epoch = generation
        worker.execute {
            val result = runCatching {
                MediaRecoverySnapshot.validate(snapshot)
                require(snapshot.getString("userId") == credentials.getString("userId") && snapshot.getString("baseUrl") == credentials.getString("baseUrl"))
                check(epoch == generation)
                val part = snapshot.getJSONArray("queue").getJSONObject(snapshot.getInt("queueIndex")).getString("partId")
                val plan = request(credentials, "playback/recover", "POST", JSONObject().put("partId", part).put("previousSessionId", snapshot.getString("previousSessionId")))
                check(epoch == generation)
                plan.put("baseUrl", credentials.getString("baseUrl")).put("userId", credentials.getString("userId"))
                    .put("accessToken", credentials.getString("accessToken")).put("queue", snapshot.getJSONArray("queue"))
                    .put("queueId", snapshot.optString("queueId")).put("queueIndex", snapshot.getInt("queueIndex"))
                    .put("video", snapshot.optBoolean("video"))
            }
            callback(result)
        }
    }

    fun subtitle(sessionId: String, subtitleId: String?, callback: (Result<JSONObject>) -> Unit) {
        val epoch = generation
        worker.execute {
            val captured = runCatching {
                val plan = checkNotNull(config)
                check(epoch == generation && plan.getString("id") == sessionId && backgroundReady && plan.has("backgroundToken"))
                JSONObject(plan.toString())
            }
            if (captured.isFailure) { callback(Result.failure(captured.exceptionOrNull()!!)); return@execute }
            subtitleWorker.execute {
              val result = runCatching {
                check(epoch == generation)
                val plan = captured.getOrThrow()
                val suffix = if (subtitleId == null) "" else "/" + java.net.URLEncoder.encode(subtitleId, "UTF-8")
                val value = request(plan, "playback/$sessionId/subtitles$suffix", "GET", JSONObject(), if (subtitleId == null) 65536 else 8 * 1024 * 1024)
                check(epoch == generation); value
            }
              callback(result)
            }
        }
    }

    private fun request(plan: JSONObject, path: String, method: String, body: JSONObject, limit: Int = 65536): JSONObject {
        val base = plan.getString("baseUrl").trimEnd('/')
        val uri = URI(base)
        require(uri.scheme in listOf("http", "https") && uri.userInfo == null && uri.query == null && uri.fragment == null)
        val background = plan.optString("backgroundToken")
        val endpoint = if (background.isNotEmpty() && path.startsWith("playback")) "background/$path" else path
        val connection = URI("$base/api/v1/media/$endpoint").toURL().openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false; connection.useCaches = false
            connection.connectTimeout = 10000; connection.readTimeout = if (method == "GET") 35000 else 10000
            val hasBody = method != "DELETE" && method != "GET"
            connection.requestMethod = method; connection.doOutput = hasBody
            if (background.isNotEmpty()) connection.setRequestProperty("X-Media-Background", background)
            else connection.setRequestProperty("Authorization", "Bearer " + plan.getString("accessToken"))
            if (hasBody) connection.setRequestProperty("Content-Type", "application/json")
            if (hasBody) connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            if (connection.responseCode !in 200..299) throw Rejected(connection.responseCode)
            if (connection.responseCode == 204) return JSONObject()
            val bytes = connection.inputStream.use { it.readBytesBounded(limit) }
            return JSONObject(bytes.toString(Charsets.UTF_8))
        } finally { connection.disconnect() }
    }

    private fun java.io.InputStream.readBytesBounded(limit: Int): ByteArray {
        val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
        while (true) { val count = read(buffer); if (count < 0) break; require(output.size() + count <= limit); output.write(buffer, 0, count) }
        return output.toByteArray()
    }
    private fun revoke(plan: JSONObject) { if (plan.has("backgroundToken")) runCatching { request(plan, "background-grants/current", "DELETE", JSONObject()) } }
    /** The final snapshot is ordered before revocation and is never dropped by the periodic-save busy flag. */
    fun finish(sessionId: String, position: Double, completed: Boolean) {
        // A late stop from the previous item must not cancel a queued configuration.
        if (configuredSessionId != sessionId) return
        configuredSessionId = null
        ++generation
        worker.execute {
            val plan = config ?: return@execute
            if (plan.optString("id") != sessionId) return@execute
            try {
                if (position.isFinite() && position >= 0 && !blocked)
                    saveNow(plan, position, completed)
            } catch (_: Exception) { onFailure(false) }
            finally { revoke(plan); config = null }
        }
    }
    fun clear() { configuredSessionId = null; val epoch = ++generation; worker.execute { if (epoch == generation) { config?.let { revoke(it) }; config = null } } }
    fun close() { configuredSessionId = null; worker.execute { config?.let { revoke(it) }; config = null; subtitleWorker.shutdown() }; worker.shutdown() }
    private class Rejected(val status: Int) : Exception("media request rejected")
}
