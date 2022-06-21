package io.legado.app.model.localBook

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.help.BookHelp
import io.legado.app.utils.*
import me.ag2s.epublib.domain.EpubBook
import me.ag2s.epublib.epub.EpubReader
import org.jsoup.Jsoup
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.charset.Charset
import java.nio.file.Paths
import java.util.*
import java.util.zip.ZipFile
import mu.KotlinLogging
private val logger = KotlinLogging.logger {}

class EpubFile(var book: Book) {

    companion object {
        private var eFile: EpubFile? = null

        @Synchronized
        private fun getEFile(book: Book): EpubFile {
            if (eFile == null || eFile?.book?.bookUrl != book.bookUrl) {
                eFile = EpubFile(book)
                //对于Epub文件默认不启用替换
                // book.setUseReplaceRule(false)
                return eFile!!
            }
            eFile?.book = book
            return eFile!!
        }

        @Synchronized
        fun getChapterList(book: Book): ArrayList<BookChapter> {
            if (book.tocUrl.isEmpty()) {
                book.tocUrl = "spin+toc"
            }
            val epubFile = getEFile(book)
            return when (book.tocUrl) {
                "toc" -> {
                    logger.info("epubFile.getChapterList")
                    epubFile.getChapterList()
                }
                "spin" -> {
                    logger.info("epubFile.getChapterListBySpine")
                    epubFile.getChapterListBySpine()
                }
                "spin<toc" -> {
                    logger.info("epubFile.getChapterListBySpinAndToc true")
                    epubFile.getChapterListBySpinAndToc(true)
                }
                "spin+toc" -> {
                    logger.info("epubFile.getChapterListBySpinAndToc")
                    epubFile.getChapterListBySpinAndToc()
                }
                "toc+spin" -> {
                    logger.info("epubFile.getChapterListByTocAndSpin")
                    epubFile.getChapterListByTocAndSpin()
                }
                "toc<spin" -> {
                    logger.info("epubFile.getChapterListByTocAndSpin true")
                    epubFile.getChapterListByTocAndSpin(true)
                }
                else -> {
                    logger.info("epubFile.getChapterListBySpinAndToc")
                    epubFile.getChapterListBySpinAndToc()
                }
            }
        }

        @Synchronized
        fun getContent(book: Book, chapter: BookChapter): String? {
            return getEFile(book).getContent(chapter)
        }

        @Synchronized
        fun getImage(
            book: Book,
            href: String
        ): InputStream? {
            return getEFile(book).getImage(href)
        }

        @Synchronized
        fun upBookInfo(book: Book, onlyCover: Boolean = false) {
            if (onlyCover) {
                return getEFile(book).updateCover()
            }
            return getEFile(book).upBookInfo()
        }
    }

    private var mCharset: Charset = Charset.defaultCharset()
    private var epubBook: EpubBook? = null
        get() {
            if (field != null) {
                return field
            }
            field = readEpub()
            return field
        }

    init {
        try {
            epubBook?.let {
                // if (book.coverUrl.isNullOrEmpty()) {
                //     book.coverUrl = FileUtils.getPath(
                //         appCtx.externalFiles,
                //         "covers",
                //         "${MD5Utils.md5Encode16(book.bookUrl)}.jpg"
                //     )
                // }
                // if (!File(book.coverUrl!!).exists()) {
                //     /*部分书籍DRM处理后，封面获取异常，待优化*/
                //     it.coverImage?.inputStream?.use { input ->
                //         val cover = BitmapFactory.decodeStream(input)
                //         val out = FileOutputStream(FileUtils.createFileIfNotExist(book.coverUrl!!))
                //         cover.compress(Bitmap.CompressFormat.JPEG, 90, out)
                //         out.flush()
                //         out.close()
                //     }
                // }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /*重写epub文件解析代码，直接读出压缩包文件生成Resources给epublib，这样的好处是可以逐一修改某些文件的格式错误*/
    private fun readEpub(): EpubBook? {
        try {
            val file = book.getLocalFile()
            //通过懒加载读取epub
            return EpubReader().readEpubLazy(ZipFile(file), "utf-8")
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return null
    }

    private fun getContent(chapter: BookChapter): String? {
        /*获取当前章节文本*/
        return getChildChapter(chapter, chapter.url)
    }

    private fun getChildChapter(chapter: BookChapter, href: String): String? {
        epubBook?.let {
            val body = Jsoup.parse(String(it.resources.getByHref(href).data, mCharset)).body()

            if (chapter.url == href) {
                val startFragmentId = chapter.startFragmentId
                val endFragmentId = chapter.endFragmentId
                /*一些书籍依靠href索引的resource会包含多个章节，需要依靠fragmentId来截取到当前章节的内容*/
                /*注:这里较大增加了内容加载的时间，所以首次获取内容后可存储到本地cache，减少重复加载*/
                if (!startFragmentId.isNullOrBlank())
                    body.getElementById(startFragmentId)?.previousElementSiblings()?.remove()
                if (!endFragmentId.isNullOrBlank() && endFragmentId != startFragmentId)
                    body.getElementById(endFragmentId)?.nextElementSiblings()?.remove()
            }

            /*选择去除正文中的H标签，部分书籍标题与阅读标题重复待优化*/
            var tag = Book.hTag
            if (book.getDelTag(tag)) {
                body.getElementsByTag("h1").remove()
                body.getElementsByTag("h2").remove()
                body.getElementsByTag("h3").remove()
                body.getElementsByTag("h4").remove()
                body.getElementsByTag("h5").remove()
                body.getElementsByTag("h6").remove()
                //body.getElementsMatchingOwnText(chapter.title)?.remove()
            }

            /*选择去除正文中的img标签，目前图片支持效果待优化*/
            tag = Book.imgTag
            if (book.getDelTag(tag)) {
                body.getElementsByTag("img").remove()
            }

            val elements = body.children()
            elements.select("script").remove()
            elements.select("style").remove()
            /*选择去除正文中的ruby标签，目前注释支持效果待优化*/
            tag = Book.rubyTag
            var html = elements.outerHtml()
            if (book.getDelTag(tag)) {
                html = html.replace("<ruby>\\s?([\\u4e00-\\u9fa5])\\s?.*?</ruby>".toRegex(), "$1")
            }
            return HtmlFormatter.formatKeepImg(html)
        }
        return null
    }

    private fun getImage(href: String): InputStream? {
        val abHref = href.replace("../", "")
        return epubBook?.resources?.getByHref(abHref)?.inputStream
    }

    private fun upBookInfo() {
        if (epubBook == null) {
            eFile = null
            book.intro = "书籍导入异常"
        } else {
            val metadata = epubBook!!.metadata
            book.name = metadata.firstTitle
            if (book.name.isEmpty()) {
                book.name = book.originName.replace(".epub", "")
            }

            if (metadata.authors.size > 0) {
                val author =
                    metadata.authors[0].toString().replace("^, |, $".toRegex(), "")
                book.author = author
            }
            if (metadata.descriptions.size > 0) {
                book.intro = Jsoup.parse(metadata.descriptions[0]).text()
            }

            updateCover()
        }
    }

    fun updateCover() {
        val coverFile = "${MD5Utils.md5Encode16(book.bookUrl)}.jpg"
        val relativeCoverUrl = Paths.get("assets", "covers", coverFile).toString()
        if (book.coverUrl.isNullOrEmpty()) {
            book.coverUrl = File.separator + relativeCoverUrl
        }
        val coverUrl = Paths.get(book.workRoot(), "storage", relativeCoverUrl).toString()
        if (!File(coverUrl).exists()) {
            FileUtils.writeBytes(coverUrl, epubBook!!.coverImage.data)
        }
        // 保存 cover
        // val cover = epubBook!!.coverImage?.href
        // if (cover != null) {
        //     val epubRootDir = book.getEpubRootDir()
        //     if (epubRootDir.isEmpty()) {
        //         book.coverUrl = book.bookUrl.replace("storage/data/", "/epub/") + "/index/" + cover
        //     } else {
        //         book.coverUrl = book.bookUrl.replace("storage/data/", "/epub/") + "/index/" + epubRootDir + "/" + cover
        //     }
        // }
    }

    fun getChapterListBySpine(): ArrayList<BookChapter> {
        val chapterList = ArrayList<BookChapter>()
        epubBook?.spine?.spineReferences?.forEachIndexed { index, spinResource ->
            val resource = spinResource.resource
            var title = resource.title
            if (title.isNullOrEmpty()) {
                try {
                    val doc =
                        Jsoup.parse(String(resource.data, mCharset))
                    val elements = doc.getElementsByTag("title")
                    if (elements.size > 0) {
                        title = elements[0].text()
                    }
                } catch (e: IOException) {
                    e.printStackTrace()
                }
            }

            val chapter = BookChapter()
            chapter.index = index
            chapter.bookUrl = book.bookUrl
            chapter.url = resource.href
            if (index == 0 && title.isEmpty()) {
                chapter.title = "封面"
            } else {
                chapter.title = title
            }
            chapterList.add(chapter)
        }
        book.latestChapterTitle = chapterList.lastOrNull()?.title
        book.totalChapterNum = chapterList.size
        return chapterList
    }

    fun getChapterList(): ArrayList<BookChapter> {
        val chapterList = ArrayList<BookChapter>()
        epubBook?.tableOfContents?.allUniqueResources?.forEachIndexed { index, resource ->
            var title = resource.title
            if (title.isNullOrEmpty()) {
                try {
                    val doc =
                        Jsoup.parse(String(resource.data, mCharset))
                    val elements = doc.getElementsByTag("title")
                    if (elements.size > 0) {
                        title = elements[0].text()
                    }
                } catch (e: IOException) {
                    e.printStackTrace()
                }
            }
            val chapter = BookChapter()
            chapter.index = index
            chapter.bookUrl = book.bookUrl
            chapter.url = resource.href
            if (index == 0 && title.isEmpty()) {
                chapter.title = "封面"
            } else {
                chapter.title = title
            }
            chapterList.add(chapter)
        }
        book.latestChapterTitle = chapterList.lastOrNull()?.title
        book.totalChapterNum = chapterList.size
        return chapterList
    }

    fun getChapterListBySpinAndToc(useTocTitle: Boolean = false): ArrayList<BookChapter> {
        // 如果读取了 toc，那么 spin 就会使用 toc 的章节名
        val tocChapterList = getChapterList()
        val spinChapterList = getChapterListBySpine()

        if (spinChapterList.size == 0) {
            return tocChapterList;
        }

        if (tocChapterList.size == 0) {
            return spinChapterList;
        }

        val titleMap: MutableMap<String, BookChapter> = mutableMapOf();

        for (i in 0 until tocChapterList.size) {
            titleMap.put(tocChapterList.get(i).url, tocChapterList.get(i))
        }

        for (i in 0 until spinChapterList.size) {
            val chapter = spinChapterList.get(i)
            val tocChapter = titleMap.get(chapter.url)
            if (tocChapter != null && tocChapter.title.isNotEmpty()) {
                if (useTocTitle || chapter.title.isEmpty()) {
                    chapter.title = tocChapter.title
                }
            }
        }

        book.latestChapterTitle = spinChapterList.lastOrNull()?.title
        book.totalChapterNum = spinChapterList.size
        return spinChapterList
    }

    fun getChapterListByTocAndSpin(useSpinTitle: Boolean = false): ArrayList<BookChapter> {
        // 如果读取了 toc，那么 spin 就会使用 toc 的章节名
        val tocChapterList = getChapterList()
        val spinChapterList = getChapterListBySpine()

        if (tocChapterList.size == 0) {
            return spinChapterList;
        }

        if (spinChapterList.size == 0) {
            return tocChapterList;
        }

        val titleMap: MutableMap<String, BookChapter> = mutableMapOf();

        for (i in 0 until spinChapterList.size) {
            titleMap.put(spinChapterList.get(i).url, spinChapterList.get(i))
        }

        for (i in 0 until tocChapterList.size) {
            val chapter = tocChapterList.get(i)
            val tocChapter = titleMap.get(chapter.url)
            if (tocChapter != null && tocChapter.title.isNotEmpty()) {
                if (useSpinTitle || chapter.title.isEmpty()) {
                    chapter.title = tocChapter.title
                }
            }
        }

        book.latestChapterTitle = tocChapterList.lastOrNull()?.title
        book.totalChapterNum = tocChapterList.size
        return tocChapterList
    }
}