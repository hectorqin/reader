package io.legado.app.data.entities

// @Entity(tableName = "caches", indices = [(Index(value = ["key"], unique = true))])
data class Cache(
    // @PrimaryKey
    val key: String = "",
    var value: String? = null,
    var deadline: Long = 0L
)