package com.opencomms.app.collaboration

import com.opencomms.app.contacts.Contact
import com.opencomms.app.protocol.ParticipantKind
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CollaborationControlAndRoomTest {

    private val meridian = contact("agent-a", "Meridian")
    private val monolith = contact("agent-b", "Peer Agent")
    private val collaboration = AgentCollaboration(
        id = "collab-1",
        agentAId = "agent-a",
        agentBId = "agent-b",
        scope = CollaborationScope.CHAT_ONLY,
        status = CollaborationStatus.CONNECTED,
        capabilities = listOf("chat"),
        createdAt = "2026-05-05T00:00:00Z",
        updatedAt = "2026-05-05T00:00:00Z"
    )

    @Test
    fun `disconnect and revoke control bodies notify both agents without private payloads`() {
        listOf(
            CollaborationControlEvent.DISCONNECT to CollaborationMessenger.buildDisconnectMessages(
                collaboration, meridian, monolith, "Operator", "human-1", "2026-05-05T00:10:00Z"
            ),
            CollaborationControlEvent.REVOKE to CollaborationMessenger.buildRevokeMessages(
                collaboration, meridian.copy(publicKey = "PUBLICKEY-SHOULD-NOT-LEAK"), monolith,
                "Operator", "human-1", "2026-05-05T00:11:00Z"
            )
        ).forEach { (event, messages) ->
            assertEquals(2, messages.size)
            assertEquals(setOf("agent-a", "agent-b"), messages.map { it.recipient.id }.toSet())
            messages.forEach { message ->
                val obj = Json.parseToJsonElement(message.body).jsonObject
                assertEquals("opencomms.collab.control.v1", obj["kind"]!!.jsonPrimitive.content)
                assertEquals(event.wireName, obj["event"]!!.jsonPrimitive.content)
                assertEquals("collab-1", obj["collaboration_id"]!!.jsonPrimitive.content)
                assertEquals("chat_only", obj["scope"]!!.jsonPrimitive.content)
                assertEquals("Operator", obj["authorizer_display_name"]!!.jsonPrimitive.content)
                assertEquals("human-1", obj["authorizer_human_id"]!!.jsonPrimitive.content)
                val peerId = obj["peer_agent_id"]!!.jsonPrimitive.content
                assertTrue(peerId == "agent-a" || peerId == "agent-b")

                val keys = obj.keys
                assertEquals(
                    setOf("kind", "collaboration_id", "event", "scope", "peer_agent_id", "authorizer_display_name", "authorizer_human_id", "effective_at", "human_message"),
                    keys
                )
                assertForbiddenPrivacyStringsAbsent(message.body)
            }
        }
    }

    @Test
    fun `room broadcast builds two messages with identical room payload and distinct recipients`() {
        val messages = CollaborationMessenger.buildRoomBroadcastMessages(
            collaboration = collaboration,
            agentA = meridian,
            agentB = monolith,
            roomId = "room-collab-1",
            seq = 7,
            fromDisplay = "Operator",
            text = "Please coordinate the release checklist."
        )

        assertEquals(2, messages.size)
        assertEquals(setOf("agent-a", "agent-b"), messages.map { it.recipient.id }.toSet())
        assertEquals(messages[0].body, messages[1].body)
        val obj = Json.parseToJsonElement(messages[0].body).jsonObject
        assertEquals("opencomms.room.v1", obj["kind"]!!.jsonPrimitive.content)
        assertEquals("room-collab-1", obj["room_id"]!!.jsonPrimitive.content)
        assertEquals("collab-1", obj["collaboration_id"]!!.jsonPrimitive.content)
        assertEquals("7", obj["seq"]!!.toString())
        assertEquals("Operator", obj["from_display"]!!.jsonPrimitive.content)
        assertEquals("Please coordinate the release checklist.", obj["text"]!!.jsonPrimitive.content)
        assertForbiddenPrivacyStringsAbsent(messages[0].body)
    }

    private fun assertForbiddenPrivacyStringsAbsent(body: String) {
        val lower = body.lowercase()
        listOf(
            "relay token", "authorization:", "bearer", "private", "secret", "transcript",
            "PUBLICKEY-SHOULD-NOT-LEAK".lowercase(), "raw envelope", "rendezvous"
        ).forEach { forbidden ->
            assertFalse("body must not contain $forbidden: $body", lower.contains(forbidden))
        }
    }

    private fun contact(id: String, name: String) = Contact(
        id = id,
        displayName = name,
        kind = ParticipantKind.AGENT,
        relayAccountId = "relay-1",
        addedAt = "2026-05-05T00:00:00Z"
    )
}
