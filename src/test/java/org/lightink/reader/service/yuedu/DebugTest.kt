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
                "  \"bookSourceGroup\": \"✯༇薅白魔人♪\",\n" +
                "  \"bookSourceName\": \"有兔\",\n" +
                "  \"bookSourceUrl\": \"http://app.youzibank.com\",\n" +
                "  \"enable\": true,\n" +
                "  \"ruleBookContent\": \"@Js:result\",\n" +
                "  \"ruleBookName\": \"\",\n" +
                "  \"ruleChapterList\": \"data.*\",\n" +
                "  \"ruleChapterName\": \"name\",\n" +
                "  \"ruleContentUrl\": \"https://book.chengxinqinye.com/book{\$.filePath}\",\n" +
                "  \"ruleFindUrl\": \"历史传记::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=193&clsIdSecond=0&gender=-1&pageNo=searchPage\\n经济管理::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=205&clsIdSecond=0&gender=-1&pageNo=searchPage\\n社科心理::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=212&clsIdSecond=0&gender=-1&pageNo=searchPage\\n艺术生活::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=245&clsIdSecond=0&gender=-1&pageNo=searchPage\\n历史著作::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=258&clsIdSecond=0&gender=-1&pageNo=searchPage\\n成功励志::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=269&clsIdSecond=0&gender=-1&pageNo=searchPage\\n英文著作::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=276&clsIdSecond=0&gender=-1&pageNo=searchPage\\n儿童读物::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=280&clsIdSecond=0&gender=-1&pageNo=searchPage\\n古典文学::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=283&clsIdSecond=0&gender=-1&pageNo=searchPage\\n现代文学::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=287&clsIdSecond=0&gender=-1&pageNo=searchPage\\n商业思维::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=291&clsIdSecond=0&gender=-1&pageNo=searchPage\\n其他::/book/list?selectionModuleId=0&fullFlag=0&orderBy=read_cnt&clsIdFirst=116&clsIdSecond=0&gender=2&pageNo=searchPage\",\n" +
                "  \"ruleSearchAuthor\": \"author\",\n" +
                "  \"ruleSearchCoverUrl\": \"https://book.banquanzhuce.com/book{\$.photoPath}\",\n" +
                "  \"ruleSearchIntroduce\": \"intro\",\n" +
                "  \"ruleSearchKind\": \"clsName\",\n" +
                "  \"ruleSearchLastChapter\": \"lastUpdate\",\n" +
                "  \"ruleSearchList\": \"data.*\",\n" +
                "  \"ruleSearchName\": \"name\",\n" +
                "  \"ruleSearchNoteUrl\": \"/book/chapter/listAll?bookId={\$.id}\",\n" +
                "  \"ruleSearchUrl\": \"http://app.youzibank.com:80/es/search/book?q=searchKey&pageNo=searchPage&pageSize=10@header:{Seq:'2482380c2df68970a7833191e8193316'}\",\n" +
                "  \"serialNumber\": 1,\n" +
                "  \"weight\": 0\n" +
                "}")
        val webBook = WebBook(bookSource)
        Debug.startDebug(webBook, "剑来")
        Thread.sleep(1000000)
    }
}