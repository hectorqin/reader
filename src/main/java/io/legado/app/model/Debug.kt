package io.legado.app.model

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.model.webBook.WebBook
import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

object Debug : DebugLog{
    suspend fun startDebug(webBook: WebBook, key: String) {
        log(msg = "⇒开始搜索关键字:$key")
        searchDebug(webBook, key)
    }

//    private suspend fun exploreDebug(webBook: WebBook, url: String) {
//        log("︾开始解析发现页")
//        val explore = webBook.exploreBook(url, 1)
//                .onSuccess { exploreBooks ->
//                    exploreBooks?.let {
//                        if (exploreBooks.isNotEmpty()) {
//                            log("︽发现页解析完成")
//                            log(showTime = false)
//                            infoDebug(webBook, exploreBooks[0].toBook())
//                        } else {
//                            log("︽未获取到书籍")
//                        }
//                    }
//                }
//                .onError {
//                    log(
//                            debugSource,
//                            it.localizedMessage,
//                            state = -1
//                    )
//                }
//
//        tasks.add(explore)
//    }

    private suspend fun searchDebug(webBook: WebBook, key: String) {
        log(msg = "︾开始解析搜索页")
        runCatching {
            webBook.searchBook(key, 1)
        }.onSuccess { searchBooks ->
            searchBooks.let {
                if (searchBooks.isNotEmpty()) {
                    log(webBook.sourceUrl, "︽搜索页解析完成")
                    infoDebug(webBook, searchBooks[0].toBook())
                } else {
                    log(webBook.sourceUrl, "︽未获取到书籍")
                }
            }
        }.onFailure {
            log(webBook.sourceUrl, it.localizedMessage)
            throw it
        }
    }

    private suspend fun infoDebug(webBook: WebBook, book: Book) {
        log(msg = "︾开始解析详情页")
        runCatching { webBook.getBookInfo(book.bookUrl) }
                .onSuccess {
                    log(webBook.sourceUrl, "︽详情页解析完成")
                    tocDebug(webBook, it)
                }
                .onFailure {
                    log(webBook.sourceUrl, it.localizedMessage)
                    throw it
                }
    }

    private suspend fun tocDebug(webBook: WebBook, book: Book) {
        log(msg = "︾开始解析目录页")
        runCatching {
            webBook.getChapterList(book)
        }
                .onSuccess { chapterList ->
                    chapterList?.let {
                        if (it.isNotEmpty()) {
                            log(webBook.sourceUrl, "︽目录页解析完成")
                            val nextChapterUrl = if (it.size > 1) it[1].url else null
                            contentDebug(webBook, book, it[0], nextChapterUrl)
                        } else {
                            log(webBook.sourceUrl, "︽目录列表为空")
                        }
                    }
                }
                .onFailure {
                    log(webBook.sourceUrl, it.localizedMessage)
                    throw it
                }
    }

    private suspend fun contentDebug(
            webBook: WebBook,
            book: Book,
            bookChapter: BookChapter,
            nextChapterUrl: String?
    ) {
        log(webBook.sourceUrl, "︾开始解析正文页")
        runCatching { webBook.getBookContent(book, bookChapter, nextChapterUrl) }
                .onSuccess {
                    log(webBook.sourceUrl, "︽正文页解析完成")
                }
                .onFailure {
                    log(webBook.sourceUrl, it.localizedMessage)
                }
    }
}