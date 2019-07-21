package org.lightink.reader.service

import io.reactivex.Observable
import io.reactivex.Single
import io.vertx.reactivex.ext.web.client.WebClient
import mu.KotlinLogging
import org.jsoup.Jsoup
import org.lightink.reader.booksource.BookSource
import org.lightink.reader.ext.parserAttr
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Service

/**
 * @Date: 2019-07-19 18:23
 * @Description:
 */

private val logger = KotlinLogging.logger {}


@Service
class MainService {

    @Autowired
    private lateinit var webClient: WebClient
    @Autowired
    private lateinit var source: BookSource

    fun search(searchKey: String): Single<MutableList<HashMap<String, String?>>> {

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
                    val map = hashMapOf<String, String?>()
                    map.put("name", t.parserAttr(source.metadata.name.first()))
                    map.put("author", t.select(source.metadata.author.first()).text())
                    map.put("link", t.parserAttr(source.metadata.link.first()))
                    return@map map
                }
                .filter { it.get("name") != null && it.get("name")!!.isNotBlank() }
                .toList()


    }


}
