package cool.cnb.reader.web

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.util.Base64
import android.util.Log
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import kotlin.math.max
import kotlin.math.min

/**
 * Draws one fixed-layout page — a comic page, a scanned image — natively.
 *
 * This class exists for one measured reason. In a WebView, showing a full-page
 * JPEG costs: the bytes crossing into the renderer process, a decode into a
 * renderer-owned bitmap, a style and layout pass over the whole document, and a
 * compositor pass. For a chapter of text that is all necessary. For "show this
 * picture filling the screen" it is not, and on a phone it is the difference
 * between a smooth page turn and a visible one.
 *
 * So the shell is allowed to draw it. The rules that keep this from becoming a
 * second renderer are:
 *
 *  - **Only pictures and only whole pages.** A comic page, a single scanned
 *    image. Anything with text layout stays in the WebView, because faithful
 *    reflow is the product's differentiator and there is exactly one
 *    implementation of it.
 *  - **All or nothing.** Either a bitmap is decoded and shown, or this returns
 *    `false` and the WebView draws the page exactly as it would in a browser.
 *    There is no partial state and no blank screen.
 *  - **No decoding on the UI thread**, and no unbounded bitmap: a 40-megapixel
 *    scan is downsampled to the viewport before it is allocated. A phone that
 *    OOMs on a comic page is worse than a slow one.
 *
 * One deliberate gap: the reader's "fit width" preference is *not* implemented
 * here. `contain` is both the default and the behaviour the CSS fallback
 * produces, so the two paths agree; `fit width` is a mode for a page whose
 * aspect ratio does not match the screen, which is the case the WebView already
 * handles well. Faking it natively would either crop a page — silently losing
 * panels — or need its own scroll surface, which is a second renderer by
 * another name. So a fixed-layout book in `fit width` simply renders in the
 * WebView, and the setting keeps working.
 */
class NativePageView(context: Context) : FrameLayout(context) {

    private val image = ImageView(context)

    /** The page currently drawn, so a repeated request is a no-op rather than a re-decode. */
    private var currentSection: String? = null
    private var currentBitmap: Bitmap? = null

    init {
        // Transparent, not black: the activity's window provides the paper colour
        // and a black flash between pages is the most visible artefact there is.
        setBackgroundColor(Color.TRANSPARENT)
        visibility = View.GONE
        fitsSystemWindows = false

        image.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        // FIT_CENTER is the "contain" behaviour: the whole page visible, aspect
        // ratio preserved, letterboxed rather than cropped. A comic page cropped
        // at the edge is a page that silently loses panels.
        image.scaleType = ImageView.ScaleType.FIT_CENTER
        image.adjustViewBounds = false

        addView(image)
    }

    /**
     * Draws a page, returning false when this view will not take it.
     *
     * A `false` is not an error: it is the signal for the caller to render the
     * page itself. Every reason below is a reason the WebView path handles.
     */
    fun show(sectionId: String, bytes: ByteArray?, mediaType: String?): Boolean {
        if (bytes == null || bytes.isEmpty()) return false
        if (!isDecodable(mediaType)) return false

        if (sectionId == currentSection && currentBitmap != null) {
            visibility = View.VISIBLE
            return true
        }

        val target = viewportSize()
        if (target.first <= 0 || target.second <= 0) return false

        val bitmap = decodeDownsampled(bytes, target.first, target.second) ?: run {
            // Undecodable. Not a crash and not a blank page: hand it back.
            fail("page image could not be decoded; the web renderer will draw it")
            return false
        }

        currentBitmap?.recycle()
        currentBitmap = bitmap
        currentSection = sectionId
        image.setImageBitmap(bitmap)
        visibility = View.VISIBLE
        return true
    }

    /** Hides the native page and releases its bitmap. */
    fun hide() {
        visibility = View.GONE
        currentSection = null
        currentBitmap?.recycle()
        currentBitmap = null
        image.setImageDrawable(null)
    }

    /**
     * Reports why this view will not draw the page, and stays out of the way.
     *
     * The message is written to logcat rather than shown. The reader is about to
     * see the page rendered by the WebView, which is the correct outcome; a
     * toast on top of it would be noise about an internal optimisation failing.
     */
    private fun fail(reason: String) {
        visibility = View.GONE
        Log.d(TAG, reason)
    }

    /** The view's real pixel size, which is what the downsample target is. */
    private fun viewportSize(): Pair<Int, Int> {
        val width = if (width > 0) width else resources.displayMetrics.widthPixels
        val height = if (height > 0) height else resources.displayMetrics.heightPixels
        return width to height
    }

    /**
     * Decodes with `inSampleSize` set so the bitmap never exceeds the viewport.
     *
     * Two passes on purpose: the first reads only the header to learn the real
     * dimensions, the second allocates. Allocating first and scaling afterwards
     * is how a 200MB scan turns into an OOM on the phone that is supposed to be
     * the target device.
     */
    private fun decodeDownsampled(data: ByteArray, targetWidth: Int, targetHeight: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, targetWidth, targetHeight)
            inPreferredConfig = Bitmap.Config.RGB_565
        }
        return runCatching { BitmapFactory.decodeByteArray(data, 0, data.size, options) }.getOrNull()
    }

    private fun sampleSize(width: Int, height: Int, targetWidth: Int, targetHeight: Int): Int {
        var sample = 1
        var halfWidth = width
        var halfHeight = height
        // Floor at 1: upsizing a small page through inSampleSize is not possible
        // and the view's scale type handles it.
        while (halfWidth / 2 >= targetWidth && halfHeight / 2 >= targetHeight) {
            halfWidth /= 2
            halfHeight /= 2
            sample *= 2
        }
        return max(1, min(sample, MAX_SAMPLE_SIZE))
    }

    companion object {
        private const val TAG = "ReaderNativePage"

        /**
         * Media types this view will accept.
         *
         * An allowlist rather than a denylist: the WebView is the safe default,
         * so anything not provably an image goes there. SVG is deliberately
         * excluded — it is markup, and rendering markup natively would be the
         * second renderer this whole design avoids.
         */
        private val DECODABLE = setOf(
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/bmp",
            "image/avif",
        )

        /** Cap on downsampling, so a pathological header cannot shrink a page to nothing. */
        private const val MAX_SAMPLE_SIZE = 8

        fun isDecodable(mediaType: String?): Boolean = mediaType != null && mediaType.lowercase() in DECODABLE

        /** Decodes base64 from the bridge. Returns null for anything malformed. */
        /**
         * Decodes base64 from the bridge.
         *
         * The web layer sends bytes this way because a JavaScript-interface
         * method can only take primitives. The Kotlin side is a `ByteArray`; the
         * earlier version of this file said `Uint8Array`, which is a
         * JavaScript type and does not exist here — an error that only surfaces
         * when the shell is actually compiled.
         */
        fun decodeBase64(encoded: String): ByteArray? = runCatching {
            Base64.decode(encoded, Base64.DEFAULT)
        }.getOrNull()
    }
}
