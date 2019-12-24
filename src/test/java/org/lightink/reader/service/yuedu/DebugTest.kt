package org.lightink.reader.service.yuedu

import io.legado.app.data.entities.BookSource
import io.legado.app.help.storage.OldRule
import io.legado.app.model.Debug
import io.legado.app.model.WebBook
import io.legado.app.utils.GSON
import org.junit.Test

import org.junit.Assert.*
import org.junit.runner.RunWith
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.junit4.SpringRunner


@RunWith(SpringRunner::class)
@SpringBootTest
class DebugTest {

    @Test
    fun startDebug() {
        val bookSource = OldRule.jsonToBookSource("{\n" +
                "\t\"bookSourceGroup\": \"S级\",\n" +
                "\t\"bookSourceName\": \"百合小说网\",\n" +
                "\t\"bookSourceUrl\": \"https://www.baihexs.com\",\n" +
                "\t\"enable\": true,\n" +
                "\t\"httpUserAgent\": \"Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko, By Black Prism) Chrome/99.0 Safari/537.36\",\n" +
                "\t\"loginUrl\": \"\",\n" +
                "\t\"ruleBookAuthor\": \"\",\n" +
                "\t\"ruleBookContent\": \"id.content@textNodes#请牢记：.*百合小说网.*\",\n" +
                "\t\"ruleBookName\": \"\",\n" +
                "\t\"ruleChapterList\": \"id.readerlist@tag.li!0\",\n" +
                "\t\"ruleChapterName\": \"tag.a@text\",\n" +
                "\t\"ruleChapterUrl\": \"id.reader@tag.a@href\",\n" +
                "\t\"ruleChapterUrlNext\": \"\",\n" +
                "\t\"ruleContentUrl\": \"tag.a@href\",\n" +
                "\t\"ruleContentUrlNext\": \"\",\n" +
                "\t\"ruleCoverUrl\": \"id.bookimg@tag.img.0@src\",\n" +
                "\t\"ruleFindUrl\": \"\",\n" +
                "\t\"ruleIntroduce\": \"id.bookintro@text\",\n" +
                "\t\"ruleSearchAuthor\": \"class.odd.1@text|id.author@tag.a@text\",\n" +
                "\t\"ruleSearchCoverUrl\": \"\",\n" +
                "\t\"ruleSearchKind\": \"\",\n" +
                "\t\"ruleSearchLastChapter\": \"class.even.0@tag.a@text|id.newlist@tag.li.0@tag.a.0@text\",\n" +
                "\t\"ruleSearchList\": \"class.grid@tag.tr!0|id.conn\",\n" +
                "\t\"ruleSearchName\": \"class.odd.0@tag.a@text|tag.h1@text\",\n" +
                "\t\"ruleSearchNoteUrl\": \"class.odd.0@tag.a@href\",\n" +
                "\t\"ruleSearchUrl\": \"https://www.baihexs.com/modules/article/search.php@searchkey=searchKey|char=gbk\",\n" +
                "\t\"serialNumber\": 15,\n" +
                "\t\"weight\": 0\n" +
                "}")
        val webBook = WebBook(bookSource)
        Debug.startDebug(webBook, "剑来")
        Thread.sleep(1000000)
    }
}