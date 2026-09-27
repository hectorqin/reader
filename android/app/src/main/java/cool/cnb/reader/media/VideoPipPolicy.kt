package cool.cnb.reader.media

/** Android restricts the PiP aspect ratio to approximately 1:2.39 … 2.39:1. */
internal object VideoPipPolicy {
    fun ratio(width: Int, height: Int, pixelRatio: Float = 1f): Pair<Int, Int> {
        val value = if (width > 0 && height > 0 && pixelRatio.isFinite() && pixelRatio > 0f) {
            width.toDouble() * pixelRatio / height
        } else 16.0 / 9.0
        return (value.coerceIn(1.0 / 2.39, 2.39) * 10000).toInt().coerceIn(4185, 23900) to 10000
    }
}
