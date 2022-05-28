package com.htmake.reader.api.controller

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.SearchBook
import io.legado.app.data.entities.BookGroup
import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.ReplaceRule
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

class ReplaceRuleController(coroutineContext: CoroutineContext): BaseController(coroutineContext) {
    suspend fun getReplaceRules(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var userNameSpace = getUserNameSpace(context)
        var list: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "replaceRule"))
        if (list != null) {
            return returnData.setData(list.getList())
        }
        return returnData.setData(arrayListOf<Int>())
    }

    suspend fun saveReplaceRule(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val replaceRule = context.bodyAsJson.mapTo(ReplaceRule::class.java)
        if (replaceRule.name.isEmpty()) {
            return returnData.setErrorMsg("名称不能为空")
        }
        if (replaceRule.pattern.isEmpty()) {
            return returnData.setErrorMsg("替换规则不能为空")
        }

        var userNameSpace = getUserNameSpace(context)
        var replaceRuleList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "replaceRule"))
        if (replaceRuleList == null) {
            replaceRuleList = JsonArray()
        }
        // 遍历判断是否存在
        var existIndex: Int = -1
        for (i in 0 until replaceRuleList.size()) {
            var _replaceRule = replaceRuleList.getJsonObject(i).mapTo(ReplaceRule::class.java)
            if (_replaceRule.name.equals(replaceRule.name)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            var list = replaceRuleList.getList()
            list.set(existIndex, JsonObject.mapFrom(replaceRule))
            replaceRuleList = JsonArray(list)
        } else {
            // 新增rss源
            replaceRuleList.add(JsonObject.mapFrom(replaceRule))
        }

        // logger.info("replaceRuleList: {}", replaceRuleList)
        saveUserStorage(userNameSpace, "replaceRule", replaceRuleList)
        return returnData.setData("")
    }

    suspend fun saveReplaceRules(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val replaceRuleJsonArray = context.bodyAsJsonArray
        if (replaceRuleJsonArray == null) {
            return returnData.setErrorMsg("参数错误")
        }
        var userNameSpace = getUserNameSpace(context)
        var replaceRuleList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "replaceRule"))
        if (replaceRuleList == null) {
            replaceRuleList = JsonArray()
        }
        for (k in 0 until replaceRuleJsonArray.size()) {
            var replaceRule = replaceRuleJsonArray.getJsonObject(k).mapTo(ReplaceRule::class.java)
            if (replaceRule.name.isEmpty()) {
                continue
            }
            if (replaceRule.pattern.isEmpty()) {
                continue
            }
            // 遍历判断是否存在
            var existIndex: Int = -1
            for (i in 0 until replaceRuleList!!.size()) {
                var _replaceRule = replaceRuleList.getJsonObject(i).mapTo(ReplaceRule::class.java)
                if (_replaceRule.name.equals(replaceRule.name)) {
                    existIndex = i
                    break;
                }
            }
            if (existIndex >= 0) {
                var list = replaceRuleList.getList()
                list.set(existIndex, JsonObject.mapFrom(replaceRule))
                replaceRuleList = JsonArray(list)
            } else {
                // 新增rss源
                replaceRuleList.add(JsonObject.mapFrom(replaceRule))
            }
        }

        // logger.info("replaceRuleList: {}", replaceRuleList)
        saveUserStorage(userNameSpace, "replaceRule", replaceRuleList!!)
        return returnData.setData("")
    }


    suspend fun deleteReplaceRule(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val replaceRule = context.bodyAsJson.mapTo(ReplaceRule::class.java)
        var userNameSpace = getUserNameSpace(context)
        var replaceRuleList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "replaceRule"))
        if (replaceRuleList == null) {
            replaceRuleList = JsonArray()
        }
        // 遍历判断是否存在
        var existIndex: Int = -1
        for (i in 0 until replaceRuleList.size()) {
            var _replaceRule = replaceRuleList.getJsonObject(i).mapTo(ReplaceRule::class.java)
            if (_replaceRule.name.equals(replaceRule.name)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            replaceRuleList.remove(existIndex)
        }
        // logger.info("replaceRule: {}", replaceRule)
        saveUserStorage(userNameSpace, "replaceRule", replaceRuleList)
        return returnData.setData("")
    }

    suspend fun deleteReplaceRules(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val replaceRuleJsonArray = context.bodyAsJsonArray

        var userNameSpace = getUserNameSpace(context)
        var replaceRuleList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "replaceRule"))
        if (replaceRuleList == null) {
            replaceRuleList = JsonArray()
        }
        for (k in 0 until replaceRuleJsonArray.size()) {
            var replaceRule = replaceRuleJsonArray.getJsonObject(k).mapTo(ReplaceRule::class.java)
            // 遍历判断书本是否存在
            var existIndex: Int = -1
            for (i in 0 until replaceRuleList.size()) {
                var _replaceRule = replaceRuleList.getJsonObject(i).mapTo(ReplaceRule::class.java)
                if (_replaceRule.name.equals(replaceRule.name)) {
                    existIndex = i
                    break;
                }
            }
            if (existIndex >= 0) {
                replaceRuleList.remove(existIndex)
            }
        }
        // logger.info("replaceRule: {}", replaceRule)
        saveUserStorage(userNameSpace, "replaceRule", replaceRuleList)
        return returnData.setData("")
    }
}