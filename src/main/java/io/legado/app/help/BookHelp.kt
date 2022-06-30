package io.legado.app.help

import io.legado.app.constant.AppPattern
import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.BookSource
import io.legado.app.utils.FileUtils
import io.legado.app.utils.NetworkUtils
import io.legado.app.utils.MD5Utils
import io.legado.app.utils.getFile
import io.legado.app.model.analyzeRule.AnalyzeUrl
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope

//import org.apache.commons.text.similarity.JaccardSimilarity

object BookHelp {
    private const val cacheImageFolderName = "images"
    private val downloadImages = CopyOnWriteArraySet<String>()

    private fun formatFolderName(folderName: String): String {
        return folderName.replace("[\\\\/:*?\"<>|.]".toRegex(), "")
    }

    fun formatAuthor(author: String?): String {
        return author
            ?.replace("作\\s*者[\\s:：]*".toRegex(), "")
            ?.replace("\\s+".toRegex(), " ")
            ?.trim { it <= ' ' }
            ?: ""
    }

    /**
     * 格式化书名
     */
    fun formatBookName(name: String): String {
        return name
            .replace(AppPattern.nameRegex, "")
            .trim { it <= ' ' }
    }

    /**
     * 格式化作者
     */
    fun formatBookAuthor(author: String): String {
        return author
            .replace(AppPattern.authorRegex, "")
            .trim { it <= ' ' }
    }

    fun getBookCacheDir(book: Book): File {
        val md5Encode = MD5Utils.md5Encode(book.bookUrl).toString()
        val bookDir = book.getBookDir()
        if (bookDir.isEmpty()) {
            throw Exception("bookDir不能为空")
        }
        val localCacheDir = File(bookDir).getFile(md5Encode)
        if (!localCacheDir.exists()) {
            localCacheDir.mkdirs()
        }
        return localCacheDir
    }

    suspend fun saveContent(
        scope: CoroutineScope,
        bookSource: BookSource,
        book: Book,
        bookChapter: BookChapter,
        content: String
    ) {
        saveText(book, bookChapter, content)
        saveImages(scope, bookSource, book, bookChapter, content)
    }

    fun saveText(
        book: Book,
        bookChapter: BookChapter,
        content: String
    ) {
        // if (content.isEmpty()) return
        //保存文本
        FileUtils.createFileIfNotExist(
            getBookCacheDir(book),
            String.format("%d.txt", bookChapter.index)
        ).writeText(content)
    }

    suspend fun saveImages(
        scope: CoroutineScope,
        bookSource: BookSource,
        book: Book,
        bookChapter: BookChapter,
        content: String
    ) {
        val awaitList = arrayListOf<Deferred<Int>>()
        content.split("\n").forEach {
            val matcher = AppPattern.imgPattern.matcher(it)
            if (matcher.find()) {
                matcher.group(1)?.let { src ->
                    val mSrc = NetworkUtils.getAbsoluteURL(bookChapter.url, src)
                    val req: Deferred<Int> = scope.async {
                        saveImage(bookSource, book, mSrc)
                        return@async 1
                    }
                    awaitList.add(req)
                }
            }
        }
        awaitList.forEach {
            it.await()
        }
    }

    suspend fun saveImage(bookSource: BookSource?, book: Book, src: String) {
        while (downloadImages.contains(src)) {
            delay(100)
        }
        if (getImage(book, src).exists()) {
            return
        }
        downloadImages.add(src)
        val analyzeUrl = AnalyzeUrl(src, source = bookSource)
        try {
            analyzeUrl.getByteArrayAwait().let {
                FileUtils.createFileIfNotExist(
                    getBookCacheDir(book),
                    cacheImageFolderName,
                    "${MD5Utils.md5Encode16(src)}.${getImageSuffix(src)}"
                ).writeBytes(it)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            downloadImages.remove(src)
        }
    }

    fun getImage(book: Book, src: String): File {
        return getBookCacheDir(book).getFile(
            cacheImageFolderName,
            "${MD5Utils.md5Encode16(src)}.${getImageSuffix(src)}"
        )
    }

    fun getImageSuffix(src: String): String {
        var suffix = src.substringAfterLast(".").substringBefore(",")
        //检查截取的后缀字符是否合法 [a-zA-Z0-9]
        val fileSuffixRegex = Regex("^[a-z0-9]+$", RegexOption.IGNORE_CASE)
        if (suffix.length > 5 || !suffix.matches(fileSuffixRegex)) {
            suffix = "jpg"
        }
        return suffix
    }
}