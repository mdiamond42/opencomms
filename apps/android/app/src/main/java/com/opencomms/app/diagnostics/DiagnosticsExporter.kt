package com.opencomms.app.diagnostics

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.opencomms.app.contacts.ContactRepository
import com.opencomms.app.identity.IdentityRepository
import com.opencomms.app.relay.RelayAccountRepository
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.io.File
import java.security.MessageDigest
import java.time.Instant

class DiagnosticsExporter(private val context: Context) {

    private val identityRepo = IdentityRepository(context)
    private val contactRepo = ContactRepository(context)
    private val accountRepo = RelayAccountRepository(context)

    fun export(): File {
        val identity = identityRepo.get()
        val contacts = contactRepo.getAll()
        val accounts = accountRepo.getAll()

        val report = buildJsonObject {
            put("generated_at", Instant.now().toString())
            put("app_version", getVersionName())
            putJsonObject("identity") {
                put("human_id_hash", identity?.humanId?.sha256Prefix() ?: "none")
                put("device_id_hash", identity?.deviceId?.sha256Prefix() ?: "none")
                put("display_name_length", identity?.displayName?.length ?: 0)
                put("created_at", identity?.createdAt ?: "none")
            }
            putJsonArray("contacts") {
                contacts.forEach { contact ->
                    add(buildJsonObject {
                        put("id_hash", contact.id.sha256Prefix())
                        put("kind", contact.kind.name)
                        put("capabilities_count", contact.capabilities.size)
                        put("added_at", contact.addedAt)
                        put("has_last_message", contact.lastMessageAt != null)
                    })
                }
            }
            putJsonArray("relay_accounts") {
                accounts.forEach { account ->
                    add(buildJsonObject {
                        put("relay_url_hash", account.relayUrl.sha256Prefix())
                        put("label", account.label ?: "none")
                        put("added_at", account.addedAt)
                    })
                }
            }
            put("contacts_count", contacts.size)
            put("relay_accounts_count", accounts.size)
            put("note", "Tokens, message bodies, and full contact IDs are excluded from diagnostics.")
        }

        val json = Json { prettyPrint = true }
        val content = json.encodeToString(report)

        val dir = File(context.filesDir, "diagnostics")
        dir.mkdirs()
        val file = File(dir, "opencomms_diagnostics_${Instant.now().epochSecond}.json")
        file.writeText(content)
        return file
    }

    fun shareIntent(file: File): Intent {
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file
        )
        return Intent(Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "OpenComms Diagnostics")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun getVersionName(): String = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
    }.getOrDefault("unknown")

    private fun String.sha256Prefix(): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }.take(12) + "…"
    }
}
