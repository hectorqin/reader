package io.legado.app.localBook

import io.legado.app.constant.AppConst
import io.legado.app.constant.AppPattern
import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.help.BookHelp
import io.legado.app.utils.*
import java.io.File
import java.util.regex.Matcher
import java.util.regex.Pattern
import javax.script.SimpleBindings

object LocalBook {

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
                TextFile().analyze(book)
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

        //匹配(知轩藏书常用格式) 《书名》其它信息作者：作者名.txt
        val m1 = Pattern
            .compile("(.*?)《([^《》]+)》(.*)")
            .matcher(tempFileName)

        //匹配 书名 by 作者名.txt
        val m2 = Pattern
            .compile("(^)(.+) by (.+)$")
            .matcher(tempFileName)

        (m1.takeIf { m1.find() } ?: m2.takeIf { m2.find() }).run {
            if (this is Matcher) {
                //按默认格式将文件名分解成书名、作者名
                name = group(2)!!
                author = BookHelp.formatBookAuthor((group(1) ?: "") + (group(3) ?: ""))
            } else {
                name = tempFileName.replace(AppPattern.nameRegex, "")
                author = tempFileName.replace(AppPattern.authorRegex, "")
                    .takeIf { it.length != tempFileName.length } ?: ""
            }

        }
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
