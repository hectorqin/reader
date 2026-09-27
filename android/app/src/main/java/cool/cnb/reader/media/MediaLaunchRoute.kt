package cool.cnb.reader.media

/** Launcher shortcuts select fixed local routes, never caller-provided URLs. */
object MediaLaunchRoute {
    fun fragmentForAction(action: String?): String? = when (action) {
        "cool.cnb.reader.OPEN_VIDEO" -> "#/media/video"
        "cool.cnb.reader.OPEN_MUSIC" -> "#/media/music"
        "cool.cnb.reader.OPEN_AUDIOBOOK" -> "#/media/audiobook"
        else -> null
    }
}
