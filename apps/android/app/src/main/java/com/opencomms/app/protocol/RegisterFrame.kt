package com.opencomms.app.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Register frame shape aligned with current relay behavior:
 *   { "type": "register", "user_id": "<id>", "token": "<token>" }
 */
@Serializable
data class RegisterFrame(
    val type: String = "register",
    @SerialName("user_id") val userId: String,
    val token: String
)

object RegisterFrameBuilder {

    private val json = Json { encodeDefaults = true }

    fun build(userId: String, token: String): String =
        json.encodeToString(RegisterFrame(userId = userId, token = token))
}
