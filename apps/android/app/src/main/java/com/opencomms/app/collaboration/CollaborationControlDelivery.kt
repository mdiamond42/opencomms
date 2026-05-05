package com.opencomms.app.collaboration

object CollaborationControlDelivery {
    fun afterDisconnectAttempt(
        collaboration: AgentCollaboration,
        noticeResults: List<Boolean>,
        now: String
    ): AgentCollaboration = if (noticeResults.size == 2 && noticeResults.all { it }) {
        CollaborationLifecycle.disconnect(collaboration, now)
    } else {
        collaboration
    }

    fun afterRevokeAttempt(
        collaboration: AgentCollaboration,
        noticeResults: List<Boolean>,
        now: String
    ): AgentCollaboration = CollaborationLifecycle.revoke(collaboration, now)
}
