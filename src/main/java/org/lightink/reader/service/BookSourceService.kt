package org.lightink.reader.service

import com.google.common.cache.CacheBuilder
import com.google.gson.reflect.TypeToken
import io.vertx.core.json.JsonArray
import io.vertx.core.json.JsonObject
import io.vertx.ext.web.client.WebClient
import io.vertx.kotlin.ext.web.client.sendAwait
import mu.KotlinLogging
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.lightink.reader.entity.BookSource
import org.lightink.reader.entity.BookSourceRepository
import org.lightink.reader.utils.getEncodeAbs
import org.lightink.reader.utils.gson
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

    /**
     * 原始书源仓库列表
     */
    suspend fun bookSourceRepositoryList(): List<BookSourceRepository> {

        logger.info { "start fetch book source repostory list..." }

        val cacheData = cache.getIfPresent("bookSourceRepositoryList")
        if (cacheData != null && cacheData is List<*> && cacheData.size > 0) {
            logger.info { "fetch book source repostory list from cache" }
            return cacheData as List<BookSourceRepository>;
        }

        return webClient.getEncodeAbs("https://gitee.com/deepink/BookSource/raw/master/src/hm.json")
                .sendAwait()
                .let {
                    val jsonArray = it.bodyAsJsonObject().getJsonArray("list")
                    val fromJson = gson.fromJson<List<BookSourceRepository>>(jsonArray.toString(), object : TypeToken<ArrayList<BookSourceRepository>>() {}.type)
                    cache.put("bookSourceRepositoryList", fromJson);
                    logger.info { "fetch book source repostory list from network" }
                    fromJson
                }

    }

    /**
     * 原始书源仓库的内容
     */
    suspend fun bookSourceDescription(code: String): JsonObject {

        val cacheData = cache.getIfPresent(code)
        if (cacheData != null && cacheData is JsonObject) {
            return cacheData;
        }

        val bookSourceRepository = bookSourceRepositoryList()
                .first { t -> t.code == code }

        return webClient.getEncodeAbs(bookSourceRepository.url)
                .sendAwait()
                .let {
                    val jsonObject = it.bodyAsJsonObject().put("url", bookSourceRepository.url)
                    cache.put(code, jsonObject);
                    jsonObject
                }

    }

    /**
     * 原始的书源内容
     */
    suspend fun bookSource(code: String, name: String): BookSource {

        val cacheData = cache.getIfPresent("$code-$name")
        if (cacheData != null && cacheData is BookSource) {
            return cacheData;
        }

        return bookSourceDescription(code)
                .let {
                    var url = it.getString("url")
                    url = url.substring(0, url.lastIndexOf("/"))
                    val cell = it.getJsonArray("list").firstOrNull { t -> JsonObject(t.toString()).getString("name") == name }
                    val jsonObject = JsonObject(cell.toString())
                    val path = url + "/sources/" + jsonObject.getString("name") + ".json"
                    path
                }
                .let { path ->
                    webClient.getEncodeAbs(path.toHttpUrl().toString())
                            .sendAwait()
                            .bodyAsJsonObject()
                }
                .let {
                    val fromJson = gson.fromJson<BookSource>(it.toString(), BookSource::class.java)
                    cache.put("$code-$name", fromJson);
                    fromJson
                }
    }

    /**
     * 输出的书源列表(厚墨专用)
     */
    suspend fun serverRepositoryJson() =
            bookSourceRepositoryList()
                    .map {
                        val author = it.author
                        val code = it.code
                        return@map bookSourceDescription(code)
                                .let {
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
                    .let {
                        JsonObject()
                                .put("name", "qingmo")
                                .put("summary", "Provided links by qingmo")
                                .put("list", it)
                    }


    /**
     * 输出的书源内容(厚墨专用)
     * @param name 格式形如 纯二-笔趣阁
     */
    suspend fun serverBookSourceJson(name: String): JsonObject {
        val split = name.split("-")
        val author = split[0]
        val pureName = split[1] //json文件名
        var code: String = ""
        return bookSourceRepositoryList()
                .first { it.author == author }
                .let { t ->
                    code = t.code
                    return@let bookSource(t.code, pureName)
                }
                .let {
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

                    return@let jsonObject
                }

    }


}

