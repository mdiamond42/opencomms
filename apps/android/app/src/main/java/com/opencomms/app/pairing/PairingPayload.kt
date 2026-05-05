package com.opencomms.app.pairing

import com.opencomms.app.protocol.ParticipantKind

data class PairingPayload(
    val type: String,
    val relayUrl: String,
    val pairingEndpoint: String?,
    val pairingToken: String?,
    val token: String?,
    val expiresAt: String?,
    val contact: PairingContact,
    val serverPublicKey: String?,
    val inviteId: String? = null,
    val mode: String? = null,
    val issuer: PairingIssuer? = null,
    val projectId: String? = null,
    val projectName: String? = null,
    val agentIds: List<String> = emptyList(),
    val safetyCode: String? = null
)

data class PairingIssuer(
    val id: String,
    val kind: ParticipantKind,
    val displayName: String
)

data class PairingContact(
    val id: String,
    val displayName: String,
    val kind: ParticipantKind,
    val capabilities: List<String> = emptyList()
)
