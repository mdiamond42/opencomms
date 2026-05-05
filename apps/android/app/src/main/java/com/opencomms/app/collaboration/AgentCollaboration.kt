package com.opencomms.app.collaboration

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class AgentCollaboration(
    val id: String,
    @SerialName("agent_a_id") val agentAId: String,
    @SerialName("agent_b_id") val agentBId: String,
    val scope: CollaborationScope,
    val status: CollaborationStatus,
    val capabilities: List<String>,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("project_name") val projectName: String? = null
)

@Serializable
enum class CollaborationScope {
    @SerialName("own_agents_unrestricted") OWN_AGENTS_UNRESTRICTED,
    @SerialName("chat_only") CHAT_ONLY,
    @SerialName("project_only") PROJECT_ONLY,
    @SerialName("total_collaboration") TOTAL_COLLABORATION;

    val wireName: String
        get() = when (this) {
            OWN_AGENTS_UNRESTRICTED -> "own_agents_unrestricted"
            CHAT_ONLY -> "chat_only"
            PROJECT_ONLY -> "project_only"
            TOTAL_COLLABORATION -> "total_collaboration"
        }
}

@Serializable
enum class CollaborationStatus {
    @SerialName("pending") PENDING,
    @Deprecated("Legacy saved status. Treat as CONNECTED in UI/helpers; write CONNECTED for new successful connections.")
    @SerialName("active") ACTIVE,
    @SerialName("connected") CONNECTED,
    @SerialName("disconnected") DISCONNECTED,
    @SerialName("revoked") REVOKED,
    @SerialName("failed") FAILED;

    val wireName: String
        get() = when (this) {
            PENDING -> "pending"
            ACTIVE -> "active"
            CONNECTED -> "connected"
            DISCONNECTED -> "disconnected"
            REVOKED -> "revoked"
            FAILED -> "failed"
        }

    val displayLabel: String
        get() = when (this) {
            PENDING -> "Pending"
            ACTIVE, CONNECTED -> "Connected"
            DISCONNECTED -> "Disconnected"
            REVOKED -> "Revoked"
            FAILED -> "Failed"
        }

    val isConnectedLike: Boolean
        get() = this == CONNECTED || this == ACTIVE
}
