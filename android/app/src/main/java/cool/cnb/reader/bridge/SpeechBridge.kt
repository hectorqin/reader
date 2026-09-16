package cool.cnb.reader.bridge

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * The platform's own `TextToSpeech`, exposed to the web layer as
 * `window.ReaderAndroid.speech`.
 *
 * ## Why this exists when every Android WebView already has `speechSynthesis`
 *
 * Because they are not the same synthesizer, and the WebView's copy is the worse
 * one on exactly the phones that need Chinese speech:
 *
 *  - A voice installed for the *operating system* (a Chinese voice from the
 *    vendor's TTS pack, or one the reader installed from the Play Store) is
 *    routinely absent from the WebView's `getVoices()`. The reader hears English
 *    or hears nothing, and nothing in the web layer can fix it — the list it is
 *    given is simply missing the voice.
 *  - `getVoices()` in a WebView is also asynchronous in a way a cold start gets
 *    wrong: the first call returns an empty array, and the code that waits for
 *    `voiceschanged` is code a phone may never run if the reader taps play first.
 *  - `TextToSpeech` reports *why* it failed through `onError`, and that reason is
 *    what turns "朗读没有声音" into a message the reader can act on.
 *
 * ## What stays in JavaScript
 *
 * The queue, the cursor, the chapter boundary, the highlight. This class speaks
 * one sentence and reports when it is done — the same contract the WebView engine
 * has, which is what makes the two interchangeable. A native queue would be a
 * second implementation of rules that already exist in one place, and the two
 * would drift.
 *
 * ## Threading
 *
 * `@JavascriptInterface` calls arrive on a WebView-owned thread; `TextToSpeech`
 * and `Handler` want the main looper. Every method here therefore posts to the
 * main thread, and callbacks go back through `evaluateJavascript`, which is the
 * only direction a WebView allows without a `WebMessagePort` handshake.
 */
class SpeechBridge(
    private val context: Context,
    private val webView: WebView,
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ready = false

    private var rate = 1f
    private var pitch = 1f
    private var volume = 1f
    private var voiceId = ""

    private var eventCallback: String? = null
    private var voicesCallback: String? = null

    /**
     * Id of the sentence currently being spoken.
     *
     * Supplied by the *client*, not minted here, and echoed back on every event.
     * A late `onDone` from a sentence the reader has already moved past must not
     * advance the web layer's cursor, and an id is the only way to tell the two
     * apart: `UtteranceProgressListener` gives an id and nothing else. The client
     * is the side that knows which sentence is on screen, so it is the side that
     * names it.
     */
    private var currentUtterance = ""

    private val progressListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            if (utteranceId == null || utteranceId != currentUtterance) return
            // Emitted for parity with the WebView engine's `onstart`, and for
            // diagnostics: a reader who sees "playing" but hears nothing can be
            // told whether the engine ever started.
            emit("start", null)
        }

        override fun onDone(utteranceId: String?) {
            if (utteranceId == null || utteranceId != currentUtterance) return
            currentUtterance = ""
            emit("done", null)
        }

        @Deprecated("Required by the platform interface; onError(id, code) is the one that carries a reason")
        override fun onError(utteranceId: String?) {
            if (utteranceId != null && utteranceId != currentUtterance) return
            currentUtterance = ""
            emit("error", "朗读失败")
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            if (utteranceId != null && utteranceId != currentUtterance) return
            currentUtterance = ""
            emit("error", errorMessage(errorCode))
        }
    }

    /**
     * Creates the engine and loads voices.
     *
     * Idempotent. The voice list is pushed when the `OnInitListener` fires rather
     * than returned from here, because initialisation is asynchronous and a
     * synchronous return would be a lie.
     */
    @JavascriptInterface
    fun init() {
        mainHandler.post {
            if (tts != null) {
                deliverVoices()
                return@post
            }
            tts = TextToSpeech(context) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    ready = true
                    tts?.setOnUtteranceProgressListener(progressListener)
                    configure()
                    deliverVoices()
                    emit("ready", null)
                } else {
                    ready = false
                    emit("error", "系统语音引擎初始化失败")
                }
            }
        }
    }

    /** Whether the engine finished initialising. */
    @JavascriptInterface
    fun available(): Boolean = ready

    /**
     * Registers the callback that receives `ready` / `start` / `done` / `error`.
     *
     * One callback with a typed event rather than three named ones: the client's
     * handler is a single `when` on the type either way, and three registrations
     * would be three chances for one of them to be missed.
     */
    @JavascriptInterface
    fun onSpeechEvent(callbackName: String) {
        if (!SAFE_IDENTIFIER.matches(callbackName)) return
        eventCallback = callbackName
    }

    /** Registers the callback that receives the voice list, JSON-encoded. */
    @JavascriptInterface
    fun onVoices(callbackName: String) {
        if (!SAFE_IDENTIFIER.matches(callbackName)) return
        voicesCallback = callbackName
        mainHandler.post { deliverVoices() }
    }

    /**
     * Speaks one sentence, replacing anything in flight.
     *
     * `QUEUE_FLUSH` rather than `QUEUE_ADD` is what makes the client's
     * one-sentence-at-a-time queue work: the client already decided what to say
     * next, so anything still queued in the engine is a leftover from a sentence
     * the reader moved past.
     */
    @JavascriptInterface
    fun speak(text: String, utteranceId: String) {
        val value = text.trim()
        if (value.isEmpty()) return
        mainHandler.post {
            val engine = tts ?: return@post
            if (!ready) return@post
            // A very long utterance makes several vendor stacks go silent, exactly
            // as it does in a WebView. The client splits far below this, but a
            // defensive cut costs nothing and turns a hang into a short sentence.
            val bounded = value.take(MAX_UTTERANCE)
            // The client's id when it sent one, a minted one otherwise, so an
            // older client that only sends text still gets its events matched
            // against the sentence in flight rather than being ignored.
            currentUtterance = utteranceId.ifBlank { "u" + System.nanoTime() }.take(ID_MAX_LENGTH)
            val params = Bundle()
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume)
            // The id is the third argument on API 21+ and the params map on older
            // releases; `speak(CharSequence, int, Bundle, String)` is the only
            // overload this project targets (minSdk 24), so the deprecated forms
            // are not needed.
            val result = engine.speak(bounded, TextToSpeech.QUEUE_FLUSH, params, currentUtterance)
            if (result == TextToSpeech.ERROR) {
                currentUtterance = ""
                emit("error", "朗读启动失败")
            }
        }
    }

    /**
     * Stops speaking.
     *
     * This is also what "pause" maps to (see `pause`), because
     * `TextToSpeech` has no pause.
     */
    @JavascriptInterface
    fun stop() {
        mainHandler.post {
            currentUtterance = ""
            tts?.stop()
        }
    }

    /**
     * Pauses, by stopping.
     *
     * The web layer replays the current sentence on resume — the same behaviour
     * the `<audio>` engine has, so switching engines does not change what the
     * reader hears. A real pause would have to be a native queue, and that is the
     * second implementation this design refuses.
     */
    @JavascriptInterface
    fun pause() {
        stop()
    }

    @JavascriptInterface
    fun setRate(value: Float) {
        rate = value.coerceIn(0.5f, 3f)
        mainHandler.post { configure() }
    }

    @JavascriptInterface
    fun setPitch(value: Float) {
        pitch = value.coerceIn(0.5f, 2f)
        mainHandler.post { configure() }
    }

    @JavascriptInterface
    fun setVolume(value: Float) {
        volume = value.coerceIn(0f, 1f)
    }

    /**
     * Selects a voice.
     *
     * The id is whatever `deliverVoices` handed out, which is the platform's own
     * `Voice.name`. An unknown id is ignored rather than reported as an error:
     * settings are per device and the voice list is per platform, so a stored id
     * from another phone is a normal state, not a bug.
     */
    @JavascriptInterface
    fun setVoice(id: String) {
        voiceId = id
        mainHandler.post { configure() }
    }

    /** Releases the engine. Called when the reader screen goes away. */
    @JavascriptInterface
    fun shutdown() {
        mainHandler.post {
            currentUtterance = ""
            tts?.stop()
            tts?.shutdown()
            tts = null
            ready = false
        }
    }

    // ---- internals ----

    private fun configure() {
        val engine = tts ?: return
        engine.setSpeechRate(rate)
        engine.setPitch(pitch)
        if (voiceId.isNotEmpty()) {
            val wanted = engine.voices?.firstOrNull { it.name == voiceId }
            if (wanted != null && !wanted.isNotInstalled) {
                engine.voice = wanted
                return
            }
        }
        // No explicit voice, or one this device does not have: fall back to the
        // device locale, which is the same choice "跟随系统" means in the UI.
        engine.setLanguage(Locale.getDefault())
    }

    /**
     * Pushes the voice list to the client, JSON-encoded.
     *
     * Called on init and again whenever the client registers a callback, because
     * either can happen first: the client registers then calls `init`, but a slow
     * `OnInitListener` can outlive a WebView reload, and the voices gathered
     * before the reload must not be lost.
     */
    private fun deliverVoices() {
        val callback = voicesCallback ?: return
        val engine = tts ?: return
        if (!ready) return
        val list = JSONArray()
        val voices: Collection<Voice> = try {
            engine.voices ?: emptySet()
        } catch (_: Exception) {
            emptySet()
        }
        val defaultVoiceName = try {
            engine.defaultVoice?.name
        } catch (_: Exception) {
            null
        }
        for (voice in voices) {
            // A voice that is not installed cannot be used, and offering it would
            // make the reader choose a voice that says nothing.
            if (voice.isNotInstalled) continue
            val entry = JSONObject()
            entry.put("id", voice.name)
            entry.put("name", friendlyName(voice))
            entry.put("lang", voice.locale.toLanguageTag())
            entry.put("default", voice.name == defaultVoiceName)
            list.put(entry)
        }
        evaluate(callback, list.toString())
    }

    /**
     * A voice's name, made readable.
     *
     * Vendor stacks name voices things like `zh-CN-x-ccc-local` or
     * `cmn-cn-x-ccc-network`, which is a package id rather than something a
     * person picks from a list. The language tag is kept in front because that is
     * the part a reader actually chooses on.
     */
    private fun friendlyName(voice: Voice): String {
        val tag = voice.locale.toLanguageTag()
        val short = voice.name.substringAfter("-x-", voice.name)
        return "$tag · $short"
    }

    private fun emit(type: String, message: String?) {
        val callback = eventCallback ?: return
        val payload = JSONObject()
        payload.put("type", type)
        if (message != null) payload.put("message", message)
        // Only for events about a specific utterance. `ready` is not about one, and
        // an empty id would be an id that matches nothing on the client.
        if (type == "start" || type == "done" || type == "error") {
            payload.put("id", currentUtterance)
        }
        evaluate(callback, payload.toString())
    }

    private fun evaluate(callbackName: String, json: String) {
        if (!SAFE_IDENTIFIER.matches(callbackName)) return
        mainHandler.post {
            // JSON-encoded so the payload cannot break out of the call site. The
            // payload is itself a JSON *string*, so it is quoted once more — the
            // client's callback parses it, which is what makes a Chinese voice
            // name with a quote in it survive.
            webView.evaluateJavascript(
                "window['$callbackName'] && window['$callbackName'](${JSONObject.quote(json)})",
                null,
            )
        }
    }

    /** The error codes a reader can act on, in words. */
    private fun errorMessage(code: Int): String = when (code) {
        TextToSpeech.ERROR_SYNTHESIS -> "语音合成失败，请检查系统 TTS 引擎"
        TextToSpeech.ERROR_SERVICE -> "语音服务不可用"
        TextToSpeech.ERROR_OUTPUT -> "音频输出不可用"
        TextToSpeech.ERROR_NETWORK -> "网络语音需要联网"
        TextToSpeech.ERROR_NETWORK_TIMEOUT -> "网络语音超时"
        TextToSpeech.ERROR_NOT_INSTALLED_YET -> "语音数据未下载完成"
        else -> "朗读失败（$code）"
    }

    companion object {
        /**
         * Ceiling per utterance.
         *
         * The client splits at 300 characters; this is the belt to that braces,
         * because a vendor engine that goes silent on a long utterance is a
         * failure the reader cannot diagnose.
         */
        private const val MAX_UTTERANCE = 600

        /**
         * Longest utterance id accepted.
         *
         * The id is passed straight to `TextToSpeech` and echoed in an
         * `evaluateJavascript` string, so it is bounded like every other string
         * that crosses the bridge.
         */
        private const val ID_MAX_LENGTH = 64

        /**
         * Callback names must be plain identifiers.
         *
         * The name is interpolated into an `evaluateJavascript` string, so an
         * unrestricted value would let the web side run arbitrary script in its
         * own context. The context is the client's own, so the risk is low, but a
         * bridge that will interpolate a string should validate it.
         */
        private val SAFE_IDENTIFIER = Regex("^[A-Za-z_$][A-Za-z0-9_$]{0,64}$")
    }
}
