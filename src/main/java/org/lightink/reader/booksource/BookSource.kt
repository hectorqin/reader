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
        val rank: Rank?,
        val name: String,
        val search: Search,
        val url: String,
        val version: Int
)

data class Content(
        val filter: List<String> = emptyList(),
        val next: Next?,
        val text: String
)

data class Next(
        val link: String,
        val text: String
)

data class Rank(
        val link: List<Link>,
        val list: String,
        val page: Page?
)

data class Page(
        val begin: String,
        val index: Int,
        val limit: Int,
        val next: String
)


data class Link(
        val link: String,
        val name: String
)

data class Search(
        val link: String,
        val list: String
)

data class Metadata(
        val author: List<String> = emptyList(),
        val catalog: List<String> = emptyList(),
        val category: List<String> = emptyList(),
        val cover: List<String> = emptyList(),
        val lastChapter: List<String> = emptyList(),
        val link: List<String> = emptyList(),
        val name: List<String> = emptyList(),
        val status: List<String> = emptyList(),
        val summary: List<String> = emptyList(),
        val update: List<String> = emptyList()
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