package cool.cnb.reader.media

import org.junit.Assert.*
import org.junit.Test

class SubtitleRequestGateTest {
    @Test fun newerSelectionOwnsStatusEvenWhenEarlierRequestCompletesLast() {
        val gate = SubtitleRequestGate()
        val listing = gate.begin("episode-1")
        assertTrue(gate.accepts(listing, "episode-1"))
        val firstSelection = gate.begin("episode-1")
        val secondSelection = gate.begin("episode-1")
        val statuses = mutableListOf<String>()
        fun complete(ticket: SubtitleRequestGate.Ticket, status: String) {
            if (gate.accepts(ticket, "episode-1")) statuses.add(status)
        }
        complete(secondSelection, "loaded")
        complete(firstSelection, "failed")
        complete(listing, "old-dialog")
        assertEquals(listOf("loaded"), statuses)
    }

    @Test fun switchingAwayAndBackOrStoppingCannotReviveOldDialogs() {
        val gate = SubtitleRequestGate()
        val oldDialog = gate.begin("episode-1")
        gate.observeSession("episode-2")
        assertFalse(gate.accepts(oldDialog, "episode-2"))
        gate.observeSession("episode-1")
        assertFalse(gate.accepts(oldDialog, "episode-1"))
        val active = gate.begin("episode-1")
        gate.observeSession("episode-1")
        assertTrue(gate.accepts(active, "episode-1"))
        gate.invalidate()
        assertFalse(gate.accepts(active, "episode-1"))
        assertTrue(gate.accepts(gate.begin("episode-1"), "episode-1"))
    }
}
