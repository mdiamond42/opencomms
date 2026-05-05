package com.opencomms.app.collaboration

import android.app.Application
import com.opencomms.app.storage.PrefsStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class AgentCollaborationRepositoryTest {

    private lateinit var repo: AgentCollaborationRepository

    @Before
    fun setUp() {
        val context = RuntimeEnvironment.getApplication()
        PrefsStore.clearAll(context)
        repo = AgentCollaborationRepository(context)
    }

    @Test
    fun `upsert and getAll round trip collaboration records`() {
        val record = sampleCollaboration("c1", "agent-a", "agent-b")
        repo.upsert(record)

        assertEquals(listOf(record), repo.getAll())
    }

    @Test
    fun `upsert replaces existing record by id`() {
        val original = sampleCollaboration("c1", "agent-a", "agent-b")
        val updated = original.copy(status = CollaborationStatus.ACTIVE, updatedAt = "2026-05-05T00:00:01Z")

        repo.upsert(original)
        repo.upsert(updated)

        assertEquals(1, repo.getAll().size)
        assertEquals(CollaborationStatus.ACTIVE, repo.getAll().single().status)
        assertEquals("2026-05-05T00:00:01Z", repo.getAll().single().updatedAt)
    }

    @Test
    fun `getByAgentPair is order insensitive`() {
        val record = sampleCollaboration("c1", "agent-a", "agent-b")
        repo.upsert(record)

        assertEquals(record, repo.getByAgentPair("agent-a", "agent-b"))
        assertEquals(record, repo.getByAgentPair("agent-b", "agent-a"))
        assertNull(repo.getByAgentPair("agent-a", "agent-c"))
    }

    @Test
    fun `upsertByAgentPair updates existing pair instead of duplicating`() {
        val original = sampleCollaboration("c1", "agent-a", "agent-b")
        val replacement = sampleCollaboration("c2", "agent-b", "agent-a").copy(
            status = CollaborationStatus.ACTIVE,
            updatedAt = "2026-05-05T00:00:02Z"
        )

        repo.upsert(original)
        repo.upsertByAgentPair(replacement)

        val saved = repo.getAll().single()
        assertEquals("c1", saved.id)
        assertEquals("2026-05-05T00:00:00Z", saved.createdAt)
        assertEquals(CollaborationStatus.ACTIVE, saved.status)
        assertEquals("2026-05-05T00:00:02Z", saved.updatedAt)
    }

    @Test
    fun `remove deletes only requested collaboration`() {
        repo.upsert(sampleCollaboration("c1", "agent-a", "agent-b"))
        repo.upsert(sampleCollaboration("c2", "agent-c", "agent-d"))

        repo.remove("c1")

        assertEquals(listOf("c2"), repo.getAll().map { it.id })
    }

    @Test
    fun `transition validates lifecycle and timestamps update`() {
        repo.upsert(sampleCollaboration("c1", "agent-a", "agent-b"))

        val connected = repo.transition("c1", CollaborationStatus.CONNECTED, "2026-05-05T00:01:00Z")
        assertEquals(CollaborationStatus.CONNECTED, connected.status)
        assertEquals("2026-05-05T00:01:00Z", connected.updatedAt)

        val disconnected = repo.transition("c1", CollaborationStatus.DISCONNECTED, "2026-05-05T00:02:00Z")
        assertEquals(CollaborationStatus.DISCONNECTED, disconnected.status)
        assertEquals("2026-05-05T00:02:00Z", disconnected.updatedAt)

        try {
            repo.transition("c1", CollaborationStatus.CONNECTED, "2026-05-05T00:03:00Z")
            fail("Expected IllegalStateException for illegal transition")
        } catch (_: IllegalStateException) {
            // expected
        }
    }

    @Test
    fun `transition to revoked is idempotent when already revoked`() {
        repo.upsert(sampleCollaboration("c1", "agent-a", "agent-b").copy(status = CollaborationStatus.REVOKED))

        val revoked = repo.transition("c1", CollaborationStatus.REVOKED, "2026-05-05T00:05:00Z")

        assertEquals(CollaborationStatus.REVOKED, revoked.status)
        assertEquals("2026-05-05T00:00:00Z", revoked.updatedAt)
    }

    @Test
    fun `legacy active records are treated as connected and new success records use connected`() {
        val record = sampleCollaboration("c1", "agent-a", "agent-b").copy(status = CollaborationStatus.ACTIVE)
        repo.upsert(record)

        val saved = repo.getAll().single()
        assertEquals(CollaborationStatus.ACTIVE, saved.status)
        assertEquals("Connected", saved.status.displayLabel)

        val reconnected = repo.transition("c1", CollaborationStatus.REVOKED, "2026-05-05T00:04:00Z")
        assertEquals(CollaborationStatus.REVOKED, reconnected.status)
    }

    @Test
    fun `records keep status scope timestamps and optional project fields`() {
        val projectPolicy = CollaborationPolicy.friendPreset(
            FriendCollaborationRestriction.PROJECT_ONLY,
            projectId = "project-7",
            projectName = "Moonbase"
        )
        val record = sampleCollaboration("c1", "agent-a", "agent-b").copy(
            status = CollaborationStatus.PENDING,
            scope = projectPolicy.scope,
            capabilities = projectPolicy.capabilities,
            projectId = projectPolicy.projectId,
            projectName = projectPolicy.projectName
        )
        repo.upsert(record)

        val saved = repo.getAll().single()
        assertEquals(CollaborationStatus.PENDING, saved.status)
        assertEquals(CollaborationScope.PROJECT_ONLY, saved.scope)
        assertEquals("2026-05-05T00:00:00Z", saved.createdAt)
        assertEquals("2026-05-05T00:00:00Z", saved.updatedAt)
        assertEquals("project-7", saved.projectId)
        assertEquals("Moonbase", saved.projectName)
        assertTrue(saved.capabilities.contains("project_context"))
    }

    private fun sampleCollaboration(id: String, agentA: String, agentB: String) = AgentCollaboration(
        id = id,
        agentAId = agentA,
        agentBId = agentB,
        scope = CollaborationScope.OWN_AGENTS_UNRESTRICTED,
        status = CollaborationStatus.PENDING,
        capabilities = CollaborationPolicy.ownAgentsUnrestricted().capabilities,
        createdAt = "2026-05-05T00:00:00Z",
        updatedAt = "2026-05-05T00:00:00Z"
    )
}
