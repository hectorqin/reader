package io.legado.app.help

//import io.legado.app.utils.getPrefInt
//import io.legado.app.utils.getPrefString
//import org.apache.commons.text.similarity.JaccardSimilarity

object BookHelp {

    private fun formatFolderName(folderName: String): String {
        return folderName.replace("[\\\\/:*?\"<>|.]".toRegex(), "")
    }

    fun formatAuthor(author: String?): String {
        return author
            ?.replace("作\\s*者[\\s:：]*".toRegex(), "")
            ?.replace("\\s+".toRegex(), " ")
            ?.trim { it <= ' ' }
            ?: ""
    }

}