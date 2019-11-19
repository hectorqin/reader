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
        val bookSource = OldRule.jsonToBookSource("  {\n" +
                "    \"bookSourceGroup\": \"优, S级, [ャ灬7℃↘寵.]\",\n" +
                "    \"bookSourceName\": \"笔趣阁\",\n" +
                "    \"bookSourceType\": \"\",\n" +
                "    \"bookSourceUrl\": \"https://www.bqg3.com\",\n" +
                "    \"enable\": true,\n" +
                "    \"httpUserAgent\": \"\",\n" +
                "    \"ruleIntroduce\": \"id.intro@tag.p.0@textNodes#注意：|最新章节.*|如果你觉得.*\",\n" +
                "    \"ruleBookAuthor\": \"id.info@tag.p.0@text#作    者：\",\n" +
                "    \"ruleBookName\": \"id.info@tag.h1@text# .*\",\n" +
                "    \"ruleBookKind\": \"class.con_top@textNodes@js:result.match(/> (.*) >/)[1]\",\n" +
                "    \"ruleBookLastChapter\": \"id.info@tag.a.-1@text\",\n" +
                "    \"ruleCoverUrl\": \"id.fmimg@tag.img@src\",\n" +
                "    \"ruleBookContent\": \"id.content@textNodes#天.*bqg3\\\\.com,|https\\\\:\\\\/\\\\/www.*\",\n" +
                "    \"ruleChapterList\": \"id.list@tag.dd@tag.a\",\n" +
                "    \"ruleChapterName\": \"text\",\n" +
                "    \"ruleChapterUrl\": \"\",\n" +
                "    \"ruleChapterUrlNext\": \"\",\n" +
                "    \"ruleContentUrl\": \"href\",\n" +
                "    \"ruleContentUrlNext\": \"\",\n" +
                "    \"ruleFindUrl\": \"\",\n" +
                "    \"ruleSearchAuthor\": \"class.odd.1@text\",\n" +
                "    \"ruleSearchCoverUrl\": \"class.odd.0@tag.a@href#/(\\\\d+)_(\\\\d+)/#/files/article/image/\$1/\$2/\$2s.jpg\",\n" +
                "    \"ruleSearchKind\": \"\",\n" +
                "    \"ruleSearchLastChapter\": \"class.even.0@text\",\n" +
                "    \"ruleSearchIntroduce\": \"\",\n" +
                "    \"ruleSearchList\": \"class.grid@tag.tr!0\",\n" +
                "    \"ruleSearchName\": \"class.odd.0@text\",\n" +
                "    \"ruleSearchNoteUrl\": \"class.odd.0@tag.a@href\",\n" +
                "    \"ruleSearchUrl\": \"/modules/article/search.php?searchtype=articlename&searchkey=searchKey|char=gbk\",\n" +
                "    \"serialNumber\": 51,\n" +
                "    \"weight\": 0\n" +
                "  }")!!
        val webBook = WebBook(bookSource)
        Debug.startDebug(webBook, "剑来")
        Thread.sleep(10000)
    }
}