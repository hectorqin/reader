package io.legado.app.help

import io.legado.app.model.analyzeRule.AnalyzeUrl
import io.legado.app.utils.EncoderUtils
import io.legado.app.utils.MD5Utils
import io.legado.app.utils.StringUtils
import io.legado.app.utils.Base64
import io.legado.app.constant.AppConst.dateFormat
import java.net.URLEncoder
import java.util.Date
import java.util.regex.Pattern

@Suppress("unused")
interface JsExtensions {

    /**
     * js实现跨域访问,不能删
     */
    fun ajax(urlStr: String): String? {
        return try {
            val analyzeUrl = AnalyzeUrl(urlStr, null, null, null, null, null)
            val call = analyzeUrl.getResponse()
            val response = call.execute()
            response.body()
        } catch (e: Exception) {
            e.localizedMessage
        }
    }

    /**
     * js实现解码,不能删
     */
    fun base64Decode(str: String): String {
        return EncoderUtils.base64Decode(str)
    }

    fun base64Encode(str: String): String? {
        return EncoderUtils.base64Encode(str)
    }

    fun base64Encode(str: String, flags: Int = Base64.NO_WRAP): String? {
        return EncoderUtils.base64Encode(str, flags)
    }

    fun md5Encode(str: String): String? {
        return MD5Utils.md5Encode(str)
    }

    fun md5Encode16(str: String): String? {
        return MD5Utils.md5Encode16(str)
    }

    /**
     * 时间格式化
     */
    fun timeFormat(time: Long): String {
        return dateFormat.format(Date(time))
    }

    /**
     * utf8编码转gbk编码
     */
    fun utf8ToGbk(str: String): String {
        val utf8 = String(str.toByteArray(charset("UTF-8")))
        val unicode = String(utf8.toByteArray(), charset("UTF-8"))
        return String(unicode.toByteArray(charset("GBK")))
    }

    fun encodeURI(str: String): String {
        return try {
            URLEncoder.encode(str, "UTF-8")
        } catch (e: Exception) {
            ""
        }
    }

    fun encodeURI(str: String, enc: String): String {
        return try {
            URLEncoder.encode(str, enc)
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * 章节数转数字
     */
    fun toNumChapter(s: String?): String? {
        if (s == null) {
            return null
        }
        val pattern = Pattern.compile("(第)(.+?)(章)")
        val matcher = pattern.matcher(s)
        return if (matcher.find()) {
            matcher.group(1) + StringUtils.stringToInt(matcher.group(2)) + matcher.group(3)
        } else {
            s
        }
    }
}
