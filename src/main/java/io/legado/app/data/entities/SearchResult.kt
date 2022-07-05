package io.legado.app.data.entities

data class SearchResult(
    val resultCount: Int = 0,
    val resultCountWithinChapter: Int = 0,
    val resultText: String = "",
    val chapterTitle: String = "",
    val query: String = "",
    val pageSize: Int = 0,
    val chapterIndex: Int = 0,
    val pageIndex: Int = 0,
    val queryIndexInResult: Int = 0,
    val queryIndexInChapter: Int = 0
) {
}