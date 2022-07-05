package io.legado.app.data.entities




//@Parcelize
//@Entity(tableName = "bookmarks", indices = [(Index(value = ["bookUrl"], unique = true))])
data class Bookmark(
//    @PrimaryKey
    val time: Long = System.currentTimeMillis(),
    val bookName: String = "",
    val bookAuthor: String = "",
    var chapterIndex: Int = 0,
    var chapterPos: Int = 0,
    var chapterName: String = "",
    var bookText: String = "",
    var content: String = ""

)