package io.legado.app.data.entities


import io.legado.app.utils.GSON
import io.legado.app.utils.fromJsonObject

data class BookChapter(
        var url: String = "",               // 章节地址
        var title: String = "",              // 章节标题
        var bookUrl: String = "",           // 书籍地址
        var index: Int = 0,                 // 章节序号
        var resourceUrl: String? = null,    // 音频真实URL
        var tag: String? = null,            //
        var start: Long? = null,            // 章节起始位置
        var end: Long? = null,               // 章节终止位置
        var variable: String? = null
) {

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

}

