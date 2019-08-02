package org.lightink.reader.service

import io.reactivex.Observable
import io.reactivex.Single
import io.vertx.reactivex.core.buffer.Buffer
import io.vertx.reactivex.ext.web.client.HttpRequest
import io.vertx.reactivex.ext.web.client.WebClient
import mu.KotlinLogging
import org.jsoup.Jsoup
import org.lightink.reader.contants.PropertyType
import org.lightink.reader.ext.parser
import org.lightink.reader.ext.url
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
    private lateinit var bookSourceService: BookSourceService


    fun search(code: String, name: String, searchKey: String): Single<MutableList<HashMap<String, String?>>> {

        return bookSourceService.bookSource(code, name)
                .flatMap { bookSource ->

                    var link = bookSource.search.link
                    val httpRequest: HttpRequest<Buffer>

                    if (link.contains("@post->")) {
                        val split = link.split("@post->")
                        link = split[0]
                        val param = split[1].split("=")
                        httpRequest = webClient.postAbs(link)
                                .addQueryParam(param[0], param[1].replace("\${key}", searchKey))
                    } else {
                        httpRequest = webClient.getAbs(link.replace("\${key}", searchKey))
                    }

                    //        val link = "https://www.daocaorenshuwu.com/plus/search.php?q=\${key}"
                    return@flatMap httpRequest
                            .rxSend()
                            .map { t ->
                                val document = Jsoup.parse(t.bodyAsString())
                                document.select(bookSource.search.list)
                            }
                            .toObservable()
                            .flatMap { t ->
                                Observable.fromIterable(t)
                            }
                            .map { t ->
                                val map = hashMapOf<String, String?>()
                                map.put("name", t.parser(bookSource.metadata.name))
                                map.put("author", t.select(bookSource.metadata.author.first()).text())
                                map.put("link", "http://qingmo.zohar.space/$code/$name/details?link=" + t.parser(bookSource.metadata.link))
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

                    return@flatMap webClient.getAbs(url)
                            .rxSend()
                            .map { t ->
                                return@map Jsoup.parse(t.bodyAsString())
                            }
                            .flatMap { t ->
                                val catalogLink = t.parser(source.metadata.catalog)
                                if (catalogLink.isNotBlank()) {
                                    logger.info { "catalogLink: $catalogLink" }
                                    return@flatMap webClient.getAbs(source.url + catalogLink).rxSend()
                                            .map {
                                                return@map t to Jsoup.parse(it.bodyAsString())
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
                                    catalogs.put("chapterlink", "http://qingmo.zohar.space/$code/$name/content?href=" + chapterlink)
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

                    return@flatMap webClient.getAbs(source.url + href)
                            .rxSend()
                            .map { t ->
                                return@map Jsoup.parse(t.bodyAsString())
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


}
