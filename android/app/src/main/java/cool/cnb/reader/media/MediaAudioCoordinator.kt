package cool.cnb.reader.media

/** Called only on the main looper. Neither subsystem needs to know the other's implementation. */
object MediaAudioCoordinator {
    var pauseMedia: (() -> Unit)? = null
    var stopSpeech: (() -> Unit)? = null
}
