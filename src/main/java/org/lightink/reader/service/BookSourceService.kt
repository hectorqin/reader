package org.lightink.reader.service

import com.google.common.cache.CacheBuilder
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import io.reactivex.Observable
import io.reactivex.Single
import io.vertx.core.json.JsonArray
import io.vertx.core.json.JsonObject
import io.vertx.reactivex.ext.web.client.WebClient
import org.lightink.reader.booksource.BookSource
import org.lightink.reader.booksource.BookSourceRepository
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Service
import java.util.*


/**
 * @Date: 2019-07-29 23:59
 * @Description:
 */

@Service
class BookSourceService {

    @Autowired
    private lateinit var webClient: WebClient

    private val cache = CacheBuilder.newBuilder().build<String, Any>()

    fun bookSourceRepositoryList(): Single<List<BookSourceRepository>> {

        val cacheData = cache.getIfPresent("bookSourceRepositoryList")
        if (cacheData != null && cacheData is List<*> && cacheData.size > 0) {
            return Single.just(cacheData as List<BookSourceRepository>);
        }

        return webClient.getAbs("https://gitee.com/hunji66/BookSource/raw/master/src/hm.json")
                .rxSend()
                .map {
                    val jsonArray = it.bodyAsJsonObject().getJsonArray("list")
                    val fromJson = Gson().fromJson<List<BookSourceRepository>>(jsonArray.toString(), object : TypeToken<ArrayList<BookSourceRepository>>() {}.type)
                    cache.put("bookSourceRepositoryList", fromJson);
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
                    return@flatMap webClient.getAbs(t.url)
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

        var url = ""

        return bookSourceDescription(code)
                .map {
                    url = it.getString("url").split("raw")[0]
                    return@map it.getJsonArray("list").first { t -> JsonObject(t.toString()).getString("name") == name }
                }
                .map { t ->
                    val jsonObject = JsonObject(t.toString())
                    val path = url + "raw/master/sources/" + jsonObject.getString("name") + ".json"
                    path
                }
                .flatMap { path ->
                    webClient.getAbs(path)
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


    fun serverBookSourceJson(name: String) = serverRepositoryJson()
            .map {
                it.getJsonArray("list")
            }
            .map {
                it.first { JsonObject(it.toString()).getString("name") == name }
            }
            .map {
                val code = JsonObject(it.toString()).getString("code")
                val pureName = JsonObject(it.toString()).getString("name").split("-")[1]
                JsonObject()
                        .put("name", name)
                        .put("version", "100")
                        .put("category", "3")
                        .put("url", "http://qingmo.zohar.space")
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
                                .put("link", "http://qingmo.zohar.space/$code/$pureName/search?key=\${key}")
                                .put("list", "\$[*]"))

            }


}

