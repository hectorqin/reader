package io.legado.app.data.entities


import io.legado.app.constant.BookType
import io.legado.app.constant.AppPattern
import io.legado.app.utils.GSON
import io.legado.app.utils.fromJsonObject
import io.legado.app.utils.MD5Utils
import io.legado.app.utils.FileUtils
import io.legado.app.model.localBook.LocalBook
import io.legado.app.model.localBook.EpubFile
import io.legado.app.model.localBook.UmdFile
import java.nio.charset.Charset
import java.io.File
import kotlin.math.max
import kotlin.math.min
import org.jsoup.Jsoup
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties("variableMap", "infoHtml", "tocHtml", "config", "rootDir", "readConfig", "localBook", "epub", "epubRootDir", "onLineTxt", "localTxt", "umd", "realAuthor", "unreadChapterNum", "folderName", "localFile", "kindList")
data class Book(
        override var bookUrl: String = "",                   // 详情页Url(本地书源存储完整文件路径)
        var tocUrl: String = "",                    // 目录页Url (toc=table of Contents)
        var origin: String = BookType.local,        // 书源URL(默认BookType.local)
        var originName: String = "",                //书源名称
        override var name: String = "",                   // 书籍名称(书源获取)
        override var author: String = "",                 // 作者名称(书源获取)
        override var kind: String? = null,                    // 分类信息(书源获取)
        var customTag: String? = null,              // 分类信息(用户修改)
        var coverUrl: String? = null,               // 封面Url(书源获取)
        var customCoverUrl: String? = null,         // 封面Url(用户修改)
        var intro: String? = null,            // 简介内容(书源获取)
       var customIntro: String? = null,      // 简介内容(用户修改)
       var charset: String? = null,                // 自定义字符集名称(仅适用于本地书籍)
        var type: Int = 0,                          // @BookType
       var group: Int = 0,                         // 自定义分组索引号
        var latestChapterTitle: String? = null,     // 最新章节标题
        var latestChapterTime: Long = System.currentTimeMillis(),            // 最新章节标题更新时间
        var lastCheckTime: Long = System.currentTimeMillis(),                // 最近一次更新书籍信息的时间
        var lastCheckCount: Int = 0,                // 最近一次发现新章节的数量
        var totalChapterNum: Int = 0,               // 书籍目录总数
       var durChapterTitle: String? = null,        // 当前章节名称
       var durChapterIndex: Int = 0,               // 当前章节索引
       var durChapterPos: Int = 0,                 // 当前阅读的进度(首行字符的索引位置)
       var durChapterTime: Long = System.currentTimeMillis(),               // 最近一次阅读书籍的时间(打开正文的时间)
        override var wordCount: String? = null,
       var canUpdate: Boolean = true,              // 刷新书架时更新书籍信息
       var order: Int = 0,                         // 手动排序
       var originOrder: Int = 0,                   //书源排序
        var useReplaceRule: Boolean = true,         // 正文使用净化替换规则
        var variable: String? = null,                // 自定义书籍变量信息(用于书源规则检索书籍信息)
        var readConfig: ReadConfig? = null
    ) : BaseBook {

    fun isLocalBook(): Boolean {
        return origin == BookType.local
    }

    fun isLocalTxt(): Boolean {
        return isLocalBook() && originName.endsWith(".txt", true)
    }

    fun isEpub(): Boolean {
        return originName.endsWith(".epub", true)
    }

    fun isCbz(): Boolean {
        return originName.endsWith(".cbz", true)
    }

    fun isUmd(): Boolean {
        return originName.endsWith(".umd", true)
    }

    fun isOnLineTxt(): Boolean {
        return !isLocalBook() && type == 0
    }

    override fun equals(other: Any?): Boolean {
        if (other is Book) {
            return other.bookUrl == bookUrl
        }
        return false
    }

    override fun hashCode(): Int {
        return bookUrl.hashCode()
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

    override var infoHtml: String? = null

    override var tocHtml: String? = null

    fun getRealAuthor() = author.replace(AppPattern.authorRegex, "")

    fun getUnreadChapterNum() = max(totalChapterNum - durChapterIndex - 1, 0)

    fun fileCharset(): Charset {
        return charset(charset ?: "UTF-8")
    }

    private fun config(): ReadConfig {
        if (readConfig == null) {
            readConfig = ReadConfig()
        }
        return readConfig!!
    }

    fun setDelTag(tag: Long) {
        config().delTag =
            if ((config().delTag and tag) == tag) config().delTag and tag.inv() else config().delTag or tag
    }

    fun getDelTag(tag: Long): Boolean {
        return config().delTag and tag == tag
    }

    fun getFolderName(): String {
        //防止书名过长,只取9位
        var folderName = name.replace(AppPattern.fileNameRegex, "")
        folderName = folderName.substring(0, min(9, folderName.length))
        return folderName + MD5Utils.md5Encode16(bookUrl)
    }

    @Transient
    private var rootDir: String = ""

    fun setRootDir(root: String) {
        if (root.isNotEmpty() && !root.endsWith(File.separator)) {
            rootDir = root + File.separator
        } else {
            rootDir = root
        }
    }

    fun getLocalFile(): File {
        if (isEpub() && originName.indexOf("localStore") < 0) {
            // 非本地书仓的 epub文件
            return FileUtils.getFile(File(rootDir + originName), "index.epub")
        }
        return File(rootDir + originName)
    }

    fun getSplitLongChapter(): Boolean {
        return false
    }

    fun toSearchBook(): SearchBook {
        return SearchBook(
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
//                originOrder = originOrder,
                variable = variable
        ).apply {
            this.infoHtml = this@Book.infoHtml
            this.tocHtml = this@Book.tocHtml
        }
    }

    fun getEpubRootDir(): String {
        // 根据 content.opf 位置来确认root目录
        // var contentOPF = "OEBPS/content.opf"

        val defaultPath = "OEBPS"

        // 根据 META-INF/container.xml 来获取 contentOPF 位置
        val containerRes = File(bookUrl + File.separator + "index" + File.separator + "META-INF" + File.separator + "container.xml")
        if (containerRes.exists()) {
            try {
                val document = Jsoup.parse(containerRes.readText())
                val rootFileElement = document
                        .getElementsByTag("rootfiles").get(0)
                        .getElementsByTag("rootfile").get(0);
                val result = rootFileElement.attr("full-path");
                System.out.println("result: " + result)
                if (result != null && result.isNotEmpty()) {
                    return File(result).parentFile?.let{
                        it.toString()
                    } ?: ""
                }
            } catch (e: Exception) {
                e.printStackTrace();
                // Log.e(TAG, e.getMessage(), e);
            }
        }

        // 返回默认位置
        return defaultPath
    }

    fun updateFromLocal(onlyCover: Boolean = false) {
        try {
            if (isEpub()) {
                EpubFile.upBookInfo(this, onlyCover)
            } else if (isUmd()) {
                UmdFile.upBookInfo(this, onlyCover)
            }
        } catch(e: Exception) {
            e.printStackTrace()
        }
    }

    fun workRoot(): String {
        return rootDir
    }

    companion object {
        const val hTag = 2L
        const val rubyTag = 4L
        const val imgTag = 8L
        const val imgStyleDefault = "DEFAULT"
        const val imgStyleFull = "FULL"
        const val imgStyleText = "TEXT"

        fun initLocalBook(bookUrl: String, localPath: String, rootDir: String = ""): Book {
            val fileName = File(localPath).name
            val nameAuthor = LocalBook.analyzeNameAuthor(fileName)
            val book = Book(bookUrl, "", BookType.local, localPath, nameAuthor.first, nameAuthor.second).also {
                it.canUpdate = false
            }
            book.setRootDir(rootDir)
            book.updateFromLocal()
            return book
        }
    }

    data class ReadConfig(
        var reverseToc: Boolean = false,
        var pageAnim: Int = -1,
        var reSegment: Boolean = false,
        var imageStyle: String? = null,
        var useReplaceRule: Boolean = false,   // 正文使用净化替换规则
        var delTag: Long = 0L   //去除标签
    )

    class Converters {
        fun readConfigToString(config: ReadConfig?): String = GSON.toJson(config)

        fun stringToReadConfig(json: String?) = GSON.fromJsonObject<ReadConfig>(json)
    }
}