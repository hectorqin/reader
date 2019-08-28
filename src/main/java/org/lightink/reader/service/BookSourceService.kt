package org.lightink.reader.service

import com.google.common.cache.CacheBuilder
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import io.reactivex.Observable
import io.reactivex.Single
import io.vertx.core.json.JsonArray
import io.vertx.core.json.JsonObject
import io.vertx.reactivex.ext.web.client.WebClient
import mu.KotlinLogging
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.lightink.reader.booksource.BookSource
import org.lightink.reader.booksource.BookSourceRepository
import org.lightink.reader.ext.getEncodeAbs
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.util.*
import java.util.concurrent.TimeUnit


/**
 * @Date: 2019-07-29 23:59
 * @Description:
 */

private val logger = KotlinLogging.logger {}

@Service
class BookSourceService {

    @Autowired
    private lateinit var webClient: WebClient

    @Value("\${qingmo.server.url}")
    private lateinit var serviceUrl: String

    private val cache = CacheBuilder.newBuilder().expireAfterWrite(30, TimeUnit.MINUTES).build<String, Any>()

    fun bookSourceRepositoryList(): Single<List<BookSourceRepository>> {

        logger.info { "start fetch book source repostory list..." }

        val cacheData = cache.getIfPresent("bookSourceRepositoryList")
        if (cacheData != null && cacheData is List<*> && cacheData.size > 0) {
            logger.info { "fetch book source repostory list from cache" }
            return Single.just(cacheData as List<BookSourceRepository>);
        }

        return webClient.getEncodeAbs("https://gitee.com/hunji66/BookSource/raw/master/src/hm.json")
                .rxSend()
                .map {
                    val jsonArray = it.bodyAsJsonObject().getJsonArray("list")
                    val fromJson = Gson().fromJson<List<BookSourceRepository>>(jsonArray.toString(), object : TypeToken<ArrayList<BookSourceRepository>>() {}.type)
                    cache.put("bookSourceRepositoryList", fromJson);
                    logger.info { "fetch book source repostory list from network" }
                    fromJson
                }

    }


    fun bookSourceDescription(code: String): Single<JsonObject> {

        val cacheData = cache.getIfPresent(code)
        if (cacheData != null && cacheData is JsonObject) {
            return Single.just(cacheData);
        }

        return bookSourceRepositoryList()
                .map {
                    return@map it.first { t -> t.code == code }
                }
                .flatMap { t ->
                    return@flatMap webClient.getEncodeAbs(t.url)
                            .rxSend()
                            .map {
                                val jsonObject = it.bodyAsJsonObject().put("url", t.url)
                                cache.put(code, jsonObject);
                                jsonObject
                            }
                }

    }


    fun bookSource(code: String, name: String): Single<BookSource> {

        val cacheData = cache.getIfPresent("$code-$name")
        if (cacheData != null && cacheData is BookSource) {
            return Single.just(cacheData);
        }

        return bookSourceDescription(code)
                .map {
                    var url = it.getString("url")
                    url = url.substring(0, url.lastIndexOf("/"))
                    val cell = it.getJsonArray("list").firstOrNull { t -> JsonObject(t.toString()).getString("name") == name }
                    val jsonObject = JsonObject(cell.toString())
                    val path = url + "/sources/" + jsonObject.getString("name") + ".json"
                    path
                }

                .flatMap { path ->
                    webClient.getEncodeAbs(path.toHttpUrl().toString())
                            .rxSend()
                            .map {
                                it.bodyAsJsonObject()
                            }
                }
                .map {
                    val fromJson = Gson().fromJson<BookSource>(it.toString(), BookSource::class.java)
                    cache.put("$code-$name", fromJson);
                    fromJson
                }
    }

    fun serverRepositoryJson() =
            bookSourceRepositoryList()
                    .toObservable()
                    .flatMap {
                        return@flatMap Observable.fromIterable(it)
                    }
                    .flatMap {
                        val author = it.author
                        val code = it.code
                        return@flatMap bookSourceDescription(code)
                                .toObservable()
                                .map {
                                    it.getJsonArray("list").map {
                                        val jsonObject = JsonObject(it.toString())
                                        jsonObject.put("name", author + "-" + jsonObject.getString("name"))
                                        jsonObject.put("url", "real site => " + jsonObject.getString("url"))
                                        jsonObject.put("code", code)
                                    }
                                }
                    }
                    .reduce { t1: List<JsonObject>, t2: List<JsonObject> ->
                        val mutableList = t1.toMutableList()
                        mutableList.addAll(t2)
                        mutableList
                    }
                    .map {
                        JsonObject()
                                .put("name", "qingmo")
                                .put("summary", "Provided links by qingmo")
                                .put("list", it)
                    }


    /**
     * @param name 格式形如 纯二-笔趣阁
     */
    fun serverBookSourceJson(name: String): Single<JsonObject> {
        val split = name.split("-")
        val author = split[0]
        val pureName = split[1] //json文件名
        var code: String = ""
        return bookSourceRepositoryList()
                .map { it.first { it.author == author } }
                .flatMap { t ->
                    code = t.code
                    return@flatMap bookSource(t.code, pureName)
                }
                .map {
                    val jsonObject = JsonObject()
                            .put("name", name)
                            .put("version", "100")
                            .put("category", "3")
                            .put("url", serviceUrl)
                            .put("charset", "utf8")
                            .put("metadata", JsonObject()
                                    .put("name", JsonArray().add("\$.name"))
                                    .put("author", JsonArray().add("\$.author"))
                                    .put("link", JsonArray().add("\$.link"))
                                    .put("cover", JsonArray().add("\$.cover"))
                                    .put("summary", JsonArray().add("\$.summary"))
                                    .put("category", JsonArray().add("\$.category"))
                                    .put("update", JsonArray().add("\$.update"))
                                    .put("lastChapter", JsonArray().add("\$.lastChapter"))
                                    .put("status", JsonArray().add("\$.status"))
                            )
                            .put("catalog", JsonObject()
                                    .put("list", "\$.catalogs")
                                    .put("orderBy", 0)
                                    .put("chapter", JsonObject()
                                            .put("name", "\$.chapterName")
                                            .put("link", "\$.chapterlink")
                                    )
                            )
                            .put("content", JsonObject()
                                    .put("text", "\$.text"))
                            .put("search", JsonObject()
                                    .put("link", "$serviceUrl/$code/$pureName/search?key=\${key}")
                                    .put("list", "\$[*]"))

                    if (it.rank != null) {
                        val rankJson = JsonObject()

                        val linkJsonArray = it.rank.link.map {
                            val linkJson = JsonObject()
                            linkJson.put("link", "$serviceUrl/$code/$pureName/rank/top/${it.name}")
                            linkJson.put("name", it.name)
                            linkJson
                        }

                        rankJson.put("link", linkJsonArray)
                        rankJson.put("list", "\$[*]")
                        if (it.rank.page != null) {
                            rankJson.put("page", JsonObject()
                                    .put("index", it.rank.page.index)
                                    .put("limit", it.rank.page.limit)
                                    .put("begin", "")
                                    .put("next", "/\${index}"))
                        }
                        jsonObject.put("rank", rankJson)
                    }

                    return@map jsonObject
                }

    }


}

