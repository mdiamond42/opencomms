package com.opencomms.app.chat

import com.opencomms.app.storage.PrefsStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import android.app.Application
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.time.Instant
import java.util.UUID

/**
 * TranscriptRepository test uses an in-memory SharedPreferences via Robolectric.
 * application = Application::class avoids instantiating the custom app class which
 * is not on the unit-test classpath.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class TranscriptRepositoryTest {

    private lateinit var repo: TranscriptRepository

    @Before
    fun setUp() {
        val context = RuntimeEnvironment.getApplication()
        repo = TranscriptRepository(context)
    }

    private fun makeMessage(contactId: String, text: String, direction: Direction = Direction.OUTBOUND): ChatMessage =
        ChatMessage(
            id = UUID.randomUUID().toString(),
            contactId = contactId,
            direction = direction,
            text = text,
            createdAt = Instant.now().toString(),
            deliveryState = DeliveryState.SENT
        )

    @Test
    fun `append and read round-trip`() {
        val msg = makeMessage("agent:assistant:demo", "hello")
        repo.append(msg)
        val messages = repo.getMessages("agent:assistant:demo")
        assertEquals(1, messages.size)
        assertEquals(msg.text, messages[0].text)
        assertEquals(msg.direction, messages[0].direction)
    }

    @Test
    fun `multiple messages are ordered by insertion`() {
        val contactId = "agent:test:1"
        val texts = listOf("first", "second", "third")
        texts.forEach { repo.append(makeMessage(contactId, it)) }
        val messages = repo.getMessages(contactId)
        assertEquals(3, messages.size)
        assertEquals(texts, messages.map { it.text })
    }

    @Test
    fun `updateDeliveryState changes state correctly`() {
        val contactId = "agent:test:2"
        val msg = makeMessage(contactId, "pending msg").copy(deliveryState = DeliveryState.PENDING)
        repo.append(msg)
        repo.updateDeliveryState(contactId, msg.id, DeliveryState.FAILED, "send error")
        val updated = repo.getMessages(contactId).first { it.id == msg.id }
        assertEquals(DeliveryState.FAILED, updated.deliveryState)
        assertEquals("send error", updated.errorMessage)
    }

    @Test
    fun `clearContact removes all messages for that contact`() {
        val contactId = "agent:test:3"
        repo.append(makeMessage(contactId, "msg1"))
        repo.append(makeMessage(contactId, "msg2"))
        repo.clearContact(contactId)
        assertTrue(repo.getMessages(contactId).isEmpty())
    }

    @Test
    fun `clearAll clears multiple contact transcripts`() {
        val ids = listOf("agent:a:1", "human:b:1")
        ids.forEach { repo.append(makeMessage(it, "msg")) }
        repo.clearAll(ids)
        ids.forEach { assertTrue(repo.getMessages(it).isEmpty()) }
    }

    @Test
    fun `messages for different contacts are isolated`() {
        repo.append(makeMessage("agent:a:1", "hello to a"))
        repo.append(makeMessage("human:b:1", "hello to b"))
        assertEquals(1, repo.getMessages("agent:a:1").size)
        assertEquals(1, repo.getMessages("human:b:1").size)
        assertEquals("hello to a", repo.getMessages("agent:a:1")[0].text)
        assertEquals("hello to b", repo.getMessages("human:b:1")[0].text)
    }
}
