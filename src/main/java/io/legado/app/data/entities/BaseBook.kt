package io.legado.app.data.entities

import io.legado.app.model.analyzeRule.RuleDataInterface
import io.legado.app.utils.splitNotBlank

interface BaseBook : RuleDataInterface {
    var kind: String?
    var wordCount: String?

    var infoHtml: String?
    var tocHtml: String?

    fun getKindList(): List<String> {
        val kindList = arrayListOf<String>()
        wordCount?.let {
            if (it.isNotBlank()) kindList.add(it)
        }
        kind?.let {
            val kinds = it.splitNotBlank(",", "\n")
            kindList.addAll(kinds)
        }
        return kindList
    }
}