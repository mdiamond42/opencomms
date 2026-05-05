package com.opencomms.app.relay

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RelayAccount(
    val id: String,
    @SerialName("relay_url") val relayUrl: String,
    val token: String,
    @SerialName("registered_as") val registeredAs: String,
    val label: String? = null,
    @SerialName("added_at") val addedAt: String
)
