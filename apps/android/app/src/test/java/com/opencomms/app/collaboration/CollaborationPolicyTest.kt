package com.opencomms.app.collaboration

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CollaborationPolicyTest {

    private val forbiddenFragments = listOf(
        "secret", "private", "key", "token", "bearer", "auth",
        "transcript", "spend", "money", "deploy", "raw_file", "raw-file", "file"
    )

    @Test
    fun `own agent unrestricted preset maps to coordination capabilities`() {
        val policy = CollaborationPolicy.ownAgentsUnrestricted()

        assertEquals(CollaborationScope.OWN_AGENTS_UNRESTRICTED, policy.scope)
        assertEquals(
            listOf("chat", "status", "task_handoff", "coordinate", "tools_if_agent_policy_allows"),
            policy.capabilities
        )
        assertHasNoForbiddenCapabilities(policy)
    }

    @Test
    fun `friend presets map to expected scopes and capabilities`() {
        val chatOnly = CollaborationPolicy.friendPreset(FriendCollaborationRestriction.CHAT_ONLY)
        assertEquals(CollaborationScope.CHAT_ONLY, chatOnly.scope)
        assertEquals(listOf("chat", "status"), chatOnly.capabilities)

        val projectOnly = CollaborationPolicy.friendPreset(
            restriction = FriendCollaborationRestriction.PROJECT_ONLY,
            projectId = "project-7",
            projectName = "Moonbase"
        )
        assertEquals(CollaborationScope.PROJECT_ONLY, projectOnly.scope)
        assertEquals(listOf("chat", "status", "project_context", "task_handoff"), projectOnly.capabilities)
        assertEquals("project-7", projectOnly.projectId)
        assertEquals("Moonbase", projectOnly.projectName)

        val total = CollaborationPolicy.friendPreset(FriendCollaborationRestriction.TOTAL_COLLABORATION)
        assertEquals(CollaborationScope.TOTAL_COLLABORATION, total.scope)
        assertEquals(listOf("chat", "status", "project_context", "task_handoff", "coordinate"), total.capabilities)

        listOf(chatOnly, projectOnly, total).forEach(::assertHasNoForbiddenCapabilities)
    }

    @Test
    fun `project only requires nonblank project metadata`() {
        assertFalse(
            CollaborationPolicy.validateFriendPreset(
                FriendCollaborationRestriction.PROJECT_ONLY,
                projectId = "",
                projectName = "Moonbase"
            ).isValid
        )
        assertFalse(
            CollaborationPolicy.validateFriendPreset(
                FriendCollaborationRestriction.PROJECT_ONLY,
                projectId = "project-7",
                projectName = "   "
            ).isValid
        )
        assertTrue(
            CollaborationPolicy.validateFriendPreset(
                FriendCollaborationRestriction.PROJECT_ONLY,
                projectId = "project-7",
                projectName = "Moonbase"
            ).isValid
        )
    }

    private fun assertHasNoForbiddenCapabilities(policy: CollaborationPolicy) {
        policy.capabilities.forEach { capability ->
            forbiddenFragments.forEach { forbidden ->
                assertFalse("$capability must not contain $forbidden", capability.contains(forbidden, ignoreCase = true))
            }
        }
    }
}
