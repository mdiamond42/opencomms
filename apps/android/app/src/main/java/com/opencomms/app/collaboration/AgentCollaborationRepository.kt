package com.opencomms.app.collaboration

import android.content.Context
import com.opencomms.app.storage.PrefsStore

private const val KEY_AGENT_COLLABORATIONS = "agent_collaborations"

class AgentCollaborationRepository(private val context: Context) {

    fun getAll(): List<AgentCollaboration> =
        PrefsStore.getObject<List<AgentCollaboration>>(context, KEY_AGENT_COLLABORATIONS) ?: emptyList()

    fun upsert(collaboration: AgentCollaboration) {
        val current = getAll().toMutableList()
        val index = current.indexOfFirst { it.id == collaboration.id }
        if (index >= 0) current[index] = collaboration else current.add(collaboration)
        PrefsStore.putObject(context, KEY_AGENT_COLLABORATIONS, current)
    }

    fun upsertByAgentPair(collaboration: AgentCollaboration) {
        val existing = getByAgentPair(collaboration.agentAId, collaboration.agentBId)
        upsert(
            if (existing == null) collaboration else collaboration.copy(
                id = existing.id,
                createdAt = existing.createdAt
            )
        )
    }

    fun remove(id: String) {
        PrefsStore.putObject(context, KEY_AGENT_COLLABORATIONS, getAll().filter { it.id != id })
    }

    fun transition(id: String, nextStatus: CollaborationStatus, now: String): AgentCollaboration {
        val current = getAll().toMutableList()
        val index = current.indexOfFirst { it.id == id }
        if (index < 0) throw IllegalArgumentException("Collaboration not found: $id")
        val next = if (nextStatus == CollaborationStatus.REVOKED) {
            CollaborationLifecycle.revoke(current[index], now)
        } else {
            CollaborationLifecycle.transition(current[index], nextStatus, now)
        }
        current[index] = next
        PrefsStore.putObject(context, KEY_AGENT_COLLABORATIONS, current)
        return next
    }

    fun getByAgentPair(agentAId: String, agentBId: String): AgentCollaboration? =
        getAll().find { collaboration ->
            (collaboration.agentAId == agentAId && collaboration.agentBId == agentBId) ||
                (collaboration.agentAId == agentBId && collaboration.agentBId == agentAId)
        }
}
