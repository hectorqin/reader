package cool.cnb.reader.media

import org.json.JSONObject

data class QueueEntry(val partId: String, val title: String)

/** All callbacks run on the owner thread; generations prevent late requests from restarting playback. */
class PlaybackQueue(
    private val loadNext: (String, Double, String, Boolean, (Result<JSONObject>) -> Unit) -> Unit,
    private val onReady: (JSONObject, QueueEntry, Int, Boolean) -> Unit,
    private val onError: () -> Unit,
    private val onChanged: () -> Unit = {},
) {
    private var entries: List<QueueEntry> = emptyList()
    private var index = 0
    private var sessionId = ""
    private var generation = 0
    private var pending = false
    private var wantsPlay = true
    var revision = 0L
        private set
    val isAdvancing: Boolean get() = pending
    val canPrevious: Boolean get() = !pending && index > 0 && entries.isNotEmpty()
    val canNext: Boolean get() = !pending && index + 1 < entries.size
    val snapshot: List<QueueEntry> get() = entries.toList()
    val currentIndex: Int get() = index

    fun configure(items: List<QueueEntry>, selected: Int, id: String) {
        require(items.size in 1..2000 && selected in items.indices)
        require(items.all { it.partId.isNotBlank() && it.partId.length <= 100 && it.title.length <= 1000 })
        generation++; entries = items.toList(); index = selected; sessionId = id; pending = false; wantsPlay = true
        revision++
        onChanged()
    }

    /** Editing retains the current session and never expands the authorized part set. */
    fun edit(id: String, expectedRevision: Long, target: Int, direction: Int): Boolean {
        if (id != sessionId || pending || revision != expectedRevision || target !in entries.indices || direction !in -1..1) return false
        val next = entries.toMutableList()
        if (direction == 0) {
            if (target == index) return false
            next.removeAt(target); if (target < index) index--
        } else {
            val destination = target + direction
            if (destination !in entries.indices) return false
            java.util.Collections.swap(next, target, destination)
            if (index == target) index = destination else if (index == destination) index = target
        }
        entries = next; revision++; onChanged(); return true
    }

    fun ended(id: String, position: Double): Boolean {
        if (id != sessionId || entries.isEmpty()) return false
        if (pending) return true
        if (!wantsPlay || index + 1 >= entries.size) return false
        return transition(id, position, index + 1, true)
    }
    fun move(id: String, position: Double, direction: Int): Boolean {
        if (id != sessionId || pending || direction !in listOf(-1, 1) || index + direction !in entries.indices) return false
        return select(id, position, index + direction)
    }
    fun select(id: String, position: Double, target: Int): Boolean {
        if (id != sessionId || pending || target !in entries.indices || target == index) return false
        wantsPlay = true
        return transition(id, position, target, false)
    }
    private fun transition(id: String, position: Double, target: Int, completed: Boolean): Boolean {
        val epoch = generation
        val next = entries[target]
        pending = true
        onChanged()
        loadNext(id, position, next.partId, completed) { result ->
            if (epoch != generation) return@loadNext
            pending = false
            result.fold(onSuccess = { plan ->
                index = target; sessionId = plan.getString("id")
                onReady(plan, next, index, wantsPlay)
            }, onFailure = { wantsPlay = false; onError() })
            onChanged()
        }
        return true
    }
    fun pause() { wantsPlay = false }
    /** False means a transition owns playback; do not restart the outgoing item. */
    fun resume(): Boolean { wantsPlay = true; return !pending }
    fun clear() { generation++; revision++; entries = emptyList(); sessionId = ""; pending = false; wantsPlay = false; onChanged() }
}
