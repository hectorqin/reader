package org.lightink.reader.utils

import io.vertx.core.buffer.Buffer
import io.vertx.ext.web.client.HttpRequest
import io.vertx.ext.web.client.WebClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.File


/**
 * @Date: 2019-07-19 23:43
 * @Description:
 */

fun String.url(): String {
    if (this.startsWith("//")) {
        return ("http:" + this).toHttpUrl().toString()
    } else if (this.startsWith("http")) {
        return this.toHttpUrl().toString()
    }
    return this
}

fun WebClient.getEncodeAbs(absoluteURI: String): HttpRequest<Buffer> {
    return this.getAbs(absoluteURI.toHttpUrl().toString())
}

fun File.deleteRecursively() {
    if (this.exists()) {
        if (this.isFile() ) {
            this.delete();
        } else {
            this.listFiles().forEach{
                it.deleteRecursively()
            }
            this.delete()
        }
    }
}










