package com.opencomms.app.collaboration

import android.app.Application
import com.opencomms.app.chat.ChatMessage
import com.opencomms.app.chat.DeliveryState
import com.opencomms.app.chat.Direction
import com.opencomms.app.chat.TranscriptRepository
import com.opencomms.app.storage.PrefsStore
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class RoomTranscriptRepositoryTest {

    private lateinit var roomRepo: RoomTranscriptRepository
    private lateinit var chatRepo: TranscriptRepository

    @Before
    fun setUp() {
        val context = RuntimeEnvironment.getApplication()
        PrefsStore.clearAll(context)
        roomRepo = RoomTranscriptRepository(context)
        chatRepo = TranscriptRepository(context)
    }

    @Test
    fun `room transcript is stored separately from one to one transcripts`() {
        roomRepo.append(
            RoomMessage(
                id = "room-msg-1",
                roomId = "room-1",
                collaborationId = "collab-1",
                seq = 1,
                senderId = "human-1",
                senderDisplay = "You",
                text = "Room only",
                createdAt = "2026-05-05T00:00:01Z"
            )
        )
        chatRepo.append(
            ChatMessage(
                id = "chat-msg-1",
                contactId = "agent-a",
                direction = Direction.OUTBOUND,
                text = "One to one only",
                createdAt = "2026-05-05T00:00:02Z",
                deliveryState = DeliveryState.SENT
            )
        )

        assertEquals(listOf("Room only"), roomRepo.getMessages("room-1").map { it.text })
        assertEquals(emptyList<RoomMessage>(), roomRepo.getMessages("agent-a"))
        assertEquals(listOf("One to one only"), chatRepo.getMessages("agent-a").map { it.text })
    }
}
