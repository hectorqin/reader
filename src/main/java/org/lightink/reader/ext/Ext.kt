package org.lightink.reader.ext

import org.jsoup.nodes.Element
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
            val element1 = element.selectFirst(s)
            if (element1 == null) {
                continue
            } else {
                element = element1
            }
            if (element.hasText()) {
                text = element.text()
            } else {
                text = element.data()
            }
        }

    }
    return text

}


fun Element.parser(selectorList: List<String>): String {
    selectorList.forEach {
        val s = this.parser(it)
        if (s.isNotBlank()) {
            return s
        }
    }
    return ""

}


fun String.url(): String {
    if (this.startsWith("//")) {
        return "http:" + this
    }
    return this
}



