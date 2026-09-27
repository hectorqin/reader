package cool.cnb.reader.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaLaunchRouteTest {
    @Test fun shortcutsSelectOnlyFixedMediaRoutes() {
        assertEquals("#/media/video", MediaLaunchRoute.fragmentForAction("cool.cnb.reader.OPEN_VIDEO"))
        assertEquals("#/media/music", MediaLaunchRoute.fragmentForAction("cool.cnb.reader.OPEN_MUSIC"))
        assertEquals("#/media/audiobook", MediaLaunchRoute.fragmentForAction("cool.cnb.reader.OPEN_AUDIOBOOK"))
    }

    @Test fun normalLaunchAndUntrustedActionsDoNotRedirectReading() {
        for (action in arrayOf(null, "android.intent.action.MAIN", "android.intent.action.VIEW", "https://example.com", "javascript:alert(1)", "#/media/music")) {
            assertNull(MediaLaunchRoute.fragmentForAction(action))
        }
    }
}
