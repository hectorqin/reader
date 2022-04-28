package io.legado.app.model.localBook

import io.legado.app.constant.AppConst
import io.legado.app.constant.AppPattern
import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.help.BookHelp
import io.legado.app.utils.*
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.InputStream
import java.util.regex.Matcher
import java.util.regex.Pattern
import javax.script.SimpleBindings

object LocalBook {

    private val nameAuthorPatterns = arrayOf(
        Pattern.compile("(.*?)《([^《》]+)》.*?作者：(.*)"),
        Pattern.compile("(.*?)《([^《》]+)》(.*)"),
        Pattern.compile("(^)(.+) 作者：(.+)$"),
        Pattern.compile("(^)(.+) by (.+)$")
    )

    @Throws(FileNotFoundException::class, SecurityException::class)
    fun getBookInputStream(book: Book): InputStream {
        val file = book.getLocalFile()
        if (file.exists()) {
            return FileInputStream(file)
        }
        throw FileNotFoundException(book.name + " 文件不存在")
    }

    @Throws(Exception::class)
    fun getChapterList(book: Book): ArrayList<BookChapter> {
        val chapters = when {
            book.isEpub() -> {
                EpubFile.getChapterList(book)
            }
            book.isUmd() -> {
                UmdFile.getChapterList(book)
            }
            else -> {
                TextFile.getChapterList(book)
            }
        }
        if (chapters.isEmpty()) {
            throw Exception("Chapterlist is empty  " + book.getLocalFile())
        }
        return chapters
    }

    fun getContent(book: Book, chapter: BookChapter): String? {
        return when {
            book.isEpub() -> {
                EpubFile.getContent(book, chapter)
            }
            book.isUmd() -> {
                UmdFile.getContent(book, chapter)
            }
            else -> {
                TextFile.getContent(book, chapter)
            }
        }
    }

    fun analyzeNameAuthor(fileName: String): Pair<String, String> {
        val tempFileName = fileName.substringBeforeLast(".")
        var name: String
        var author: String

        for (pattern in nameAuthorPatterns) {
            pattern.matcher(tempFileName).takeIf { it.find() }?.run {
                name = group(2)!!
                val group1 = group(1) ?: ""
                val group3 = group(3) ?: ""
                author = BookHelp.formatBookAuthor(group1 + group3)
                return Pair(name, author)
            }
        }

        name = BookHelp.formatBookName(tempFileName)
        author = BookHelp.formatBookAuthor(tempFileName.replace(name, ""))
            .takeIf { it.length != tempFileName.length } ?: ""

        return Pair(name, author)
    }

    fun deleteBook(book: Book) {
        kotlin.runCatching {
            var bookFile = book.getLocalFile();
            if (book.isLocalTxt() || book.isUmd()) {
                if (bookFile.exists()) {
                    bookFile.delete()
                }
            }
            if (book.isEpub()) {
                bookFile = bookFile.parentFile
                if (bookFile != null && bookFile.exists()) {
                    FileUtils.delete(bookFile, true)
                }
            }
        }
    }
}
