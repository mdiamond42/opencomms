package com.opencomms.app.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Participant(
    val type: ParticipantKind,
    val id: String,
    @SerialName("device_id") val deviceId: String? = null
)
