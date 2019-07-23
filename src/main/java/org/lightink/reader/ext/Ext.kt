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

        if (s.startsWith("attr->")) {
            text = element.attr(s.removePrefix("attr->"))
        } else if (s.startsWith("js->")) {
            text = engine.eval(s.removePrefix("js->").replace("\${this}", "\"$text\"")).toString()
        } else {
            element = element.selectFirst(s)
            if (element.hasText()) {
                text = element.text()
            } else {
                text = element.data()
            }
        }

    }
    return text

}


fun String.url(): String {
    if (this.startsWith("//")) {
        return "http:" + this
    }
    return this
}



