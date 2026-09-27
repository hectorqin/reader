package cool.cnb.reader.media

import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

/** Only identities and preferences survive; tokens, stream URLs and local positions never do. */
object MediaRecoverySnapshot {
    fun create(plan: JSONObject, entries: List<QueueEntry>, index: Int, video: Boolean, speed: Float, now: Long = System.currentTimeMillis()): JSONObject {
        val value = JSONObject().put("version", 1).put("savedAt", now)
            .put("userId", plan.getString("userId")).put("baseUrl", plan.getString("baseUrl").trimEnd('/'))
            .put("queueId", plan.optString("queueId")).put("queueIndex", index).put("video", video).put("speed", speed.toDouble())
            .put("previousSessionId", plan.getString("id"))
            .put("queue", JSONArray().apply { entries.forEach { put(JSONObject().put("partId", it.partId).put("title", it.title.take(64))) } })
        return validate(value, now)
    }

    fun validate(value: JSONObject, now: Long = System.currentTimeMillis()): JSONObject {
        require(value.getInt("version") == 1)
        val age = now - value.getLong("savedAt")
        require(age in 0..7L * 24 * 60 * 60 * 1000)
        require(value.getString("userId").length in 1..200)
        require(value.getString("previousSessionId").length in 1..100)
        val base = URI(value.getString("baseUrl"))
        require(base.scheme in listOf("http", "https") && base.host != null && base.userInfo == null && base.query == null && base.fragment == null)
        val entries = value.getJSONArray("queue")
        require(entries.length() in 1..2000 && value.getInt("queueIndex") in 0 until entries.length())
        for (index in 0 until entries.length()) {
            val entry = entries.getJSONObject(index)
            require(entry.getString("partId").length in 1..100 && entry.getString("title").length <= 64)
        }
        val speed = value.getDouble("speed")
        require(speed.isFinite() && speed in 0.25..4.0)
        return value
    }
}
