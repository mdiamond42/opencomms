package com.opencomms.app.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * AgentComms/OpenComms protocol v0.1 envelope.
 * Wire format is strict server-side; keep JSON keys aligned with packages/protocol/src/envelope.ts.
 */
@Serializable
data class EnvelopePayload(
    @SerialName("content_type") val contentType: String,
    val body: String,
    val summary: String? = null
)

@Serializable
data class EnvelopePermissions(
    @SerialName("may_execute_tools") val mayExecuteTools: Boolean,
    @SerialName("may_notify_human") val mayNotifyHuman: Boolean,
    @SerialName("risk_level") val riskLevel: String
)

@Serializable
data class EnvelopeV01(
    val version: String = "0.1",
    val id: String,
    @SerialName("idempotency_key") val idempotencyKey: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("expires_at") val expiresAt: String,
    val sender: Participant,
    val recipient: Participant,
    val channel: String,
    val intent: String,
    @SerialName("requires_ack") val requiresAck: Boolean,
    @SerialName("correlation_id") val correlationId: String? = null,
    val payload: EnvelopePayload,
    val permissions: EnvelopePermissions
)
