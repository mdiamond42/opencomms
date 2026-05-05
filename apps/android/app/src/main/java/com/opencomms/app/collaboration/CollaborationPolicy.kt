package com.opencomms.app.collaboration

enum class FriendCollaborationRestriction {
    CHAT_ONLY,
    PROJECT_ONLY,
    TOTAL_COLLABORATION
}

data class CollaborationValidation(
    val isValid: Boolean,
    val message: String? = null
)

data class CollaborationPolicy(
    val scope: CollaborationScope,
    val capabilities: List<String>,
    val projectId: String? = null,
    val projectName: String? = null
) {
    companion object {
        fun ownAgentsUnrestricted(): CollaborationPolicy = CollaborationPolicy(
            scope = CollaborationScope.OWN_AGENTS_UNRESTRICTED,
            capabilities = listOf("chat", "status", "task_handoff", "coordinate", "tools_if_agent_policy_allows")
        )

        fun friendPreset(
            restriction: FriendCollaborationRestriction,
            projectId: String? = null,
            projectName: String? = null
        ): CollaborationPolicy {
            val validation = validateFriendPreset(restriction, projectId, projectName)
            require(validation.isValid) { validation.message ?: "Invalid collaboration policy" }
            return when (restriction) {
                FriendCollaborationRestriction.CHAT_ONLY -> CollaborationPolicy(
                    scope = CollaborationScope.CHAT_ONLY,
                    capabilities = listOf("chat", "status")
                )
                FriendCollaborationRestriction.PROJECT_ONLY -> CollaborationPolicy(
                    scope = CollaborationScope.PROJECT_ONLY,
                    capabilities = listOf("chat", "status", "project_context", "task_handoff"),
                    projectId = projectId!!.trim(),
                    projectName = projectName!!.trim()
                )
                FriendCollaborationRestriction.TOTAL_COLLABORATION -> CollaborationPolicy(
                    scope = CollaborationScope.TOTAL_COLLABORATION,
                    capabilities = listOf("chat", "status", "project_context", "task_handoff", "coordinate")
                )
            }
        }

        fun validateFriendPreset(
            restriction: FriendCollaborationRestriction,
            projectId: String? = null,
            projectName: String? = null
        ): CollaborationValidation {
            if (restriction == FriendCollaborationRestriction.PROJECT_ONLY &&
                (projectId.isNullOrBlank() || projectName.isNullOrBlank())
            ) {
                return CollaborationValidation(false, "Project-only collaboration requires project id and project name.")
            }
            return CollaborationValidation(true)
        }
    }
}
