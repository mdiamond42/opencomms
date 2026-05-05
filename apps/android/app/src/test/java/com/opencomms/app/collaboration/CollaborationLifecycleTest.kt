package com.opencomms.app.collaboration

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CollaborationLifecycleTest {

    @Test
    fun `status labels and actions map active legacy to connected`() {
        assertEquals("Connected", CollaborationStatus.ACTIVE.displayLabel)
        assertEquals("Connected", CollaborationStatus.CONNECTED.displayLabel)
        assertTrue(CollaborationStatus.ACTIVE.isConnectedLike)
        assertEquals(
            setOf(CollaborationAction.OPEN_ROOM, CollaborationAction.DISCONNECT, CollaborationAction.REVOKE),
            CollaborationLifecycle.availableActions(sample(CollaborationStatus.ACTIVE)).toSet()
        )
    }

    @Test
    fun `valid lifecycle helpers timestamp transitions`() {
        val pending = sample(CollaborationStatus.PENDING)

        val connected = CollaborationLifecycle.confirmConnected(pending, now = "2026-05-05T00:01:00Z")
        assertEquals(CollaborationStatus.CONNECTED, connected.status)
        assertEquals("2026-05-05T00:01:00Z", connected.updatedAt)

        val disconnected = CollaborationLifecycle.disconnect(connected, now = "2026-05-05T00:02:00Z")
        assertEquals(CollaborationStatus.DISCONNECTED, disconnected.status)
        assertEquals("2026-05-05T00:02:00Z", disconnected.updatedAt)

        val reconnecting = CollaborationLifecycle.reconnect(disconnected, now = "2026-05-05T00:03:00Z")
        assertEquals(CollaborationStatus.PENDING, reconnecting.status)
        assertEquals("2026-05-05T00:03:00Z", reconnecting.updatedAt)

        val revoked = CollaborationLifecycle.revoke(reconnecting, now = "2026-05-05T00:04:00Z")
        assertEquals(CollaborationStatus.REVOKED, revoked.status)
        assertEquals("2026-05-05T00:04:00Z", revoked.updatedAt)
    }

    @Test
    fun `revoked is terminal and read only`() {
        val revoked = sample(CollaborationStatus.REVOKED)
        assertEquals(emptyList<CollaborationAction>(), CollaborationLifecycle.availableActions(revoked))
        assertFalse(CollaborationLifecycle.canTransition(CollaborationStatus.REVOKED, CollaborationStatus.PENDING))
        assertFailsTransition { CollaborationLifecycle.reconnect(revoked, now = "2026-05-05T00:05:00Z") }
        assertFailsTransition { CollaborationLifecycle.confirmConnected(revoked, now = "2026-05-05T00:05:00Z") }
    }

    @Test
    fun `revoke is idempotent when collaboration is already revoked`() {
        val revoked = sample(CollaborationStatus.REVOKED)

        val secondRevoke = CollaborationLifecycle.revoke(revoked, now = "2026-05-05T00:05:00Z")

        assertEquals(CollaborationStatus.REVOKED, secondRevoke.status)
        assertEquals("2026-05-05T00:00:00Z", secondRevoke.updatedAt)
    }

    @Test
    fun `action availability covers all statuses`() {
        assertEquals(setOf(CollaborationAction.RETRY, CollaborationAction.REVOKE), CollaborationLifecycle.availableActions(sample(CollaborationStatus.PENDING)).toSet())
        assertEquals(setOf(CollaborationAction.OPEN_ROOM, CollaborationAction.DISCONNECT, CollaborationAction.REVOKE), CollaborationLifecycle.availableActions(sample(CollaborationStatus.CONNECTED)).toSet())
        assertEquals(setOf(CollaborationAction.RECONNECT, CollaborationAction.REVOKE), CollaborationLifecycle.availableActions(sample(CollaborationStatus.DISCONNECTED)).toSet())
        assertEquals(setOf(CollaborationAction.RETRY, CollaborationAction.REVOKE), CollaborationLifecycle.availableActions(sample(CollaborationStatus.FAILED)).toSet())
        assertEquals(emptySet<CollaborationAction>(), CollaborationLifecycle.availableActions(sample(CollaborationStatus.REVOKED)).toSet())
    }

    private fun assertFailsTransition(block: () -> Unit) {
        try {
            block()
            throw AssertionError("Expected IllegalStateException")
        } catch (_: IllegalStateException) {
            // expected
        }
    }

    private fun sample(status: CollaborationStatus) = AgentCollaboration(
        id = "collab-1",
        agentAId = "agent-a",
        agentBId = "agent-b",
        scope = CollaborationScope.OWN_AGENTS_UNRESTRICTED,
        status = status,
        capabilities = CollaborationPolicy.ownAgentsUnrestricted().capabilities,
        createdAt = "2026-05-05T00:00:00Z",
        updatedAt = "2026-05-05T00:00:00Z"
    )
}
