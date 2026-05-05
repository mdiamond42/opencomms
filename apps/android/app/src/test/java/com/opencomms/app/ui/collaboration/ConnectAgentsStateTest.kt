package com.opencomms.app.ui.collaboration

import com.opencomms.app.collaboration.FriendCollaborationRestriction
import com.opencomms.app.contacts.AgentOwnership
import com.opencomms.app.contacts.Contact
import com.opencomms.app.protocol.ParticipantKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectAgentsStateTest {

    private val ownAgentA = contact("agent-a", "Meridian", ParticipantKind.AGENT, AgentOwnership.OWN)
    private val ownAgentB = contact("agent-b", "Peer Agent", ParticipantKind.AGENT, AgentOwnership.OWN)
    private val friendAgent = contact("agent-f", "Friend Bot", ParticipantKind.AGENT, AgentOwnership.FRIEND)
    private val human = contact("human-a", "Human Pal", ParticipantKind.HUMAN)

    @Test
    fun `own agent candidates include only explicitly owned agent contacts`() {
        val unclassifiedAgent = contact("agent-u", "Unknown Bot", ParticipantKind.AGENT)
        val state = ConnectAgentsState(contacts = listOf(ownAgentA, human, friendAgent, unclassifiedAgent, ownAgentB))

        assertEquals(listOf(ownAgentA, ownAgentB), state.ownAgentCandidates)
    }

    @Test
    fun `friend agent candidates include friend and unclassified agents but not own agents`() {
        val unclassifiedAgent = contact("agent-u", "Unknown Bot", ParticipantKind.AGENT)
        val state = ConnectAgentsState(contacts = listOf(ownAgentA, human, friendAgent, unclassifiedAgent, ownAgentB))

        assertEquals(listOf(friendAgent, unclassifiedAgent), state.friendAgentCandidates)
    }

    @Test
    fun `own agent connection requires exactly two different agents`() {
        assertFalse(ConnectAgentsState(contacts = listOf(ownAgentA, ownAgentB)).canConnectOwnAgents)
        assertFalse(
            ConnectAgentsState(
                contacts = listOf(ownAgentA, ownAgentB),
                selectedOwnAgentIds = listOf("agent-a", "agent-a")
            ).canConnectOwnAgents
        )
        assertTrue(
            ConnectAgentsState(
                contacts = listOf(ownAgentA, ownAgentB),
                selectedOwnAgentIds = listOf("agent-a", "agent-b")
            ).canConnectOwnAgents
        )
    }

    @Test
    fun `friend agent mode requires an agent contact and selected restriction`() {
        assertFalse(
            ConnectAgentsState(
                contacts = listOf(friendAgent),
                selectedFriendAgentId = "agent-f"
            ).canConnectFriendAgent
        )
        assertFalse(
            ConnectAgentsState(
                contacts = listOf(human),
                selectedFriendAgentId = "human-a",
                selectedRestriction = FriendCollaborationRestriction.CHAT_ONLY
            ).canConnectFriendAgent
        )
        assertTrue(
            ConnectAgentsState(
                contacts = listOf(friendAgent),
                selectedFriendAgentId = "agent-f",
                selectedRestriction = FriendCollaborationRestriction.CHAT_ONLY
            ).canConnectFriendAgent
        )
    }

    @Test
    fun `project only friend mode requires project fields`() {
        assertFalse(
            ConnectAgentsState(
                contacts = listOf(friendAgent),
                selectedFriendAgentId = "agent-f",
                selectedRestriction = FriendCollaborationRestriction.PROJECT_ONLY,
                projectId = "",
                projectName = "Moonbase"
            ).canConnectFriendAgent
        )
        assertFalse(
            ConnectAgentsState(
                contacts = listOf(friendAgent),
                selectedFriendAgentId = "agent-f",
                selectedRestriction = FriendCollaborationRestriction.PROJECT_ONLY,
                projectId = "project-7",
                projectName = " "
            ).canConnectFriendAgent
        )
        assertTrue(
            ConnectAgentsState(
                contacts = listOf(friendAgent),
                selectedFriendAgentId = "agent-f",
                selectedRestriction = FriendCollaborationRestriction.PROJECT_ONLY,
                projectId = "project-7",
                projectName = "Moonbase"
            ).canConnectFriendAgent
        )
    }

    private fun contact(
        id: String,
        name: String,
        kind: ParticipantKind,
        agentOwnership: AgentOwnership = AgentOwnership.FRIEND,
        capabilities: List<String> = emptyList()
    ) = Contact(
        id = id,
        displayName = name,
        kind = kind,
        capabilities = capabilities,
        agentOwnership = agentOwnership,
        relayAccountId = "relay-1",
        addedAt = "2026-05-05T00:00:00Z"
    )
}
