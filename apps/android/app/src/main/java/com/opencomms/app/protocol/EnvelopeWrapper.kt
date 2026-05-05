package com.opencomms.app.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.util.UUID

@Serializable
data class OutboundEnvelopeFrame(
    val type: String = "envelope",
    val envelope: EnvelopeV01
)

object EnvelopeWrapper {

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    fun wrap(envelope: EnvelopeV01): String = json.encodeToString(buildJsonObject {
        put("type", "envelope")
        put("envelope", buildJsonObject {
            put("version", envelope.version)
            put("id", envelope.id)
            put("idempotency_key", envelope.idempotencyKey)
            put("created_at", envelope.createdAt)
            put("expires_at", envelope.expiresAt)
            put("sender", participantJson(envelope.sender, includeDeviceId = true))
            put("recipient", participantJson(envelope.recipient, includeDeviceId = false))
            put("channel", envelope.channel)
            put("intent", envelope.intent)
            put("requires_ack", envelope.requiresAck)
            if (envelope.correlationId == null) {
                put("correlation_id", JsonNull)
            } else {
                put("correlation_id", envelope.correlationId)
            }
            put("payload", buildJsonObject {
                put("content_type", envelope.payload.contentType)
                put("body", envelope.payload.body)
                envelope.payload.summary?.let { put("summary", it) }
            })
            put("permissions", buildJsonObject {
                put("may_execute_tools", envelope.permissions.mayExecuteTools)
                put("may_notify_human", envelope.permissions.mayNotifyHuman)
                put("risk_level", envelope.permissions.riskLevel)
            })
        })
    })

    fun buildTextEnvelope(
        id: String = UUID.randomUUID().toString(),
        createdAt: String = Instant.now().toString(),
        sender: Participant,
        recipient: Participant,
        text: String,
        idempotencyKey: String = UUID.randomUUID().toString(),
        expiresAt: String = Instant.parse(createdAt).plusSeconds(300).toString(),
        requiresAck: Boolean = true,
        correlationId: String? = null
    ): EnvelopeV01 = EnvelopeV01(
        version = "0.1",
        id = id,
        idempotencyKey = idempotencyKey,
        createdAt = createdAt,
        expiresAt = expiresAt,
        sender = sender,
        recipient = recipient,
        channel = "text",
        intent = "message",
        requiresAck = requiresAck,
        correlationId = correlationId,
        payload = EnvelopePayload(contentType = "text/plain", body = text),
        permissions = EnvelopePermissions(
            mayExecuteTools = false,
            mayNotifyHuman = true,
            riskLevel = "low"
        )
    )

    fun buildTextEnvelope(
        senderId: String,
        recipientId: String,
        body: String,
        recipientType: ParticipantKind = ParticipantKind.AGENT
    ): String = wrap(
        buildTextEnvelope(
            sender = Participant(ParticipantKind.HUMAN, senderId, "android"),
            recipient = Participant(recipientType, recipientId),
            text = body
        )
    )

    private fun participantJson(participant: Participant, includeDeviceId: Boolean) = buildJsonObject {
        put("type", participant.type.wireValue)
        put("id", participant.id)
        if (includeDeviceId) participant.deviceId?.let { put("device_id", it) }
    }

    private val ParticipantKind.wireValue: String
        get() = when (this) {
            ParticipantKind.HUMAN -> "human"
            ParticipantKind.AGENT -> "agent"
            // Current TS protocol accepts human|agent|service only. Preserve DEVICE as a
            // local contact kind for pairing/UI, but never emit the unsupported "device"
            // participant type on the wire until packages/protocol adds it.
            ParticipantKind.DEVICE -> "service"
            ParticipantKind.SERVICE -> "service"
        }
}
