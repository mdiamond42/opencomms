package com.opencomms.app.collaboration

import com.opencomms.app.contacts.Contact
import com.opencomms.app.protocol.ParticipantKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CollaborationMessengerTest {

    private val meridian = contact("agent-a", "Meridian")
    private val monolith = contact("agent-b", "Peer Agent")

    @Test
    fun `builds two intro bodies one for each agent about the other`() {
        val policy = CollaborationPolicy.ownAgentsUnrestricted()

        val messages = CollaborationMessenger.buildIntroMessages(
            authorizationSource = "Operator local phone",
            agentA = meridian,
            agentB = monolith,
            policy = policy
        )

        assertEquals(2, messages.size)
        assertEquals("agent-a", messages[0].recipient.id)
        assertEquals("agent-b", messages[0].peer?.id)
        assertTrue(messages[0].body.contains("Authorized by: Operator local phone"))
        assertTrue(messages[0].body.contains("Peer: Peer Agent (agent-b)"))
        assertEquals("agent-b", messages[1].recipient.id)
        assertEquals("agent-a", messages[1].peer?.id)
        assertTrue(messages[1].body.contains("Peer: Meridian (agent-a)"))
    }

    @Test
    fun `intro body includes scope capabilities and project metadata when present`() {
        val policy = CollaborationPolicy.friendPreset(
            restriction = FriendCollaborationRestriction.PROJECT_ONLY,
            projectId = "project-7",
            projectName = "Moonbase"
        )

        val body = CollaborationMessenger.buildIntroMessages(
            authorizationSource = "Operator local phone",
            agentA = meridian,
            agentB = monolith,
            policy = policy
        ).first().body

        assertTrue(body.contains("Scope: project_only"))
        assertTrue(body.contains("Capabilities: chat, status, project_context, task_handoff"))
        assertTrue(body.contains("Project: Moonbase (project-7)"))
    }

    @Test
    fun `intro body excludes relay tokens and private data`() {
        val body = CollaborationMessenger.buildIntroMessages(
            authorizationSource = "Operator local phone",
            agentA = meridian.copy(publicKey = "public-key-only"),
            agentB = monolith.copy(publicKey = "peer-public-key-only"),
            policy = CollaborationPolicy.ownAgentsUnrestricted()
        ).first().body.lowercase()

        listOf("relay token", "private", "bearer", "secret", "public-key-only", "peer-public-key-only").forEach {
            assertFalse("body must not include $it", body.contains(it))
        }
    }

    @Test
    fun `builds friend authorization body with restriction project metadata capabilities and caveat`() {
        val policy = CollaborationPolicy.friendPreset(
            restriction = FriendCollaborationRestriction.PROJECT_ONLY,
            projectId = "project-7",
            projectName = "Moonbase"
        )

        val message = CollaborationMessenger.buildFriendAuthorizationMessage(
            authorizationSource = "Operator local phone",
            authorizerId = "human-1",
            friendAgent = monolith,
            policy = policy
        )

        assertEquals("agent-b", message.recipient.id)
        assertTrue(message.body.contains("OpenComms friend-agent collaboration authorization"))
        assertTrue(message.body.contains("Authorized by: Operator local phone (human-1)"))
        assertTrue(message.body.contains("Restriction: project_only"))
        assertTrue(message.body.contains("Capabilities: chat, status, project_context, task_handoff"))
        assertTrue(message.body.contains("Project: Moonbase (project-7)"))
        assertTrue(message.body.contains("Safety: app-side authorization only; your agent policy still applies."))
        assertFalse(message.body.lowercase().contains("private"))
        assertFalse(message.body.lowercase().contains("token"))
    }

    private fun contact(id: String, name: String) = Contact(
        id = id,
        displayName = name,
        kind = ParticipantKind.AGENT,
        relayAccountId = "relay-1",
        addedAt = "2026-05-05T00:00:00Z"
    )
}
