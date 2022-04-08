package io.legado.app.data.entities


import io.legado.app.utils.GSON
import io.legado.app.utils.fromJsonObject
import io.legado.app.utils.MD5Utils
import io.legado.app.model.analyzeRule.AnalyzeUrl
import io.legado.app.utils.NetworkUtils

data class BookChapter(
        var url: String = "",               // 章节地址
        var title: String = "",              // 章节标题
        var baseUrl: String = "",           //用来拼接相对url
        var bookUrl: String = "",           // 书籍地址
        var index: Int = 0,                 // 章节序号
        var resourceUrl: String? = null,    // 音频真实URL
        var tag: String? = null,            //
        var start: Long? = null,            // 章节起始位置
        var end: Long? = null,               // 章节终止位置
        var startFragmentId: String? = null,  //EPUB书籍当前章节的fragmentId
        var endFragmentId: String? = null,    //EPUB书籍下一章节的fragmentId
        var variable: String? = null        //变量
) {

    @Transient
    var variableMap: HashMap<String, String>? = null
        private set
        get() {
            if (field == null) {
                field = GSON.fromJsonObject<HashMap<String, String>>(variable) ?: HashMap()
            }
            return field
        }

    fun putVariable(key: String, value: String) {
        variableMap?.put(key, value)
        variable = GSON.toJson(variableMap)
    }

    override fun hashCode() = url.hashCode()

    override fun equals(other: Any?): Boolean {
        if (other is BookChapter) {
            return other.url == url
        }
        return false
    }

    fun getAbsoluteURL():String{
        val urlMatcher = AnalyzeUrl.paramPattern.matcher(url)
        val urlBefore = if(urlMatcher.find())url.substring(0,urlMatcher.start()) else url
        val urlAbsoluteBefore = NetworkUtils.getAbsoluteURL(baseUrl,urlBefore)
        return if(urlBefore.length == url.length) urlAbsoluteBefore else urlAbsoluteBefore + ',' + url.substring(urlMatcher.end())
    }


    fun getFileName(): String = String.format("%05d-%s.nb", index, MD5Utils.md5Encode16(title))
}

