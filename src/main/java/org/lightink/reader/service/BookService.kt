package org.lightink.reader.service

import com.jayway.jsonpath.JsonPath
import mu.KotlinLogging
import org.jsoup.Jsoup
import org.lightink.reader.contants.PropertyType
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.net.URLEncoder
import io.vertx.core.buffer.Buffer
import io.vertx.ext.web.client.HttpResponse
import io.vertx.ext.web.client.WebClient

import io.vertx.kotlin.ext.web.client.sendAwait
import io.vertx.kotlin.ext.web.client.sendBufferAwait
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.lightink.reader.ext.*


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

    /**
     * 搜索结果
     */
    suspend fun search(code: String, name: String, searchKey: String): List<HashMap<String, String?>> {
        val bookSource = bookSourceService.bookSource(code, name)

        //日志打点
        //code name searchurl search key
        logger.info { "search == >  " + serviceUrl }


        val link = bookSource.search.link
        //搜索内容encode
        val searchKeyEncoded = if (bookSource.charset.isNotBlank()) {
            URLEncoder.encode(searchKey, bookSource.charset)
        } else searchKey

        //判断是post还是get请求
        val httpResponse: HttpResponse<Buffer> = if (link.contains("@post->")) {
            val split = bookSource.search.link.split("@post->")
//            val param = split[1].split("=")
            webClient.postAbs(split[0])
                    .putHeader("content-type", "application/x-www-form-urlencoded")
                    .sendBufferAwait(Buffer.buffer().appendString(split[1].replace("\${key}", searchKeyEncoded)))
        } else {
            webClient.getEncodeAbs(link.replace("\${key}", searchKeyEncoded))
                    .sendAwait()
        }

        //val link = "https://www.daocaorenshuwu.com/plus/search.php?q=\${key}"

        if (httpResponse.getHeader("Content-type").startsWith("application/json")) {
            val list: List<Any> = JsonPath.read(httpResponse.bodyAsString(), bookSource.search.list, null)
            return list
                    .map { t ->
                        val map = hashMapOf<String, String?>()
                        //val document = Configuration.defaultConfiguration().jsonProvider().parse(t)
                        map.put("name", t.jsonParser(bookSource.metadata.name))
                        map.put("author", t.jsonParser(bookSource.metadata.author))
                        var url = t.jsonParser(bookSource.metadata.link).url()
                        map.put("link", "$serviceUrl/$code/$name/details?link=" + url)
                        map.put("cover", t.jsonParser(bookSource.metadata.cover))
                        map.put("summary", t.jsonParser(bookSource.metadata.summary))
                        map.put("category", t.jsonParser(bookSource.metadata.category))
                        map.put("status", t.jsonParser(bookSource.metadata.status))
                        map.put("update", t.jsonParser(bookSource.metadata.update))
                        map.put("lastChapter", t.jsonParser(bookSource.metadata.lastChapter))
                        return@map map
                    }
                    .filter { it.get("name") != null && it.get("name")!!.isNotBlank() }
        } else {

            //判断是否重定向到详情页
            val redirectUrl = httpResponse.followedRedirects().lastOrNull().orEmpty()
            val document = Jsoup.parse(httpResponse.body().bytes.universalChardet())
            //先按搜索进行解析
            var elements = document.select(bookSource.search.list).toList()
            //解析不到按照是详情页处理,从详情页中解析出内容放到搜索结果中(只有一条)
            if (elements.isEmpty()) {
                elements = listOf(document)
            }
            return elements
                    .map { t ->
                        val map = hashMapOf<String, String?>()
                        map.put("name", t.parser(bookSource.metadata.name))
                        map.put("author", t.select(bookSource.metadata.author.first()).text())
                        var url = t.parser(bookSource.metadata.link).url()
                        //详情页跳转url为null,则说明本身是详情页,那么使用重定向的url
                        if (url.isBlank()) {
                            url = redirectUrl
                        }
                        map.put("link", "$serviceUrl/$code/$name/details?link=" + url)

                        map.put("cover", t.parser(bookSource.metadata.cover))
                        map.put("summary", t.parser(bookSource.metadata.summary))
                        map.put("category", t.parser(bookSource.metadata.category))
                        map.put("status", t.parser(bookSource.metadata.status))
                        map.put("update", t.parser(bookSource.metadata.update))
                        map.put("lastChapter", t.parser(bookSource.metadata.lastChapter))
                        return@map map
                    }
                    .filter { it.get("name") != null && it.get("name")!!.isNotBlank() }
                    .toList()
        }

    }

    /**
     * 书的详情
     */
    suspend fun details(code: String, name: String, link: String): HashMap<String, Any> {

        val source = bookSourceService.bookSource(code, name)

        val url = if (link.startsWith("http")) link else source.url + link
        val resp = webClient.getEncodeAbs(url)
                .sendAwait()

        if (resp.getHeader("Content-type").startsWith("application/json")) {
            val t = resp.bodyAsString()
            val map = hashMapOf<String, Any>()
            map.put("cover", t.jsonParser(source.metadata.cover.reversed()))
            map.put("summary", t.jsonParser(source.metadata.summary.reversed()))
            map.put("category", t.jsonParser(source.metadata.category.reversed()))
            map.put("status", t.jsonParser(source.metadata.status.reversed()))
            map.put("update", t.jsonParser(source.metadata.update.reversed()))
            map.put("lastChapter", t.jsonParser(source.metadata.lastChapter.reversed()))

            val catalogLink = t.jsonParser(source.metadata.catalog)

            var catalogDocument = t
            if (catalogLink.isNotBlank()) {
                val catalogurl = if (link.startsWith("http")) catalogLink.url() else source.url + catalogLink.url()
                catalogDocument = webClient.getEncodeAbs(catalogurl)
                        .sendAwait().bodyAsString()
            }



            val catalog: List<Any> = JsonPath.read(catalogDocument, source.catalog.list, null)
            map.put("catalogs", catalog.map {
                val catalogs = hashMapOf<String, String>()
                catalogs.put("chapterName", it.jsonParser(source.catalog.chapter.name))
                val chapterlink = it.jsonParser(source.catalog.chapter.link).toHttpUrl().toString()
                catalogs.put("chapterlink", "$serviceUrl/$code/$name/content?href=" + URLEncoder.encode(chapterlink))
                catalogs
            })


            map.put("orderBy", source.catalog.orderBy)
            return map
        } else {

            val document = Jsoup.parse(resp.body().bytes.universalChardet())
            val catalogLink = document.parser(source.metadata.catalog)
            //如果目录需要单独获取则获取,不需要则视为在详情document里
            val catalogDocument = if (catalogLink.isNotBlank()) {
                logger.info { "catalogLink: $catalogLink" }
                webClient.getEncodeAbs(source.url + catalogLink).sendAwait()
                        .let {
                            Jsoup.parse(it.body().bytes.universalChardet())
                        }
            } else document

            val map = hashMapOf<String, Any>()
            map.put("cover", document.parser(source.metadata.cover, propertyType = PropertyType.DETAIL))
            map.put("summary", document.parser(source.metadata.summary, propertyType = PropertyType.DETAIL))
            map.put("category", document.parser(source.metadata.category, propertyType = PropertyType.DETAIL))
            map.put("status", document.parser(source.metadata.status, propertyType = PropertyType.DETAIL))
            map.put("update", document.parser(source.metadata.update, propertyType = PropertyType.DETAIL))
            map.put("lastChapter", document.parser(source.metadata.lastChapter, propertyType = PropertyType.DETAIL))

            val catalog = catalogDocument.select(source.catalog.list)
            map.put("catalogs", catalog.map {
                val catalogs = hashMapOf<String, String>()
                catalogs.put("chapterName", it.parser(source.catalog.chapter.name))
                val chapterlink = it.parser(source.catalog.chapter.link).url()
                catalogs.put("chapterlink", "$serviceUrl/$code/$name/content?href=" + chapterlink)
                catalogs
            })

            map.put("orderBy", source.catalog.orderBy)

            return map
        }
    }


    /**
     * 内容与正文
     */
    suspend fun content(code: String, name: String, href: String): HashMap<String, Any> {
        val source = bookSourceService.bookSource(code, name)
        var absoluteURI = if (href.startsWith("http")) href else source.url + href
        val resp = webClient.getEncodeAbs(absoluteURI)
                .sendAwait()

        if (resp.getHeader("Content-type").startsWith("application/json")) {
            val map = hashMapOf<String, Any>()
            val t = resp.bodyAsString()
            map.put("text", t.jsonParser(source.content.text))
//          if (source.content.next != null) {
//              val nextlinks = t.jsonParser(source.content.next.link)
//              val nextlink = nextlinks.filter { it.text() == source.content.next.text }.firstOrNull()?.text()
//              map.put("nextLink", nextlink.orEmpty())
//              map.put("nextText", source.content.next.text.orEmpty());
//          }
            return map
        } else {
            Jsoup.parse(resp.body().bytes.universalChardet())
                    .let { t ->
                        val map = hashMapOf<String, Any>()
                        val filter = t.parser(source.content.filter)
                        if (filter.isNotBlank()) {
                            t.select(filter).remove()
                        }

                        map.put("text", t.parser(source.content.text, PropertyType.CONTENT))
                        if (source.content.next != null) {
                            val nextlinks = t.select(source.content.next.link)
                            val nextlink = nextlinks.filter { it.text() == source.content.next.text }.firstOrNull()?.text()
                            map.put("nextLink", nextlink.orEmpty())
                            map.put("nextText", source.content.next.text.orEmpty());
                        }
                        return map
                    }
        }

    }

    /**
     * 排行榜
     */
    suspend fun rank(code: String, name: String, classify: String): List<HashMap<String, String?>> {
//        var rank: Rank by Delegates.notNull()
//        var bookSource: BookSource by Delegates.notNull()
        val bookSource = bookSourceService.bookSource(code, name)
        if (bookSource.rank == null) return emptyList()

        //获取指定排行分类的连接
        val rankLink = bookSource.rank.link.first { it.name == classify }

        val resp = webClient.getEncodeAbs(rankLink.link)
                .sendAwait()

        if (resp.getHeader("Content-type").startsWith("application/json")) {
            return JsonPath.read<List<Any>>(resp.bodyAsString(), bookSource.rank.list, null)
                    .map { t ->
                        val map = hashMapOf<String, String?>()
                        map.put("name", t.jsonParser(bookSource.metadata.name))
                        map.put("author", t.jsonParser(bookSource.metadata.author.first()))
                        map.put("link", "$serviceUrl/$code/$name/details?link=" + t.jsonParser(bookSource.metadata.link).url())
                        map.put("cover", t.jsonParser(bookSource.metadata.cover))
                        map.put("summary", t.jsonParser(bookSource.metadata.summary))
                        map.put("category", t.jsonParser(bookSource.metadata.category))
                        map.put("status", t.jsonParser(bookSource.metadata.status))
                        map.put("update", t.jsonParser(bookSource.metadata.update))
                        map.put("lastChapter", t.jsonParser(bookSource.metadata.lastChapter))
                        return@map map
                    }

        } else {

            val document = Jsoup.parse(resp.body().bytes.universalChardet())
            val list = document.select(bookSource.rank.list)
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
            return list
        }
    }
}
