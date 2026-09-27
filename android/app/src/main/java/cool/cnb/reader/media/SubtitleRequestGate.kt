package cool.cnb.reader.media

/** Main-thread ownership of subtitle UI callbacks; independent of player/network lifetime. */
internal class SubtitleRequestGate {
    data class Ticket(val sessionId: String, val revision: Long)
    private var revision = 0L
    private var sessionId: String? = null

    fun observeSession(current: String?) {
        if (sessionId != current) { sessionId = current; revision++ }
    }

    fun begin(current: String): Ticket {
        observeSession(current)
        return Ticket(current, ++revision)
    }

    fun accepts(ticket: Ticket, current: String?): Boolean =
        ticket.revision == revision && ticket.sessionId == sessionId && ticket.sessionId == current

    fun invalidate() { revision++; sessionId = null }
}
