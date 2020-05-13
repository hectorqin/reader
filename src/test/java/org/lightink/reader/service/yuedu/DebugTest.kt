package org.lightink.reader.service.yuedu

import io.legado.app.data.entities.BookSource
import io.legado.app.help.storage.OldRule
import io.legado.app.model.Debug
import io.legado.app.model.WebBook
import io.legado.app.utils.GSON
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
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
        runBlocking {
            val bookSource = OldRule.jsonToBookSource("{\n" +
                    "    \"bookSourceUrl\": \"http:\\/\\/www.biquku.la\",\n" +
                    "    \"bookSourceType\": \"0\",\n" +
                    "    \"bookSourceName\": \"笔趣阁(库)\",\n" +
                    "    \"bookSourceGroup\": \"优质\",\n" +
                    "    \"loginUrl\": \"\",\n" +
                    "    \"bookUrlPattern\": \"\",\n" +
                    "    \"header\": \"\",\n" +
                    "    \"searchUrl\": \"\\/modules\\/article\\/search.php,{\\n  \\\"method\\\": \\\"POST\\\",\\n  \\\"body\\\": \\\"searchkey={{key}}\\\"\\n}\",\n" +
                    "    \"exploreUrl\": \"玄幻::\\/xiaoshuo1\\/index{{page}}.html\\n修真::\\/xiaoshuo2\\/index{{page}}.html\\n都市::\\/xiaoshuo3\\/index{{page}}.html\\n穿越::\\/xiaoshuo4\\/index{{page}}.html\\n网游::\\/xiaoshuo5\\/index{{page}}.html\\n科幻::\\/xiaoshuo6\\/index{{page}}.html\",\n" +
                    "    \"enabled\": true,\n" +
                    "    \"enabledExplore\": true,\n" +
                    "    \"weight\": 0,\n" +
                    "    \"customOrder\": 8,\n" +
                    "    \"lastUpdateTime\": 0,\n" +
                    "    \"ruleSearch\": {\n" +
                    "        \"bookList\": \"class.grid@tag.tr!0\",\n" +
                    "        \"name\": \"tag.td.0@tag.a.0@text\",\n" +
                    "        \"author\": \"tag.td.2@text\",\n" +
                    "        \"kind\": \"\",\n" +
                    "        \"wordCount\": \"\",\n" +
                    "        \"lastChapter\": \"tag.td.1@tag.span.0@tag.a.0@text##正文\",\n" +
                    "        \"intro\": \"\",\n" +
                    "        \"coverUrl\": \"\",\n" +
                    "        \"bookUrl\": \"tag.td.0@tag.a.0@href\"\n" +
                    "    },\n" +
                    "    \"ruleExplore\": {\n" +
                    "        \"bookList\": \"class.item\",\n" +
                    "        \"name\": \"tag.dt@tag.a@text\",\n" +
                    "        \"author\": \"tag.dt@tag.span@text\",\n" +
                    "        \"kind\": \"\",\n" +
                    "        \"wordCount\": \"\",\n" +
                    "        \"lastChapter\": \"\",\n" +
                    "        \"intro\": \"tag.dd@text\",\n" +
                    "        \"coverUrl\": \"tag.img@src\",\n" +
                    "        \"bookUrl\": \"tag.dt@tag.a@href\"\n" +
                    "    },\n" +
                    "    \"ruleBookInfo\": {\n" +
                    "        \"init\": \"\",\n" +
                    "        \"name\": \"id.info@tag.h1.0@text\",\n" +
                    "        \"author\": \"id.info@tag.p.0@text##作者：\",\n" +
                    "        \"kind\": \"\",\n" +
                    "        \"wordCount\": \"\",\n" +
                    "        \"lastChapter\": \"id.info@tag.p.-1@tag.a@text\",\n" +
                    "        \"intro\": \"id.intro@tag.p@text\",\n" +
                    "        \"coverUrl\": \"id.fmimg@tag.img.0@src\",\n" +
                    "        \"tocUrl\": \"\"\n" +
                    "    },\n" +
                    "    \"ruleToc\": {\n" +
                    "        \"chapterList\": \"id.list@tag.dd\",\n" +
                    "        \"chapterName\": \"tag.a@text\",\n" +
                    "        \"chapterUrl\": \"tag.a@href\",\n" +
                    "        \"isVip\": \"\",\n" +
                    "        \"updateTime\": \"\",\n" +
                    "        \"nextTocUrl\": \"\"\n" +
                    "    },\n" +
                    "    \"ruleContent\": {\n" +
                    "        \"content\": \"id.content@textNodes\",\n" +
                    "        \"nextContentUrl\": \"\",\n" +
                    "        \"webJs\": \"\",\n" +
                    "        \"sourceRegex\": \"\"\n" +
                    "    }\n" +
                    "}")
            val webBook = WebBook(bookSource!!)
            Debug.startDebug(webBook, "剑来")
            Thread.sleep(1000000)

        }
    }
}