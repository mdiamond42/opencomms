package com.opencomms.app.identity

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LocalIdentity(
    @SerialName("human_id") val humanId: String,
    @SerialName("device_id") val deviceId: String,
    @SerialName("display_name") val displayName: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("public_key") val publicKey: String? = null,
    @SerialName("private_key_opaque") val privateKeyOpaque: String? = null
)
