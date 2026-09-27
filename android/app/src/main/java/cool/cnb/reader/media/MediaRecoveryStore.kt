package cool.cnb.reader.media

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** App-private, excluded from Android backup, authenticated encryption with a device key. */
class MediaRecoveryStore(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "media-recovery.bin"))
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun write(value: JSONObject) {
        try {
            val plain = MediaRecoverySnapshot.validate(value).toString().toByteArray(Charsets.UTF_8)
            require(plain.size <= 700000)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val encrypted = cipher.iv + cipher.doFinal(plain)
            val output = file.startWrite()
            try { output.write(encrypted); file.finishWrite(output) }
            catch (error: Exception) { file.failWrite(output); throw error }
        } catch (_: Exception) { clear() }
    }
    fun read(): JSONObject? = try {
        val bytes = file.openRead().use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) { val count = input.read(buffer); if (count < 0) break; require(output.size() + count <= 700028); output.write(buffer, 0, count) }
            output.toByteArray().also { require(it.size >= 29) }
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        MediaRecoverySnapshot.validate(JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)))
    } catch (_: Exception) { clear(); null }
    fun clear() { file.delete() }
    companion object { private const val ALIAS = "reader-media-recovery-v1" }
}
