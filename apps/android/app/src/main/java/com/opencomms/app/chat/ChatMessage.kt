package com.opencomms.app.chat

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class Direction { OUTBOUND, INBOUND }

@Serializable
enum class DeliveryState { PENDING, SENT, DELIVERED, FAILED }

@Serializable
data class ChatMessage(
    val id: String,
    @SerialName("contact_id") val contactId: String,
    val direction: Direction,
    val text: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("delivery_state") val deliveryState: DeliveryState,
    @SerialName("error_message") val errorMessage: String? = null,
    @SerialName("envelope_id") val envelopeId: String? = null
)
