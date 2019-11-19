package io.legado.app.data.entities





//@Parcelize
//@Entity(tableName = "search_keywords", indices = [(Index(value = ["word"], unique = true))])
data class SearchKeyword(
//    @PrimaryKey
    var word: String = "",                      // 搜索关键词
    var usage: Int = 1,                         // 使用次数
    var lastUseTime: Long = System.currentTimeMillis()      // 最后一次使用时间
)
