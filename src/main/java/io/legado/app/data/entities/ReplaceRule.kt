package io.legado.app.data.entities

import com.fasterxml.jackson.annotation.JsonProperty;



//@Parcelize
//@Entity(
//    tableName = "replace_rules",
//    indices = [(Index(value = ["id"]))]
//)
data class ReplaceRule(
//    @PrimaryKey(autoGenerate = true)
    var id: Long = System.currentTimeMillis(),
    var name: String = "",
    var group: String? = null,
    var pattern: String = "",
    var replacement: String = "",
    var scope: String? = null,
    @get:JsonProperty("isEnabled") var isEnabled: Boolean = true,
    @get:JsonProperty("isRegex") var isRegex: Boolean = false,
//    @ColumnInfo(name = "sortOrder")
    var order: Int = 0
)