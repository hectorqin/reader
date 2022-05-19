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

class UserController(coroutineContext: CoroutineContext): BaseController(coroutineContext) {
    val userMaxCount = 50

    private fun getUserLimit(context: RoutingContext): Int {
        if (context.request().host().equals("reader.htmake.com")) {
            return 200;
        }
        return Math.min(Math.max(appConfig.userLimit, 1), userMaxCount)
    }

    suspend fun login(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        val username = context.bodyAsJson.getString("username") ?: ""
        val password = context.bodyAsJson.getString("password") ?: ""
        if (username.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入用户名")
        }
        if (password.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入密码")
        }
        var userMap = mutableMapOf<String, Map<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, Map<String, Any>>
        }
        var existedUser = userMap.getOrDefault(username, null)
        if (existedUser == null) {
            if (username.length < 5) {
                return returnData.setErrorMsg("用户名不能低于5位")
            }
            if (password.length < 8) {
                return returnData.setErrorMsg("密码不能低于8位")
            }
            if (username.equals("default")) {
                return returnData.setErrorMsg("用户名不能为非法字符")
            }
            val usernameReg = Regex("[a-z0-9]+", RegexOption.IGNORE_CASE)    //忽略大小写
            if (!usernameReg.matches(username)) {
                return returnData.setErrorMsg("用户名只能由字母和数字组成")
            }
            if (appConfig.inviteCode.isNotEmpty()) {
                // 需要填入邀请码才能注册
                val code = context.bodyAsJson.getString("code") ?: ""
                if (code.isNullOrEmpty()) {
                    return returnData.setErrorMsg("请输入邀请码")
                }
                if (!appConfig.inviteCode.equals(code)) {
                    return returnData.setErrorMsg("邀请码错误")
                }
            }
            val userLimit = getUserLimit(context)
            if (userMap.keys.size >= userLimit) {
                return returnData.setErrorMsg("超过用户数上限")
            }

            // 自动注册
            var salt = getRandomString(8)
            var passwordEncrypted = genEncryptedPassword(password, salt)
            var newUser = User(username, passwordEncrypted, salt)

            val loginData = saveUserSession(context, userMap, newUser)
            return returnData.setData(loginData)
        } else {
            // 登录
            var userInfo: User? = existedUser.toDataClass()
            if (userInfo == null) {
                return returnData.setErrorMsg("用户信息错误")
            }
            var passwordEncrypted = genEncryptedPassword(password, userInfo.salt)
            if (passwordEncrypted != userInfo.password) {
                return returnData.setErrorMsg("密码错误")
            }
            val loginData = saveUserSession(context, userMap, userInfo)
            return returnData.setData(loginData)
        }
    }

    suspend fun logout(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (!appConfig.secure) {
            return returnData.setErrorMsg("不支持的操作")
        }
        var username = context.session().get("username") as String? ?: ""
        context.session().destroy()

        // 清除自动登录token
        var accessToken = context.queryParam("accessToken").firstOrNull() ?: ""
        if (accessToken.isNotEmpty()) {
            var tmp = accessToken.split(":", limit=2)
            if (tmp.size >= 2) {
                accessToken = tmp[1]

                var userMap = mutableMapOf<String, MutableMap<String, Any>>()
                var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
                if (userMapJson != null) {
                    userMap = userMapJson.map as MutableMap<String, MutableMap<String, Any>>
                }
                var currentUser = userMap.getOrDefault(username, null)
                if (currentUser == null) {
                    return returnData.setErrorMsg("系统错误")
                }
                var tokenMapVal = currentUser.getOrDefault("token_map", null)
                if (tokenMapVal != null) {
                    var tokenMap: MutableMap<String, Long>? = tokenMapVal as MutableMap<String, Long>?
                    if (tokenMap != null) {
                        tokenMap.remove(accessToken)
                        currentUser.put("token_map", tokenMap)
                    }
                }
                if (currentUser.getOrDefault("token", "").equals(accessToken)) {
                    currentUser.put("token", "")
                }

                userMap.put(username, currentUser)
                saveStorage("data", "users", value = userMap)
            }
        }
        return returnData.setErrorMsg("请重新登录").setData("NEED_LOGIN")
    }

    suspend fun getUserList(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (!appConfig.secure || appConfig.secureKey.isEmpty()) {
            return returnData.setErrorMsg("不支持的操作")
        }
        if (!checkManagerAuth(context)) {
            return returnData.setData("NEED_SECURE_KEY").setErrorMsg("请输入管理密码")
        }
        var userMap = mutableMapOf<String, MutableMap<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, MutableMap<String, Any>>
        }
        var userList = arrayListOf<Map<String, Any>>()
        userMap.forEach{
            userList.add(formatUser(it.value))
        }
        return returnData.setData(userList)
    }

    suspend fun addUser(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (!appConfig.secure || appConfig.secureKey.isEmpty()) {
            return returnData.setErrorMsg("不支持的操作")
        }
        val username = context.bodyAsJson.getString("username") ?: ""
        val password = context.bodyAsJson.getString("password") ?: ""
        if (username.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入用户名")
        }
        if (password.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入密码")
        }
        if (username.length < 5) {
            return returnData.setErrorMsg("用户名不能低于5位")
        }
        if (password.length < 8) {
            return returnData.setErrorMsg("密码不能低于8位")
        }
        if (username.equals("default")) {
            return returnData.setErrorMsg("用户名不能为非法字符")
        }
        if (!checkManagerAuth(context)) {
            return returnData.setData("NEED_SECURE_KEY").setErrorMsg("请输入管理密码")
        }
        val usernameReg = Regex("[a-z0-9]+", RegexOption.IGNORE_CASE)    //忽略大小写
        if (!usernameReg.matches(username)) {
            return returnData.setErrorMsg("用户名只能由字母和数字组成")
        }
        var userMap = mutableMapOf<String, Map<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, Map<String, Any>>
        }
        var existedUser = userMap.getOrDefault(username, null)
        if (existedUser != null) {
            return returnData.setErrorMsg("用户已存在")
        }

        val userLimit = getUserLimit(context)
        if (userMap.keys.size >= userLimit) {
            return returnData.setErrorMsg("超过用户数上限")
        }

        // 自动注册
        var salt = getRandomString(8)
        var passwordEncrypted = genEncryptedPassword(password, salt)
        var newUser = User(username, passwordEncrypted, salt)
        userMap.put(newUser.username, newUser.toMap())
        saveStorage("data", "users", value = userMap)

        var userList = arrayListOf<Map<String, Any>>()
        userMap.forEach{
            userList.add(formatUser(it.value))
        }
        return returnData.setData(userList)
    }

    suspend fun resetPassword(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (!appConfig.secure || appConfig.secureKey.isEmpty()) {
            return returnData.setErrorMsg("不支持的操作")
        }
        val username = context.bodyAsJson.getString("username") ?: ""
        val password = context.bodyAsJson.getString("password") ?: ""
        if (username.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入用户名")
        }
        if (password.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入密码")
        }
        if (password.length < 8) {
            return returnData.setErrorMsg("密码不能低于8位")
        }
        if (username.equals("default")) {
            return returnData.setErrorMsg("用户不存在")
        }
        if (!checkManagerAuth(context)) {
            return returnData.setData("NEED_SECURE_KEY").setErrorMsg("请输入管理密码")
        }
        var userMap = mutableMapOf<String, MutableMap<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, MutableMap<String, Any>>
        }

        var existedUser = userMap.getOrDefault(username, null)
        if (existedUser == null) {
            return returnData.setErrorMsg("用户不存在")
        }

        var salt = getRandomString(8)
        var passwordEncrypted = genEncryptedPassword(password, salt)
        existedUser.put("salt", salt)
        existedUser.put("password", passwordEncrypted)
        userMap.put(username, existedUser)
        saveStorage("data", "users", value = userMap as MutableMap<String, Map<String, Any>>)

        return returnData.setData("")
    }

    suspend fun deleteUsers(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (!appConfig.secure || appConfig.secureKey.isEmpty()) {
            return returnData.setErrorMsg("不支持的操作")
        }
        if (!checkManagerAuth(context)) {
            return returnData.setData("NEED_SECURE_KEY").setErrorMsg("请输入管理密码")
        }
        var userMap = mutableMapOf<String, MutableMap<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))

        if (userMapJson != null) {
            val userJsonArray = context.bodyAsJsonArray
            for (i in 0 until userJsonArray.size()) {
                var username = userJsonArray.getString(i)
                if (username != null && userMapJson.containsKey(username)) {
                    // 删除用户信息
                    userMapJson.remove(username)
                    // 移除用户目录
                    var userHome = File(getWorkDir("storage", "data", username))
                    logger.info("delete userHome: {}", userHome)
                    if (userHome.exists()) {
                        userHome.deleteRecursively()
                    }
                }
            }
            userMap = userMapJson.map as MutableMap<String, MutableMap<String, Any>>
            saveStorage("data", "users", value = userMap)
        }

        var userList = arrayListOf<Map<String, Any>>()
        userMap.forEach{
            userList.add(formatUser(it.value))
        }
        return returnData.setData(userList)
    }

    suspend fun updateUser(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (!appConfig.secure || appConfig.secureKey.isEmpty()) {
            return returnData.setErrorMsg("不支持的操作")
        }
        if (!checkManagerAuth(context)) {
            return returnData.setData("NEED_SECURE_KEY").setErrorMsg("请输入管理密码")
        }
        val username = context.bodyAsJson.getString("username") ?: ""
        val enableWebdav = context.bodyAsJson.getBoolean("enableWebdav")
        val enableLocalStore = context.bodyAsJson.getBoolean("enableLocalStore")
        if (username.isEmpty()) {
            return returnData.setErrorMsg("参数错误")
        }

        var userMap = mutableMapOf<String, MutableMap<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))

        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, MutableMap<String, Any>>
            var existedUser = userMap.getOrDefault(username, null)
            if (existedUser == null) {
                return returnData.setErrorMsg("用户不存在")
            }
            if (enableWebdav != null) {
                existedUser.put("enable_webdav", enableWebdav)
            }
            if (enableLocalStore != null) {
                existedUser.put("enable_local_store", enableLocalStore)
            }
            userMap.put(username, existedUser)
            saveStorage("data", "users", value = userMap)
        }

        var userList = arrayListOf<Map<String, Any>>()
        userMap.forEach{
            userList.add(formatUser(it.value))
        }
        return returnData.setData(userList)
    }

    suspend fun getUserInfo(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        checkAuth(context)
        var username = context.session().get("username") as String?
        var secure = env.getProperty("reader.app.secure", Boolean::class.java)
        var secureKey = env.getProperty("reader.app.secureKey")

        var userInfo: Any? = null
        if (username != null) {
            var user = getUserInfoClass(username)
            if (user != null) {
                userInfo = formatUser(user)
            }
        }

        return returnData.setData(mapOf(
            "userInfo" to userInfo,
            "secure" to secure,
            "secureKey" to secureKey?.isNotEmpty()
        ))
    }

    suspend fun saveUserConfig(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val content = context.bodyAsJson
        if (content == null) {
            return returnData.setErrorMsg("参数错误")
        }
        content.put("@updateTime", System.currentTimeMillis())

        val userNameSpace = getUserNameSpace(context)
        saveUserStorage(userNameSpace, "userConfig", content)
        return returnData.setData("")
    }

    suspend fun getUserConfig(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val userNameSpace = getUserNameSpace(context)
        val userConfig = asJsonObject(getUserStorage(userNameSpace, "userConfig"))
        if (userConfig == null) {
            return returnData.setErrorMsg("没有备份文件")
        }
        return returnData.setData(userConfig.map)
    }

    suspend fun uploadFile(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (context.fileUploads() == null || context.fileUploads().isEmpty()) {
            return returnData.setErrorMsg("请上传文件")
        }
        var userNameSpace = getUserNameSpace(context)
        var fileList = JsonArray()
        var type = context.request().getParam("type")
        if (type.isNullOrEmpty()) {
            type = "images"
        }
        // logger.info("type: {}", type)
        context.fileUploads().forEach {
            var file = File(it.uploadedFileName())
            logger.info("uploadFile: {} {} {}", it.uploadedFileName(), it.fileName(), file)
            if (file.exists()) {
                var fileName = it.fileName()
                var newFile = File(getWorkDir("storage", "assets", userNameSpace, type, fileName))
                if (!newFile.parentFile.exists()) {
                    newFile.parentFile.mkdirs()
                }
                if (newFile.exists()) {
                    newFile.delete()
                }
                logger.info("moveTo: {}", newFile)
                if (file.copyRecursively(newFile)) {
                    fileList.add("/assets/" + userNameSpace + "/" + type + "/" + fileName)
                }
                file.deleteRecursively()
            }
        }
        return returnData.setData(fileList.getList())
    }

    suspend fun deleteFile(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var url: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            url = context.bodyAsJson.getString("url") ?: ""
        } else {
            // get 请求
            url = context.queryParam("url").firstOrNull() ?: ""
        }
        if (url.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入文件链接")
        }
        var userNameSpace = getUserNameSpace(context)
        if (!url.startsWith("/assets/" + userNameSpace + "/")) {
            return returnData.setErrorMsg("文件链接错误")
        }
        var file = File(getWorkDir("storage" + url))
        logger.info("delete file: {}", file)
        file.deleteRecursively()
        return returnData.setData("")
    }
}