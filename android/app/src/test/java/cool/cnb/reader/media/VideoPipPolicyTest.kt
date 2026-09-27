package cool.cnb.reader.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VideoPipPolicyTest {
    @Test fun ratioHandlesUnknownPortraitWideAndNonSquarePixels() {
        assertEquals(17777 to 10000, VideoPipPolicy.ratio(0, 0))
        assertEquals(5625 to 10000, VideoPipPolicy.ratio(1080, 1920))
        assertEquals(23900 to 10000, VideoPipPolicy.ratio(10000, 100))
        assertEquals(17777 to 10000, VideoPipPolicy.ratio(100, 100, Float.NaN))
        val portrait = VideoPipPolicy.ratio(100, 10000)
        assertTrue(portrait.first.toDouble() / portrait.second >= 1.0 / 2.39)
        assertEquals(20000 to 10000, VideoPipPolicy.ratio(100, 100, 2f))
    }
}
