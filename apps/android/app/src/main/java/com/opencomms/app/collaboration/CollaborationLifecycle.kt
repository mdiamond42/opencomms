package com.opencomms.app.collaboration

enum class CollaborationAction {
    RETRY,
    OPEN_ROOM,
    DISCONNECT,
    RECONNECT,
    REVOKE
}

object CollaborationLifecycle {
    fun availableActions(collaboration: AgentCollaboration): List<CollaborationAction> = when (collaboration.status) {
        CollaborationStatus.PENDING -> listOf(CollaborationAction.RETRY, CollaborationAction.REVOKE)
        CollaborationStatus.ACTIVE, CollaborationStatus.CONNECTED -> listOf(
            CollaborationAction.OPEN_ROOM,
            CollaborationAction.DISCONNECT,
            CollaborationAction.REVOKE
        )
        CollaborationStatus.DISCONNECTED -> listOf(CollaborationAction.RECONNECT, CollaborationAction.REVOKE)
        CollaborationStatus.REVOKED -> emptyList()
        CollaborationStatus.FAILED -> listOf(CollaborationAction.RETRY, CollaborationAction.REVOKE)
    }

    fun canTransition(from: CollaborationStatus, to: CollaborationStatus): Boolean {
        val normalizedFrom = from.normalizedForTransitions()
        val normalizedTo = to.normalizedForTransitions()
        return when (normalizedFrom) {
            CollaborationStatus.PENDING -> normalizedTo == CollaborationStatus.CONNECTED ||
                normalizedTo == CollaborationStatus.FAILED ||
                normalizedTo == CollaborationStatus.REVOKED
            CollaborationStatus.CONNECTED -> normalizedTo == CollaborationStatus.DISCONNECTED ||
                normalizedTo == CollaborationStatus.REVOKED
            CollaborationStatus.DISCONNECTED -> normalizedTo == CollaborationStatus.PENDING ||
                normalizedTo == CollaborationStatus.REVOKED
            CollaborationStatus.FAILED -> normalizedTo == CollaborationStatus.PENDING ||
                normalizedTo == CollaborationStatus.REVOKED
            CollaborationStatus.REVOKED -> false
            CollaborationStatus.ACTIVE -> false // unreachable after normalization
        }
    }

    fun transition(collaboration: AgentCollaboration, nextStatus: CollaborationStatus, now: String): AgentCollaboration {
        requireAllowed(collaboration.status, nextStatus)
        return collaboration.copy(status = nextStatus.normalizedForWrites(), updatedAt = now)
    }

    fun confirmConnected(collaboration: AgentCollaboration, now: String): AgentCollaboration =
        transition(collaboration, CollaborationStatus.CONNECTED, now)

    fun confirmFailed(collaboration: AgentCollaboration, now: String): AgentCollaboration =
        transition(collaboration, CollaborationStatus.FAILED, now)

    fun disconnect(collaboration: AgentCollaboration, now: String): AgentCollaboration =
        transition(collaboration, CollaborationStatus.DISCONNECTED, now)

    fun reconnect(collaboration: AgentCollaboration, now: String): AgentCollaboration =
        transition(collaboration, CollaborationStatus.PENDING, now)

    fun revoke(collaboration: AgentCollaboration, now: String): AgentCollaboration =
        if (collaboration.status == CollaborationStatus.REVOKED) {
            collaboration
        } else {
            transition(collaboration, CollaborationStatus.REVOKED, now)
        }

    private fun requireAllowed(from: CollaborationStatus, to: CollaborationStatus) {
        if (!canTransition(from, to)) {
            throw IllegalStateException("Illegal collaboration status transition: ${from.wireName} -> ${to.wireName}")
        }
    }
}

fun CollaborationStatus.normalizedForTransitions(): CollaborationStatus = when (this) {
    CollaborationStatus.ACTIVE -> CollaborationStatus.CONNECTED
    else -> this
}

fun CollaborationStatus.normalizedForWrites(): CollaborationStatus = when (this) {
    CollaborationStatus.ACTIVE -> CollaborationStatus.CONNECTED
    else -> this
}
