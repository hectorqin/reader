package io.legado.app.data.entities

//import android.os.Parcelable
//import androidx.room.*
import io.legado.app.utils.GSON
import io.legado.app.utils.fromJsonObject
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

//@Parcelize
//@Entity(
//    tableName = "searchBooks",
//    indices = [(Index(value = ["bookUrl"], unique = true))],
//    foreignKeys = [(ForeignKey(
//        entity = BookSource::class,
//        parentColumns = ["bookSourceUrl"],
//        childColumns = ["origin"],
//        onDelete = ForeignKey.CASCADE
//    ))]
//)
@JsonIgnoreProperties("variableMap", "infoHtml", "tocHtml", "origins", "kindList")
data class SearchBook(
//    @PrimaryKey
    override var bookUrl: String = "",
    var origin: String = "",                     // 书源规则
    var originName: String = "",
    var type: Int = 0,                          // @BookType
    override var name: String = "",
    override var author: String = "",
    override var kind: String? = null,
    var coverUrl: String? = null,
    var intro: String? = null,
    override var wordCount: String? = null,
    var latestChapterTitle: String? = null,
    var tocUrl: String = "",                    // 目录页Url (toc=table of Contents)
    var time: Long = 0,
    var variable: String? = null,
    var originOrder: Int = 0
) :  BaseBook, Comparable<SearchBook> {

//    @Ignore
//    @IgnoredOnParcel
    override var infoHtml: String? = null

//    @Ignore
//    @IgnoredOnParcel
    override var tocHtml: String? = null

    override fun equals(other: Any?): Boolean {
        if (other is SearchBook) {
            if (other.bookUrl == bookUrl) {
                return true
            }
        }
        return false
    }

    override fun hashCode(): Int {
        return bookUrl.hashCode()
    }

    override fun compareTo(other: SearchBook): Int {
        return other.originOrder - this.originOrder
    }

    @delegate:Transient
    override val variableMap: HashMap<String, String> by lazy {
        GSON.fromJsonObject<HashMap<String, String>>(variable).getOrNull() ?: hashMapOf()
    }

    override fun putVariable(key: String, value: String?) {
        if (value != null) {
            variableMap[key] = value
        } else {
            variableMap.remove(key)
        }
        variable = GSON.toJson(variableMap)
    }

//    @Ignore
//    @IgnoredOnParcel
    var origins: LinkedHashSet<String>? = null
        private set

    fun addOrigin(origin: String) {
        if (origins == null) {
            origins = linkedSetOf(this.origin)
        }
        origins?.add(origin)
    }

    fun toBook(): Book {
        return Book(
            name = name,
            author = author,
            kind = kind,
            bookUrl = bookUrl,
            origin = origin,
            originName = originName,
            type = type,
            wordCount = wordCount,
            latestChapterTitle = latestChapterTitle,
            coverUrl = coverUrl,
            intro = intro,
            tocUrl = tocUrl,
//            originOrder = originOrder,
            variable = variable
        ).apply {
            this.infoHtml = this@SearchBook.infoHtml
            this.tocUrl = this@SearchBook.tocUrl
        }
    }
}