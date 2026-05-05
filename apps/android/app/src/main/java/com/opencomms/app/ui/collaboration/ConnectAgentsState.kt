package com.opencomms.app.ui.collaboration

import com.opencomms.app.collaboration.FriendCollaborationRestriction
import com.opencomms.app.contacts.AgentOwnership
import com.opencomms.app.contacts.Contact
import com.opencomms.app.protocol.ParticipantKind

data class ConnectAgentsState(
    val contacts: List<Contact> = emptyList(),
    val selectedOwnAgentIds: List<String> = emptyList(),
    val selectedFriendAgentId: String? = null,
    val selectedRestriction: FriendCollaborationRestriction? = null,
    val projectId: String = "",
    val projectName: String = ""
) {
    val ownAgentCandidates: List<Contact>
        get() = contacts.filter { it.kind == ParticipantKind.AGENT && it.agentOwnership == AgentOwnership.OWN }

    val friendAgentCandidates: List<Contact>
        get() = contacts.filter { it.kind == ParticipantKind.AGENT && it.agentOwnership != AgentOwnership.OWN }

    val canConnectOwnAgents: Boolean
        get() {
            val distinct = selectedOwnAgentIds.filter { id -> ownAgentCandidates.any { it.id == id } }.distinct()
            return selectedOwnAgentIds.size == 2 && distinct.size == 2
        }

    val canConnectFriendAgent: Boolean
        get() {
            val restriction = selectedRestriction ?: return false
            val selectedIsAgent = selectedFriendAgentId != null && friendAgentCandidates.any { it.id == selectedFriendAgentId }
            if (!selectedIsAgent) return false
            if (restriction == FriendCollaborationRestriction.PROJECT_ONLY) {
                return projectId.isNotBlank() && projectName.isNotBlank()
            }
            return true
        }

    fun selectedOwnAgents(): Pair<Contact, Contact>? {
        if (!canConnectOwnAgents) return null
        val first = ownAgentCandidates.first { it.id == selectedOwnAgentIds[0] }
        val second = ownAgentCandidates.first { it.id == selectedOwnAgentIds[1] }
        return first to second
    }

    fun selectedFriendAgent(): Contact? = selectedFriendAgentId?.let { id -> friendAgentCandidates.firstOrNull { it.id == id } }
}
