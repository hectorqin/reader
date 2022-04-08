package io.legado.app.data.entities




//@Parcelize
//@Entity(tableName = "bookmarks", indices = [(Index(value = ["bookUrl"], unique = true))])
data class Bookmark(
//    @PrimaryKey
    var time: Long = System.currentTimeMillis(),
    var bookUrl: String = "",
    var bookName: String = "",
    var chapterName: String = "",
    var chapterIndex: Int = 0,
    var pageIndex: Int = 0,
    var content: String = ""

)