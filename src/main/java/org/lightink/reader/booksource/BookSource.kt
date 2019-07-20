package org.lightink.reader.booksource

/**
 * @Date: 2019-07-19 18:31
 * @Description:
 */

data class BookSource(
        val catalog: Catalog,
        val category: Int,
        val charset: String,
        val content: Content,
        val metadata: Metadata,
        val name: String,
        val search: Search,
        val url: String,
        val version: Int
)

data class Content(
        val filter: List<String>,
        val next: Next,
        val text: String
)

data class Next(
        val link: String,
        val text: String
)

data class Search(
        val link: String,
        val list: String
)

data class Metadata(
        val author: List<String>,
        val catalog: List<Any>,
        val category: List<String>,
        val cover: List<String>,
        val lastChapter: List<String>,
        val link: List<String>,
        val name: List<String>,
        val status: List<String>,
        val summary: List<String>,
        val update: List<String>
)

data class Catalog(
        val chapter: Chapter,
        val list: String,
        val orderBy: Int
)

data class Chapter(
        val link: String,
        val name: String
)