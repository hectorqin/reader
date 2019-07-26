package org.lightink.reader.service

import io.reactivex.Observable
import io.reactivex.Single
import io.vertx.reactivex.ext.web.client.WebClient
import mu.KotlinLogging
import org.jsoup.Jsoup
import org.lightink.reader.booksource.BookSource
import org.lightink.reader.ext.parser
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
                    map.put("name", t.parser(source.metadata.name.first()))
                    map.put("author", t.select(source.metadata.author.first()).text())
                    map.put("link", t.parser(source.metadata.link.first()))
                    return@map map
                }
                .filter { it.get("name") != null && it.get("name")!!.isNotBlank() }
                .toList()


    }


    fun details(link: String): Single<HashMap<String, Any>> {
        val url = "https://www.daocaorenshuwu.com/${link}"

        return webClient.getAbs(url)
                .rxSend()
                .map { t ->
                    return@map Jsoup.parse(t.bodyAsString())
                }
                .map { t ->
                    val map = hashMapOf<String, Any>()
                    map.put("cover", t.parser(source.metadata.cover.first()))
                    map.put("summary", t.parser(source.metadata.summary.first()))
                    map.put("category", t.parser(source.metadata.category.first()))
                    map.put("status", t.parser(source.metadata.status.first()))
                    map.put("update", t.parser(source.metadata.update.first()))
                    map.put("lastChapter", t.parser(source.metadata.lastChapter.first()))
                    val catalog = t.select(source.catalog.list)
                    map.put("catalogs", catalog.map {
                        val catalogs = hashMapOf<String, String>()
                        catalogs.put("chapterName", it.parser(source.catalog.chapter.name))
                        catalogs.put("chapterlink", it.parser(source.catalog.chapter.link))
                        catalogs
                    });

                    return@map map
                }

    }

    fun content(href: String): Single<HashMap<String, Any>> {

        return webClient.getAbs(href)
                .rxSend()
                .map { t ->
                    return@map Jsoup.parse(t.bodyAsString())
                }
                .map { t ->
                    val map = hashMapOf<String, Any>()
                    val filter = t.parser(source.content.filter.first())
                    if (filter.isNotBlank()) {
                        t.select(filter).remove()
                    }

                    map.put("text", t.parser(source.content.text))
                    val nextlinks = t.select(source.content.next.link)
                    val nextlink = nextlinks.filter { it.text() == source.content.next.text }.firstOrNull()?.text()
                    map.put("nextLink", nextlink.orEmpty())
                    map.put("nextText", source.content.next.text);
                    return@map map
                }
    }


}
