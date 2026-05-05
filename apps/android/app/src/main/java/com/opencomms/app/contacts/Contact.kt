package com.opencomms.app.contacts

import com.opencomms.app.protocol.ParticipantKind
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Contact(
    val id: String,
    @SerialName("display_name") val displayName: String,
    val kind: ParticipantKind,
    val capabilities: List<String> = emptyList(),
    @SerialName("agent_ownership") val agentOwnership: AgentOwnership = AgentOwnership.FRIEND,
    @SerialName("relay_account_id") val relayAccountId: String,
    @SerialName("public_key") val publicKey: String? = null,
    @SerialName("added_at") val addedAt: String,
    @SerialName("last_message_at") val lastMessageAt: String? = null,
    @SerialName("last_message_preview") val lastMessagePreview: String? = null
)

@Serializable
enum class AgentOwnership {
    @SerialName("own") OWN,
    @SerialName("friend") FRIEND
}
