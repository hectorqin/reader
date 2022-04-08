package io.legado.app.data.entities




//@Parcelize
//@Entity(tableName = "book_groups")
data class BookGroup(
//        @PrimaryKey
        var groupId: Int = 0,
        var groupName: String = "",
        var order: Int = 0,
        var show: Boolean = true
)