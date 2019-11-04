package org.lightink.reader.entity


/**
 * @Date: 2019-07-19 18:31
 * @Description:
 */

class BookSource(var name: String, val summary: String, val version: Int, val category: Int, var url: String, val charset: String, val metadata: Metadata, val catalog: Catalog, val content: Content, val search: Search, val rank: Rank?, val auth: Auth?) {

    data class Metadata(val name: List<String>, val author: List<String>, val cover: List<String>, val summary: List<String>, val category: List<String>, val status: List<String>?, val update: List<String>?, val lastChapter: List<String>?, val link: List<String>, val catalog: List<String>, val custom: List<String>?)

    data class Search(val link: String, val list: String)

    data class Rank(val link: List<RankLink>, val list: String, val page: Page?)

    data class RankLink(val name: String, val link: String)

    data class Page(val index: Int, val limit: Int, val begin: String, val next: String)

    data class Catalog(val list: String, val orderBy: Int, val booklet: Booklet?, val chapter: Chapter, val page: Page?)

    data class Booklet(val name: String, val list: String)

    data class Chapter(val name: String, val link: String)

    data class Content(val text: String, val filter: List<String>?, val page: Page?)

    data class Auth(val login: String, val cookie: String, val header: String?, val params: String?, val verify: AuthVerify, val vip: AuthChapterVip?, val buy: AuthChapterBuy?)

    data class AuthVerify(val link: String, val key: String, val value: String)

    data class AuthChapterVip(val key: String, val value: String)

    data class AuthChapterBuy(val key: String, val value: String)
}
