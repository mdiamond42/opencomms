package com.opencomms.app.identity

import android.content.Context
import com.opencomms.app.storage.PrefsStore
import java.time.Instant
import java.util.UUID

private const val KEY_IDENTITY = "identity"

class IdentityRepository(private val context: Context) {

    fun getOrCreate(): LocalIdentity {
        val existing = PrefsStore.getObject<LocalIdentity>(context, KEY_IDENTITY)
        if (existing != null) return existing
        return create().also { save(it) }
    }

    fun get(): LocalIdentity? = PrefsStore.getObject(context, KEY_IDENTITY)

    fun save(identity: LocalIdentity) {
        PrefsStore.putObject(context, KEY_IDENTITY, identity)
    }

    fun updateDisplayName(displayName: String) {
        val existing = get() ?: return
        save(existing.copy(displayName = displayName))
    }

    fun regenerate(): LocalIdentity {
        val fresh = create()
        save(fresh)
        return fresh
    }

    fun clear() {
        PrefsStore.remove(context, KEY_IDENTITY)
    }

    private fun create(): LocalIdentity = LocalIdentity(
        humanId = "human:local:${UUID.randomUUID()}",
        deviceId = "device:android:${UUID.randomUUID()}",
        displayName = "My Phone",
        createdAt = Instant.now().toString()
    )
}
