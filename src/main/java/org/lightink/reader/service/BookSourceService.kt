package org.lightink.reader.service

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import io.reactivex.Single
import io.vertx.core.json.JsonObject
import io.vertx.reactivex.ext.web.client.WebClient
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


    fun bookSourceRepositoryList(): Single<List<BookSourceRepository>> {
        return webClient.getAbs("https://gitee.com/hunji66/BookSource/raw/master/src/hm.json")
                .rxSend()
                .map {
                    val jsonArray = it.bodyAsJsonObject().getJsonArray("list")
                    Gson().fromJson<List<BookSourceRepository>>(jsonArray.toString(), object : TypeToken<ArrayList<BookSourceRepository>>() {}.type)

                }

    }


    fun bookSourceDescription(code: String): Single<JsonObject> {
        return bookSourceRepositoryList()
                .map {
                    return@map it.first { t -> t.code == code }
                }
                .flatMap { t ->
                    return@flatMap webClient.getAbs(t.url)
                            .rxSend()
                            .map {
                                it.bodyAsJsonObject().put("url", t.url)
                            }
                }

    }


    fun bookSource(code: String, name: String): Single<JsonObject> {
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
                            .map { it.bodyAsJsonObject() }
                }
    }


}