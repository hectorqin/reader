package org.lightink.reader.ext

import io.vertx.reactivex.core.buffer.Buffer
import io.vertx.reactivex.ext.web.client.HttpRequest
import io.vertx.reactivex.ext.web.client.WebClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.jsoup.nodes.Element
import org.lightink.reader.contants.PropertyType
import org.mozilla.universalchardet.UniversalDetector
import java.nio.charset.Charset
import javax.script.ScriptEngineManager


/**
 * @Date: 2019-07-19 23:43
 * @Description:
 */


//fun Element.parserAttr(selector: String): String? {
//    val split = selector.split("@attr->")
//    return this.select(split.first()).attr(split.last())
//}

val engine = ScriptEngineManager().getEngineByName("nashorn")

fun Element.parser(selector: String): String {

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
                if (element.select(s).hasText()) {
                    text = element.select(s).html()
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
        val s = this.parser(it)
        if (s.isNotBlank()) {
            return s
        }
    }
    return ""

}


fun String.url(): String {
    if (this.startsWith("//")) {
        return ("http:" + this).toHttpUrl().encodedPath
    } else if (this.startsWith("http")) {
        return this.toHttpUrl().encodedPath
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
        return this.toString()
    }

}




