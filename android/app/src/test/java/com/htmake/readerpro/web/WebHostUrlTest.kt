package com.htmake.readerpro.web

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebHostUrlTest {
    @Test fun onlyExactAssetOriginsStayInsideTheMainFrame() {
        for (url in listOf(
            "https://appassets.androidplatform.net/assets/index.html",
            "https://APPASSETS.ANDROIDPLATFORM.NET:443/assets/index.html#/home",
        )) assertTrue(url, isInternalUrl(url))

        for (url in listOf(
            "https://appassets.androidplatform.net.evil.test/assets/index.html",
            "https://appassets.androidplatform.net@evil.test/assets/index.html",
            "https://user@appassets.androidplatform.net/assets/index.html",
            "https://appassets.androidplatform.net:444/assets/index.html",
            "https://appassets.androidplatform.net/other/index.html",
            "http://appassets.androidplatform.net/assets/index.html",
            "https://appassets.androidplatform.net\\@evil.test/assets/index.html",
            "javascript:alert(1)",
            "not a valid URI",
        )) assertFalse(url, isInternalUrl(url))
    }

    @Test fun documentSchemesAreRestrictedToSubframes() {
        for (url in listOf("reader-res:cover.png", "blob:https://example.com/id", "data:text/html,hello", "about:blank")) {
            assertFalse(url, isInternalUrl(url))
            assertTrue(url, isInternalUrl(url, isMainFrame = false))
        }
    }
}
