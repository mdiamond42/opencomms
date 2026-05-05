package com.opencomms.app.collaboration

import com.opencomms.app.contacts.Contact
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class CollaborationIntroMessage(
    val recipient: Contact,
    val peer: Contact?,
    val body: String
)

object CollaborationMessenger {
    private val json = Json { encodeDefaults = true }

    fun buildIntroMessages(
        authorizationSource: String,
        agentA: Contact,
        agentB: Contact,
        policy: CollaborationPolicy
    ): List<CollaborationIntroMessage> = listOf(
        buildIntroMessage(authorizationSource, recipient = agentA, peer = agentB, policy = policy),
        buildIntroMessage(authorizationSource, recipient = agentB, peer = agentA, policy = policy)
    )

    fun buildFriendAuthorizationMessage(
        authorizationSource: String,
        authorizerId: String,
        friendAgent: Contact,
        policy: CollaborationPolicy
    ): CollaborationIntroMessage {
        val lines = mutableListOf(
            "OpenComms friend-agent collaboration authorization",
            "Authorized by: $authorizationSource ($authorizerId)",
            "Agent: ${friendAgent.displayName} (${friendAgent.id})",
            "Restriction: ${policy.scope.wireName}",
            "Capabilities: ${policy.capabilities.joinToString(", ")}",
            "Safety: app-side authorization only; your agent policy still applies."
        )
        appendProjectMetadata(lines, policy)
        return CollaborationIntroMessage(
            recipient = friendAgent,
            peer = null,
            body = lines.joinToString("\n")
        )
    }

    fun buildDisconnectMessages(
        collaboration: AgentCollaboration,
        agentA: Contact,
        agentB: Contact,
        authorizerDisplayName: String,
        authorizerHumanId: String,
        effectiveAt: String
    ): List<CollaborationIntroMessage> = buildControlMessages(
        CollaborationControlEvent.DISCONNECT,
        collaboration,
        agentA,
        agentB,
        authorizerDisplayName,
        authorizerHumanId,
        effectiveAt
    )

    fun buildReconnectMessages(
        collaboration: AgentCollaboration,
        agentA: Contact,
        agentB: Contact,
        authorizerDisplayName: String,
        authorizerHumanId: String,
        effectiveAt: String
    ): List<CollaborationIntroMessage> = buildControlMessages(
        CollaborationControlEvent.RECONNECT,
        collaboration,
        agentA,
        agentB,
        authorizerDisplayName,
        authorizerHumanId,
        effectiveAt
    )

    fun buildRevokeMessages(
        collaboration: AgentCollaboration,
        agentA: Contact,
        agentB: Contact,
        authorizerDisplayName: String,
        authorizerHumanId: String,
        effectiveAt: String
    ): List<CollaborationIntroMessage> = buildControlMessages(
        CollaborationControlEvent.REVOKE,
        collaboration,
        agentA,
        agentB,
        authorizerDisplayName,
        authorizerHumanId,
        effectiveAt
    )

    fun buildRoomBroadcastMessages(
        collaboration: AgentCollaboration,
        agentA: Contact,
        agentB: Contact,
        roomId: String,
        seq: Int,
        fromDisplay: String,
        text: String
    ): List<CollaborationIntroMessage> {
        val body = json.encodeToString(
            kotlinx.serialization.json.JsonObject.serializer(),
            buildJsonObject {
                put("kind", "opencomms.room.v1")
                put("room_id", roomId)
                put("collaboration_id", collaboration.id)
                put("seq", seq)
                put("from_display", fromDisplay)
                put("text", text)
            }
        )
        return listOf(
            CollaborationIntroMessage(agentA, agentB, body),
            CollaborationIntroMessage(agentB, agentA, body)
        )
    }

    private fun buildControlMessages(
        event: CollaborationControlEvent,
        collaboration: AgentCollaboration,
        agentA: Contact,
        agentB: Contact,
        authorizerDisplayName: String,
        authorizerHumanId: String,
        effectiveAt: String
    ): List<CollaborationIntroMessage> = listOf(
        CollaborationIntroMessage(
            recipient = agentA,
            peer = agentB,
            body = controlBody(event, collaboration, peerAgentId = agentB.id, authorizerDisplayName, authorizerHumanId, effectiveAt)
        ),
        CollaborationIntroMessage(
            recipient = agentB,
            peer = agentA,
            body = controlBody(event, collaboration, peerAgentId = agentA.id, authorizerDisplayName, authorizerHumanId, effectiveAt)
        )
    )

    private fun controlBody(
        event: CollaborationControlEvent,
        collaboration: AgentCollaboration,
        peerAgentId: String,
        authorizerDisplayName: String,
        authorizerHumanId: String,
        effectiveAt: String
    ): String = json.encodeToString(
        kotlinx.serialization.json.JsonObject.serializer(),
        buildJsonObject {
            put("kind", "opencomms.collab.control.v1")
            put("collaboration_id", collaboration.id)
            put("event", event.wireName)
            put("scope", collaboration.scope.wireName)
            put("peer_agent_id", peerAgentId)
            put("authorizer_display_name", authorizerDisplayName)
            put("authorizer_human_id", authorizerHumanId)
            put("effective_at", effectiveAt)
            put("human_message", event.humanMessage)
        }
    )

    private fun buildIntroMessage(
        authorizationSource: String,
        recipient: Contact,
        peer: Contact,
        policy: CollaborationPolicy
    ): CollaborationIntroMessage {
        val lines = mutableListOf(
            "OpenComms agent collaboration authorization",
            "Authorized by: $authorizationSource",
            "Peer: ${peer.displayName} (${peer.id})",
            "Scope: ${policy.scope.wireName}",
            "Capabilities: ${policy.capabilities.joinToString(", ")}",
            "Safety: app-side collaboration only; each agent must still follow its own policy."
        )
        appendProjectMetadata(lines, policy)
        return CollaborationIntroMessage(
            recipient = recipient,
            peer = peer,
            body = lines.joinToString("\n")
        )
    }

    private fun appendProjectMetadata(lines: MutableList<String>, policy: CollaborationPolicy) {
        if (!policy.projectId.isNullOrBlank() && !policy.projectName.isNullOrBlank()) {
            lines.add("Project: ${policy.projectName} (${policy.projectId})")
        }
    }
}
