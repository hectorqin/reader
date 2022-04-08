package io.legado.app.constant

import java.io.File

object DeepinkBookSource {

    fun generate(name: String, url: String, md5: String) {
        val text = "{\n" +
                "  \"name\": \"$name by [yuedu.best]\",\n" +
                "  \"url\": \"$url\",\n" +
                "  \"version\": 100,\n" +
                "  \"search\": {\n" +
                "    \"url\": \"http://api.yuedu.best/yuedu/searchBook@post->{\\\"key\\\":\\\"\${key}\\\", \\\"bookSourceCode\\\":\\\"$md5\\\"}\",\n" +
                "    \"charset\": \"utf-8\",\n" +
                "    \"list\": \"\$.[*]\",\n" +
                "    \"name\": \"\$.name\",\n" +
                "    \"author\": \"\$.author\",\n" +
                "    \"cover\": \"\$.coverUrl\",\n" +
                "    \"summary\": \"\$.intro\",\n" +
                "    \"detail\": \"http://api.yuedu.best/yuedu/getBookInfo@post->{\\\"searchBook\\\":\${$}, \\\"bookSourceCode\\\":\\\"$md5\\\"}\"\n" +
                "  },\n" +
                "  \"detail\": {\n" +
                "    \"name\": \"\$.name\",\n" +
                "    \"author\": \"\$.author\",\n" +
                "    \"cover\": \"\$.coverUrl\",\n" +
                "    \"summary\": \"\$.intro\",\n" +
                "    \"status\": \"\",\n" +
                "    \"update\": \"\$.latestChapterTime\",\n" +
                "    \"lastChapter\": \"\$.latestChapterTitle\",\n" +
                "    \"catalog\": \"http://api.yuedu.best/yuedu/getChapterList@post->{\\\"book\\\":\${$}, \\\"bookSourceCode\\\":\\\"$md5\\\"}\"\n" +
                "  },\n" +
                "  \"catalog\": {\n" +
                "    \"list\": \"\$.[*]\",\n" +
                "    \"name\": \"\$.title\",\n" +
                "    \"chapter\": \"http://api.yuedu.best/yuedu/getContent@post->{\\\"bookChapter\\\":\${$}, \\\"bookSourceCode\\\":\\\"$md5\\\"}\"\n" +
                "  },\n" +
                "  \"chapter\": {\n" +
                "    \"content\": \"\$.text\"\n" +
                "  }\n" +
                "}"

        val file = File("repo/${url.replace("https://","").replace("http://","")}.json")
        println("file path: "+ file.absoluteFile)
        file.createNewFile()
        file.writeText(text)
//        println("file path: "+ file.absoluteFile)
    }
}