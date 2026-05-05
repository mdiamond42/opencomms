package com.opencomms.app.chat

import android.content.Context
import com.opencomms.app.storage.PrefsStore

private fun transcriptKey(contactId: String) = "transcript:$contactId"

class TranscriptRepository(private val context: Context) {

    fun getMessages(contactId: String): List<ChatMessage> =
        PrefsStore.getObject<List<ChatMessage>>(context, transcriptKey(contactId)) ?: emptyList()

    fun append(message: ChatMessage) {
        val current = getMessages(message.contactId).toMutableList()
        current.add(message)
        PrefsStore.putObject(context, transcriptKey(message.contactId), current)
    }

    fun updateDeliveryState(contactId: String, messageId: String, state: DeliveryState, error: String? = null) {
        val messages = getMessages(contactId).toMutableList()
        val idx = messages.indexOfFirst { it.id == messageId }
        if (idx >= 0) {
            messages[idx] = messages[idx].copy(deliveryState = state, errorMessage = error)
            PrefsStore.putObject(context, transcriptKey(contactId), messages)
        }
    }

    fun clearContact(contactId: String) {
        PrefsStore.remove(context, transcriptKey(contactId))
    }

    fun clearAll(contactIds: List<String>) {
        contactIds.forEach { clearContact(it) }
    }
}
