package io.legado.app.model.localBook

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.utils.*
import java.io.File
import java.io.InputStream
import java.util.*
import java.nio.file.Paths
import java.util.zip.ZipFile
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import com.htmake.reader.utils.getFileExtetion
import com.htmake.reader.utils.xml2map

class CbzFile(var book: Book) {
    var info: MutableMap<String, Any>? = null
    var cover: InputStream? = null

    companion object {
        private var cFile: CbzFile? = null

        @Synchronized
        private fun getCbzFile(book: Book): CbzFile {
            if (cFile == null || cFile?.book?.bookUrl != book.bookUrl) {
                cFile = CbzFile(book)
                return cFile!!
            }
            cFile?.book = book
            return cFile!!
        }

        @Synchronized
        fun getChapterList(book: Book): ArrayList<BookChapter> {
            return getCbzFile(book).getChapterList()
        }

        @Synchronized
        fun getContent(book: Book, chapter: BookChapter): String? {
            return getCbzFile(book).getContent(chapter)
        }

        @Synchronized
        fun upBookInfo(book: Book, onlyCover: Boolean = false) {
            if (onlyCover) {
                return getCbzFile(book).updateCover()
            }
            return getCbzFile(book).upBookInfo()
        }
    }

    init {
    }

    private fun parseBookInfo(): Pair<MutableMap<String, Any>?, InputStream?> {
        if (cover != null || info != null) {
            return Pair(info, cover)
        }
        val zf = ZipFile(book.getLocalFile())
        val entries = zf.entries()
        val imageExt = listOf("jpg", "jpeg", "gif", "png", "bmp", "webp", "svg")

        while (entries.hasMoreElements()) {
            val zipEntry: ZipEntry = entries.nextElement() as ZipEntry

            if (!zipEntry.isDirectory) {
                val name = zipEntry.name
                if (name.equals("ComicInfo.xml")) {
                    // 解析书籍信息
                    var inputStream = zf.getInputStream(zipEntry)
                    info = xml2map(inputStream)
                } else if (cover == null) {
                    // 解析第一张图片
                    val ext = getFileExtetion(name).lowercase()
                    if (imageExt.contains(ext)) {
                        cover = zf.getInputStream(zipEntry)
                    }
                }
            }
            if (cover != null && info != null) {
                break;
            }
        }

        return Pair(info, cover)
    }

    private fun upBookInfo() {
        val result = parseBookInfo()
        if (result.first != null) {
            val bookInfo = result.first as Map<String, Any>
            val info = bookInfo.get("ComicInfo") as Map<String, Any>? ?: null
            book.name = (info?.get("Title") ?: book.name) as String
            book.author = (info?.get("Writer") ?: book.author) as String
        }
        updateCover()
    }

    private fun updateCover() {
        val coverFile = "${MD5Utils.md5Encode16(book.bookUrl)}.jpg"
        val relativeCoverUrl = Paths.get("assets", "covers", coverFile).toString()
        if (book.coverUrl.isNullOrEmpty()) {
            book.coverUrl = File.separator + relativeCoverUrl
        }
        val coverUrl = Paths.get(book.workRoot(), "storage", relativeCoverUrl).toString()
        if (!File(coverUrl).exists()) {
            val result = parseBookInfo()
            if (result.second != null) {
                val coverStream = result.second as InputStream
                FileUtils.writeInputStream(coverUrl, coverStream)
            }
        }
    }

    private fun getContent(chapter: BookChapter): String? {
        return ""
    }

    private fun getChapterList(): ArrayList<BookChapter> {
        val chapterList = ArrayList<BookChapter>()
        val zf = ZipFile(book.getLocalFile())
        val entries = zf.entries()
        var imageFileList = arrayListOf<String>();
        while (entries.hasMoreElements()) {
            val zipEntry: ZipEntry = entries.nextElement() as ZipEntry

            if (!zipEntry.isDirectory) {
                val name = zipEntry.name
                if (!name.endsWith(".xml")) {
                    // 只获取图片文件
                    imageFileList.add(name)
                }
            }
        }
        // 排序
        imageFileList.sort()
        for (i in 0 until imageFileList.size) {
            val name = imageFileList.get(i)
            val chapter = BookChapter()
            chapter.title = name
            chapter.index = i
            chapter.bookUrl = book.bookUrl
            chapter.url = name
            chapterList.add(chapter)
        }
        book.latestChapterTitle = chapterList.lastOrNull()?.title
        book.totalChapterNum = chapterList.size
        return chapterList
    }
}