package com.htmake.reader.init

import com.htmake.reader.utils.getWorkDir

// 处理 appCtx
object appCtx {
    val cacheDir: String by lazy {
        getWorkDir("storage", "cache")
    }
}
