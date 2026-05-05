package com.opencomms.app.collaboration

import android.content.Context
import com.opencomms.app.storage.PrefsStore
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

private fun roomTranscriptKey(roomId: String) = "room_transcript:$roomId"

@Serializable
data class RoomMessage(
    val id: String,
    @SerialName("room_id") val roomId: String,
    @SerialName("collaboration_id") val collaborationId: String,
    val seq: Int,
    @SerialName("sender_id") val senderId: String,
    @SerialName("sender_display") val senderDisplay: String,
    val text: String,
    @SerialName("created_at") val createdAt: String
)

class RoomTranscriptRepository(private val context: Context) {
    fun getMessages(roomId: String): List<RoomMessage> =
        PrefsStore.getObject<List<RoomMessage>>(context, roomTranscriptKey(roomId)) ?: emptyList()

    fun append(message: RoomMessage) {
        val current = getMessages(message.roomId).toMutableList()
        current.add(message)
        PrefsStore.putObject(context, roomTranscriptKey(message.roomId), current)
    }

    fun clear(roomId: String) {
        PrefsStore.remove(context, roomTranscriptKey(roomId))
    }
}
