package org.lightink.reader.service

import com.google.gson.Gson
import io.reactivex.Observable
import io.reactivex.Single
import io.vertx.core.json.JsonObject
import io.vertx.reactivex.ext.web.client.WebClient
import org.jsoup.Jsoup
import org.lightink.reader.booksource.BookSource
import org.lightink.reader.ext.parserAttr
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Service

/**
 * @Date: 2019-07-19 18:23
 * @Description:
 */
@Service
class MainService {

    @Autowired
    private lateinit var webClient: WebClient
    @Autowired
    private lateinit var source: BookSource

    fun search(searchKey: String): Single<MutableList<JsonObject>> {
        val bookSource = Gson().fromJson<BookSource>("", BookSource::class.java)


//        val link = bookSource.search.link
        val link = "https://www.daocaorenshuwu.com/plus/search.php?q=\${key}"
        return webClient.getAbs(link.replace("\${key}", searchKey))
                .rxSend()
                .map { t ->
                    val document = Jsoup.parse(t.bodyAsString())
                    document.select(source.search.list)
                }
                .toObservable()
                .flatMap { t ->
                    Observable.fromIterable(t)
                }
                .map { t ->
                    val jsonObject = JsonObject()
                    jsonObject.put("name", t.parserAttr(source.metadata.name.first()))
                    jsonObject.put("author", t.select(source.metadata.author.first()).text())
                    jsonObject.put("link", t.parserAttr(source.metadata.link.first()))
                    println("jsonObject: " + jsonObject)
                    return@map jsonObject
                }
                .filter { it.getString("name").isNotBlank() }
                .toList()


    }


}
