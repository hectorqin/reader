package io.legado.app.constant

import java.text.SimpleDateFormat
import javax.script.ScriptEngine
import javax.script.ScriptEngineManager

object AppConst {


    const val UA_NAME = "User-Agent"

    val userAgent: String by lazy {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.142 Safari/537.36"
    }

    val SCRIPT_ENGINE: ScriptEngine by lazy {
        ScriptEngineManager().getEngineByName("rhino")
    }

    val TIME_FORMAT: SimpleDateFormat by lazy {
        SimpleDateFormat("HH:mm")
    }

    val keyboardToolChars: List<String> by lazy {
        arrayListOf(
            "@", "&", "|", "%", "/", ":", "[", "]", "{", "}", "<", ">", "\\", "$", "#", "!", ".",
            "href", "src", "textNodes", "xpath", "json", "css", "id", "class", "tag"
        )
    }

}