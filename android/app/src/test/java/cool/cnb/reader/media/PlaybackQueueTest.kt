package cool.cnb.reader.media

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlaybackQueueTest {
    @Test fun editsPreserveCurrentOccurrenceAndRejectStaleOrAdvancingCommands() {
        val requested=mutableListOf<String>()
        val queue=PlaybackQueue({_,_,part,_,_->requested.add(part)},{_,_,_,_->fail()},{fail()})
        queue.configure(listOf(QueueEntry("a","first"),QueueEntry("a","repeat"),QueueEntry("b","last")),1,"s")
        val original=queue.revision
        assertFalse(queue.edit("s",original,1,0))
        assertTrue(queue.edit("s",original,1,-1))
        assertEquals(0,queue.currentIndex);assertEquals("repeat",queue.snapshot[0].title)
        assertFalse(queue.edit("s",original,2,0))
        assertTrue(queue.edit("s",queue.revision,1,0))
        assertEquals(listOf("repeat","last"),queue.snapshot.map { it.title });assertTrue(requested.isEmpty())
        assertTrue(queue.move("s",12.0,1));assertEquals(listOf("b"),requested)
        assertFalse(queue.edit("s",queue.revision,1,0))
    }
    @Test fun arbitrarySelectionSavesIncompleteProgressAndRejectsStaleCommands() {
        var done: ((Result<JSONObject>) -> Unit)? = null
        val requests = mutableListOf<Pair<String, Boolean>>()
        val queue = PlaybackQueue({ _, _, next, completed, callback -> requests.add(next to completed); done = callback }, { _, _, _, _ -> }, { fail() })
        queue.configure(entries, 0, "session")
        assertFalse(queue.select("stale", 1.0, 2)); assertFalse(queue.select("session", 1.0, 3)); assertFalse(queue.select("session", 1.0, 0))
        assertTrue(queue.select("session", 12.0, 2)); assertFalse(queue.select("session", 12.0, 1))
        assertEquals(listOf("a" to false), requests)
        done!!(Result.success(JSONObject().put("id", "new-session")))
        assertEquals(2, queue.currentIndex); assertEquals(entries, queue.snapshot)
    }
    @Test fun resumeDuringManualTransitionOnlyStartsTheIncomingItem() {
        var done: ((Result<JSONObject>) -> Unit)? = null
        val started = mutableListOf<Pair<String, Boolean>>()
        val queue = PlaybackQueue({ _, _, _, _, callback -> done = callback },
            { _, entry, _, play -> started.add(entry.partId to play) }, { fail() })
        queue.configure(entries, 0, "current")
        assertTrue(queue.move("current", 15.0, 1))
        queue.pause()
        assertFalse(queue.resume())
        assertTrue(started.isEmpty())
        done!!(Result.success(JSONObject().put("id", "incoming")))
        assertEquals(listOf("b" to true), started)
        assertTrue(queue.resume())
    }
    @Test fun manualMovesKeepUnfinishedProgressAndBlockDuplicateRequests() {
        val requests = mutableListOf<Pair<String, Boolean>>()
        var callback: ((Result<JSONObject>) -> Unit)? = null
        val ready = mutableListOf<Pair<Int, Boolean>>()
        val queue = PlaybackQueue({ _, _, next, completed, done -> requests.add(next to completed); callback = done },
            { _, _, index, play -> ready.add(index to play) }, { fail() })
        queue.configure(entries, 1, "s1")
        assertTrue(queue.canPrevious); assertTrue(queue.canNext)
        assertTrue(queue.move("s1", 12.0, -1)); assertFalse(queue.move("s1", 12.0, -1))
        assertFalse(queue.canPrevious); assertFalse(queue.canNext)
        queue.pause(); callback!!(Result.success(JSONObject().put("id", "s2")))
        assertEquals(listOf("a" to false), requests); assertEquals(listOf(0 to false), ready)
        assertFalse(queue.canPrevious); assertTrue(queue.canNext)
        assertFalse(queue.move("s2", 1.0, -1)); assertFalse(queue.move("stale", 1.0, 1))
        assertTrue(queue.move("s2", 1.0, 1)); callback!!(Result.success(JSONObject().put("id", "s3")))
        assertEquals(listOf("a" to false, "b" to false), requests)
    }
    private val entries = listOf(QueueEntry("a", "第一章"), QueueEntry("b", "第二章"), QueueEntry("a", "重播第一章"))
    @Test fun repeatedEndEventsCreateOneRequestAndPreserveDuplicateParts() {
        val calls = mutableListOf<String>(); val ready = mutableListOf<Triple<String, Int, Boolean>>()
        var finish: ((Result<JSONObject>) -> Unit)? = null
        val queue = PlaybackQueue({ id, position, next, _, done -> assertEquals("s1", id); assertEquals(60.0, position, 0.0); calls.add(next); finish = done },
            { _, entry, index, play -> ready.add(Triple(entry.partId, index, play)) }, { fail("unexpected queue error") })
        queue.configure(entries, 0, "s1")
        assertTrue(queue.ended("s1", 60.0)); assertTrue(queue.ended("s1", 60.0))
        assertEquals(listOf("b"), calls)
        finish!!(Result.success(JSONObject().put("id", "s2")))
        assertEquals(listOf(Triple("b", 1, true)), ready)
        assertFalse(queue.ended("s1", 60.0))
    }
    @Test fun pauseDuringRequestPreparesNextItemWithoutAutoplay() {
        var finish: ((Result<JSONObject>) -> Unit)? = null
        var playResult: Boolean? = null
        val queue = PlaybackQueue({ _, _, _, _, done -> finish = done }, { _, _, _, play -> playResult = play }, { fail() })
        queue.configure(entries, 0, "s1"); queue.ended("s1", 1.0); queue.pause()
        finish!!(Result.success(JSONObject().put("id", "s2")))
        assertEquals(false, playResult)
    }
    @Test fun stopOrReplacementInvalidatesLateNetworkResults() {
        val callbacks = mutableListOf<(Result<JSONObject>) -> Unit>(); var started = 0
        val queue = PlaybackQueue({ _, _, _, _, done -> callbacks.add(done) }, { _, _, _, _ -> started++ }, { fail() })
        queue.configure(entries, 0, "s1"); queue.ended("s1", 1.0); queue.clear()
        callbacks[0](Result.success(JSONObject().put("id", "stale")))
        assertEquals(0, started)
        queue.configure(entries, 0, "s2"); queue.ended("s2", 1.0); queue.configure(entries, 2, "s3")
        callbacks[1](Result.success(JSONObject().put("id", "stale2")))
        assertEquals(0, started); assertFalse(queue.ended("s3", 1.0))
    }
    @Test fun aFailedTransitionWaitsForExplicitResumeAndRetriesSameEntry() {
        val requested = mutableListOf<String>(); var errors = 0
        val queue = PlaybackQueue({ _, _, next, _, done -> requested.add(next); done(Result.failure(IllegalStateException("offline"))) },
            { _, _, _, _ -> fail() }, { errors++ })
        queue.configure(entries, 0, "s1"); queue.ended("s1", 1.0)
        assertFalse(queue.ended("s1", 1.0)); assertEquals(1, errors)
        queue.resume(); queue.ended("s1", 1.0)
        assertEquals(listOf("b", "b"), requested)
    }
    @Test fun duplicatePartIdsRemainIndependentQueueEntries() {
        val requested = mutableListOf<String>(); val titles = mutableListOf<String>()
        val queue = PlaybackQueue({ _, _, next, _, done -> requested.add(next); done(Result.success(JSONObject().put("id", "next"))) },
            { _, entry, _, _ -> titles.add(entry.title) }, { fail() })
        queue.configure(entries, 1, "s2"); queue.ended("s2", 1.0)
        assertEquals(listOf("a"), requested); assertEquals(listOf("重播第一章"), titles)
    }
}
