package com.opencomms.app.pairing

import java.net.URI
import java.time.Instant

object PairingValidator {

    private val safeInviteCapabilities = setOf("chat", "status", "task_handoff", "memory_reference_request")
    private val allowedInviteModes = setOf("human_to_human", "own_agent", "friend_project_agents")

    fun validate(payload: PairingPayload): Result<PairingPayload> {
        if (payload.type != "opencomms_pairing_v1" && payload.type != "opencomms_pairing_invite_v1" && payload.type != "opencomms_agent_card_v1") {
            return Result.failure(PairingError.UnsupportedType)
        }

        if (!isAllowedRelayUrl(payload.relayUrl)) {
            return Result.failure(PairingError.MissingRelay)
        }

        payload.expiresAt?.let { expiresAtStr ->
            val expiry = runCatching { Instant.parse(expiresAtStr) }
                .getOrElse { return Result.failure(PairingError.Expired) }
            if (expiry.isBefore(Instant.now())) {
                return Result.failure(PairingError.Expired)
            }
        }

        if (payload.type == "opencomms_pairing_invite_v1") {
            val mode = payload.mode ?: return Result.failure(PairingError.UnsupportedType)
            if (!allowedInviteModes.contains(mode)) return Result.failure(PairingError.UnsupportedType)
            if (payload.contact.capabilities.any { !safeInviteCapabilities.contains(it) }) {
                return Result.failure(PairingError.BadKind)
            }
            when (mode) {
                "human_to_human" -> {
                    if (payload.contact.kind.name.lowercase() != "human") return Result.failure(PairingError.BadKind)
                    if (payload.projectId != null || payload.projectName != null || payload.agentIds.isNotEmpty()) {
                        return Result.failure(PairingError.MissingContact)
                    }
                }
                "own_agent" -> {
                    if (payload.contact.kind.name.lowercase() != "agent") return Result.failure(PairingError.BadKind)
                    if (payload.projectId != null || payload.projectName != null || payload.agentIds.isNotEmpty()) {
                        return Result.failure(PairingError.MissingContact)
                    }
                }
                "friend_project_agents" -> {
                    if (payload.projectId.isNullOrBlank() || payload.projectName.isNullOrBlank() || !isCanonicalAgentIds(payload.agentIds)) {
                        return Result.failure(PairingError.MissingContact)
                    }
                }
            }
            return Result.success(payload)
        }

        if (payload.type == "opencomms_agent_card_v1") {
            if (payload.contact.kind.name.lowercase() != "agent") return Result.failure(PairingError.BadKind)
            if (payload.contact.capabilities.any { !safeInviteCapabilities.contains(it) }) {
                return Result.failure(PairingError.BadKind)
            }
            return Result.success(payload)
        }

        val hasToken = !payload.token.isNullOrBlank()
        val hasPairingToken = !payload.pairingToken.isNullOrBlank()
        val hasPairingEndpoint = !payload.pairingEndpoint.isNullOrBlank()

        return when {
            hasToken || hasPairingToken -> Result.success(payload)
            hasPairingEndpoint -> Result.failure(PairingError.EndpointNotImplemented)
            else -> Result.failure(PairingError.MissingToken)
        }
    }

    private fun isAllowedRelayUrl(raw: String): Boolean {
        val uri = runCatching { URI(raw) }.getOrNull() ?: return false
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme == "https") return !uri.host.isNullOrBlank()
        if (scheme != "http") return false
        val host = uri.host?.lowercase() ?: return false
        return host == "localhost" || host == "127.0.0.1" || host == "::1"
    }

    private fun isCanonicalAgentIds(agentIds: List<String>): Boolean {
        return agentIds.isNotEmpty() && agentIds.none { it.isBlank() } && agentIds == agentIds.distinct().sorted()
    }

    fun parseAndValidate(raw: String): Result<PairingPayload> {
        val parsed = PairingParser.parse(raw)
        if (parsed.isFailure) return parsed
        return validate(parsed.getOrThrow())
    }
}
