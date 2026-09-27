package cool.cnb.reader.media

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MediaRecoverySnapshotTest {
    @Test fun snapshotContainsNoCredentialsTicketsOrStalePosition() {
        val plan = JSONObject().put("userId", "user").put("baseUrl", "https://reader.test/").put("id", "session")
            .put("accessToken", "secret").put("backgroundToken", "secret").put("streamUrl", "secret").put("position", 90)
        val snapshot = MediaRecoverySnapshot.create(plan, listOf(QueueEntry("part", "chapter")), 0, false, 1.5f, 1000)
        assertFalse(snapshot.has("accessToken")); assertFalse(snapshot.has("backgroundToken"))
        assertFalse(snapshot.has("streamUrl")); assertFalse(snapshot.has("position"))
        assertEquals("https://reader.test", snapshot.getString("baseUrl"))
        assertEquals("session", snapshot.getString("previousSessionId"))
        assertEquals(1.5, snapshot.getDouble("speed"), 0.0)
        assertThrows(IllegalArgumentException::class.java) { MediaRecoverySnapshot.validate(snapshot, 1000 + 8L * 24 * 60 * 60 * 1000) }
        assertThrows(IllegalArgumentException::class.java) { MediaRecoverySnapshot.validate(snapshot, 999) }
        assertThrows(IllegalArgumentException::class.java) { MediaRecoverySnapshot.validate(JSONObject(snapshot.toString()).put("queueIndex", 1), 1000) }
        assertThrows(IllegalArgumentException::class.java) { MediaRecoverySnapshot.validate(JSONObject(snapshot.toString()).put("baseUrl", "https://user:password@reader.test"), 1000) }
    }
}
