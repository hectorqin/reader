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
// import io.legado.app.help.coroutine.Coroutine

private val logger = KotlinLogging.logger {}

class WebdavController(coroutineContext: CoroutineContext, router: Router, onHandlerError: (RoutingContext, Exception) -> Unit): BaseController(coroutineContext) {

    init {
        // webdav 服务
        router.route("/reader3/webdav*").handler {
            it.addHeadersEndHandler { _ ->
                var res = it.response()
                res.putHeader("DAV", "1,2")
                res.putHeader("Access-Control-Allow-Origin", "*")
                res.putHeader("Access-Control-Allow-Credentials", "true")
                res.putHeader("Access-Control-Expose-Headers", "DAV, content-length, Allow")
                res.putHeader("MS-Author-Via", "DAV")
                res.putHeader("Allow", "OPTIONS,DELETE,GET,PUT,PROPFIND,MKCOL,MOVE,COPY,LOCK,UNLOCK")
                if (appConfig.secure) {
                    res.putHeader("WWW-Authenticate", "Basic realm=\"Default realm\"")
                }
            }
            val rawMethod = it.request().rawMethod()
            if (!checkAuthorization(it)) {
                if (
                    rawMethod.equals("PROPFIND") ||
                    rawMethod.equals("MKCOL") ||
                    rawMethod.equals("PUT") ||
                    rawMethod.equals("GET") ||
                    rawMethod.equals("DELETE") ||
                    rawMethod.equals("MOVE") ||
                    rawMethod.equals("COPY") ||
                    rawMethod.equals("LOCK") ||
                    rawMethod.equals("UNLOCK")
                ) {
                    it.response().setStatusCode(401).end()
                    return@handler
                } else if(rawMethod.equals("OPTIONS")) {
                    var authorization = it.request().getHeader("Authorization")
                    if (authorization != null) {
                        it.response().setStatusCode(401).end()
                        return@handler
                    }
                }
            }
            when (rawMethod) {
                "PROPFIND" -> launch(Dispatchers.IO) {
                    try {
                        webdavList(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "MKCOL" -> launch(Dispatchers.IO) {
                    try {
                        webdavMkdir(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "PUT" -> launch(Dispatchers.IO) {
                    try {
                        webdavUpload(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "GET" -> launch(Dispatchers.IO) {
                    try {
                        webdavDownload(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "DELETE" -> launch(Dispatchers.IO) {
                    try {
                        webdavDelete(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "MOVE" -> launch(Dispatchers.IO) {
                    try {
                        webdavMove(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "COPY" -> launch(Dispatchers.IO) {
                    try {
                        webdavCopy(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "LOCK" -> launch(Dispatchers.IO) {
                    try {
                        webdavLock(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "UNLOCK" -> launch(Dispatchers.IO) {
                    try {
                        webdavUnLock(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "OPTIONS" -> it.response().setStatusCode(200).end()
                else -> it.response().setStatusCode(405).end()
            }
        }
    }

    fun checkAuthorization(context: RoutingContext): Boolean {
        if (!appConfig.secure) {
            return true
        }
        var authorization = context.request().getHeader("Authorization")
        logger.info("authorization: {}", authorization)
        if (authorization == null || authorization.isEmpty()) {
            return false
        }

        // Basic YTox
        val auth = EncoderUtils.base64Decode(authorization.replace("Basic ", "", true)).split(":", limit=2)
        if (auth.size < 2) {
            return false
        }
        val username = auth[0]
        val password = auth[1]
        var userMap = mutableMapOf<String, Map<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, Map<String, Any>>
        }
        var existedUser = userMap.getOrDefault(username, null)
        if (existedUser == null) {
            return false
        }
        var userInfo: User? = existedUser.toDataClass()
        if (userInfo == null) {
            return false
        }
        var passwordEncrypted = genEncryptedPassword(password, userInfo.salt)
        if (passwordEncrypted != userInfo.password) {
            logger.info("user: {} password error", userInfo.username)
            return false
        }

        if (!userInfo.enable_webdav) {
            logger.info("user: {} enable_webdav: false", userInfo.username)
            return false
        }

        context.put("username", userInfo.username)

        return true
    }

    suspend fun webdavList(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")
        var file = File(home + path)
        if (!file.exists()) {
            context.response().setStatusCode(404).end()
            return
        }

        var xml =
        """<?xml version="1.0" encoding="utf-8"?>
            <D:multistatus xmlns:D="DAV:">
                %s
            </D:multistatus>
        """

        var dirResponse =
        """<D:response>
                <D:href>%s</D:href>
                <D:propstat>
                    <D:status>HTTP/1.1 200 OK</D:status>
                    <D:prop>
                        <D:getlastmodified>%s</D:getlastmodified>
                        <D:creationdate>%s</D:creationdate>
                        <D:resourcetype>
                            <D:collection />
                        </D:resourcetype>
                        <D:displayname>%s</D:displayname>
                    </D:prop>
                </D:propstat>
            </D:response>
        """

        var fileResponse =
        """<D:response>
                <D:href>%s</D:href>
                <D:propstat>
                    <D:status>HTTP/1.1 200 OK</D:status>
                    <D:prop>
                        <D:getlastmodified>%s</D:getlastmodified>
                        <D:creationdate>%s</D:creationdate>
                        <D:resourcetype />
                        <D:displayname>%s</D:displayname>
                        <D:getcontentlength>%s</D:getcontentlength>
                        <D:getcontenttype>%s</D:getcontenttype>
                    </D:prop>
                </D:propstat>
            </D:response>
        """

        var fileUrl = context.request().absoluteURI()

        // 只支持一级
        var formatter = { f: File, url: String, showName: Boolean ->
            var name = if(showName) f.name else ""
            var modifiedDate = SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(f.lastModified())
            if (f.isFile()) {
                String.format(fileResponse, url, modifiedDate, modifiedDate, name, f.length(), "")
            } else {
                String.format(dirResponse, url, modifiedDate, modifiedDate, name)
            }
        }

        var response = ""
        if (file.isFile()) {
            response = String.format(xml, formatter(file, fileUrl, true))
            context.response().setStatusCode(207).end(response)
            return
        }

        if (file.isDirectory()) {
            fileUrl = if (fileUrl.endsWith("/")) fileUrl else fileUrl + "/"
            response = formatter(file, fileUrl, false)
            file.listFiles().forEach {
                val fileName = URLEncoder.encode(it.name, "UTF-8")
                response = response + formatter(it, fileUrl + fileName, true)
            }
            response = String.format(xml, response)
            context.response().setStatusCode(207).end(response)
            return
        }

        context.response().setStatusCode(404).end()
    }

    suspend fun webdavMkdir(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")
        var file = File(home + path)
        if (file.exists()) {
            // 文件夹存在时，返回成功
            context.response().setStatusCode(201).end()
            return
        }
        try {
            file.mkdirs()
            context.response().setStatusCode(201).end()
        } catch(e: Exception) {
            context.response().setStatusCode(500).end()
        }
    }

    suspend fun webdavUpload(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")
        var file = File(home + path)
        if (!file.parentFile.exists()) {
            context.response().setStatusCode(409).end()
            return
        }
        if (file.isDirectory()) {
            context.response().setStatusCode(405).end()
            return
        }
        if (file.exists()) {
            file.delete();
        }
        try {
            file.writeBytes(context.getBody().getBytes())
            // 同步用户进度
            if (file.toString().indexOf("/bookProgress/") > 0 && file.toString().indexOf(".json") > 0) {
                val userNameSpace = getUserNameSpace(context)
                BookController(coroutineContext).syncBookProgressFromWebdav(file, userNameSpace)
            }
            context.response().setStatusCode(201).end()
        } catch(e: Exception) {
            context.response().setStatusCode(500).end()
        }
    }

    suspend fun webdavDownload(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")
        var file = File(home + path)
        if (!file.exists()) {
            context.response().setStatusCode(404).end()
            return
        }
        if (file.isDirectory()) {
            context.response().setStatusCode(405).end()
            return
        }
        context.response().putHeader("Cache-Control", "86400").sendFile(file.toString())
    }

    suspend fun webdavDelete(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")
        var file = File(home + path)
        if (!file.exists()) {
            context.response().setStatusCode(404).end()
            return
        }
        file.deleteRecursively()
        context.response().setStatusCode(200).end()
    }

    suspend fun webdavMove(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")

        var file = File(home + path)
        if (!file.exists()) {
            context.response().setStatusCode(412).end()
            return
        }
        var destination = context.request().getHeader("Destination")
        if (destination == null) {
            context.response().setStatusCode(400).end()
            return
        }
        var destinationUrl = URL(destination)
        destination = destinationUrl.path?.replace("/reader3/webdav/", "/", true)
        if (destination == null) {
            context.response().setStatusCode(400).end()
            return
        }

        var overwrite = context.request().getHeader("Overwrite")
        var destinationFile = File(home + URLDecoder.decode(destination, "UTF-8"))
        if (destinationFile.exists()) {
            if (overwrite == null || overwrite.isEmpty()) {
                context.response().setStatusCode(412).end()
                return
            }
            destinationFile.deleteRecursively()
        }
        file.renameTo(destinationFile)

        context.response().setStatusCode(201).end()
    }

    suspend fun webdavCopy(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")

        var file = File(home + path)
        if (!file.exists()) {
            context.response().setStatusCode(412).end()
            return
        }
        var destination = context.request().getHeader("Destination")
        if (destination == null) {
            context.response().setStatusCode(400).end()
            return
        }
        var destinationUrl = URL(destination)
        destination = destinationUrl.path?.replace("/reader3/webdav/", "/", true)
        if (destination == null) {
            context.response().setStatusCode(400).end()
            return
        }

        var overwrite = context.request().getHeader("Overwrite")
        var destinationFile = File(home + URLDecoder.decode(destination, "UTF-8"))
        if (destinationFile.exists()) {
            if (overwrite == null || overwrite.isEmpty()) {
                context.response().setStatusCode(412).end()
                return
            }
            destinationFile.deleteRecursively()
        }
        file.copyRecursively(destinationFile)

        context.response().setStatusCode(201).end()
    }

    suspend fun webdavLock(context: RoutingContext) {
        var response =
        """<?xml version="1.0" encoding="utf-8"?>
        <D:prop xmlns:D="DAV:">
            <D:lockdiscovery>
                <D:activelock>
                    <D:locktype>
                        <write />
                    </D:locktype>
                    <D:lockscope>
                        <exclusive />
                    </D:lockscope>
                    <D:locktoken>
                        <D:href>%s</D:href>
                    </D:locktoken>
                    <D:lockroot>
                        <D:href>%s</D:href>
                    </D:lockroot>
                    <D:depth>infinity</D:depth>
                    <D:owner>
                        <a:href xmlns:a="DAV:">http://www.apple.com/webdav_fs/</a:href>
                    </D:owner>
                    <D:timeout>%s</D:timeout>
                </D:activelock>
            </D:lockdiscovery>
        </D:prop>
        """
        var lockToken = "urn:uuid:" + UUID.randomUUID().toString()

        var timeout = context.request().getHeader("Timeout")
        if (timeout == null) {
            timeout = "Second-3600"
        }

        var fileUrl = context.request().absoluteURI()

        context.response().putHeader("Lock-Token", lockToken).setStatusCode(200).end(String.format(response, lockToken, fileUrl, timeout))
    }

    suspend fun webdavUnLock(context: RoutingContext) {
        var lockToken = context.request().getHeader("Lock-Token")
        if (lockToken == null) {
            context.response().setStatusCode(400).end()
            return
        }
        context.response().putHeader("Lock-Token", lockToken).setStatusCode(204).end()
    }


    suspend fun getWebdavFileList(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
            }
            if (!userInfo.enable_webdav) {
                return returnData.setErrorMsg("未开启webdav功能")
            }
        }
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
            path = URLDecoder.decode(path, "UTF-8")
        }
        if (path.isEmpty()) {
            path = "/"
        }
        var home = getUserWebdavHome(context)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            return returnData.setErrorMsg("路径不存在")
        }
        if (!file.isDirectory()) {
            return returnData.setErrorMsg("路径不是目录")
        }
        var fileList = arrayListOf<Map<String, Any>>()
        file.listFiles().forEach{
            if (!it.name.startsWith(".")) {
                fileList.add(mapOf(
                    "name" to it.name,
                    "size" to it.length(),
                    "path" to it.toString().replace(home, ""),
                    "lastModified" to it.lastModified(),
                    "isDirectory" to it.isDirectory()
                ))
            }
        }
        return returnData.setData(fileList)
    }

    suspend fun getWebdavFile(context: RoutingContext) {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            context.success(returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用"))
            return
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                context.success(returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用"))
                return
            }
            if (!userInfo.enable_webdav) {
                context.success(returnData.setErrorMsg("未开启webdav功能"))
                return
            }
        }
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
            path = URLDecoder.decode(path, "UTF-8")
        }
        if (path.isEmpty()) {
            context.success(returnData.setErrorMsg("参数错误"))
            return
        }
        var home = getUserWebdavHome(context)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            context.success(returnData.setErrorMsg("路径不存在"))
            return
        }
        context.response().putHeader("Cache-Control", "86400").sendFile(file.toString())
    }

    suspend fun deleteWebdavFile(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
            }
            if (!userInfo.enable_webdav) {
                return returnData.setErrorMsg("未开启webdav功能")
            }
        }
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
            path = URLDecoder.decode(path, "UTF-8")
        }
        if (path.isEmpty()) {
            return returnData.setErrorMsg("参数错误")
        }
        var home = getUserWebdavHome(context)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            return returnData.setErrorMsg("路径不存在")
        }
        file.deleteRecursively()
        return returnData.setData("")
    }

    suspend fun deleteWebdavFileList(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
            }
            if (!userInfo.enable_webdav) {
                return returnData.setErrorMsg("未开启webdav功能")
            }
        }
        var path = context.bodyAsJson.getJsonArray("path")
        if (path == null) {
            return returnData.setErrorMsg("参数错误")
        }
        var home = getUserWebdavHome(context)
        path.forEach {
            var filePath = URLDecoder.decode(it as String? ?: "", "UTF-8")
            if (filePath.isNotEmpty()) {
                var file = File(home + filePath)
                file.deleteRecursively()
            }
        }
        return returnData.setData("")
    }

    suspend fun restoreFromWebdav(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
            }
            if (!userInfo.enable_webdav) {
                return returnData.setErrorMsg("未开启webdav功能")
            }
        }
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
            path = URLDecoder.decode(path, "UTF-8")
        }
        if (path.isEmpty()) {
            path = "/"
        }
        var ext = getFileExt(path)
        if (ext != "zip") {
            return returnData.setErrorMsg("路径不是zip备份文件")
        }
        var home = getUserWebdavHome(context)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            return returnData.setErrorMsg("路径不存在")
        }
        val bookController = BookController(coroutineContext)
        if (!bookController.syncFromWebdav(file.toString(), getUserNameSpace(context))) {
            return returnData.setErrorMsg("恢复失败")
        }
        return returnData.setData("")
    }

    suspend fun backupToWebdav(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
            }
            if (!userInfo.enable_webdav) {
                return returnData.setErrorMsg("未开启webdav功能")
            }
        }
        val bookController = BookController(coroutineContext)

        val userNameSpace = getUserNameSpace(context)
        var latestZipFilePath = bookController.getLastBackFileFromWebdav(userNameSpace)
        if (latestZipFilePath == null) {
            return returnData.setErrorMsg("请先使用阅读App备份到webdav")
        }
        if (!bookController.saveToWebdav(latestZipFilePath, userNameSpace)) {
            return returnData.setErrorMsg("备份失败")
        }
        return returnData.setData("")
    }

}