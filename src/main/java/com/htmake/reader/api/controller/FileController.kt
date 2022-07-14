package com.htmake.reader.api.controller

import com.htmake.reader.api.ReturnData
import com.htmake.reader.entity.User
import com.htmake.reader.utils.getWorkDir
import com.htmake.reader.utils.error
import com.htmake.reader.utils.success
import com.htmake.reader.utils.toDir
import java.net.URLEncoder;
import java.io.File
import kotlin.coroutines.CoroutineContext
import io.legado.app.data.entities.Book
import io.legado.app.exception.TocEmptyException
import io.legado.app.model.localBook.LocalBook
import io.legado.app.utils.FileUtils
import io.vertx.core.http.HttpMethod
import io.vertx.ext.web.RoutingContext
import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

class FileController(coroutineContext: CoroutineContext): BaseController(coroutineContext) {
    suspend fun checkAccess(context: RoutingContext, isSave: Boolean = false, isDelete: Boolean = false): ReturnData? {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        context.put("__FILE_HOME__", null)
        var home: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            if (context.fileUploads() == null || context.fileUploads().isEmpty()) {
                home = context.bodyAsJson.getString("home") ?: ""
            } else {
                home = context.request().getParam("home") ?: ""
            }
        } else {
            // get 请求
            home = context.queryParam("home").firstOrNull() ?: ""
        }
        when (home) {
            "__WEBDAV__" -> {
                if (appConfig.secure) {
                    var userInfo = context.get("userInfo") as User?
                    if (userInfo == null) {
                        return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
                    }
                    if (!userInfo.enable_webdav) {
                        return returnData.setErrorMsg("未开启webdav功能")
                    }
                }
                context.put("__FILE_HOME__", getUserWebdavHome(context).toDir())
            }
            "__LOCAL_STORE__" -> {
                if (appConfig.secure) {
                    var userInfo = context.get("userInfo") as User?
                    if (userInfo == null) {
                        return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
                    }
                    if (!userInfo.enable_local_store) {
                        return returnData.setErrorMsg("未开启本地书仓功能")
                    }
                }
                if (isSave || isDelete) {
                    if (!checkManagerAuth(context)) {
                        return returnData.setData("NEED_SECURE_KEY").setErrorMsg("请输入管理密码")
                    }
                }
                context.put("__FILE_HOME__", getWorkDir("storage", "localStore").toDir())
            }
            "__HOME__" -> {
                var userNameSpace = getUserNameSpace(context)
                context.put("__FILE_HOME__", getWorkDir("storage", "data", userNameSpace).toDir())
            }
            "__STORAGE__" -> {
                if (!checkManagerAuth(context)) {
                    return returnData.setData("NEED_SECURE_KEY").setErrorMsg("请输入管理密码")
                }
                context.put("__FILE_HOME__", getWorkDir("storage").toDir())
            }
            else -> {
                return returnData.setErrorMsg("非法访问")
            }
        }
        logger.info("context.__FILE_HOME__ {}", context.get("__FILE_HOME__") as String?)
        return null
    }

    suspend fun list(context: RoutingContext): ReturnData {
        val checkResult = checkAccess(context)
        if (checkResult != null) {
            return checkResult
        }
        val returnData = ReturnData()
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
        }
        if (path.isEmpty()) {
            path = "/"
        }
        var home = context.get("__FILE_HOME__") as String?
        if (home == null) {
            return returnData.setErrorMsg("参数错误")
        }
        path = path.toDir(true)
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

    suspend fun upload(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (context.fileUploads() == null || context.fileUploads().isEmpty()) {
            return returnData.setErrorMsg("请上传文件")
        }
        val checkResult = checkAccess(context, true)
        if (checkResult != null) {
            return checkResult
        }
        var path = context.request().getParam("path")
        if (path.isNullOrEmpty()) {
            path = "/"
        }
        path = path.toDir(true)
        var fileList = arrayListOf<Map<String, Any>>()
        var home = context.get("__FILE_HOME__") as String?
        if (home == null) {
            return returnData.setErrorMsg("参数错误")
        }

        // logger.info("type: {}", type)
        context.fileUploads().forEach {
            var file = File(it.uploadedFileName())
            logger.info("uploadFile: {} {} {}", it.uploadedFileName(), it.fileName(), file)
            if (file.exists()) {
                var fileName = it.fileName()
                var newFile = File(home + path + File.separator + fileName)
                if (!newFile.parentFile.exists()) {
                    newFile.parentFile.mkdirs()
                }
                if (newFile.exists()) {
                    newFile.delete()
                }
                logger.info("moveTo: {}", newFile)
                if (file.copyRecursively(newFile)) {
                    fileList.add(mapOf(
                        "name" to newFile.name,
                        "size" to newFile.length(),
                        "path" to newFile.toString().replace(home, ""),
                        "lastModified" to newFile.lastModified(),
                        "isDirectory" to newFile.isDirectory()
                    ))
                }
                file.deleteRecursively()
            }
        }
        return returnData.setData(fileList)
    }

    suspend fun download(context: RoutingContext) {
        val checkResult = checkAccess(context)
        if (checkResult != null) {
            context.success(checkResult)
            return
        }
        val returnData = ReturnData()
        var path: String
        var stream: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
            stream = context.bodyAsJson.getInteger("stream", 0)
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
            stream = context.queryParam("stream").firstOrNull()?.toInt() ?: 0
        }
        if (path.isEmpty()) {
            context.success(returnData.setErrorMsg("参数错误"))
            return
        }
        var home = context.get("__FILE_HOME__") as String?
        if (home == null) {
            context.success(returnData.setErrorMsg("参数错误"))
            return
        }
        path = path.toDir(true)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            context.success(returnData.setErrorMsg("路径不存在"))
            return
        }
        val response = context.response().putHeader("Cache-Control", "86400")
        if (stream <= 0) {
            response.putHeader("Content-Disposition", "attachment; filename=" + URLEncoder.encode(file.name, "UTF-8"))
        }
        response.sendFile(file.toString())
    }

    suspend fun get(context: RoutingContext):  ReturnData {
        val checkResult = checkAccess(context)
        if (checkResult != null) {
            return checkResult
        }
        val returnData = ReturnData()
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
        }
        if (path.isEmpty()) {
            return returnData.setErrorMsg("参数错误")
        }
        var home = context.get("__FILE_HOME__") as String?
        if (home == null) {
            return returnData.setErrorMsg("参数错误")
        }
        path = path.toDir(true)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            return returnData.setErrorMsg("路径不存在")
        }
        return returnData.setData(file.readText())
    }

    suspend fun save(context: RoutingContext):  ReturnData {
        val checkResult = checkAccess(context, true)
        if (checkResult != null) {
            return checkResult
        }
        val returnData = ReturnData()
        var path = context.bodyAsJson.getString("path", "") ?: ""
        var content = context.bodyAsJson.getString("content", "") ?: ""
        if (path.isEmpty()) {
            return returnData.setErrorMsg("参数错误")
        }
        var home = context.get("__FILE_HOME__") as String?
        if (home == null) {
            return returnData.setErrorMsg("参数错误")
        }
        path = path.toDir(true)
        var file = FileUtils.createFileWithReplace(home + path)
        logger.info("file: {} {}", path, file)
        file.writeText(content)

        return returnData.setData("")
    }

    suspend fun mkdir(context: RoutingContext):  ReturnData {
        val checkResult = checkAccess(context, true)
        if (checkResult != null) {
            return checkResult
        }
        val returnData = ReturnData()
        var path = context.bodyAsJson.getString("path", "") ?: ""
        if (path.isEmpty()) {
            return returnData.setErrorMsg("参数错误")
        }
        var name = context.bodyAsJson.getString("name", "") ?: ""
        if (name.isEmpty() || name.startsWith(".")) {
            return returnData.setErrorMsg("参数错误")
        }
        var home = context.get("__FILE_HOME__") as String?
        if (home == null) {
            return returnData.setErrorMsg("参数错误")
        }
        path = path.toDir(true)
        var file = File(home + path + File.separator + name)
        logger.info("file: {} {}", path, file)
        if (file.exists()) {
            return returnData.setErrorMsg("路径已存在")
        }
        file.mkdirs()

        return returnData.setData("")
    }

    suspend fun delete(context: RoutingContext): ReturnData {
        val checkResult = checkAccess(context, false, true)
        if (checkResult != null) {
            return checkResult
        }
        val returnData = ReturnData()
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
        }
        if (path.isEmpty()) {
            return returnData.setErrorMsg("参数错误")
        }
        var home = context.get("__FILE_HOME__") as String?
        if (home == null) {
            return returnData.setErrorMsg("参数错误")
        }
        path = path.toDir(true)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            return returnData.setErrorMsg("路径不存在")
        }
        file.deleteRecursively()
        return returnData.setData("")
    }

    suspend fun deleteMulti(context: RoutingContext): ReturnData {
        val checkResult = checkAccess(context, false, true)
        if (checkResult != null) {
            return checkResult
        }
        val returnData = ReturnData()
        var path = context.bodyAsJson.getJsonArray("path")
        if (path == null) {
            return returnData.setErrorMsg("参数错误")
        }
        var home = context.get("__FILE_HOME__") as String?
        if (home == null) {
            return returnData.setErrorMsg("参数错误")
        }
        path.forEach {
            var filePath = it as String? ?: ""
            if (filePath.isNotEmpty()) {
                var file = File(home + filePath.toDir(true))
                file.deleteRecursively()
            }
        }
        return returnData.setData("")
    }

    suspend fun importPreview(context: RoutingContext): ReturnData {
        val checkResult = checkAccess(context)
        if (checkResult != null) {
            return checkResult
        }
        val returnData = ReturnData()
        var paths = context.bodyAsJson.getJsonArray("path")
        if (paths == null) {
            return returnData.setErrorMsg("参数错误")
        }
        var home = context.get("__FILE_HOME__") as String?
        if (home == null) {
            return returnData.setErrorMsg("参数错误")
        }
        var fileList = arrayListOf<Map<String, Any>>()
        var userNameSpace = getUserNameSpace(context)
        paths.forEach {
            var path = it as String? ?: ""
            if (path.isNotEmpty()) {
                path = home + path
                var file = File(path)
                logger.info("localFile: {} {}", path, file)
                if (file.exists() && !file.isDirectory()) {
                    val fileName = file.name
                    val ext = getFileExt(fileName)
                    if (ext != "txt" && ext != "epub" && ext != "umd" && ext != "cbz") {
                        return returnData.setErrorMsg("不支持导入" + ext + "格式的书籍文件")
                    }
                    val book = Book.initLocalBook(path, path, getWorkDir())
                    book.setUserNameSpace(userNameSpace)
                    logger.info("book {}", book)
                    try {
                        val chapters = LocalBook.getChapterList(book)
                        fileList.add(mapOf("book" to book, "chapters" to chapters))
                    } catch(e: TocEmptyException) {
                        fileList.add(mapOf("book" to book, "chapters" to arrayListOf<Int>()))
                    }
                }
            }
        }
        return returnData.setData(fileList)
    }

    suspend fun restore(context: RoutingContext): ReturnData {
        val checkResult = checkAccess(context)
        if (checkResult != null) {
            return checkResult
        }
        val returnData = ReturnData()
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
        }
        if (path.isEmpty()) {
            path = "/"
        }
        var ext = getFileExt(path)
        if (ext != "zip") {
            return returnData.setErrorMsg("路径不是zip备份文件")
        }
        var home = context.get("__FILE_HOME__") as String?
        if (home == null) {
            return returnData.setErrorMsg("参数错误")
        }
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
}