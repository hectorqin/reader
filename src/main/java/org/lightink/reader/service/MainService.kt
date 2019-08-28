package org.lightink.reader.service

import com.fasterxml.jackson.databind.deser.SettableBeanProperty
import io.reactivex.Observable
import io.reactivex.Single
import io.vertx.reactivex.core.buffer.Buffer
import io.vertx.reactivex.ext.web.client.HttpResponse
import io.vertx.reactivex.ext.web.client.WebClient
import mu.KotlinLogging
import org.jsoup.Jsoup
import org.lightink.reader.booksource.BookSource
import org.lightink.reader.booksource.Rank
import org.lightink.reader.contants.PropertyType
import org.lightink.reader.ext.getEncodeAbs
import org.lightink.reader.ext.parser
import org.lightink.reader.ext.universalChardet
import org.lightink.reader.ext.url
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.net.URLEncoder
import kotlin.properties.Delegates

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
    private lateinit var bookSourceService: BookSourceService
    @Value("\${qingmo.server.url}")
    private lateinit var serviceUrl: String


    fun search(code: String, name: String, searchKey: String): Single<MutableList<HashMap<String, String?>>> {

        logger.info { "serviceUrl == >  " + serviceUrl }

        return bookSourceService.bookSource(code, name)
                .flatMap { bookSource ->

                    var link = bookSource.search.link
                    val httpRequest: Single<HttpResponse<Buffer>>

                    val searchKeyEncoded = if (bookSource.charset.isNotBlank()) {
                        URLEncoder.encode(searchKey, bookSource.charset)
                    } else searchKey

                    if (link.contains("@post->")) {
                        val split = link.split("@post->")
                        link = split[0]
                        val param = split[1].split("=")
                        httpRequest = webClient.postAbs(link)
                                .putHeader("content-type", "application/x-www-form-urlencoded")
                                .rxSendBuffer(Buffer.buffer().appendString(split[1].replace("\${key}", searchKeyEncoded)))
                    } else {
                        httpRequest = webClient.getEncodeAbs(link.replace("\${key}", searchKeyEncoded))
                                .rxSend()
                    }

                    //        val link = "https://www.daocaorenshuwu.com/plus/search.php?q=\${key}"
                    var redirectUrl = ""
                    return@flatMap httpRequest
                            .map { t ->
                                redirectUrl = t.followedRedirects().lastOrNull().orEmpty()
                                val document = Jsoup.parse(t.body().bytes.universalChardet())
                                var elements = document.select(bookSource.search.list).toList()
                                if (elements.isEmpty()) {
                                    elements = listOf(document)
                                }
                                elements
                            }
                            .toObservable()
                            .flatMap { t ->
                                Observable.fromIterable(t)
                            }
                            .map { t ->
                                val map = hashMapOf<String, String?>()
                                map.put("name", t.parser(bookSource.metadata.name))
                                map.put("author", t.select(bookSource.metadata.author.first()).text())
                                var url = t.parser(bookSource.metadata.link).url()
                                if (url.isBlank()) {
                                    url = redirectUrl
                                }
                                map.put("link", "$serviceUrl/$code/$name/details?link=" + url)

                                map.put("cover", t.parser(bookSource.metadata.cover, propertyType = PropertyType.DETAIL))
                                map.put("summary", t.parser(bookSource.metadata.summary, propertyType = PropertyType.DETAIL))
                                map.put("category", t.parser(bookSource.metadata.category, propertyType = PropertyType.DETAIL))
                                map.put("status", t.parser(bookSource.metadata.status, propertyType = PropertyType.DETAIL))
                                map.put("update", t.parser(bookSource.metadata.update, propertyType = PropertyType.DETAIL))
                                map.put("lastChapter", t.parser(bookSource.metadata.lastChapter, propertyType = PropertyType.DETAIL))
                                return@map map
                            }
                            .filter { it.get("name") != null && it.get("name")!!.isNotBlank() }
                            .toList()

                }

    }


    fun details(code: String, name: String, link: String): Single<HashMap<String, Any>> {


        return bookSourceService.bookSource(code, name)
                .flatMap { source ->

                    val url = "${source.url}$link"

                    return@flatMap webClient.getEncodeAbs(url)
                            .rxSend()
                            .map { t ->
                                val document = Jsoup.parse(t.body().bytes.universalChardet())
                                return@map document
                            }
                            .flatMap { t ->
                                val catalogLink = t.parser(source.metadata.catalog)
                                if (catalogLink.isNotBlank()) {
                                    logger.info { "catalogLink: $catalogLink" }
                                    return@flatMap webClient.getEncodeAbs(source.url + catalogLink).rxSend()
                                            .map {
                                                return@map t to Jsoup.parse(it.body().bytes.universalChardet())
                                            }
                                } else {
                                    return@flatMap Single.just(t to null)
                                }
                            }
                            .map { p ->
                                val t = p.first
                                val map = hashMapOf<String, Any>()
                                map.put("cover", t.parser(source.metadata.cover, propertyType = PropertyType.DETAIL))
                                map.put("summary", t.parser(source.metadata.summary, propertyType = PropertyType.DETAIL))
                                map.put("category", t.parser(source.metadata.category, propertyType = PropertyType.DETAIL))
                                map.put("status", t.parser(source.metadata.status, propertyType = PropertyType.DETAIL))
                                map.put("update", t.parser(source.metadata.update, propertyType = PropertyType.DETAIL))
                                map.put("lastChapter", t.parser(source.metadata.lastChapter, propertyType = PropertyType.DETAIL))

                                val catalogDocument = if (p.second != null) {
                                    p.second
                                } else {
                                    t
                                }
                                val catalog = catalogDocument!!.select(source.catalog.list)
                                map.put("catalogs", catalog.map {
                                    val catalogs = hashMapOf<String, String>()
                                    catalogs.put("chapterName", it.parser(source.catalog.chapter.name))
                                    val chapterlink = it.parser(source.catalog.chapter.link).url()
                                    catalogs.put("chapterlink", "$serviceUrl/$code/$name/content?href=" + chapterlink)
                                    catalogs
                                })

                                map.put("orderBy", source.catalog.orderBy)

                                return@map map
                            }
                }

    }

    fun content(code: String, name: String, href: String): Single<HashMap<String, Any>> {
        return bookSourceService.bookSource(code, name)
                .flatMap { source ->

                    return@flatMap webClient.getEncodeAbs(source.url + href)
                            .rxSend()
                            .map { t ->
                                return@map Jsoup.parse(t.body().bytes.universalChardet())
                            }
                            .map { t ->
                                val map = hashMapOf<String, Any>()
                                val filter = t.parser(source.content.filter)
                                if (filter.isNotBlank()) {
                                    t.select(filter).remove()
                                }

                                map.put("text", t.parser(source.content.text))
                                if (source.content.next != null) {
                                    val nextlinks = t.select(source.content.next.link)
                                    val nextlink = nextlinks.filter { it.text() == source.content.next.text }.firstOrNull()?.text()
                                    map.put("nextLink", nextlink.orEmpty())
                                    map.put("nextText", source.content.next.text.orEmpty());
                                }
                                return@map map
                            }
                }
    }


    fun rank(code: String, name: String, classify: String): Single<MutableList<HashMap<String, String?>>> {
        var rank: Rank by Delegates.notNull()
        var bookSource: BookSource by Delegates.notNull()
        return bookSourceService.bookSource(code, name)
                .map {
                    bookSource = it
                    rank = it.rank!!
                    it.rank.link.first { it.name == classify }
                }
                .flatMap { t ->
                    return@flatMap webClient.getEncodeAbs(t.link)
                            .rxSend()
                }
                .map {
                    val document = Jsoup.parse(it.body().bytes.universalChardet())
                    document.select(rank.list).toList()
                }
                .toObservable()
                .flatMap { t ->
                    Observable.fromIterable(t)
                }
                .map { t ->
                    val map = hashMapOf<String, String?>()
                    map.put("name", t.parser(bookSource.metadata.name))
                    map.put("author", t.select(bookSource.metadata.author.first()).text())
                    map.put("link", "$serviceUrl/$code/$name/details?link=" + t.parser(bookSource.metadata.link).url())
                    map.put("cover", t.parser(bookSource.metadata.cover))
                    map.put("summary", t.parser(bookSource.metadata.summary))
                    map.put("category", t.parser(bookSource.metadata.category))
                    map.put("status", t.parser(bookSource.metadata.status))
                    map.put("update", t.parser(bookSource.metadata.update))
                    map.put("lastChapter", t.parser(bookSource.metadata.lastChapter))
                    return@map map
                }
                .toList()
    }


}
