package com.opencomms.app.collaboration

import org.junit.Assert.assertEquals
import org.junit.Test

class CollaborationControlDeliveryTest {
    @Test
    fun `disconnect persists disconnected only when both notices succeed`() {
        val connected = sample(CollaborationStatus.CONNECTED)

        assertEquals(
            CollaborationStatus.CONNECTED,
            CollaborationControlDelivery.afterDisconnectAttempt(connected, listOf(true, false), "2026-05-05T00:01:00Z").status
        )
        assertEquals(
            CollaborationStatus.DISCONNECTED,
            CollaborationControlDelivery.afterDisconnectAttempt(connected, listOf(true, true), "2026-05-05T00:01:00Z").status
        )
    }

    @Test
    fun `revoke is locally final even when notices fail`() {
        val connected = sample(CollaborationStatus.CONNECTED)

        val revoked = CollaborationControlDelivery.afterRevokeAttempt(connected, listOf(false, true), "2026-05-05T00:02:00Z")

        assertEquals(CollaborationStatus.REVOKED, revoked.status)
        assertEquals("2026-05-05T00:02:00Z", revoked.updatedAt)
    }

    private fun sample(status: CollaborationStatus) = AgentCollaboration(
        id = "collab-1",
        agentAId = "agent-a",
        agentBId = "agent-b",
        scope = CollaborationScope.CHAT_ONLY,
        status = status,
        capabilities = listOf("chat"),
        createdAt = "2026-05-05T00:00:00Z",
        updatedAt = "2026-05-05T00:00:00Z"
    )
}
