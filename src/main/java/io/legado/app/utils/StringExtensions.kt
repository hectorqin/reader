package io.legado.app.utils

// import org.apache.commons.text.StringEscapeUtils
import io.legado.app.constant.AppPattern.dataUriRegex

fun String?.safeTrim() = if (this.isNullOrBlank()) null else this.trim()

fun String?.isAbsUrl() = if (this.isNullOrBlank()) false else this.startsWith("http://", true)
        || this.startsWith("https://", true)

fun String?.isDataUrl() =
    this?.let {
        dataUriRegex.matches(it)
    } ?: false

fun String?.isJson(): Boolean = this?.run {
    val str = this.trim()
    when {
        str.startsWith("{") && str.endsWith("}") -> true
        str.startsWith("[") && str.endsWith("]") -> true
        else -> false
    }
} ?: false

fun String?.isJsonObject(): Boolean = this?.run {
    val str = this.trim()
    str.startsWith("{") && str.endsWith("}")
} ?: false

fun String?.isJsonArray(): Boolean = this?.run {
    val str = this.trim()
    str.startsWith("[") && str.endsWith("]")
} ?: false

fun String?.isXml(): Boolean =
    this?.run {
        val str = this.trim()
        str.startsWith("<") && str.endsWith(">")
    } ?: false

fun String?.isTrue(nullIsTrue: Boolean = false): Boolean {
    if (this.isNullOrBlank() || this == "null") {
        return nullIsTrue
    }
    return !this.matches("\\s*(?i)(false|no|not|0)\\s*".toRegex())
}

fun String?.htmlFormat(): String = if (this.isNullOrBlank()) "" else
    this.replace("(?i)<(br[\\s/]*|/*p\\b.*?|/*div\\b.*?)>".toRegex(), "\n")// 替换特定标签为换行符
        .replace("<[script>]*.*?>|&nbsp;".toRegex(), "")// 删除script标签对和空格转义符
        .replace("\\s*\\n+\\s*".toRegex(), "\n　　")// 移除空行,并增加段前缩进2个汉字
        .replace("^[\\n\\s]+".toRegex(), "　　")//移除开头空行,并增加段前缩进2个汉字
        .replace("[\\n\\s]+$".toRegex(), "") //移除尾部空行

fun String.splitNotBlank(vararg delimiter: String): Array<String> = run {
    this.split(*delimiter).map { it.trim() }.filterNot { it.isBlank() }.toTypedArray()
}

fun String.splitNotBlank(regex: Regex, limit: Int = 0): Array<String> = run {
    this.split(regex, limit).map { it.trim() }.filterNot { it.isBlank() }.toTypedArray()
}

fun String.startWithIgnoreCase(start: String): Boolean {
    return if (this.isBlank()) false else startsWith(start, true)
}

fun String.cnCompare(other: String): Int {
    // return java.text.Collator.getInstance(Locale.CHINA).compare(this, other)
    return this.compareTo(other)
}

/**
 * 将字符串拆分为单个字符,包含emoji
 */
fun String.toStringArray(): Array<String> {
    var codePointIndex = 0
    return try {
        Array(codePointCount(0, length)) {
            val start = codePointIndex
            codePointIndex = offsetByCodePoints(start, 1)
            substring(start, codePointIndex)
        }
    } catch (e: Exception) {
        split("").toTypedArray()
    }
}

