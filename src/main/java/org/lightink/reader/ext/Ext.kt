package org.lightink.reader.ext

import org.jsoup.nodes.Element

/**
 * @Date: 2019-07-19 23:43
 * @Description:
 */


fun Element.parserAttr(selector: String): String? {
    val split = selector.split("@attr->")
    return this.select(split.first()).attr(split.last())
}