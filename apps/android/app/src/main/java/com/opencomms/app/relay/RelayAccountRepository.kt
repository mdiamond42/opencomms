package com.opencomms.app.relay

import android.content.Context
import com.opencomms.app.storage.PrefsStore
import java.time.Instant
import java.util.UUID

private const val KEY_RELAY_ACCOUNTS = "relay_accounts"

class RelayAccountRepository(private val context: Context) {

    fun getAll(): List<RelayAccount> =
        PrefsStore.getObject<List<RelayAccount>>(context, KEY_RELAY_ACCOUNTS) ?: emptyList()

    fun getById(id: String): RelayAccount? = getAll().find { it.id == id }

    fun upsert(account: RelayAccount) {
        val current = getAll().toMutableList()
        val idx = current.indexOfFirst { it.id == account.id }
        if (idx >= 0) current[idx] = account else current.add(account)
        PrefsStore.putObject(context, KEY_RELAY_ACCOUNTS, current)
    }

    fun findOrCreate(relayUrl: String, token: String, registeredAs: String): RelayAccount {
        val existing = getAll().find { it.relayUrl == relayUrl && it.token == token }
        if (existing != null) return existing
        val account = RelayAccount(
            id = UUID.randomUUID().toString(),
            relayUrl = relayUrl,
            token = token,
            registeredAs = registeredAs,
            addedAt = Instant.now().toString()
        )
        upsert(account)
        return account
    }

    fun remove(accountId: String) {
        val updated = getAll().filter { it.id != accountId }
        PrefsStore.putObject(context, KEY_RELAY_ACCOUNTS, updated)
    }

    fun clear() {
        PrefsStore.remove(context, KEY_RELAY_ACCOUNTS)
    }
}
