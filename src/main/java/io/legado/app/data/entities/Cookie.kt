package io.legado.app.data.entities

// @Entity(tableName = "cookies", indices = [(Index(value = ["url"], unique = true))])
data class Cookie(
    // @PrimaryKey
    var url: String = "",
    var cookie: String = ""
)