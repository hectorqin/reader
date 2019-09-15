package org.lightink.reader.utils

import com.jayway.jsonpath.JsonPath
import io.vertx.core.buffer.Buffer
import io.vertx.ext.web.client.HttpRequest
import io.vertx.ext.web.client.WebClient
import net.minidev.json.JSONArray
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.jsoup.nodes.Element
import org.lightink.reader.contants.PropertyType
import org.mozilla.universalchardet.UniversalDetector
import java.nio.ByteBuffer
import java.nio.charset.Charset
import javax.script.ScriptEngineManager


/**
 * @Date: 2019-07-19 23:43
 * @Description:
 */

val engine = ScriptEngineManager().getEngineByName("nashorn")

fun Element.parser(selector: String, propertyType: PropertyType = PropertyType.SEARCH): String {

    var element: Element = this

    var text = ""

    for (s in selector.split("@")) {

        if (s.isBlank()) {
            continue
        }

        if (s.startsWith("attr->")) {
            text = element.attr(s.removePrefix("attr->"))
        } else if (s.startsWith("js->")) {
            text = engine.eval(s.removePrefix("js->").replace("\${this}", "\"$text\"")).toString()
        } else {

            if (element.selectFirst(s) == null) {
                continue
            } else {
                if (element.select(s).hasText() && propertyType == PropertyType.CONTENT) {
                    text = element.select(s).html()
                } else if (element.select(s).hasText()) {
                    text = element.select(s).text()
                } else {
                    text = element.selectFirst(s).data()
                }
                element = element.selectFirst(s)
            }

        }

    }
    return text

}


fun Element.parser(selectorList: List<String>?, propertyType: PropertyType = PropertyType.SEARCH): String {
    if (selectorList == null) {
        return ""
    }

    if (propertyType == PropertyType.DETAIL) {
        selectorList.reversed()
    } else {
        selectorList
    }.forEach {
        val s = this.parser(it, propertyType)
        if (s.isNotBlank()) {
            return s
        }
    }
    return ""

}


fun String.url(): String {
    if (this.startsWith("//")) {
        return ("http:" + this).toHttpUrl().toString()
    } else if (this.startsWith("http")) {
        return this.toHttpUrl().toString()
    }
    return this
}


fun WebClient.getEncodeAbs(absoluteURI: String): HttpRequest<Buffer> {
    return this.getAbs(absoluteURI.toHttpUrl().toString())
}


fun ByteArray.universalChardet(): String {

    val detector = UniversalDetector(null)
    detector.handleData(this, 0, this.size)
    detector.dataEnd()
    val charset = detector.detectedCharset
    detector.reset()
    if (charset != null) {
        return this.toString(Charset.forName(charset))
    } else {
        for ((key, value) in Charset.availableCharsets()) {
            try {
                value.newDecoder().decode(ByteBuffer.wrap(this))
            } catch (e: Exception) {
                continue
            }
            return this.toString(Charset.forName(key))
        }
        return this.toString()
    }

}

fun Any.jsonParser(list: List<String>?): String {
    if (list == null) {
        return ""
    }

    list.forEach {
        val s = this.jsonParser(it)
        if (s.isNotBlank()) {
            return s
        }
    }
    return ""
}

fun Any.jsonParser(jsonpath: String): String {
    var text = ""

    for (s in jsonpath.split("@")) {

        if (s.isBlank()) {
            continue
        }

        if (s.startsWith("js->")) {
            text = engine.eval(s.removePrefix("js->").replace("\${this}", "\"$text\"")).toString()
        } else {
            if (this is String) {
                var read = JsonPath.read<Any>(this, s)
                if (read is JSONArray) {
                    text = read[0].toString()
                } else {
                    text = read.toString()
                }
            } else {
                text = JsonPath.read(this, s)
            }
        }

    }
    return text
}








