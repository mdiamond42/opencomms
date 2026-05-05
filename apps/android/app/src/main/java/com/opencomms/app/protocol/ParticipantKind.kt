package com.opencomms.app.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class ParticipantKind {
    @SerialName("human") HUMAN,
    @SerialName("agent") AGENT,
    @SerialName("device") DEVICE,
    @SerialName("service") SERVICE;

    companion object {
        fun fromString(value: String): ParticipantKind? = when (value.lowercase()) {
            "human" -> HUMAN
            "agent" -> AGENT
            "device" -> DEVICE
            "service" -> SERVICE
            else -> null
        }
    }
}
