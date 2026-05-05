package com.opencomms.app.contacts

import android.content.Context
import com.opencomms.app.protocol.ParticipantKind
import com.opencomms.app.storage.PrefsStore

private const val KEY_CONTACTS = "contacts"

class ContactRepository(private val context: Context) {

    fun getAll(): List<Contact> =
        PrefsStore.getObject<List<Contact>>(context, KEY_CONTACTS) ?: emptyList()

    fun getById(id: String): Contact? = getAll().find { it.id == id }

    fun upsert(contact: Contact) {
        val current = getAll().toMutableList()
        val idx = current.indexOfFirst { it.id == contact.id }
        if (idx >= 0) current[idx] = contact else current.add(contact)
        PrefsStore.putObject(context, KEY_CONTACTS, current)
    }

    fun updateLastMessage(contactId: String, preview: String, at: String) {
        val contact = getById(contactId) ?: return
        upsert(contact.copy(lastMessageAt = at, lastMessagePreview = preview))
    }

    fun updateAgentOwnership(contactId: String, ownership: AgentOwnership) {
        val contact = getById(contactId) ?: return
        if (contact.kind != ParticipantKind.AGENT) return
        upsert(contact.copy(agentOwnership = ownership))
    }

    fun remove(contactId: String) {
        val updated = getAll().filter { it.id != contactId }
        PrefsStore.putObject(context, KEY_CONTACTS, updated)
    }

    fun clear() {
        PrefsStore.remove(context, KEY_CONTACTS)
    }
}
