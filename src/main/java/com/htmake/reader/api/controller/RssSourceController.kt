package com.htmake.reader.api.controller

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.SearchBook
import io.legado.app.data.entities.BookGroup
import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.RssSource
import io.legado.app.data.entities.RssArticle
import io.legado.app.model.webBook.WebBook
import io.vertx.ext.web.Route
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import io.vertx.ext.web.handler.StaticHandler;
import mu.KotlinLogging
import com.htmake.reader.config.AppConfig
import com.htmake.reader.config.BookConfig
import io.legado.app.constant.DeepinkBookSource
import com.htmake.reader.utils.error
import com.htmake.reader.utils.success
import com.htmake.reader.utils.getStorage
import com.htmake.reader.utils.saveStorage
import com.htmake.reader.utils.asJsonArray
import com.htmake.reader.utils.asJsonObject
import com.htmake.reader.utils.toDataClass
import com.htmake.reader.utils.toMap
import com.htmake.reader.utils.fillData
import com.htmake.reader.utils.getWorkDir
import com.htmake.reader.utils.getRandomString
import com.htmake.reader.utils.genEncryptedPassword
import com.htmake.reader.entity.User
import com.htmake.reader.utils.SpringContextUtils
import com.htmake.reader.utils.deleteRecursively
import com.htmake.reader.utils.unzip
import com.htmake.reader.utils.zip
import com.htmake.reader.utils.jsonEncode
import com.htmake.reader.utils.getRelativePath
import com.htmake.reader.verticle.RestVerticle
import com.htmake.reader.SpringEvent
import org.springframework.stereotype.Component
import io.vertx.core.json.JsonObject
import io.vertx.core.json.JsonArray
import io.vertx.core.http.HttpMethod
import com.htmake.reader.api.ReturnData
import io.legado.app.utils.MD5Utils
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.URL;
import java.util.UUID;
import io.vertx.ext.web.client.WebClient
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.core.env.Environment
import java.io.File
import java.lang.Runtime
import kotlin.collections.mutableMapOf
import kotlin.system.measureTimeMillis
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat;
import io.legado.app.utils.EncoderUtils
import io.legado.app.model.rss.Rss
import org.springframework.scheduling.annotation.Scheduled
import io.legado.app.model.localBook.LocalBook
import java.nio.file.Paths
import kotlinx.coroutines.withContext
import kotlinx.coroutines.async
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.CoroutineScope

private val logger = KotlinLogging.logger {}

class RssSourceController(coroutineContext: CoroutineContext): BaseController(coroutineContext) {
    suspend fun getRssSources(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var userNameSpace = getUserNameSpace(context)
        var list: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "rssSources"))
        if (list != null) {
            return returnData.setData(list.getList())
        }
        return returnData.setData(arrayListOf<Int>())
    }

    suspend fun saveRssSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val rssSource = context.bodyAsJson.mapTo(RssSource::class.java)
        if (rssSource.sourceUrl.isEmpty()) {
            return returnData.setErrorMsg("RSS链接不能为空")
        }
        if (rssSource.sourceName.isEmpty()) {
            return returnData.setErrorMsg("RSS名称不能为空")
        }

        var userNameSpace = getUserNameSpace(context)
        var rssSourceList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "rssSources"))
        if (rssSourceList == null) {
            rssSourceList = JsonArray()
        }
        // 遍历判断是否存在
        var existIndex: Int = -1
        for (i in 0 until rssSourceList.size()) {
            var _rssSource = rssSourceList.getJsonObject(i).mapTo(RssSource::class.java)
            if (_rssSource.sourceUrl.equals(rssSource.sourceUrl)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            var list = rssSourceList.getList()
            list.set(existIndex, JsonObject.mapFrom(rssSource))
            rssSourceList = JsonArray(list)
        } else {
            // 新增rss源
            rssSourceList.add(JsonObject.mapFrom(rssSource))
        }

        // logger.info("rssSourceList: {}", rssSourceList)
        saveUserStorage(userNameSpace, "rssSources", rssSourceList)
        return returnData.setData("")
    }

    suspend fun saveRssSources(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val rssSourceJsonArray = context.bodyAsJsonArray
        if (rssSourceJsonArray == null) {
            return returnData.setErrorMsg("参数错误")
        }
        var userNameSpace = getUserNameSpace(context)
        var rssSourceList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "rssSources"))
        if (rssSourceList == null) {
            rssSourceList = JsonArray()
        }
        for (k in 0 until rssSourceJsonArray.size()) {
            var rssSource = rssSourceJsonArray.getJsonObject(k).mapTo(RssSource::class.java)
            if (rssSource.sourceUrl.isEmpty()) {
                continue
            }
            if (rssSource.sourceName.isEmpty()) {
                continue
            }
            // 遍历判断是否存在
            var existIndex: Int = -1
            for (i in 0 until rssSourceList!!.size()) {
                var _rssSource = rssSourceList.getJsonObject(i).mapTo(RssSource::class.java)
                if (_rssSource.sourceUrl.equals(rssSource.sourceUrl)) {
                    existIndex = i
                    break;
                }
            }
            if (existIndex >= 0) {
                var list = rssSourceList.getList()
                list.set(existIndex, JsonObject.mapFrom(rssSource))
                rssSourceList = JsonArray(list)
            } else {
                // 新增rss源
                rssSourceList.add(JsonObject.mapFrom(rssSource))
            }
        }

        // logger.info("rssSourceList: {}", rssSourceList)
        saveUserStorage(userNameSpace, "rssSources", rssSourceList!!)
        return returnData.setData("")
    }


    suspend fun deleteRssSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val rssSource = context.bodyAsJson.mapTo(RssSource::class.java)
        var userNameSpace = getUserNameSpace(context)
        var rssSourceList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "rssSources"))
        if (rssSourceList == null) {
            rssSourceList = JsonArray()
        }
        // 遍历判断是否存在
        var existIndex: Int = -1
        for (i in 0 until rssSourceList.size()) {
            var _rssSource = rssSourceList.getJsonObject(i).mapTo(RssSource::class.java)
            if (_rssSource.sourceUrl.equals(rssSource.sourceUrl)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            rssSourceList.remove(existIndex)
        }
        // logger.info("rssSource: {}", rssSource)
        saveUserStorage(userNameSpace, "rssSources", rssSourceList)
        return returnData.setData("")
    }

    fun getRssSourceByURL(url: String, userNameSpace: String): RssSource? {
        if (url.isEmpty()) {
            return null
        }
        var list: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "rssSources"))
        if (list == null) {
            return null
        }
        for (i in 0 until list.size()) {
            var _rssSource = list.getJsonObject(i).mapTo(RssSource::class.java)
            if (_rssSource.sourceUrl.equals(url)) {
                return _rssSource
            }
        }
        return null
    }

    suspend fun getRssArticles(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var sourceUrl: String
        var page: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            sourceUrl = context.bodyAsJson.getString("sourceUrl")
            page = context.bodyAsJson.getInteger("page", 1)
        } else {
            // get 请求
            sourceUrl = context.queryParam("sourceUrl").firstOrNull() ?: ""
            page = context.queryParam("page").firstOrNull()?.toInt() ?: 1
            sourceUrl = URLDecoder.decode(sourceUrl, "UTF-8")
        }
        if (sourceUrl.isEmpty()) {
            return returnData.setErrorMsg("RSS链接不能为空")
        }

        var userNameSpace = getUserNameSpace(context)
        var rssSource = getRssSourceByURL(sourceUrl, userNameSpace)
        if (rssSource == null) {
            return returnData.setErrorMsg("RSS源不存在")
        }

        val rssArtcles = Rss.getArticles(rssSource, page)

        return returnData.setData(rssArtcles)
    }

    suspend fun getRssContent(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var sourceUrl: String
        var link: String
        var origin: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            sourceUrl = context.bodyAsJson.getString("sourceUrl")
            link = context.bodyAsJson.getString("link")
            origin = context.bodyAsJson.getString("origin")
        } else {
            // get 请求
            sourceUrl = context.queryParam("sourceUrl").firstOrNull() ?: ""
            link = context.queryParam("link").firstOrNull() ?: ""
            origin = context.queryParam("origin").firstOrNull() ?: ""
            sourceUrl = URLDecoder.decode(sourceUrl, "UTF-8")
            link = URLDecoder.decode(link, "UTF-8")
            origin = URLDecoder.decode(origin, "UTF-8")
        }
        if (sourceUrl.isEmpty()) {
            return returnData.setErrorMsg("RSS链接不能为空")
        }
        if (link.isEmpty()) {
            return returnData.setErrorMsg("RSS文章链接不能为空")
        }
        if (origin.isEmpty()) {
            return returnData.setErrorMsg("RSS文章来源不能为空")
        }

        var userNameSpace = getUserNameSpace(context)
        var rssSource = getRssSourceByURL(sourceUrl, userNameSpace)
        if (rssSource == null) {
            return returnData.setErrorMsg("RSS源不存在")
        }
        val rssArticle = RssArticle(origin = origin, link = link)
        val content = Rss.getContent(rssArticle, rssSource)

        return returnData.setData(content)
    }


}