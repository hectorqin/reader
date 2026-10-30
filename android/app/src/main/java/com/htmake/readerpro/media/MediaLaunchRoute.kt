package com.htmake.readerpro.media

/** Launcher shortcuts select fixed local routes, never caller-provided URLs. */
object MediaLaunchRoute {
    fun fragmentForAction(action: String?): String? = when (action) {
        "com.htmake.readerpro.OPEN_VIDEO" -> "#/media/video"
        "com.htmake.readerpro.OPEN_MUSIC" -> "#/media/music"
        "com.htmake.readerpro.OPEN_AUDIOBOOK" -> "#/media/audiobook"
        else -> null
    }
}
