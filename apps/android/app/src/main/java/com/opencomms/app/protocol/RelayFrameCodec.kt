package com.opencomms.app.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

sealed class RelayFrame {
    data class Registered(val userId: String, val usersOnline: List<String>) : RelayFrame()
    data class IncomingEnvelope(val envelope: EnvelopeV01) : RelayFrame()
    data class Delivery(
        val status: String,
        val envelopeId: String,
        val recipientId: String,
        val recipientSocketCount: Int? = null
    ) : RelayFrame()
    data class Pong(val at: String? = null) : RelayFrame()
    data class RelayError(val error: String? = null, val code: String? = null, val message: String? = null) : RelayFrame() {
        val displayMessage: String
            get() = error?.takeIf { it.isNotBlank() }
                ?: message?.takeIf { it.isNotBlank() }
                ?: "unknown error"
    }
    data class Unknown(val type: String?, val raw: String) : RelayFrame()
}

@Serializable
private data class RegisteredPayload(
    @SerialName("user_id") val userId: String,
    @SerialName("users_online") val usersOnline: List<String> = emptyList()
)

@Serializable
private data class EnvelopeFramePayload(
    val envelope: EnvelopeV01
)

@Serializable
private data class ErrorPayload(
    val error: String? = null,
    val code: String? = null,
    val message: String? = null
)

@Serializable
private data class DeliveryPayload(
    val status: String,
    @SerialName("envelope_id") val envelopeId: String,
    @SerialName("recipient_id") val recipientId: String,
    @SerialName("recipient_socket_count") val recipientSocketCount: Int? = null
)

object RelayFrameCodec {

    private val json = Json { ignoreUnknownKeys = true }

    fun decode(raw: String): RelayFrame {
        return runCatching {
            val obj: JsonObject = json.parseToJsonElement(raw).jsonObject
            val type = obj["type"]?.jsonPrimitive?.content
            when (type) {
                "registered" -> decodeRegistered(raw, obj)
                "envelope" -> {
                    val p = json.decodeFromString<EnvelopeFramePayload>(raw)
                    RelayFrame.IncomingEnvelope(p.envelope)
                }
                "delivery" -> {
                    val p = json.decodeFromString<DeliveryPayload>(raw)
                    RelayFrame.Delivery(p.status, p.envelopeId, p.recipientId, p.recipientSocketCount)
                }
                "pong" -> RelayFrame.Pong(obj["at"]?.jsonPrimitive?.content)
                "error" -> {
                    val p = json.decodeFromString<ErrorPayload>(raw)
                    RelayFrame.RelayError(error = p.error, code = p.code, message = p.message)
                }
                else -> RelayFrame.Unknown(type, raw)
            }
        }.getOrElse {
            val type = runCatching {
                json.parseToJsonElement(raw).jsonObject["type"]?.jsonPrimitive?.content
            }.getOrNull()
            RelayFrame.Unknown(type, raw)
        }
    }

    private fun decodeRegistered(raw: String, obj: JsonObject): RelayFrame.Registered {
        val decoded = runCatching { json.decodeFromString<RegisteredPayload>(raw) }.getOrNull()
        if (decoded != null) return RelayFrame.Registered(decoded.userId, decoded.usersOnline)

        // Defensive fallback keeps the current relay success frame visible even if extra/odd fields appear.
        val userId = obj["user_id"]?.jsonPrimitive?.content ?: ""
        val usersOnline = obj["users_online"]?.jsonArray?.mapNotNull {
            runCatching { it.jsonPrimitive.content }.getOrNull()
        } ?: emptyList()
        return RelayFrame.Registered(userId, usersOnline)
    }
}
