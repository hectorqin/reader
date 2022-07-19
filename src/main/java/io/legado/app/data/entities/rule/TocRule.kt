package io.legado.app.data.entities.rule

data class TocRule(
    var preUpdateJs: String? = null,
    var chapterList: String? = null,
    var chapterName: String? = null,
    var chapterUrl: String? = null,
    var isVolume: String? = null,
    var isVip: String? = null,
    var updateTime: String? = null,
    var nextTocUrl: String? = null
)